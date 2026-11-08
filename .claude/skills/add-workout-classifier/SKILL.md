---
name: add-workout-classifier
description: Add or change how RunNote classifies a run (Long/Easy/Tempo/VO2max rules, thresholds, interval detection, or summary format) test-first, using a sanitized real activity as the fixture. Use when a run is misclassified, when adding a workout type, or when changing the classifier prompt or calculator tools.
---

# add-workout-classifier

Past classification fixes (see `git log`) were mostly prompt edits checked by
running one activity against the live OpenAI API. This skill makes each change
land with an offline regression test built from a real activity.

## 0. Know which path you are on

`src/services/workoutAnalysis.ts` → `analyzeWorkout()`:

1. **Long** (`isLongRun`: ≥ 10 mi or ≥ 90 min): deterministic, no LLM.
2. **Easy** (`isEasyRun`: every lap in pace zone 1–2): deterministic, no LLM.
3. **Everything else** → OpenAI with `SYSTEM_PROMPT` and calculator tools.
   The model picks laps; all arithmetic happens in `src/services/workoutCalculations.ts`.

Prefer a deterministic rule (path 1–2) over a prompt change whenever the rule can
be stated in code. Never let the model do arithmetic.

## 1. Get a fixture

Ask the user for the raw Strava activity JSON (`GET /api/v3/activities/{id}`,
including `laps`) and the summary line they expect. Do not fetch it yourself
and do not invent lap data. Then:

```bash
node scripts/sanitize-fixture.mjs /path/to/raw.json > /tmp/sanitized.json
```

Append the activity object to the right `test/fixtures/{easy,long,tempo}.json`.
Never commit the raw export.

## 2. Write the failing test first

- Deterministic path: add a case to `test/workoutAnalysis.test.ts` asserting
  `formatWorkoutSummary(await analyzeWorkout(fixture))` equals the expected line
  and that `create` (the mocked OpenAI call) was not called.
- LLM path: script the model with `toolCallsResponse(...)` / `stopResponse()` (see
  existing tests). Assert what we send (laps present, tools offered) and what we do
  with the model's tool calls. The model is mocked, so these tests cannot show
  that the prompt works; say so in your report.
- Formatting only: add a case to `test/activityFormatter.test.ts`.

Run `npx vitest run <file>` and **show the failure** before changing `src/`.

## 3. Implement

Touch only what the change needs. If you add a `WorkoutType`, update together:
`src/models/workoutTypes.ts`, the `returnWorkoutResult` enum in `workoutAnalysis.ts`,
`generateActivityTitle` and `formatWorkoutSummary` in `src/utils/activityFormatter.ts`.

## 4. Verify

Run the `verify-change` skill. Every existing fixture test must still pass; a
change that "fixes" one activity by breaking another is not done.
