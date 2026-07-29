import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jsRouter = path.join(
  pluginRoot,
  "skills",
  "agent-conductor",
  "scripts",
  "route-agents.mjs",
);
const psRouter = path.join(
  pluginRoot,
  "skills",
  "agent-conductor",
  "scripts",
  "route-agents.ps1",
);
const standalone = path.join(pluginRoot, "tests", "run-router-tests.ps1");
const fixtures = JSON.parse(
  fs.readFileSync(path.join(pluginRoot, "tests", "fixtures", "routing.json"), "utf8"),
);

function findPowerShell() {
  for (const command of ["powershell.exe", "pwsh.exe", "pwsh"]) {
    const result = spawnSync(command, ["-NoProfile", "-Command", "exit 0"], {
      encoding: "utf8",
    });
    if (result.status === 0) return command;
  }
  return null;
}

const powerShell = findPowerShell();

function runJson(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
  assert.equal(
    result.status,
    0,
    `${command} exited ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  assert.equal(result.stderr, "");
  try {
    return JSON.parse(result.stdout.replace(/^\uFEFF/, ""));
  } catch (error) {
    assert.fail(`Invalid JSON from ${command}: ${error.message}\n${result.stdout}`);
  }
}

function runJavaScript(query, options = {}) {
  const args = [
    jsRouter,
    "--query",
    query,
    "--limit",
    String(options.limit ?? 3),
    "--scope",
    options.scope ?? "bundled",
  ];
  if (options.project) args.push("--project", options.project);
  return runJson(process.execPath, args);
}

function runPowerShell(query, options = {}) {
  assert.ok(powerShell, "PowerShell is unavailable");
  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    psRouter,
    "-Query",
    query,
    "-Limit",
    String(options.limit ?? 3),
    "-Scope",
    options.scope ?? "bundled",
  ];
  if (options.project) args.push("-Project", options.project);
  return runJson(powerShell, args);
}

function normalizeResult(result) {
  return {
    queries: result.queries,
    scope: result.scope,
    defaultAgent: result.defaultAgent,
    defaultUsed: result.defaultUsed,
    confidence: result.confidence,
    candidates: result.candidates.map((candidate) => ({
      ...candidate,
      agent_file: path.normalize(candidate.agent_file),
    })),
    ...(result.fallback ? { fallback: result.fallback } : {}),
  };
}

test(
  "PowerShell and JavaScript routers return equivalent full output",
  { skip: powerShell ? false : "PowerShell unavailable" },
  () => {
    const cases = fixtures.categoryFixtures.flatMap((fixture) => [
      { query: fixture.zh, options: { scope: "bundled", limit: 3 } },
      { query: fixture.en, options: { scope: "bundled", limit: 3 } },
    ]);
    cases.push(
      { query: "产品设计", options: { scope: "bundled", limit: 1 } },
      { query: "写一首关于秋天的诗", options: { scope: "bundled", limit: 3 } },
    );
    for (const item of cases) {
      assert.deepEqual(
        normalizeResult(runPowerShell(item.query, item.options)),
        normalizeResult(runJavaScript(item.query, item.options)),
        item.query,
      );
    }
  },
);

test(
  "PowerShell and JavaScript project scope paths are equivalent",
  { skip: powerShell ? false : "PowerShell unavailable" },
  () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "router-parity-"));
    const agents = path.join(project, ".codex", "agents");
    fs.mkdirSync(agents, { recursive: true });
    fs.copyFileSync(
      path.join(
        pluginRoot,
        "assets",
        "agents",
        "engineering-frontend-developer.toml",
      ),
      path.join(agents, "engineering-frontend-developer.toml"),
    );
    try {
      const options = { scope: "project", project, limit: 1 };
      assert.deepEqual(
        normalizeResult(runPowerShell("前端开发", options)),
        normalizeResult(runJavaScript("前端开发", options)),
      );
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  },
);

test("standalone PowerShell entrypoint resolves the real router path", () => {
  const script = fs.readFileSync(standalone, "utf8");
  assert.match(
    script,
    /Join-PathSegments \$pluginRoot "skills" "agent-conductor" "scripts" "route-agents\.ps1"/,
  );
  assert.equal(fs.existsSync(psRouter), true);
});
