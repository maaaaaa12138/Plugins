import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const router = path.join(
  pluginRoot,
  "skills",
  "agent-conductor",
  "scripts",
  "route-agents.mjs",
);
const fixtures = JSON.parse(
  fs.readFileSync(path.join(pluginRoot, "tests", "fixtures", "routing.json"), "utf8"),
);
const index = JSON.parse(
  fs.readFileSync(
    path.join(
      pluginRoot,
      "skills",
      "agent-conductor",
      "references",
      "agent-index.json",
    ),
    "utf8",
  ),
);

function invokeRouter(query, options = {}) {
  const args = [router, "--query", query, "--limit", String(options.limit ?? 5)];
  if (options.scope) args.push("--scope", options.scope);
  if (options.project) args.push("--project", options.project);
  const result = spawnSync(process.execPath, args, { encoding: "utf8" });
  return result;
}

function runRouter(query, options = {}) {
  const result = invokeRouter(query, options);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test("routing hints cover all indexed role-bearing categories", () => {
  const hints = JSON.parse(
    fs.readFileSync(
      path.join(
        pluginRoot,
        "skills",
        "agent-conductor",
        "references",
        "routing-hints.json",
      ),
      "utf8",
    ),
  );
  const indexed = [...new Set(index.agents.map((agent) => agent.category))].sort();
  assert.equal(indexed.length, 19);
  assert.deepEqual([...hints.categories].sort(), indexed);
  assert.equal(hints.config.defaultAgent, "default");
});

test("every category routes confidently in Chinese and English", () => {
  for (const fixture of fixtures.categoryFixtures) {
    for (const language of ["zh", "en"]) {
      const result = runRouter(fixture[language], {
        scope: "bundled",
        limit: 5,
      });
      assert.equal(
        result.defaultUsed,
        false,
        `${fixture.category}/${language}: unexpectedly used default`,
      );
      assert.equal(
        result.candidates[0].category,
        fixture.category,
        `${fixture.category}/${language}: ${result.candidates[0].slug}`,
      );
      assert.equal(result.candidates[0].agent_source, "bundled");
      assert.equal(fs.existsSync(result.candidates[0].agent_file), true);
    }
  }
});

test("ambiguity fallback is evaluated before output limit", () => {
  for (const limit of [1, 5]) {
    const result = runRouter("产品设计", { scope: "bundled", limit });
    assert.equal(result.defaultUsed, true);
    assert.equal(result.fallback.agent_type, "default");
    assert.equal(result.fallback.agent_source, "builtin");
    assert.equal(result.candidates.length, limit);
    assert.ok(result.confidence.runnerUpScore > 0);
    assert.ok(result.confidence.separation < result.confidence.minSeparation);
  }
});

test("unrelated requests use the built-in default Agent", () => {
  for (const query of fixtures.ambiguousFixtures.slice(1)) {
    const result = runRouter(query, { scope: "bundled", limit: 1 });
    assert.equal(result.defaultUsed, true);
    assert.deepEqual(result.fallback, {
      agent_type: "default",
      agent_file: null,
      agent_source: "builtin",
      reason: result.fallback.reason,
    });
  }
});

test("Chinese bigrams are recall-only evidence", () => {
  const result = runRouter("前端开发", { scope: "bundled", limit: 5 });
  const top = result.candidates[0];
  assert.deepEqual(top.evidence.ordinaryTokens, []);
  assert.ok(top.evidence.chineseBigrams.includes("前端"));
  assert.ok(top.evidence.chineseBigrams.includes("开发"));
  assert.equal(top.evidence.bigramScore > 0, true);
});

test("short Latin hint terms do not match inside unrelated words", () => {
  const result = runRouter(
    "tax strategist for transfer pricing and corporate tax compliance",
    { scope: "bundled", limit: 5 },
  );
  assert.equal(result.defaultUsed, false);
  assert.equal(result.candidates[0].category, "finance");
  assert.equal(result.candidates[0].matchedHints.includes("gis-geo"), false);
});

test("Latin stop words do not contribute ordinary token evidence", () => {
  const result = runRouter(
    "HR recruiter for candidate screening and hiring workflow",
    { scope: "bundled", limit: 5 },
  );
  assert.equal(result.defaultUsed, false);
  assert.equal(result.candidates[0].slug, "hr-recruiter");
  assert.equal(result.candidates[0].evidence.ordinaryTokens.includes("for"), false);
  assert.equal(result.candidates[0].evidence.ordinaryTokens.includes("and"), false);
});

test("scope resolution prefers project, then global, then bundled", () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "agent-conductor-project-"));
  const projectAgents = path.join(project, ".codex", "agents");
  fs.mkdirSync(projectAgents, { recursive: true });
  const slug = "engineering-frontend-developer";
  const projectFile = path.join(projectAgents, `${slug}.toml`);
  fs.writeFileSync(projectFile, 'name = "engineering-frontend-developer"\n', "utf8");
  try {
    const explicitProject = runRouter("前端开发", {
      scope: "project",
      project,
      limit: 1,
    });
    assert.equal(explicitProject.candidates[0].agent_source, "project");
    assert.equal(path.normalize(explicitProject.candidates[0].agent_file), projectFile);

    const auto = runRouter("前端开发", {
      scope: "auto",
      project,
      limit: 1,
    });
    assert.equal(auto.candidates[0].agent_source, "project");

    const bundled = runRouter("前端开发", { scope: "bundled", limit: 1 });
    assert.equal(bundled.candidates[0].agent_source, "bundled");
    assert.match(
      bundled.candidates[0].agent_file.replaceAll("\\", "/"),
      /\/assets\/agents\/engineering-frontend-developer\.toml$/,
    );
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test("explicit project scope fails when the selected role file is missing", () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "agent-conductor-empty-"));
  try {
    const result = invokeRouter("前端开发", {
      scope: "project",
      project,
      limit: 1,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Resolved Agent file does not exist/);
    assert.equal(result.stdout, "");
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});
