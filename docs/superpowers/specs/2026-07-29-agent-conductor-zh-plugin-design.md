# Agent Conductor Chinese Expert Team Plugin Design

Date: 2026-07-29
Status: Approved for implementation planning
Repository: `maaaaaa12138/Plugins` (private)

## Summary

Build a private Codex plugin named `agent-conductor-zh` with the display name
"Agent Conductor 中文专家团". The plugin combines the user-authored Agent
Conductor skill with a pinned snapshot of the 268 Chinese specialist roles from
`jnMetaCode/agency-agents-zh`.

Codex plugins do not currently register custom Agent TOML files directly.
Custom Agents are discovered from `~/.codex/agents/` or a project's
`.codex/agents/` directory. The plugin therefore bundles the role files and
provides an explicit, audited installation bridge. Global installation is the
default; project installation remains available as an option.

## Goals

- Install the Agent Conductor workflow from one private Codex plugin.
- Bundle all 268 role definitions so installs are reproducible and work without
  downloading role content at setup time.
- Register roles as native Codex custom Agents through an explicit setup action.
- Default to global installation in `~/.codex/agents/`.
- Support project-scoped installation in `<project>/.codex/agents/`.
- Preserve user-modified Agent files during update and uninstall.
- Keep the plugin usable in compatibility mode before native roles are installed.
- Retain upstream MIT license notices and source attribution.

## Non-goals

- No automatic background download from the upstream role repository.
- No hidden SessionStart hook that modifies global Codex configuration.
- No MCP server, app connector, or external API dependency in version 1.
- No public Plugin Directory submission in version 1.
- No management of unrelated files already present in an Agent directory.

## Repository Layout

```text
Plugins/
├── .agents/
│   └── plugins/
│       └── marketplace.json
├── docs/
│   └── superpowers/specs/
└── plugins/
    └── agent-conductor-zh/
        ├── .codex-plugin/
        │   └── plugin.json
        ├── skills/
        │   ├── agent-conductor/
        │   │   ├── SKILL.md
        │   │   ├── agents/openai.yaml
        │   │   ├── references/agent-index.json
        │   │   └── scripts/
        │   └── manage-expert-agents/
        │       └── SKILL.md
        ├── assets/
        │   ├── agents/*.toml
        │   └── roles-manifest.json
        ├── scripts/
        │   ├── manage-agents.mjs
        │   └── manage-agents.ps1
        ├── LICENSES/
        │   └── agency-agents-zh-MIT.txt
        ├── NOTICE.md
        └── README.md
```

Only `plugin.json` belongs under `.codex-plugin/`. The plugin intentionally has
no hooks, MCP configuration, or app manifest.

## Components

### Plugin manifest and marketplace

The plugin manifest uses the stable identifier `agent-conductor-zh`, semantic
versioning, private repository metadata, the `./skills/` component path, and
Productivity category metadata. The repo marketplace at
`.agents/plugins/marketplace.json` points to
`./plugins/agent-conductor-zh` and marks the plugin as available with install-time
authentication.

Because the GitHub repository is private, collaborators must already have
GitHub access and authenticate Git before Codex can fetch the marketplace.

### Agent Conductor skill

The existing skill remains the orchestration entry point. It routes a sanitized
task summary, chooses one primary role and at most two useful reviewers, keeps
one writer per file scope, waits for delegated results, and validates the final
result in the parent thread.

The router index points to the bundled role snapshot. When a selected native
Agent type is unavailable, compatibility mode starts a default subagent and
instructs it to read the matching bundled TOML before processing the bounded
task. This keeps the plugin useful before the explicit native-role setup runs.

### Role bundle and manifest

`assets/agents/` contains exactly 268 TOML files. `roles-manifest.json` records:

- plugin role-bundle version;
- upstream repository and pinned commit or release;
- role count;
- each role's slug, relative path, SHA-256 hash, and source attribution;
- schema version used by the installer.

Every TOML must define non-empty `name`, `description`, and
`developer_instructions` fields. Filenames and names must be unique. Slugs are
restricted to a conservative allowlist and cannot contain path separators or
parent-directory segments.

### Managed installer

The cross-platform core is `scripts/manage-agents.mjs`; the PowerShell wrapper
provides a convenient Windows entry point. It supports these actions:

```text
status    Show scope, installed version, missing roles, and conflicts
install   Validate and install the pinned role bundle
update    Upgrade files that are still owned and unmodified
uninstall Remove only unmodified files owned by this plugin
```

The scope option is `global` or `project`, with `global` as the default.
Project scope requires an explicit project root and never guesses a target from
an unrelated working directory.

Managed state is stored outside the role directory:

- global: `~/.codex/agent-conductor-zh/state.json`;
- project: `<project>/.codex/agent-conductor-zh/state.json`.

State records the plugin version, role-bundle version, scope, target directory,
source hash, installed hash, installation time, and operation ID for each owned
file.

## Installation Flow

1. A collaborator adds the private GitHub marketplace and installs
   `agent-conductor-zh`.
2. The plugin immediately exposes Agent Conductor compatibility mode.
3. The user invokes the `manage-expert-agents` skill and chooses global setup by
   default or project setup explicitly.
4. The installer validates the complete source bundle before changing the
   target directory.
5. It computes a dry-run plan, reports additions and conflicts, then requests
   approval for writes outside the current workspace when required.
6. Each accepted file is written to a temporary file in the target directory,
   verified by hash, and atomically renamed into place.
7. State is written only after all accepted role operations finish.
8. The user starts a new Codex task so custom Agent discovery refreshes.

## Update and Conflict Rules

- A missing destination file is installed.
- A destination matching the previous managed hash may be updated.
- A destination that existed before management is never overwritten.
- A managed destination changed by the user is preserved and reported as a
  conflict.
- A new bundle with a duplicate or invalid role fails before any destination
  write.
- Version 1 does not provide an implicit force-overwrite mode. Conflict
  resolution is deliberate and file-specific.
- Updates use only the role snapshot bundled with the installed plugin version;
  they do not fetch live upstream content.

## Uninstall and Recovery

Uninstall removes a role only when the current destination hash still matches
the hash recorded by this plugin. Modified files and pre-existing files remain
in place and are listed in the uninstall report. Empty directories created by
the plugin may be removed only when no unrelated content is present.

If an operation fails, temporary files are removed and state remains at the
last completed version. The next `status` command reports incomplete or
mismatched files and provides a safe retry path.

## Security and Privacy

- Setup is explicit; no lifecycle hook silently changes user configuration.
- Installer input cannot select arbitrary source or destination paths.
- Slugs and manifest paths are validated against traversal and injection.
- Source role hashes are checked before every managed operation.
- Router queries receive only a short, sanitized task summary. API keys,
  passwords, tokens, private URLs, and unnecessary source code are excluded.
- The installer performs no network requests and runs no code from role text.
- Role files do not embed credentials or broaden Codex permissions.
- Agents continue to use the parent session's sandbox and approval policy.

## Licensing and Attribution

The bundled role library remains under its MIT license. The plugin includes the
full upstream copyright and permission notice for Michael Sitarzewski and
jnMetaCode, plus the upstream repository URL and pinned source revision.
Agent Conductor and plugin-specific code remain private and unlicensed for
public redistribution unless the repository owner chooses a license later.

## Validation and Testing

Required checks before release:

- validate `.codex-plugin/plugin.json` with the official plugin validator;
- validate both skills with the skill quick validator;
- verify the marketplace schema and relative source path;
- parse all TOML files and assert exactly 268 unique names and filenames;
- regenerate and verify all SHA-256 values in `roles-manifest.json`;
- run installer integration tests against temporary global and project roots;
- test fresh install, idempotent install, update, user-modified conflict,
  pre-existing file conflict, partial failure recovery, and uninstall;
- verify compatibility routing when native Agents are absent;
- verify native role selection in a new Codex task after setup;
- scan the plugin tree for secrets before commit and push.

## Versioning and Updates

The plugin follows semantic versioning. A role-snapshot change requires at least
a patch release and a regenerated manifest. The repository records the upstream
revision used for each release. Updating the private marketplace changes the
plugin package; collaborators then reinstall or upgrade the plugin and run the
managed `update` action for native role files.

## Success Criteria

- The private repository exposes `agent-conductor-zh` through its repo
  marketplace.
- A collaborator with repository access can install the plugin.
- Agent Conductor works in compatibility mode immediately after plugin install.
- Global setup installs exactly 268 validated native Agent files.
- Project setup installs the same pinned set without touching global Agents.
- User-modified and unrelated Agent files survive update and uninstall.
- A new Codex task can route to and spawn the installed specialist roles.

## Known Product Boundary

Official Codex documentation currently describes custom Agents as personal or
project TOML configuration, while plugin packaging natively covers skills, MCP
servers, hooks, apps, and assets. The managed bridge is therefore an explicit
compatibility layer. Its implementation stays isolated so it can be removed or
replaced if Codex later adds native Agent packaging to plugins.
