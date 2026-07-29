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
  assert.equal(manifest.skills, "./skills/");
  assert.equal(entry.source.path, "./plugins/agent-conductor-zh");
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
    /^plugins\/agent-conductor-zh\/\*\* text eol=lf$/m,
  );
});
