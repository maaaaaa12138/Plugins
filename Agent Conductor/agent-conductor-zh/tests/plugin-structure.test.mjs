import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(pluginRoot, "..", "..");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

test("plugin and marketplace expose agent-conductor-zh", () => {
  const manifest = readJson(path.join(pluginRoot, ".codex-plugin", "plugin.json"));
  const marketplace = readJson(
    path.join(repoRoot, ".agents", "plugins", "marketplace.json"),
  );
  const entry = marketplace.plugins.find(
    (item) => item.name === "agent-conductor-zh",
  );

  assert.equal(manifest.name, "agent-conductor-zh");
  assert.equal(manifest.version, "1.0.0");
  assert.equal(
    manifest.interface.displayName,
    "Agent Conductor 中文专家团",
  );
  assert.equal(manifest.repository, "https://github.com/maaaaaa12138/Plugins");
  assert.equal(
    manifest.homepage,
    "https://github.com/maaaaaa12138/Plugins/tree/main/Agent%20Conductor/agent-conductor-zh",
  );
  assert.equal(manifest.skills, "./skills/");
  assert.equal(entry.source.path, "./Agent Conductor/agent-conductor-zh");
  assert.deepEqual(entry.policy, {
    installation: "AVAILABLE",
    authentication: "ON_INSTALL",
  });
  assert.equal(entry.category, "Productivity");

  for (const unsupported of ["hooks", "mcpServers", "apps"]) {
    assert.equal(manifest[unsupported], undefined);
  }
});

test("plugin files keep LF endings so manifest hashes are stable", () => {
  const attributes = fs.readFileSync(path.join(repoRoot, ".gitattributes"), "utf8");
  assert.match(
    attributes,
    /^"Agent Conductor\/agent-conductor-zh\/\*\*" text eol=lf$/m,
  );
});

test("PowerShell management entry point is Windows 5.1 compatible", () => {
  const wrapper = fs.readFileSync(
    path.join(pluginRoot, "scripts", "manage-agents.ps1"),
    "utf8",
  );
  assert.match(wrapper, /^\[CmdletBinding\(\)\]/);
  assert.match(wrapper, /ValidateSet\("status", "install", "update", "uninstall"\)/);
  assert.match(wrapper, /ValidateSet\("global", "project"\)/);
  assert.match(wrapper, /\[string\]\$Scope = "global"/);
  assert.match(wrapper, /\[switch\]\$DryRun/);
  assert.match(wrapper, /\[switch\]\$Json/);
  assert.match(wrapper, /Node\.js 18 or newer/);
  assert.match(wrapper, /exit \$LASTEXITCODE/);
  assert.doesNotMatch(wrapper, /Invoke-Expression/);
});

test("README documents private setup, compatibility, and conservative management", () => {
  const readme = fs.readFileSync(path.join(pluginRoot, "README.md"), "utf8");
  assert.match(readme, /private repository/i);
  assert.match(readme, /collaborator/i);
  assert.match(readme, /compatibility mode/i);
  assert.match(readme, /bundled/i);
  assert.match(readme, /global scope is the default/i);
  assert.match(readme, /project scope is optional/i);
  for (const action of ["status", "install", "update", "uninstall"]) {
    assert.match(readme, new RegExp(`-Action ${action}\\b`));
  }
  assert.match(readme, /-DryRun/);
  assert.match(readme, /never overwrite/i);
  assert.match(readme, /new Codex task/i);
  assert.match(readme, /jnMetaCode\/agency-agents-zh/);
  assert.match(readme, /MIT/);
});
