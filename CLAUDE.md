@AGENTS.md

## Claude Code specifics

Configured in `.claude/settings.json` (see `HARNESS.md` for the reasoning):

- **PostToolUse hook**: every Edit/Write runs ESLint on the touched file
  (`.claude/hooks/lint-edited-file.mjs`). Fix reported errors before continuing.
- **Stop hook**: `npm run typecheck` and `npm test` must pass before you can end a turn
  (`.claude/hooks/stop-gate.mjs`). If you truly cannot get to green, say so plainly
  and explain why; don't game the gate.
- **Skills**: `verify-change` (full CI-equivalent gate + diff hygiene) and
  `add-workout-classifier` (test-first classification changes from a real activity).
- **Permissions**: gate commands are pre-allowed; reading `local.settings.json`/`.env`,
  deploying, and force-pushing are denied.
