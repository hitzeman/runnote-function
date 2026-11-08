#!/usr/bin/env node
// Reduce a raw Strava activity export (GET /activities/{id}) to the fields
// RunNote actually reads, so it can be committed as a test fixture.
//
// Strips everything location- or identity-bearing: map/polyline, lat/lng,
// athlete id, embed_token, segment efforts, gear, photos, timestamps.
//
// Usage: node scripts/sanitize-fixture.mjs raw.json > test/fixtures/<name>.json
// Input may be a single activity object or an array of them.
import { readFileSync } from 'node:fs';

const ACTIVITY_FIELDS = [
  'id', 'name', 'type', 'sport_type', 'distance', 'moving_time',
  'elapsed_time', 'average_speed', 'max_speed', 'average_heartrate',
  'max_heartrate', 'description', 'laps',
];
const LAP_FIELDS = [
  'id', 'name', 'lap_index', 'distance', 'moving_time', 'elapsed_time',
  'average_speed', 'max_speed', 'average_heartrate', 'max_heartrate',
  'pace_zone',
];

const pick = (obj, keys) =>
  Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/sanitize-fixture.mjs <raw-activity.json>');
  process.exit(1);
}
const raw = JSON.parse(readFileSync(file, 'utf8'));
const activities = (Array.isArray(raw) ? raw : [raw]).map((a) => {
  const out = pick(a, ACTIVITY_FIELDS);
  out.laps = (a.laps ?? []).map((lap) => pick(lap, LAP_FIELDS));
  return out;
});
process.stdout.write(JSON.stringify(activities, null, 2) + '\n');
