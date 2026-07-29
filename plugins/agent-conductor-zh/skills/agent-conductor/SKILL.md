---
name: agent-conductor
description: Use when a task benefits from automatically choosing, coordinating, or delegating to one of the bundled or installed agency-agents-zh specialist roles across engineering, product, design, testing, security, marketing, finance, legal, operations, and other professional domains.
---

# Agent Conductor

Route by the requested outcome, then use the narrowest specialist that owns that
outcome. Keep the parent task responsible for requirements, decisions,
integration, verification, and the final response.

## Route

1. Reduce the request to a short task summary. Remove API keys, passwords, tokens, private URLs, personal data, and unrelated source code.
2. On Windows run:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/route-agents.ps1 -Query "sanitized task outcome" -Limit 5 -Scope auto -Project "C:/absolute/project"
   ```

   On other systems run:

   ```bash
   node scripts/route-agents.mjs --query "sanitized task outcome" --limit 5 --scope auto --project "/absolute/project"
   ```

   Omit the project argument when there is no reliable project root. Never guess
   an unrelated working directory.
3. Inspect `defaultUsed`, `confidence`, `matchedHints`, and `evidence`. If
   `defaultUsed` is true or the candidates do not fit the outcome, continue with
   the built-in `default` Agent and state the uncertainty briefly.
4. Choose one primary specialist. Add at most two reviewers only when their
   independent testing, security, design, or research work changes the result.

## Delegate

- Use `candidate.agent_type` as the exact native custom Agent type. The Chinese
  `name` is display text, not an Agent type.
- Start a custom type without full-history inheritance: use
  `fork_turns="none"`, or `fork_context=false` on tools that expose that field.
- If the tool cannot select a custom Agent type, start a built-in `default`
  subagent. Tell it to read the exact UTF-8 path in `candidate.agent_file`, parse
  the TOML, apply its `developer_instructions` for this assignment, and then do
  the bounded task.
- Never construct a role path yourself. The router may return a project,
  global, or bundled source, and compatibility mode must work before managed
  installation.
- If `candidate.agent_file` is missing or invalid, do not claim the role was
  loaded. Use the built-in `default` Agent and report the loading failure.

## Coordinate

- Assign one writer for each file scope. Reviewers remain read-only unless they
  own a separate, non-overlapping artifact.
- Give each specialist a bounded deliverable and require concise evidence.
- Wait for delegated work, reconcile disagreements in the parent task, and run
  the final verification there.
- Do not start a large panel for a simple request. One primary Agent is the
  normal case.

The router is a decision aid. Parent-task judgment overrides a candidate whose
description does not match the requested result.
