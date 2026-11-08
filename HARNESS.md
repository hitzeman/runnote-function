# Agent harness

This repo is set up so a coding agent can make a change and a human reviews a diff
that already passed the same checks CI runs. This doc goes through each piece:
what it is, why it exists, and which kind of agent mistake it catches.

```
instructions   AGENTS.md ← CLAUDE.md (@import)        what to do, and what not to do
in-loop        PostToolUse: eslint on edited file     catch it at the edit
end-of-turn    Stop: typecheck + tests                can't finish red
on-demand      skills: verify-change, add-workout-…   repeatable workflows
pre-merge      CI: lint, typecheck, test, build,      same gate, not skippable
               npm audit, gitleaks
```

## Instructions

### `AGENTS.md`
Shared conventions for any agent: commands, a map of the code, eight rules, and the
known gaps. It is kept short on purpose. It points to commands and files instead of
restating code, because restated code drifts. The previous `CLAUDE.md` described an
HR-based prompt and line numbers that no longer existed.

**Catches:** the agent guessing commands, mocking in the wrong layer, sending
deterministic cases to the LLM, committing raw Strava data, and treating a known gap
as a bug to "fix" without being asked.

### `CLAUDE.md`
`@AGENTS.md` plus the Claude Code–specific parts: what the hooks do and which skills
exist. Keeping one source avoids two instruction files drifting apart.

## Hooks (`.claude/settings.json`)

### PostToolUse → `.claude/hooks/lint-edited-file.mjs`
Runs ESLint (type-aware `typescript-eslint`) on each file the agent edits. On errors it
exits 2, so the output goes back to the agent right away.

**Catches:** `any` leaking from untyped API responses, floating promises, unused
imports, and `==`. These are small and cheap to fix at the edit, and they pile up if
they are only found at the end.

### Stop → `.claude/hooks/stop-gate.mjs`
Runs `npm run typecheck` and `npm test` when the agent tries to end its turn. If either
fails, it exits 2 with the last 60 lines of output, and the agent keeps working. It
blocks even on re-entry (`stop_hook_active`), because a red build is never an
acceptable end state; a human can interrupt or set `RUNNOTE_SKIP_STOP_GATE=1`.

**Catches:** "done" claims on a broken build. That includes a change that passes the
test the agent was looking at but breaks another fixture, and type errors in files the
agent didn't open.

### Permissions
Gate commands are pre-allowed, so the agent runs them without asking. Reading
`local.settings.json` / `.env*`, `func azure functionapp publish` and force-pushes are
denied.

**Catches:** secrets ending up in the transcript, and irreversible actions taken
without a human.

## Skills (`.claude/skills/`)

### `verify-change`
The full CI-equivalent gate (lint, typecheck, test, build, audit) plus a diff review
for secrets, unsanitized fixtures, scratch files, unrelated churn and un-mocked network
imports. It ends with a pass/fail table and forbids reporting green without running
every step.

**Catches:** the build/audit steps the Stop hook doesn't run, "fixing" failures by
suppressing them, and leftover debug files.

### `add-workout-classifier`
Steps for changing classification: identify the path (deterministic vs LLM),
sanitize a real activity into a fixture, write a failing test and show it fail, then
implement and verify. It forbids inventing lap data, and it notes that mocked-LLM
tests do not prove the prompt works.

**Catches:** prompt tweaks with no regression test, a fix for one activity that breaks
another, and overstating what a mocked test proves.

## Tests (`test/`, Vitest)

Unit tests run offline in under a second. Strava (`axios`, `src/shared/strava`),
OpenAI (`src/shared/ai`) and `@azure/functions` are mocked at the module boundary;
classification and description logic run for real. Fixtures are real activities run
through `scripts/sanitize-fixture.mjs`, and several expected values are the summaries
RunNote actually wrote to Strava. The LLM tests script the model's responses, so they
verify our side of the tool-calling loop, not the model's judgement.

## Quality gates

| Gate | Config | Notes |
|---|---|---|
| Typecheck | `tsconfig.json` (`strict: true`) | Covers `src/`, `test/` and the Vitest config. `tsconfig.build.json` emits `src/` only. |
| Lint | `eslint.config.mjs` | `recommendedTypeChecked` + `no-floating-promises`, `eqeqeq`. Unsafe-`any` rules are relaxed in tests only. |
| Tests | `vitest.config.mts` | `npm run test:coverage` for a report; there is no coverage threshold on purpose. |
| Dependencies | `npm audit --audit-level=high` | Production deps: 0 advisories. Dev tooling has moderate advisories only. |
| Secrets | `.gitleaks.toml` | Default rules, full history. One documented allowlist entry. |

## CI (`.github/workflows/ci.yml`)

Runs on PRs and on pushes to `main`. It is the same gate as `npm run check`, plus build,
audit and gitleaks. Hooks only apply to Claude Code sessions; CI applies to every
change, whichever agent or human made it.

## What the harness caught while it was being built

These are real, each with a failing test first and a fix in its own commit:

- Strict mode: missing `average_heartrate` (no HR strap) would print `(HR NaN)`.
- `formatPace(419.6)` returned `6:60` instead of `7:00`.
- Strava mile laps (1609.34 m = 0.999997 mi) rendered as `3 x 1.0 mi`.
- A real description ending in `—from RunNote` (em-dash) wasn't recognised, so
  re-annotation would stack two summaries.
- Easy runs always sent a Strava PUT, even with nothing to change, because an
  undefined `name` was compared to the existing title.

## Lessons

<!-- Real incidents only. Each: what the agent did, what caught it (or should have), what changed. -->

- TODO(Todd): an incident where an agent's change to this repo looked right but was wrong, and what caught it.
- TODO(Todd): a prompt/classifier change that regressed another activity type, and how you noticed.
- TODO(Todd): what you would gate differently next time (or what turned out to be noise).
