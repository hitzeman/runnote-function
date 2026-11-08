import { describe, expect, it } from 'vitest';
import {
  calculateIntervalMetrics,
  calculateRunMetrics,
  calculateTempoBlockMetrics,
  formatPace,
} from '../src/services/workoutCalculations';

const MILE = 1609.344;

describe('formatPace', () => {
  it('formats whole and fractional seconds per mile as M:SS', () => {
    expect(formatPace(398)).toBe('6:38');
    expect(formatPace(540)).toBe('9:00');
    expect(formatPace(545.2)).toBe('9:05');
  });

  it('carries into the next minute when seconds round up to 60', () => {
    // 6:59.6 should display as 7:00, never 6:60.
    expect(formatPace(419.6)).toBe('7:00');
  });
});

describe('calculateRunMetrics', () => {
  it('converts meters/seconds to miles and seconds-per-mile', () => {
    const m = calculateRunMetrics({
      distance_meters: 10 * MILE,
      moving_time_seconds: 5400,
      average_heartrate: 139.6,
    });
    expect(m.distance_miles).toBeCloseTo(10, 6);
    expect(m.pace_seconds_per_mile).toBeCloseTo(540, 6);
    expect(m.average_heartrate).toBe(140);
  });

  it('leaves heart rate undefined when the activity has no HR data', () => {
    const m = calculateRunMetrics({ distance_meters: MILE, moving_time_seconds: 480 });
    expect(m.average_heartrate).toBeUndefined();
  });
});

describe('calculateTempoBlockMetrics', () => {
  it('sums distance and time across the block and averages lap HR', () => {
    const m = calculateTempoBlockMetrics({
      laps: [
        { distance: MILE, moving_time: 400, average_heartrate: 158 },
        { distance: MILE, moving_time: 396, average_heartrate: 163 },
        { distance: MILE / 2, moving_time: 196, average_heartrate: 166 },
      ],
    });
    expect(m.distance_miles).toBeCloseTo(2.5, 6);
    expect(m.pace_seconds_per_mile).toBeCloseTo(992 / 2.5, 6);
    // Unweighted mean of lap averages: (158+163+166)/3 = 162.33 -> 162
    expect(m.average_heartrate).toBe(162);
  });
});

describe('calculateIntervalMetrics', () => {
  it('returns per-interval paces in lap order', () => {
    const m = calculateIntervalMetrics({
      laps: [
        { distance: 1000, moving_time: 245, average_heartrate: 160 },
        { distance: 1000, moving_time: 238, average_heartrate: 164 },
        { distance: 1000, moving_time: 237, average_heartrate: 168 },
      ],
    });
    expect(m.interval_count).toBe(3);
    expect(m.distance_per_interval_miles).toBeCloseTo(1000 / MILE, 6);
    expect(m.individual_paces_seconds.map(formatPace)).toEqual(['6:34', '6:23', '6:21']);
    expect(m.average_heartrate).toBe(164);
  });
});
