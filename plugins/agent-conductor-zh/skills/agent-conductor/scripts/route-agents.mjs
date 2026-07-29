#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(scriptDir, "..");
const pluginRoot = path.resolve(skillRoot, "..", "..");
const referencesDir = path.join(skillRoot, "references");
const latinStopWords = new Set([
  "a",
  "an",
  "and",
  "for",
  "from",
  "in",
  "into",
  "of",
  "on",
  "or",
  "the",
  "to",
  "using",
  "with",
]);

function fail(message, exitCode = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(exitCode);
}

function parseArguments(argv) {
  const queries = [];
  let limit = 5;
  let scope = "auto";
  let projectRoot = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--query" && argv[index + 1]) {
      queries.push(argv[++index]);
    } else if (argument === "--limit" && argv[index + 1]) {
      const parsed = Number(argv[++index]);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 50) {
        fail("--limit must be an integer from 1 to 50", 2);
      }
      limit = parsed;
    } else if (argument === "--scope" && argv[index + 1]) {
      scope = argv[++index];
    } else if (argument === "--project" && argv[index + 1]) {
      projectRoot = path.resolve(argv[++index]);
    } else {
      fail(`Unknown or incomplete argument: ${argument}`, 2);
    }
  }
  if (queries.length === 0) fail("At least one --query is required", 2);
  if (!new Set(["auto", "global", "project", "bundled"]).has(scope)) {
    fail("--scope must be auto, global, project, or bundled", 2);
  }
  if (scope === "project" && !projectRoot) {
    fail("--scope project requires --project with an absolute project root", 2);
  }
  return { queries, limit, scope, projectRoot };
}

function readRoutingData() {
  const index = JSON.parse(
    fs.readFileSync(path.join(referencesDir, "agent-index.json"), "utf8"),
  );
  const hintsDocument = JSON.parse(
    fs.readFileSync(path.join(referencesDir, "routing-hints.json"), "utf8"),
  );
  const indexedCategories = [
    ...new Set(index.agents.map((agent) => agent.category)),
  ].sort();
  const declaredCategories = [...hintsDocument.categories].sort();
  if (JSON.stringify(indexedCategories) !== JSON.stringify(declaredCategories)) {
    throw new Error("routing-hints categories do not match the Agent index");
  }
  if (hintsDocument.config.defaultAgent !== "default") {
    throw new Error('routing-hints defaultAgent must be the built-in "default"');
  }
  const indexedSlugs = new Set(index.agents.map((agent) => agent.slug));
  const categorySet = new Set(indexedCategories);
  for (const hint of hintsDocument.hints) {
    for (const category of Object.keys(hint.categoryBoosts ?? {})) {
      if (!categorySet.has(category)) {
        throw new Error(`Unknown category in hint ${hint.id}: ${category}`);
      }
    }
    for (const slug of [
      ...Object.keys(hint.agentBoosts ?? {}),
      ...Object.keys(hint.penalties ?? {}),
    ]) {
      if (!indexedSlugs.has(slug)) {
        throw new Error(`Unknown Agent in hint ${hint.id}: ${slug}`);
      }
    }
    for (const pattern of hint.patterns ?? []) new RegExp(pattern, "i");
  }
  return { index, ...hintsDocument };
}

function normalize(text) {
  return String(text).normalize("NFKC").toLowerCase();
}

function latinTokens(text) {
  return [
    ...new Set(
      [...text.matchAll(/[a-z0-9][a-z0-9-]*/g)]
        .map((match) => match[0])
        .filter((token) => token.length > 1 && !latinStopWords.has(token)),
    ),
  ];
}

function chineseBigrams(text) {
  const bigrams = new Set();
  for (const run of text.match(/[\u3400-\u9fff]+/g) ?? []) {
    if (run.length <= 2) {
      bigrams.add(run);
      continue;
    }
    for (let index = 0; index < run.length - 1; index += 1) {
      bigrams.add(run.slice(index, index + 2));
    }
  }
  return [...bigrams];
}

function hintPatternMatches(queryNorm, pattern) {
  const queryLatinTokens = latinTokens(queryNorm);
  return pattern.split("|").some((alternative) => {
    const term = normalize(alternative.trim());
    if (!term) return false;
    if (/[^\x00-\x7f]/.test(term)) return queryNorm.includes(term);
    const termTokens = latinTokens(term);
    if (termTokens.length > 1) {
      const queryWords = queryLatinTokens.join(" ");
      return queryWords.includes(termTokens.join(" "));
    }
    const token = termTokens[0];
    if (!token) return false;
    return queryLatinTokens.some(
      (queryToken) =>
        queryToken === token || (token.length >= 4 && queryToken.startsWith(token)),
    );
  });
}

function pathInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function requireExisting(file, source) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    throw new Error(`Resolved Agent file does not exist (${source}): ${file}`);
  }
  return { file: path.resolve(file), source };
}

function resolveAgentFile(slug, options) {
  const fileName = `${slug}.toml`;
  const bundledRoot = path.resolve(pluginRoot, "assets", "agents");
  const bundledFile = path.resolve(bundledRoot, fileName);
  if (!pathInside(bundledRoot, bundledFile)) {
    throw new Error(`Bundled Agent path escapes assets/agents: ${slug}`);
  }
  const globalFile = path.join(os.homedir(), ".codex", "agents", fileName);
  const projectFile = options.projectRoot
    ? path.join(options.projectRoot, ".codex", "agents", fileName)
    : null;

  if (options.scope === "bundled") return requireExisting(bundledFile, "bundled");
  if (options.scope === "global") return requireExisting(globalFile, "global");
  if (options.scope === "project") {
    return requireExisting(projectFile, "project");
  }
  if (projectFile && fs.existsSync(projectFile)) {
    return requireExisting(projectFile, "project");
  }
  if (fs.existsSync(globalFile)) return requireExisting(globalFile, "global");
  return requireExisting(bundledFile, "bundled");
}

function scoreAgents(index, hints, weights, queryNorm) {
  const ordinaryTokens = latinTokens(queryNorm);
  const bigrams = chineseBigrams(queryNorm);
  return index.agents.map((agent) => {
    const slug = normalize(agent.slug);
    const name = normalize(agent.name);
    const description = normalize(agent.description);
    const haystack = normalize(
      `${agent.slug} ${agent.name} ${agent.description} ${agent.category}`,
    );
    const matchedHints = [];
    const matchedPhrases = [];
    let curatedPhraseScore = 0;
    let exactRoleScore = 0;
    let ordinaryScore = 0;
    let bigramScore = 0;
    let categoryBoost = 0;
    let agentBoost = 0;
    let penalty = 0;

    for (const hint of hints) {
      let active = false;
      for (const phrase of hint.phrases ?? []) {
        const normalizedPhrase = normalize(phrase);
        if (
          normalizedPhrase &&
          (queryNorm.includes(normalizedPhrase) ||
            (queryNorm.length >= 2 && normalizedPhrase.includes(queryNorm)))
        ) {
          active = true;
          matchedPhrases.push(phrase);
          curatedPhraseScore += weights.curatedPhrase;
        }
      }
      for (const pattern of hint.patterns ?? []) {
        if (hintPatternMatches(queryNorm, pattern)) active = true;
      }
      if (active) {
        matchedHints.push(hint.id);
        categoryBoost += hint.categoryBoosts?.[agent.category] ?? 0;
        agentBoost += hint.agentBoosts?.[agent.slug] ?? 0;
        penalty += hint.penalties?.[agent.slug] ?? 0;
      }
    }

    if (queryNorm.includes(name) || queryNorm.includes(slug)) {
      exactRoleScore += weights.exactNameOrSlug;
    }

    for (const token of ordinaryTokens) {
      if (slug === token || name === token) ordinaryScore += weights.exactNameOrSlug;
      else if (slug.includes(token)) ordinaryScore += weights.slugContains;
      else if (name.includes(token)) ordinaryScore += weights.nameContains;
      else if (description.includes(token)) ordinaryScore += weights.descContains;
      else if (haystack.includes(token)) ordinaryScore += weights.haystackContains;
    }
    for (const bigram of bigrams) {
      if (haystack.includes(bigram)) bigramScore += weights.bigramRecall;
    }

    const score =
      curatedPhraseScore +
      exactRoleScore +
      ordinaryScore +
      bigramScore +
      categoryBoost +
      agentBoost +
      penalty;
    return {
      ...agent,
      score,
      matchedHints,
      evidence: {
        matchedPhrases,
        ordinaryTokens,
        chineseBigrams: bigrams,
        curatedPhraseScore,
        exactRoleScore,
        ordinaryScore,
        bigramScore,
        categoryBoost,
        agentBoost,
        penalty,
      },
    };
  });
}

function buildResult(data, options) {
  const queryNorm = normalize(options.queries.join(" "));
  const fullyRanked = scoreAgents(
    data.index,
    data.hints,
    data.weights,
    queryNorm,
  )
    .filter((agent) => agent.score > 0)
    .sort((left, right) => right.score - left.score || left.slug.localeCompare(right.slug));
  const topScore = fullyRanked[0]?.score ?? 0;
  const runnerUpScore = fullyRanked[1]?.score ?? 0;
  const separation = topScore - runnerUpScore;
  const lowScore = topScore < data.config.minTopScore;
  const ambiguous = fullyRanked.length > 1 && separation < data.config.minSeparation;
  const defaultUsed = fullyRanked.length === 0 || lowScore || ambiguous;
  const candidates = fullyRanked.slice(0, options.limit).map((agent) => {
    const resolved = resolveAgentFile(agent.slug, options);
    return {
      category: agent.category,
      slug: agent.slug,
      name: agent.name,
      description: agent.description,
      score: agent.score,
      matchedHints: agent.matchedHints,
      evidence: agent.evidence,
      agent_type: agent.slug,
      agent_file: resolved.file,
      agent_source: resolved.source,
    };
  });
  const reason =
    fullyRanked.length === 0 || lowScore
      ? "no candidate cleared minTopScore"
      : ambiguous
        ? "top candidate separation below minSeparation (ambiguous)"
        : "candidate confidence accepted";

  const result = {
    queries: options.queries,
    scope: options.scope,
    defaultAgent: data.config.defaultAgent,
    defaultUsed,
    confidence: {
      minTopScore: data.config.minTopScore,
      minSeparation: data.config.minSeparation,
      topScore,
      runnerUpScore,
      separation,
      reason,
    },
    candidates,
  };
  if (defaultUsed) {
    result.fallback = {
      agent_type: "default",
      agent_file: null,
      agent_source: "builtin",
      reason,
    };
  }
  return result;
}

try {
  const options = parseArguments(process.argv.slice(2));
  const data = readRoutingData();
  process.stdout.write(`${JSON.stringify(buildResult(data, options), null, 2)}\n`);
} catch (error) {
  fail(error.message);
}
