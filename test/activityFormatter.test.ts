import { describe, expect, it } from 'vitest';
import {
  applyRunNoteToDescription,
  createActivityUpdate,
  formatWorkoutSummary,
  generateActivityTitle,
} from '../src/utils/activityFormatter';
import type { WorkoutAnalysisResult } from '../src/models/workoutTypes';
import { loadAll } from './helpers';

const MARKER = '--from RunNote';
const countMarkers = (s: string) => (s.match(/--\s*from\s*RunNote/gi) ?? []).length;

describe('formatWorkoutSummary', () => {
  it('formats easy runs with one-decimal distance under 10 mi and HR', () => {
    expect(
      formatWorkoutSummary({
        type: 'E',
        metrics: { distance_miles: 7.27, pace_seconds_per_mile: 545, average_heartrate: 124 },
      })
    ).toBe('E 7.3 mi @ 9:05/mi (HR 124)');
  });

  it('rounds distance to whole miles at 10 mi and above', () => {
    expect(
      formatWorkoutSummary({
        type: 'L',
        metrics: { distance_miles: 11.01, pace_seconds_per_mile: 539, average_heartrate: 130 },
      })
    ).toBe('L 11 mi @ 8:59/mi (HR 130)');
  });

  it('formats continuous tempo with "avg" pace and no HR', () => {
    expect(
      formatWorkoutSummary({
        type: 'T',
        structure: 'continuous',
        metrics: { distance_miles: 3.11, pace_seconds_per_mile: 398, average_heartrate: 161 },
      })
    ).toBe('T 3.1 mi @ avg 6:38/mi');
  });

  it('formats interval workouts with each rep pace', () => {
    expect(
      formatWorkoutSummary({
        type: 'T',
        structure: 'interval',
        interval_metrics: {
          interval_count: 3,
          distance_per_interval_miles: 1.0,
          individual_paces_seconds: [384, 384, 383],
          average_heartrate: 160,
        },
      })
    ).toBe('T 3 x 1 mi @ 6:24, 6:24, 6:23');
  });

  it('uses one decimal for sub-mile reps', () => {
    expect(
      formatWorkoutSummary({
        type: 'T',
        structure: 'interval',
        interval_metrics: {
          interval_count: 2,
          distance_per_interval_miles: 0.62,
          individual_paces_seconds: [394, 390],
          average_heartrate: 160,
        },
      })
    ).toBe('T 2 x 0.6 mi @ 6:34, 6:30');
  });

  // Known bug, fixed in a follow-up commit. Strava records a 1-mile lap as
  // 1609.34 m, i.e. 0.999997 mi, which currently renders as "1.0 mi".
  it.fails('renders Strava 1609.34 m reps as "1 mi"', () => {
    expect(
      formatWorkoutSummary({
        type: 'T',
        structure: 'interval',
        interval_metrics: {
          interval_count: 3,
          distance_per_interval_miles: 1609.34 / 1609.344,
          individual_paces_seconds: [383, 384, 382],
          average_heartrate: 167,
        },
      })
    ).toBe('T 3 x 1 mi @ 6:23, 6:24, 6:22');
  });

  it('omits HR when the activity has none', () => {
    expect(
      formatWorkoutSummary({ type: 'E', metrics: { distance_miles: 5, pace_seconds_per_mile: 520 } })
    ).toBe('E 5.0 mi @ 8:40/mi');
  });

  it('falls back to "<type> run" with no metrics', () => {
    expect(formatWorkoutSummary({ type: 'V' })).toBe('V run');
  });
});

describe('applyRunNoteToDescription', () => {
  it('adds the summary to an empty description', () => {
    expect(applyRunNoteToDescription('', 'E 7.2 mi @ 8:09/mi (HR 141)')).toBe(
      `E 7.2 mi @ 8:09/mi (HR 141) ${MARKER}\n\n`
    );
    expect(applyRunNoteToDescription(null, 'X')).toBe(`X ${MARKER}\n\n`);
    expect(applyRunNoteToDescription(undefined, 'X')).toBe(`X ${MARKER}\n\n`);
  });

  it('prepends above existing device content and preserves it in order', () => {
    expect(applyRunNoteToDescription('137 Training Load\n-- from COROS', 'T 5k')).toBe(
      `T 5k ${MARKER}\n\n137 Training Load\n-- from COROS`
    );
  });

  it('replaces (never stacks) a previous RunNote line', () => {
    const existing = `T 3 x 1mi @ 6:30, 6:29, 6:28 ${MARKER}\n\n137 Training Load\n-- from COROS`;
    expect(applyRunNoteToDescription(existing, 'E 7.2 mi @ 8:09/mi (HR 141)')).toBe(
      `E 7.2 mi @ 8:09/mi (HR 141) ${MARKER}\n\n137 Training Load\n-- from COROS`
    );
  });

  it('matches old markers case- and space-insensitively', () => {
    expect(applyRunNoteToDescription('Old summary --FROM RUNNOTE\n\n--from COROS', 'New')).toBe(
      `New ${MARKER}\n\n--from COROS`
    );
    expect(applyRunNoteToDescription('Old -- from  runnote', 'New')).toBe(`New ${MARKER}\n\n`);
  });

  it('strips markers the summary itself already contains', () => {
    expect(applyRunNoteToDescription('', `E 7.5 mi ${MARKER} ${MARKER}`)).toBe(`E 7.5 mi ${MARKER}\n\n`);
  });

  it('collapses a multi-line summary to one line', () => {
    expect(applyRunNoteToDescription('', 'T 3 x 1 mi\n  @ 6:24')).toBe(`T 3 x 1 mi @ 6:24 ${MARKER}\n\n`);
  });

  it('normalizes CRLF line endings', () => {
    expect(applyRunNoteToDescription('line one\r\nline two', 'S')).toBe(`S ${MARKER}\n\nline one\nline two`);
  });

  it('is idempotent: applying the same summary twice changes nothing', () => {
    const once = applyRunNoteToDescription('102 Training Load\n-- from COROS', 'E 8.1 mi');
    expect(applyRunNoteToDescription(once, 'E 8.1 mi')).toBe(once);
  });

  // Real descriptions captured from Strava (see test/fixtures). Every fixture
  // must end up with exactly one marker, and re-applying must be a no-op.
  const fixtureDescriptions = [...loadAll('easy'), ...loadAll('long'), ...loadAll('tempo')]
    .filter((a) => a.description)
    // 16514624729 has an em-dash marker; covered separately below.
    .filter((a) => a.id !== 16514624729)
    .map((a) => [a.id, a.description as string] as const);

  it.each(fixtureDescriptions)('fixture %s: exactly one marker, idempotent', (_id, desc) => {
    const once = applyRunNoteToDescription(desc, 'E 5.0 mi @ 8:00/mi (HR 140)');
    expect(countMarkers(once)).toBe(1);
    expect(once.startsWith('E 5.0 mi @ 8:00/mi (HR 140) --from RunNote\n\n')).toBe(true);
    expect(applyRunNoteToDescription(once, 'E 5.0 mi @ 8:00/mi (HR 140)')).toBe(once);
  });

  // Known bug, fixed in a follow-up commit. Real Strava data contains an
  // em-dash marker ("—from RunNote", e.g. from mobile autocorrect) which the
  // marker regex does not recognise, so the old annotation survives.
  it.fails('replaces an em-dash "—from RunNote" marker instead of keeping it', () => {
    const existing = '5k T avg 6:36/mi —from RunNote\n\n134 Training Load\n-- from COROS';
    expect(applyRunNoteToDescription(existing, 'T 3.1 mi @ avg 6:36/mi')).toBe(
      `T 3.1 mi @ avg 6:36/mi ${MARKER}\n\n134 Training Load\n-- from COROS`
    );
  });
});

describe('createActivityUpdate', () => {
  const easy: WorkoutAnalysisResult = {
    type: 'E',
    metrics: { distance_miles: 8, pace_seconds_per_mile: 520, average_heartrate: 140 },
  };

  it('does not rename easy runs', () => {
    const u = createActivityUpdate('', easy);
    expect(u.name).toBeUndefined();
    expect(u.description).toBe(`E 8.0 mi @ 8:40/mi (HR 140) ${MARKER}\n\n`);
  });

  it.each([
    ['L', 'Long Run'],
    ['T', 'Tempo Run'],
    ['V', 'VO2max Intervals'],
  ] as const)('renames %s workouts to "%s"', (type, title) => {
    expect(createActivityUpdate('', { ...easy, type }).name).toBe(title);
    expect(generateActivityTitle(type)).toBe(title);
  });
});
