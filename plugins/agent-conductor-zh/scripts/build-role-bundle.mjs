#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) {
      throw new Error(
        "Usage: build-role-bundle.mjs --index <file> --source-agents <dir> --upstream-revision <sha> --plugin-version <semver>",
      );
    }
    values.set(key, value);
  }
  for (const required of [
    "--index",
    "--source-agents",
    "--upstream-revision",
    "--plugin-version",
  ]) {
    if (!values.has(required)) throw new Error(`Missing ${required}`);
  }
  return {
    indexPath: path.resolve(values.get("--index")),
    sourceAgents: path.resolve(values.get("--source-agents")),
    upstreamRevision: values.get("--upstream-revision"),
    pluginVersion: values.get("--plugin-version"),
  };
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function validateIndex(index) {
  if (!Array.isArray(index.agents) || index.agents.length !== 268) {
    throw new Error("Agent index must contain exactly 268 roles");
  }
  const slugs = new Set();
  const names = new Set();
  for (const agent of index.agents) {
    if (!slugPattern.test(agent.slug)) throw new Error(`Invalid slug: ${agent.slug}`);
    if (!agent.category || !agent.name || !agent.description) {
      throw new Error(`Incomplete index record: ${agent.slug}`);
    }
    if (slugs.has(agent.slug)) throw new Error(`Duplicate slug: ${agent.slug}`);
    if (names.has(agent.name)) throw new Error(`Duplicate display name: ${agent.name}`);
    slugs.add(agent.slug);
    names.add(agent.name);
  }
  const categories = new Set(index.agents.map((agent) => agent.category));
  if (categories.size !== 19) {
    throw new Error(`Expected 19 role-bearing categories, found ${categories.size}`);
  }
}

function buildBundle(options) {
  if (!/^[0-9a-f]{40}$/.test(options.upstreamRevision)) {
    throw new Error("Upstream revision must be a 40-character lowercase Git SHA");
  }
  const index = JSON.parse(fs.readFileSync(options.indexPath, "utf8"));
  validateIndex(index);

  const agentsDir = path.join(pluginRoot, "assets", "agents");
  fs.mkdirSync(agentsDir, { recursive: true });
  const expectedFiles = new Set(index.agents.map((agent) => `${agent.slug}.toml`));
  const unexpectedFiles = fs
    .readdirSync(agentsDir)
    .filter((file) => file.endsWith(".toml") && !expectedFiles.has(file));
  if (unexpectedFiles.length > 0) {
    throw new Error(`Unexpected existing role files: ${unexpectedFiles.join(", ")}`);
  }

  const roles = [];
  for (const agent of index.agents) {
    const fileName = `${agent.slug}.toml`;
    const source = path.join(options.sourceAgents, fileName);
    const destination = path.join(agentsDir, fileName);
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
      throw new Error(`Missing source role: ${source}`);
    }
    fs.copyFileSync(source, destination);
    roles.push({
      slug: agent.slug,
      category: agent.category,
      path: `agents/${fileName}`,
      sha256: sha256(destination),
      source: "jnMetaCode/agency-agents-zh",
    });
  }

  const manifest = {
    schemaVersion: 1,
    pluginVersion: options.pluginVersion,
    roleBundleVersion: `agency-agents-zh-${options.upstreamRevision.slice(0, 12)}`,
    generatedAt: index.generatedAt,
    upstream: {
      repository: "https://github.com/jnMetaCode/agency-agents-zh",
      revision: options.upstreamRevision,
    },
    roleCount: roles.length,
    roleBearingCategoryCount: new Set(
      index.agents.map((agent) => agent.category),
    ).size,
    roles,
  };
  fs.writeFileSync(
    path.join(pluginRoot, "assets", "roles-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  process.stdout.write(
    `Built ${roles.length} roles across ${manifest.roleBearingCategoryCount} categories\n`,
  );
}

try {
  buildBundle(parseArguments(process.argv.slice(2)));
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
