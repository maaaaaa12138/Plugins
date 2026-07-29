# Agent Conductor Chinese Expert Team Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build, validate, privately publish, and locally install `agent-conductor-zh`, a Codex plugin that routes work to a bundled, managed snapshot of 268 Chinese specialist Agents.

**Architecture:** The repo-local marketplace exposes two skills and a pinned role bundle. The Agent Conductor skill uses equivalent JavaScript and Windows PowerShell routers backed by one index and one routing-hints file; a separate Node installer manages global or project Agent copies without overwriting user changes. The plugin remains useful before native-Agent installation by resolving routed roles from its bundled TOML files and falling back to the built-in `default` Agent when confidence or role loading fails.

**Tech Stack:** Codex plugin JSON, Markdown skills, Node.js ESM and `node:test`, Windows PowerShell 5.1+, Python 3 `tomllib` for validation, Git/GitHub private repository.

---

## File Map

- `.agents/plugins/marketplace.json`: repo marketplace containing the private plugin entry.
- `plugins/agent-conductor-zh/.codex-plugin/plugin.json`: plugin identity and skill discovery metadata.
- `plugins/agent-conductor-zh/skills/agent-conductor/SKILL.md`: routing, delegation, compatibility, and safety workflow.
- `plugins/agent-conductor-zh/skills/agent-conductor/agents/openai.yaml`: skill display metadata.
- `plugins/agent-conductor-zh/skills/agent-conductor/references/agent-index.json`: 268 searchable role records across 19 role-bearing categories.
- `plugins/agent-conductor-zh/skills/agent-conductor/references/routing-hints.json`: shared weights, thresholds, phrases, and category/role boosts.
- `plugins/agent-conductor-zh/skills/agent-conductor/scripts/route-agents.mjs`: cross-platform router and path resolver.
- `plugins/agent-conductor-zh/skills/agent-conductor/scripts/route-agents.ps1`: Windows PowerShell 5.1-compatible equivalent router.
- `plugins/agent-conductor-zh/skills/manage-expert-agents/SKILL.md`: explicit status/install/update/uninstall workflow.
- `plugins/agent-conductor-zh/skills/manage-expert-agents/agents/openai.yaml`: management skill display metadata.
- `plugins/agent-conductor-zh/assets/agents/*.toml`: pinned 268-role compatibility and installation source.
- `plugins/agent-conductor-zh/assets/roles-manifest.json`: bundle provenance, hashes, categories, and schema version.
- `plugins/agent-conductor-zh/scripts/build-role-bundle.mjs`: deterministic bundle copier and manifest generator.
- `plugins/agent-conductor-zh/scripts/manage-agents.mjs`: managed installation core.
- `plugins/agent-conductor-zh/scripts/manage-agents.ps1`: PowerShell entry point forwarding validated arguments to Node.
- `plugins/agent-conductor-zh/tests/*.test.mjs`: plugin, router, cross-runtime, and installer behavior tests.
- `plugins/agent-conductor-zh/tests/validate-role-bundle.py`: structured TOML and manifest validation.
- `plugins/agent-conductor-zh/tests/fixtures/routing.json`: all-category, ambiguity, scope, and parity fixtures.
- `plugins/agent-conductor-zh/LICENSES/agency-agents-zh-MIT.txt`: upstream MIT terms.
- `plugins/agent-conductor-zh/NOTICE.md`: Michael Sitarzewski and jnMetaCode attribution plus pinned source revision.
- `plugins/agent-conductor-zh/README.md`: private installation, global default, project option, update, and recovery instructions.

### Task 1: Enforce the Private-Repository Release Gate

**Files:**
- Verify: GitHub repository `maaaaaa12138/Plugins`
- Verify: local branch and remote in `C:/Users/PC/Documents/Codemao Work/_github-plugins`

- [ ] **Step 1: Verify the current visibility before changing it**

Use the authenticated GitHub repository settings page or API and record the response.

Expected before repair:

```json
{"private":false,"visibility":"public"}
```

- [ ] **Step 2: Change repository visibility to Private**

Use GitHub Settings > General > Danger Zone > Change repository visibility, confirm `maaaaaa12138/Plugins`, and complete GitHub's confirmation flow.

- [ ] **Step 3: Verify the release gate**

Re-read repository metadata.

Expected:

```json
{"private":true,"visibility":"private"}
```

Do not push any plugin, role, or manifest file unless both fields match.

### Task 2: Scaffold and Validate Plugin Metadata

**Files:**
- Create: `.agents/plugins/marketplace.json`
- Create: `plugins/agent-conductor-zh/.codex-plugin/plugin.json`
- Create: `plugins/agent-conductor-zh/tests/plugin-structure.test.mjs`

- [ ] **Step 1: Write the failing structure test**

Create a Node test that loads both JSON files, verifies the exact plugin identity and source path, and asserts that unsupported components are absent:

```js
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(pluginRoot, "..", "..");
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

test("plugin and marketplace expose agent-conductor-zh", () => {
  const manifest = readJson(path.join(pluginRoot, ".codex-plugin", "plugin.json"));
  const market = readJson(path.join(repoRoot, ".agents", "plugins", "marketplace.json"));
  const entry = market.plugins.find((item) => item.name === "agent-conductor-zh");
  assert.equal(manifest.name, "agent-conductor-zh");
  assert.equal(manifest.interface.displayName, "Agent Conductor 中文专家团");
  assert.equal(manifest.skills, "./skills/");
  assert.equal(entry.source.path, "./plugins/agent-conductor-zh");
  assert.deepEqual(entry.policy, { installation: "AVAILABLE", authentication: "ON_INSTALL" });
  for (const unsupported of ["hooks", "mcpServers", "apps"]) assert.equal(manifest[unsupported], undefined);
});
```

- [ ] **Step 2: Run the test and confirm RED**

Run: `node --test plugins/agent-conductor-zh/tests/plugin-structure.test.mjs`

Expected: FAIL with `ENOENT` for `plugin.json` or `marketplace.json`.

- [ ] **Step 3: Create the manifest and marketplace entry**

Use the official plugin scaffold for the repo-local marketplace, then set version `1.0.0`, repository `https://github.com/maaaaaa12138/Plugins`, private-use descriptions, `skills: "./skills/"`, and Productivity metadata. Keep hooks, MCP, and apps absent.

Run:

```powershell
python C:/Users/PC/.codex/skills/.system/plugin-creator/scripts/create_basic_plugin.py agent-conductor-zh --path plugins --marketplace-path .agents/plugins/marketplace.json --with-skills --with-scripts --with-assets --with-marketplace
```

- [ ] **Step 4: Run structure and official manifest validation**

Run:

```powershell
node --test plugins/agent-conductor-zh/tests/plugin-structure.test.mjs
python C:/Users/PC/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugins/agent-conductor-zh
```

Expected: both commands exit 0; Node reports 1 passing test and the validator reports a valid plugin.

- [ ] **Step 5: Commit plugin metadata**

```powershell
git add .agents/plugins/marketplace.json plugins/agent-conductor-zh/.codex-plugin/plugin.json plugins/agent-conductor-zh/tests/plugin-structure.test.mjs
git commit -m "feat: scaffold private agent conductor plugin"
```

### Task 3: Build and Validate the 268-Role Snapshot

**Files:**
- Create: `plugins/agent-conductor-zh/scripts/build-role-bundle.mjs`
- Create: `plugins/agent-conductor-zh/tests/validate-role-bundle.py`
- Create: `plugins/agent-conductor-zh/assets/agents/*.toml`
- Create: `plugins/agent-conductor-zh/assets/roles-manifest.json`
- Create: `plugins/agent-conductor-zh/LICENSES/agency-agents-zh-MIT.txt`
- Create: `plugins/agent-conductor-zh/NOTICE.md`
- Copy: `plugins/agent-conductor-zh/skills/agent-conductor/references/agent-index.json`

- [ ] **Step 1: Write the failing structured bundle validator**

The Python validator must parse every TOML with `tomllib`, compare slugs to the index, verify unique `name` fields, check non-empty `description` and `developer_instructions`, recompute SHA-256, and assert exactly 268 roles and 19 categories:

```python
import hashlib, json, pathlib, tomllib

ROOT = pathlib.Path(__file__).resolve().parents[1]
INDEX = json.loads((ROOT / "skills/agent-conductor/references/agent-index.json").read_text("utf-8"))
MANIFEST = json.loads((ROOT / "assets/roles-manifest.json").read_text("utf-8"))
FILES = sorted((ROOT / "assets/agents").glob("*.toml"))

assert len(FILES) == len(INDEX["agents"]) == MANIFEST["roleCount"] == 268
assert len({a["category"] for a in INDEX["agents"]}) == MANIFEST["roleBearingCategoryCount"] == 19
assert {p.stem for p in FILES} == {a["slug"] for a in INDEX["agents"]}
names = set()
by_slug = {r["slug"]: r for r in MANIFEST["roles"]}
for file in FILES:
    data = tomllib.loads(file.read_text("utf-8"))
    assert all(isinstance(data.get(k), str) and data[k].strip() for k in ("name", "description", "developer_instructions"))
    assert data["name"] == file.stem and data["name"] not in names
    names.add(data["name"])
    assert by_slug[file.stem]["sha256"] == hashlib.sha256(file.read_bytes()).hexdigest()
print("VALID ROLE BUNDLE: 268 roles, 19 categories")
```

- [ ] **Step 2: Run validation and confirm RED**

Run: `python plugins/agent-conductor-zh/tests/validate-role-bundle.py`

Expected: FAIL because the index, manifest, and role bundle are absent.

- [ ] **Step 3: Implement deterministic bundle generation**

Implement `build-role-bundle.mjs` with CLI arguments `--index`, `--source-agents`, `--upstream-revision`, and `--plugin-version`. It must validate slug allowlist `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`, read only `${slug}.toml` files named by the index, copy bytes unchanged, hash each destination, and write this manifest contract:

```js
const manifest = {
  schemaVersion: 1,
  pluginVersion,
  roleBundleVersion: `agency-agents-zh-${upstreamRevision.slice(0, 12)}`,
  upstream: {
    repository: "https://github.com/jnMetaCode/agency-agents-zh",
    revision: upstreamRevision,
  },
  roleCount: roles.length,
  roleBearingCategoryCount: new Set(roles.map((role) => role.category)).size,
  roles,
};
```

Each role record is `{ slug, category, path: "agents/${slug}.toml", sha256, source: "jnMetaCode/agency-agents-zh" }`. Abort before writing output when counts, duplicates, source files, or slugs are invalid.

- [ ] **Step 4: Generate the role bundle and provenance files**

Run the builder against `C:/Users/PC/.codex/agents` and the verified upstream commit. Copy the upstream MIT license unchanged and write NOTICE with both copyright owners, repository URL, revision, snapshot date, and conversion note.

Expected: `assets/agents` contains exactly 268 TOML files; no unrelated local Agent is included.

- [ ] **Step 5: Run structured validation and secret scan**

Run:

```powershell
python plugins/agent-conductor-zh/tests/validate-role-bundle.py
rg -n -i "api[_ -]?key|authorization:|bearer [a-z0-9._-]+|password\s*=|secret\s*=" plugins/agent-conductor-zh/assets plugins/agent-conductor-zh/NOTICE.md
```

Expected: validator prints `VALID ROLE BUNDLE: 268 roles, 19 categories`; secret scan returns no credential material.

- [ ] **Step 6: Commit the pinned role bundle**

```powershell
git add plugins/agent-conductor-zh/assets plugins/agent-conductor-zh/LICENSES plugins/agent-conductor-zh/NOTICE.md plugins/agent-conductor-zh/scripts/build-role-bundle.mjs plugins/agent-conductor-zh/tests/validate-role-bundle.py plugins/agent-conductor-zh/skills/agent-conductor/references/agent-index.json
git commit -m "feat: bundle 268 Chinese expert agents"
```

### Task 4: Implement Confidence-Safe JavaScript Routing

**Files:**
- Create: `plugins/agent-conductor-zh/skills/agent-conductor/references/routing-hints.json`
- Create: `plugins/agent-conductor-zh/skills/agent-conductor/scripts/route-agents.mjs`
- Create: `plugins/agent-conductor-zh/tests/fixtures/routing.json`
- Create: `plugins/agent-conductor-zh/tests/router.test.mjs`

- [ ] **Step 1: Write failing router tests**

Cover all 19 categories in Chinese and English, `defaultAgent === "default"`, unrelated fallback, a tied product/design fixture with `limit=1` and `limit=5`, no bigram duplication, and path resolution. Every non-builtin `agent_file` must exist.

Use this output comparator for ambiguity:

```js
for (const limit of [1, 5]) {
  const result = runRouter("产品设计", { limit, scope: "bundled" });
  assert.equal(result.defaultUsed, true);
  assert.equal(result.fallback.agent_type, "default");
  assert.equal(result.fallback.agent_source, "builtin");
}
```

Use temporary project and home directories to assert explicit project resolution, `auto` precedence `project > global > bundled`, missing bundled failure, and path containment.

- [ ] **Step 2: Run router tests and confirm RED**

Run: `node --test plugins/agent-conductor-zh/tests/router.test.mjs`

Expected: FAIL because routing hints and the router are absent.

- [ ] **Step 3: Add shared routing configuration**

Start from the reviewed 19-category WorkBuddy routing data, set `config.defaultAgent` to `default`, preserve `minTopScore: 12` and `minSeparation: 4`, and validate that declared categories exactly match the index. Keep curated phrases and role boosts, but ensure every hint references known categories and slugs.

- [ ] **Step 4: Implement the router core**

The JavaScript router must:

```js
const queryLatin = latinTokens(queryNorm);
const queryBigrams = chineseBigrams(queryNorm);
const ordinaryTokens = [...new Set(queryLatin)];
const fullyRanked = scored.filter(({ score }) => score > 0).sort(compareCandidates);
const ambiguous = fullyRanked.length > 1 && fullyRanked[0].score - fullyRanked[1].score < config.minSeparation;
const defaultUsed = fullyRanked.length === 0 || fullyRanked[0].score < config.minTopScore || ambiguous;
const candidates = fullyRanked.slice(0, limit).map(toResolvedCandidate);
```

Curated phrases, exact role/slug and Latin terms contribute ordinary evidence; Chinese bigrams contribute only `bigramRecall`. `bundled` returns a candidate only when the resolved path exists inside `assets/agents`. Explicit `global` and `project` scopes report missing files as resolution errors; `auto` chooses the first existing project/global/bundled file. The CLI exits 2 for invalid arguments and 1 for data or resolution failures.

- [ ] **Step 5: Run tests and inspect representative output**

Run:

```powershell
node --test plugins/agent-conductor-zh/tests/router.test.mjs
node plugins/agent-conductor-zh/skills/agent-conductor/scripts/route-agents.mjs --query "渗透测试 安全审计" --limit 5 --scope bundled
node plugins/agent-conductor-zh/skills/agent-conductor/scripts/route-agents.mjs --query "产品设计" --limit 1 --scope bundled
```

Expected: tests pass; security selects a security role; `产品设计` uses built-in `default` despite `--limit 1`.

- [ ] **Step 6: Commit JavaScript routing**

```powershell
git add plugins/agent-conductor-zh/skills/agent-conductor/references/routing-hints.json plugins/agent-conductor-zh/skills/agent-conductor/scripts/route-agents.mjs plugins/agent-conductor-zh/tests/fixtures/routing.json plugins/agent-conductor-zh/tests/router.test.mjs
git commit -m "feat: add confidence-safe expert routing"
```

### Task 5: Add Windows PowerShell 5.1 Routing Parity

**Files:**
- Create: `plugins/agent-conductor-zh/skills/agent-conductor/scripts/route-agents.ps1`
- Create: `plugins/agent-conductor-zh/tests/router-parity.test.mjs`
- Create: `plugins/agent-conductor-zh/tests/run-router-tests.ps1`

- [ ] **Step 1: Write the failing full-parity test**

Detect `powershell.exe` or `pwsh` by a separate `exit 0` probe. If neither exists, print only `SKIP: PowerShell unavailable` and do not print a pass summary. When one exists, execute all 19 category fixtures plus ambiguity and scope fixtures, parse JSON, and deep-compare these fields:

```js
const comparable = ({ queries, scope, defaultAgent, defaultUsed, candidates, fallback }) => ({
  queries,
  scope,
  defaultAgent,
  defaultUsed,
  candidates: candidates.map(({ category, slug, score, matchedHints, agent_type, agent_file, agent_source }) => ({
    category, slug, score, matchedHints, agent_type,
    agent_file: path.normalize(agent_file), agent_source,
  })),
  fallback,
});
```

Any PowerShell non-zero exit, stderr, or JSON parse error must fail the test.

- [ ] **Step 2: Run parity test and confirm RED**

Run: `node --test plugins/agent-conductor-zh/tests/router-parity.test.mjs`

Expected: FAIL because `route-agents.ps1` does not exist.

- [ ] **Step 3: Implement the PowerShell router**

Port the shared-data loading, normalization, phrase/hint scoring, bigram-only recall, pre-limit confidence gate, and path resolution. Use a 5.1-compatible helper for multi-segment paths:

```powershell
function Join-PathSegments {
  param([Parameter(Mandatory=$true)][string]$Base, [Parameter(ValueFromRemainingArguments=$true)][string[]]$Segments)
  $result = $Base
  foreach ($segment in $Segments) { $result = Join-Path -Path $result -ChildPath $segment }
  return $result
}
```

Set `$ErrorActionPreference = "Stop"`, emit UTF-8 JSON only on stdout, and exit non-zero on resolution or parse failures.

- [ ] **Step 4: Create the standalone PowerShell test entry point**

`tests/run-router-tests.ps1` must resolve the real router with:

```powershell
$PluginRoot = Split-Path -Parent $PSScriptRoot
$Router = Join-PathSegments $PluginRoot "skills" "agent-conductor" "scripts" "route-agents.ps1"
if (-not (Test-Path -LiteralPath $Router -PathType Leaf)) { throw "Router not found: $Router" }
```

It invokes the Node parity suite and returns Node's exit code.

- [ ] **Step 5: Run both parity entry points**

Run:

```powershell
node --test plugins/agent-conductor-zh/tests/router-parity.test.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File plugins/agent-conductor-zh/tests/run-router-tests.ps1
```

Expected: both exit 0 and parity covers all 19 role-bearing categories; no execution failure is reported as a skip.

- [ ] **Step 6: Commit PowerShell parity**

```powershell
git add plugins/agent-conductor-zh/skills/agent-conductor/scripts/route-agents.ps1 plugins/agent-conductor-zh/tests/router-parity.test.mjs plugins/agent-conductor-zh/tests/run-router-tests.ps1
git commit -m "feat: add PowerShell 5.1 router parity"
```

### Task 6: Write and Validate Both Skills

**Files:**
- Create: `plugins/agent-conductor-zh/skills/agent-conductor/SKILL.md`
- Create: `plugins/agent-conductor-zh/skills/agent-conductor/agents/openai.yaml`
- Create: `plugins/agent-conductor-zh/skills/manage-expert-agents/SKILL.md`
- Create: `plugins/agent-conductor-zh/skills/manage-expert-agents/agents/openai.yaml`
- Create: `plugins/agent-conductor-zh/tests/skill-contract.test.mjs`

- [ ] **Step 1: Write failing skill contract tests**

Assert Agent Conductor documents sanitized routing, one primary and at most two reviewers, one writer per file scope, exact `slug`, `fork_turns="none"` or `fork_context=false`, consumption of returned `agent_file`, built-in `default` fallback, and no constructed global role path. Assert the management skill documents all four actions, global default, explicit project root, conflict preservation, approval boundaries, and new-task refresh.

- [ ] **Step 2: Run skill tests and confirm RED**

Run: `node --test plugins/agent-conductor-zh/tests/skill-contract.test.mjs`

Expected: FAIL because both skills are absent.

- [ ] **Step 3: Write Agent Conductor skill**

Adapt the existing user-authored skill to invoke scope-aware routers. Compatibility prompts must use the returned file:

```text
Start a built-in default subagent. Read the exact UTF-8 path in `candidate.agent_file`, apply its `developer_instructions` for this task, and then perform the bounded assignment. If that file is missing or invalid, stop role impersonation and report that the built-in default Agent is being used.
```

Never use `agent-conductor` as an Agent type and never synthesize a global role path.

- [ ] **Step 4: Write management skill and display metadata**

Document exact commands for status/install/update/uninstall, with global scope omitted by default and project scope demonstrated as `--scope project --project C:/work/project`. Explain dry run, conflict reporting, and restart/new-task discovery.

- [ ] **Step 5: Validate contracts and official skill schema**

Run:

```powershell
node --test plugins/agent-conductor-zh/tests/skill-contract.test.mjs
python C:/Users/PC/.codex/skills/.system/skill-creator/scripts/quick_validate.py plugins/agent-conductor-zh/skills/agent-conductor
python C:/Users/PC/.codex/skills/.system/skill-creator/scripts/quick_validate.py plugins/agent-conductor-zh/skills/manage-expert-agents
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit both skills**

```powershell
git add plugins/agent-conductor-zh/skills plugins/agent-conductor-zh/tests/skill-contract.test.mjs
git commit -m "feat: add conductor and agent management skills"
```

### Task 7: Implement Conflict-Preserving Agent Management

**Files:**
- Create: `plugins/agent-conductor-zh/scripts/manage-agents.mjs`
- Create: `plugins/agent-conductor-zh/tests/manage-agents.test.mjs`

- [ ] **Step 1: Write failing installer integration tests**

Run the CLI with temporary `HOME`/`USERPROFILE` and project roots. Create named tests for these exact outcomes: fresh global install writes every fixture role plus state; a second install performs no writes; project scope without an absolute project root exits 2; a pre-existing role remains byte-identical and is reported as a conflict; update replaces only files matching the previous managed hash; a user-modified managed role survives update and uninstall; uninstall removes only unchanged owned roles; a bad source hash exits 1 before creating the target directory; and status separately reports missing, modified, and unmanaged conflicts.

Tests use a miniature fixture bundle and manifest so failure cases remain fast; one full-bundle smoke test asserts a 268-file dry run.

- [ ] **Step 2: Run tests and confirm RED**

Run: `node --test plugins/agent-conductor-zh/tests/manage-agents.test.mjs`

Expected: FAIL because `manage-agents.mjs` is absent.

- [ ] **Step 3: Implement argument and scope validation**

Support `status|install|update|uninstall`, `--scope global|project`, `--project`, `--dry-run`, `--json`, and test-only `--home`/`--bundle-root` arguments gated by `NODE_ENV=test`. Default scope is global. Resolve state to `~/.codex/agent-conductor-zh/state.json` or `path.join(projectRoot, ".codex", "agent-conductor-zh", "state.json")`; reject relative project roots and paths escaping the selected scope.

- [ ] **Step 4: Implement validation and planning**

Before any target write, parse the manifest, enforce schema/count/unique slugs/path containment, recompute every source hash, and build action records:

```js
{ slug, action: "add" | "update" | "keep" | "conflict" | "remove", reason, sourceHash, currentHash, managedHash }
```

An absent destination is `add`; a pre-existing unmanaged destination is `conflict`; a managed file equal to its installed hash may update; a modified managed file is `conflict`.

- [ ] **Step 5: Implement atomic writes and conservative uninstall**

Write each accepted file to a sibling temporary path, verify bytes/hash, and rename atomically. Persist state through the same temporary-write pattern only after role operations complete. Uninstall removes a role only when current hash equals the recorded installed hash; leave user-modified and unrelated files untouched.

- [ ] **Step 6: Run installer tests and full dry run**

Run:

```powershell
node --test plugins/agent-conductor-zh/tests/manage-agents.test.mjs
node plugins/agent-conductor-zh/scripts/manage-agents.mjs status --json
node plugins/agent-conductor-zh/scripts/manage-agents.mjs install --dry-run --json
```

Expected: integration suite passes; full dry run reports 268 planned roles without changing `~/.codex/agents`.

- [ ] **Step 7: Commit installer core**

```powershell
git add plugins/agent-conductor-zh/scripts/manage-agents.mjs plugins/agent-conductor-zh/tests/manage-agents.test.mjs
git commit -m "feat: add conflict-preserving agent installer"
```

### Task 8: Add Windows Management Entry Point and User Documentation

**Files:**
- Create: `plugins/agent-conductor-zh/scripts/manage-agents.ps1`
- Create: `plugins/agent-conductor-zh/README.md`
- Modify: `plugins/agent-conductor-zh/tests/plugin-structure.test.mjs`

- [ ] **Step 1: Add failing wrapper and documentation assertions**

Assert the PowerShell wrapper supports the four actions, defaults to global, forwards explicit project scope, works under Windows PowerShell 5.1, and returns Node's exit code. Assert README states the repository is private, compatibility mode works before setup, global setup is default, project setup is optional, updates preserve modifications, and a new Codex task is required after native install.

- [ ] **Step 2: Run the assertions and confirm RED**

Run: `node --test plugins/agent-conductor-zh/tests/plugin-structure.test.mjs`

Expected: FAIL because wrapper and README are absent.

- [ ] **Step 3: Implement the PowerShell wrapper**

Use `[CmdletBinding()]`, a ValidateSet for actions/scopes, 5.1-compatible path joining, a checked `node` lookup, and an argument array. Do not evaluate strings or use shell concatenation. End with `exit $LASTEXITCODE`.

- [ ] **Step 4: Write README installation and operations**

Document private collaborator access, marketplace installation, plugin installation, compatibility mode, default global setup, project setup, status/update/uninstall, conflict behavior, security model, provenance, and troubleshooting. Use exact commands for both Node and PowerShell entry points.

- [ ] **Step 5: Run wrapper and documentation validation**

Run:

```powershell
node --test plugins/agent-conductor-zh/tests/plugin-structure.test.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File plugins/agent-conductor-zh/scripts/manage-agents.ps1 -Action status -Json
python C:/Users/PC/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugins/agent-conductor-zh
```

Expected: all commands exit 0 and status JSON identifies global scope.

- [ ] **Step 6: Commit wrapper and documentation**

```powershell
git add plugins/agent-conductor-zh/scripts/manage-agents.ps1 plugins/agent-conductor-zh/README.md plugins/agent-conductor-zh/tests/plugin-structure.test.mjs
git commit -m "docs: add expert plugin setup and management"
```

### Task 9: Run Full Validation and Install Locally

**Files:**
- Verify: all plugin files
- Write outside repo after approval: local Codex plugin cache/marketplace state
- Write outside repo after approval: `C:/Users/PC/.codex/agents/*.toml` and managed state

- [ ] **Step 1: Run the complete test suite**

Run:

```powershell
node --test plugins/agent-conductor-zh/tests/*.test.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File plugins/agent-conductor-zh/tests/run-router-tests.ps1
python plugins/agent-conductor-zh/tests/validate-role-bundle.py
python C:/Users/PC/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugins/agent-conductor-zh
python C:/Users/PC/.codex/skills/.system/skill-creator/scripts/quick_validate.py plugins/agent-conductor-zh/skills/agent-conductor
python C:/Users/PC/.codex/skills/.system/skill-creator/scripts/quick_validate.py plugins/agent-conductor-zh/skills/manage-expert-agents
git diff --check
```

Expected: every command exits 0; 268 roles and all 19 category fixtures are reported.

- [ ] **Step 2: Scan the entire pending tree for credentials and unexpected binaries**

Run:

```powershell
rg -n -i "api[_ -]?key|authorization:|bearer [a-z0-9._-]+|password\s*=|client[_ -]?secret|private[_ -]?key" plugins .agents docs
Get-ChildItem -Recurse -File plugins/agent-conductor-zh | Where-Object { $_.Extension -notin '.json','.md','.mjs','.ps1','.toml','.yaml','.txt' }
```

Expected: no credential values and no unexpected binary files.

- [ ] **Step 3: Install the repo marketplace/plugin locally**

Add the repo-local marketplace with the supported Codex plugin command, install `agent-conductor-zh`, and verify it appears in the installed plugin list. Use the cachebuster/update workflow if a development copy was already installed.

- [ ] **Step 4: Run managed global installation**

First run `install --dry-run --json`. Then run the real default-global install only after reviewing conflicts. Existing unrelated or user-modified Agent files must remain untouched.

- [ ] **Step 5: Verify compatibility and native paths**

Route one task with bundled scope and one with auto scope. Expected before managed setup: `agent_source=bundled`; expected after setup: `agent_source=global`. Verify every returned role file exists and can be parsed.

- [ ] **Step 6: Commit any validation-only corrections**

```powershell
git add .agents plugins docs
git commit -m "test: complete agent conductor plugin validation"
```

Skip this commit when the working tree is already clean.

### Task 10: Private Push and Release Verification

**Files:**
- Verify: local Git history and clean worktree
- Push: private GitHub repository `maaaaaa12138/Plugins`

- [ ] **Step 1: Re-check repository visibility immediately before push**

Expected:

```json
{"private":true,"visibility":"private"}
```

Abort the push if this is not true.

- [ ] **Step 2: Inspect release history and working tree**

Run:

```powershell
git status --short
git log --oneline --decorate -12
git diff origin/main...HEAD --stat
```

Expected: clean worktree; only the intended design, plan, marketplace, plugin, role snapshot, tests, licenses, and documentation are ahead of origin.

- [ ] **Step 3: Push main to the private remote**

Run: `git push origin main`

Expected: push succeeds and the remote branch contains the local HEAD.

- [ ] **Step 4: Verify remote privacy and content**

Confirm repository metadata remains Private and verify these remote paths exist:

```text
.agents/plugins/marketplace.json
plugins/agent-conductor-zh/.codex-plugin/plugin.json
plugins/agent-conductor-zh/assets/roles-manifest.json
plugins/agent-conductor-zh/skills/agent-conductor/SKILL.md
plugins/agent-conductor-zh/skills/manage-expert-agents/SKILL.md
```

- [ ] **Step 5: Report installed state and residual boundary**

Report the private repository URL, plugin version, role count, installation scope, test results, selected local source precedence, and the remaining Codex boundary: custom Agent discovery refreshes in a new task after installation.
