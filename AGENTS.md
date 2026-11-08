# AGENTS.md

Conventions for any coding agent (and human) working in this repo.
`CLAUDE.md` imports this file; keep shared rules here.

## What this is

Azure Functions (Node 22, TypeScript) app: a Strava webhook fetches a new run,
classifies it (Long / Easy / Tempo / VO2max) and prepends a one-line summary to the
activity description. **The project is paused** (see README). Treat it as a
reference implementation: fix and test, don't add product features unprompted.

## Commands

| Task | Command |
|---|---|
| Install | `npm ci` |
| Full gate (run before saying "done") | `npm run check` (lint + typecheck + test) |
| Lint / typecheck / test | `npm run lint` · `npm run typecheck` · `npm test` |
| Single test file | `npx vitest run test/<name>.test.ts` |
| Coverage | `npm run test:coverage` |
| Build / run locally | `npm run build` · `npm start` (needs Azure Functions Core Tools + Azurite) |
| New test fixture | `node scripts/sanitize-fixture.mjs raw.json` |

CI (`.github/workflows/ci.yml`) runs the gate plus `npm run build`,
`npm audit --audit-level=high` and a gitleaks secret scan.

## Map

- `src/functions/` — HTTP triggers: `authConnect`, `authCallback` (OAuth), `webhook`.
- `src/services/workoutAnalysis.ts` — classification. Long/Easy are deterministic
  rules; only the remaining runs go to OpenAI, which picks laps and calls tools.
- `src/services/workoutCalculations.ts` — all arithmetic (the model's tools).
- `src/utils/activityFormatter.ts` — summary text, titles, description merging.
- `src/shared/` — external boundaries: `strava.ts` (axios), `ai.ts` (OpenAI),
  `tokenStore.ts` / `stateStore.ts` (Azure Table Storage).
- `test/` — Vitest; `test/fixtures/` holds sanitized real activities.

## Rules

1. **Test first for bug fixes.** Reproduce with a failing test, then fix. Show the failure.
2. **No network in tests.** Mock at the boundary (`src/shared/strava`, `src/shared/ai`,
   `axios`, `@azure/functions`), never deeper inside business logic.
3. **Fixtures are sanitized.** Never commit raw Strava exports: they contain GPS
   polylines, start coordinates and athlete ids. Use `scripts/sanitize-fixture.mjs`.
4. **Deterministic before LLM.** If a classification rule can be written in code, put it
   before the OpenAI call. The model never does arithmetic; it calls the calculator tools.
5. **Descriptions are idempotent.** All edits go through `applyRunNoteToDescription`:
   exactly one `--from RunNote` line, at the top, and other text (e.g. COROS) kept in order.
6. **The webhook always returns 200** to Strava, even on errors (otherwise Strava retries).
7. **Don't weaken gates** (`eslint-disable`, `@ts-ignore`, `it.skip`, config loosening)
   without saying why in the diff and in your summary.
8. **Secrets.** Never read, print or commit `local.settings.json` or `.env*`. Never deploy
   (`func azure functionapp publish`) or force-push.

## Known gaps (don't be surprised by these)

- `authConnect`, `authCallback`, `tokenStore`, `stateStore` have no tests yet.
- Model-generated tool arguments are not validated at runtime.
- Lap HR is averaged unweighted (not by lap duration).
- If the model calculates a continuous block but never returns a result, the fallback
  labels the run `E` (tested as current behaviour).
