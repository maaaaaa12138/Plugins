import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readSkill(name) {
  return fs.readFileSync(path.join(pluginRoot, "skills", name, "SKILL.md"), "utf8");
}

test("Agent Conductor skill preserves routing and delegation guardrails", () => {
  const skill = readSkill("agent-conductor");
  assert.match(skill, /^---\r?\nname: agent-conductor\r?\n/);
  assert.match(skill, /scripts\/route-agents\.ps1/);
  assert.match(skill, /scripts\/route-agents\.mjs/);
  assert.match(skill, /--scope auto/);
  assert.match(skill, /candidate\.agent_file/);
  assert.match(skill, /built-in `default`/);
  assert.doesNotMatch(skill, /~\/.codex\/agents\/<slug>\.toml/);
  assert.match(skill, /fork_turns="none"/);
  assert.match(skill, /fork_context=false/);
  assert.match(skill, /one primary/i);
  assert.match(skill, /at most two/i);
  assert.match(skill, /one writer/i);
  assert.match(skill, /API keys, passwords, tokens, private URLs/i);
});

test("management skill documents conservative global and project operations", () => {
  const skill = readSkill("manage-expert-agents");
  assert.match(skill, /^---\r?\nname: manage-expert-agents\r?\n/);
  for (const action of ["status", "install", "update", "uninstall"]) {
    assert.match(skill, new RegExp(`\\b${action}\\b`));
  }
  assert.match(skill, /global scope is the default/i);
  assert.match(skill, /--scope project --project C:\/work\/project/);
  assert.match(skill, /--dry-run/);
  assert.match(skill, /conflict/i);
  assert.match(skill, /never overwrite/i);
  assert.match(skill, /new Codex task/i);
});

test("both skills include Codex display metadata", () => {
  for (const name of ["agent-conductor", "manage-expert-agents"]) {
    const metadata = fs.readFileSync(
      path.join(pluginRoot, "skills", name, "agents", "openai.yaml"),
      "utf8",
    );
    assert.match(metadata, /^interface:/m);
    assert.match(metadata, /^  display_name: /m);
    assert.match(metadata, /^  short_description: /m);
    assert.match(metadata, /^  default_prompt: /m);
  }
});
