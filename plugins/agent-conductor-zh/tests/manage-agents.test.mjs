import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manager = path.join(pluginRoot, "scripts", "manage-agents.mjs");
const testRunner = path.join(pluginRoot, "tests", "manage-agents-runner.mjs");

function hash(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function roleContent(slug, marker) {
  return `name = "${slug}"\ndescription = "${marker}"\ndeveloper_instructions = """\n${marker}\n"""\n`;
}

function writeBundle(root, roles, version = "bundle-v1") {
  const agentsDir = path.join(root, "assets", "agents");
  fs.mkdirSync(agentsDir, { recursive: true });
  const manifestRoles = [];
  for (const [slug, content] of Object.entries(roles)) {
    const file = path.join(agentsDir, `${slug}.toml`);
    fs.writeFileSync(file, content, "utf8");
    manifestRoles.push({
      slug,
      category: "testing",
      path: `agents/${slug}.toml`,
      sha256: hash(content),
      source: "test-fixture",
    });
  }
  const manifest = {
    schemaVersion: 1,
    pluginVersion: "1.0.0",
    roleBundleVersion: version,
    upstream: { repository: "https://example.test/roles", revision: "a".repeat(40) },
    roleCount: manifestRoles.length,
    roleBearingCategoryCount: 1,
    roles: manifestRoles,
  };
  fs.writeFileSync(
    path.join(root, "assets", "roles-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-manager-test-"));
  const home = path.join(root, "home");
  const bundle = path.join(root, "bundle");
  fs.mkdirSync(home, { recursive: true });
  writeBundle(bundle, {
    alpha: roleContent("alpha", "alpha-v1"),
    beta: roleContent("beta", "beta-v1"),
  });
  return {
    root,
    home,
    bundle,
    target: path.join(home, ".codex", "agents"),
    state: path.join(home, ".codex", "agent-conductor-zh", "state.json"),
  };
}

function invoke(action, context, extra = []) {
  const args = [
    testRunner,
    action,
    "--scope",
    "global",
    "--home",
    context.home,
    "--bundle-root",
    context.bundle,
    "--json",
    ...extra,
  ];
  return spawnSync(process.execPath, args, {
    encoding: "utf8",
    env: { ...process.env, NODE_ENV: "test" },
  });
}

function run(action, context, extra = []) {
  const result = invoke(action, context, extra);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stderr, "");
  return JSON.parse(result.stdout);
}

function cleanup(context) {
  fs.rmSync(context.root, { recursive: true, force: true });
}

test("fresh global install is dry-runnable and writes owned files plus state", () => {
  const context = fixture();
  try {
    const preview = run("install", context, ["--dry-run"]);
    assert.equal(preview.dryRun, true);
    assert.deepEqual(preview.actionCounts, {
      add: 2,
      update: 0,
      keep: 0,
      remove: 0,
      missing: 0,
      modified: 0,
      conflict: 0,
    });
    assert.equal(fs.existsSync(context.target), false);

    const installed = run("install", context);
    assert.equal(installed.actionCounts.add, 2);
    assert.deepEqual(
      fs.readdirSync(context.target).sort(),
      ["alpha.toml", "beta.toml"],
    );
    const state = JSON.parse(fs.readFileSync(context.state, "utf8"));
    assert.equal(state.scope, "global");
    assert.deepEqual(Object.keys(state.files).sort(), ["alpha", "beta"]);
  } finally {
    cleanup(context);
  }
});

test("production CLI rejects test path overrides even when NODE_ENV is test", () => {
  const context = fixture();
  try {
    const result = spawnSync(
      process.execPath,
      [
        manager,
        "install",
        "--home",
        context.home,
        "--bundle-root",
        context.bundle,
        "--json",
      ],
      { encoding: "utf8", env: { ...process.env, NODE_ENV: "test" } },
    );
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Unknown argument: --home/);
    assert.equal(fs.existsSync(context.target), false);
  } finally {
    cleanup(context);
  }
});

test("second install is idempotent", () => {
  const context = fixture();
  try {
    run("install", context);
    const before = fs.statSync(path.join(context.target, "alpha.toml")).mtimeMs;
    const second = run("install", context);
    assert.equal(second.actionCounts.keep, 2);
    assert.equal(second.changed, false);
    assert.equal(fs.statSync(path.join(context.target, "alpha.toml")).mtimeMs, before);
  } finally {
    cleanup(context);
  }
});

test("project scope requires an explicit absolute project root", () => {
  const context = fixture();
  try {
    const result = spawnSync(
      process.execPath,
      [
        testRunner,
        "install",
        "--scope",
        "project",
        "--home",
        context.home,
        "--bundle-root",
        context.bundle,
        "--json",
      ],
      { encoding: "utf8", env: { ...process.env, NODE_ENV: "test" } },
    );
    assert.equal(result.status, 2);
    assert.match(result.stderr, /requires --project with an absolute path/);
  } finally {
    cleanup(context);
  }
});

test("pre-existing unmanaged role is never overwritten", () => {
  const context = fixture();
  try {
    fs.mkdirSync(context.target, { recursive: true });
    const existing = roleContent("alpha", "user-owned");
    fs.writeFileSync(path.join(context.target, "alpha.toml"), existing, "utf8");
    const result = run("install", context);
    assert.equal(result.actionCounts.add, 1);
    assert.equal(result.actionCounts.conflict, 1);
    assert.equal(fs.readFileSync(path.join(context.target, "alpha.toml"), "utf8"), existing);
    const state = JSON.parse(fs.readFileSync(context.state, "utf8"));
    assert.deepEqual(Object.keys(state.files), ["beta"]);
  } finally {
    cleanup(context);
  }
});

test("update replaces only unchanged managed files", () => {
  const context = fixture();
  try {
    run("install", context);
    writeBundle(
      context.bundle,
      {
        alpha: roleContent("alpha", "alpha-v2"),
        beta: roleContent("beta", "beta-v1"),
      },
      "bundle-v2",
    );
    const result = run("update", context);
    assert.equal(result.actionCounts.update, 1);
    assert.equal(result.actionCounts.keep, 1);
    assert.match(fs.readFileSync(path.join(context.target, "alpha.toml"), "utf8"), /alpha-v2/);
  } finally {
    cleanup(context);
  }
});

test("user-modified managed role survives update and uninstall", () => {
  const context = fixture();
  try {
    run("install", context);
    const changed = roleContent("alpha", "user-modified");
    fs.writeFileSync(path.join(context.target, "alpha.toml"), changed, "utf8");
    writeBundle(
      context.bundle,
      {
        alpha: roleContent("alpha", "alpha-v2"),
        beta: roleContent("beta", "beta-v1"),
      },
      "bundle-v2",
    );

    const update = run("update", context);
    assert.equal(update.actionCounts.conflict, 1);
    assert.equal(fs.readFileSync(path.join(context.target, "alpha.toml"), "utf8"), changed);

    const uninstall = run("uninstall", context);
    assert.equal(uninstall.actionCounts.remove, 1);
    assert.equal(uninstall.actionCounts.conflict, 1);
    assert.equal(fs.existsSync(path.join(context.target, "beta.toml")), false);
    assert.equal(fs.readFileSync(path.join(context.target, "alpha.toml"), "utf8"), changed);
  } finally {
    cleanup(context);
  }
});

test("invalid source hash aborts before destination writes", () => {
  const context = fixture();
  try {
    const manifestFile = path.join(context.bundle, "assets", "roles-manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
    manifest.roles[0].sha256 = "0".repeat(64);
    fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    const result = invoke("install", context);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Source hash mismatch/);
    assert.equal(fs.existsSync(context.target), false);
  } finally {
    cleanup(context);
  }
});

test("status reports missing, modified, and unmanaged conflicts", () => {
  const context = fixture();
  try {
    fs.mkdirSync(context.target, { recursive: true });
    fs.writeFileSync(
      path.join(context.target, "beta.toml"),
      roleContent("beta", "pre-existing"),
      "utf8",
    );
    run("install", context);
    fs.rmSync(path.join(context.target, "alpha.toml"));
    const status = run("status", context);
    assert.equal(status.actionCounts.missing, 1);
    assert.equal(status.actionCounts.conflict, 1);
  } finally {
    cleanup(context);
  }
});

test("status never reports that it changed files when an update is available", () => {
  const context = fixture();
  try {
    run("install", context);
    writeBundle(
      context.bundle,
      {
        alpha: roleContent("alpha", "alpha-v2"),
        beta: roleContent("beta", "beta-v1"),
      },
      "bundle-v2",
    );
    const status = run("status", context);
    assert.equal(status.actionCounts.update, 1);
    assert.equal(status.changed, false);
  } finally {
    cleanup(context);
  }
});

test("all operations reject an Agent directory junction without touching its target", () => {
  const context = fixture();
  try {
    run("install", context);
    const outside = path.join(context.root, "outside-agents");
    fs.renameSync(context.target, outside);
    fs.symlinkSync(
      outside,
      context.target,
      process.platform === "win32" ? "junction" : "dir",
    );
    const before = fs.readFileSync(path.join(outside, "alpha.toml"), "utf8");

    for (const action of ["status", "update", "uninstall"]) {
      const result = invoke(action, context);
      assert.equal(result.status, 1, `${action}: ${result.stderr || result.stdout}`);
      assert.match(result.stderr, /symbolic link|reparse|regular directory/i);
      assert.equal(fs.readFileSync(path.join(outside, "alpha.toml"), "utf8"), before);
    }
  } finally {
    cleanup(context);
  }
});

test("state replacement after planning aborts before role files change", () => {
  const context = fixture();
  try {
    run("install", context);
    writeBundle(
      context.bundle,
      {
        alpha: roleContent("alpha", "alpha-v2"),
        beta: roleContent("beta", "beta-v1"),
      },
      "bundle-v2",
    );
    const result = invoke("update", context, ["--tamper-state-before-apply"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Managed state changed during operation/);
    assert.match(
      fs.readFileSync(path.join(context.target, "alpha.toml"), "utf8"),
      /alpha-v1/,
    );
  } finally {
    cleanup(context);
  }
});

test("full bundled role set produces a 268-role dry run", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-manager-full-"));
  const context = {
    root,
    home: path.join(root, "home"),
    bundle: pluginRoot,
    target: path.join(root, "home", ".codex", "agents"),
  };
  fs.mkdirSync(context.home, { recursive: true });
  try {
    const result = run("install", context, ["--dry-run"]);
    assert.equal(result.bundleRoleCount, 268);
    assert.equal(result.actionCounts.add, 268);
    assert.equal(fs.existsSync(context.target), false);
  } finally {
    cleanup(context);
  }
});
