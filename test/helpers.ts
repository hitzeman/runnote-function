import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Activity } from '../src/models/activity.model';

type FixtureSet = 'easy' | 'long' | 'tempo';

/** Load a sanitized Strava activity from test/fixtures (see scripts/sanitize-fixture.mjs). */
export function loadActivity(set: FixtureSet, id: number): Activity {
  const all = JSON.parse(
    readFileSync(join(__dirname, 'fixtures', `${set}.json`), 'utf8')
  ) as Activity[];
  const found = all.find((a) => a.id === id);
  if (!found) throw new Error(`fixture ${set}/${id} not found`);
  // Deep copy so tests can mutate freely.
  return structuredClone(found);
}

export function loadAll(set: FixtureSet): Activity[] {
  return JSON.parse(
    readFileSync(join(__dirname, 'fixtures', `${set}.json`), 'utf8')
  ) as Activity[];
}
