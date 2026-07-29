---
name: manage-expert-agents
description: Use when installing, updating, checking, repairing, or uninstalling the Agent Conductor Chinese expert role bundle globally or for one Codex project, including first-time plugin setup and conflict-safe role maintenance.
---

# Manage Expert Agents

Use the plugin's managed installer. Setup is explicit: the plugin does not use a
hook to change Agent files in the background.

## Choose Scope

Global scope is the default. It manages roles in `~/.codex/agents/` and state in
`~/.codex/agent-conductor-zh/state.json`.

Project scope manages one explicit project. Always pass an absolute root:

```text
--scope project --project C:/work/project
```

Never infer a project target from an unrelated current directory.

## Inspect First

On Windows:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/manage-agents.ps1 -Action status -Json
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/manage-agents.ps1 -Action install -DryRun -Json
```

On other systems:

```bash
node scripts/manage-agents.mjs status --json
node scripts/manage-agents.mjs install --dry-run --json
```

Review `add`, `update`, `keep`, `remove`, and `conflict` counts before writes.
Request approval when the selected target is outside the current writable
workspace.

## Apply an Operation

Supported actions are `status`, `install`, `update`, and `uninstall`.

Default global install:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/manage-agents.ps1 -Action install -Json
```

Explicit project install:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/manage-agents.ps1 -Action install -Scope project -Project C:/work/project -Json
```

Use the same scope for later `status`, `update`, and `uninstall` operations.

## Preserve User Files

- Never overwrite a pre-existing unmanaged Agent.
- Never overwrite a managed Agent whose bytes differ from its recorded installed
  hash. Report it as a conflict.
- Update only unchanged files owned by this plugin.
- Uninstall only unchanged files owned by this plugin.
- Do not invent a force mode. Resolve conflicts deliberately and file by file.
- If source validation fails, stop before creating or changing the target.

After a successful native Agent install or update, start a new Codex task so
custom Agent discovery refreshes. Agent Conductor compatibility mode continues
to use bundled roles before native setup.
