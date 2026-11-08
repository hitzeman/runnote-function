---
name: verify-change
description: Run RunNote's full pre-review gate (lint, typecheck, tests, build, dependency audit) and a diff hygiene check, then report results honestly. Use before saying a change is done, before committing, or when asked to "verify", "check", or "make sure CI will pass".
---

# verify-change

The bar is "CI would be green and a human reviewer sees nothing surprising in the diff".
The Stop hook only runs typecheck + tests; this skill is the full gate.

## 1. Run the gate (same order as `.github/workflows/ci.yml`)

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm audit --audit-level=high
```

Run each one even if an earlier one fails, so you report every failure at once.
Do not "fix" a failure by weakening the gate: no `eslint-disable`, `@ts-ignore`,
`it.skip`, loosened assertions, or tsconfig/eslint config changes unless the user
asked for that. If a suppression is truly warranted, add a comment explaining
why and call it out in your report.

## 2. Check the diff

```bash
git status --short
git diff --stat HEAD
```

Look for, and fix or flag:

- **Secrets**: API keys, tokens, connection strings, `local.settings.json`, `.env`.
- **Raw Strava data**: any `test/fixtures/*.json` containing `map`, `polyline`,
  `start_latlng`, `athlete`, or `embed_token`. Fixtures must come from
  `node scripts/sanitize-fixture.mjs`.
- **Scratch files**: ad-hoc scripts, `console.log` debugging, commented-out code blocks.
- **Unrelated changes**: formatting churn or drive-by edits outside the task.
- **Tests that hit the network**: anything importing `axios`, `openai` or
  `src/shared/{strava,ai}` without a `vi.mock` for it.

## 3. Report

Give a short table: each gate step → pass / fail (with the first relevant error).
List anything you deliberately left (and why). Never report "all green" without
having run every step in this session.
