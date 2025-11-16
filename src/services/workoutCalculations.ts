import {
  BaseWorkoutMetrics,
  IntervalWorkoutMetrics,
  RepetitionWorkoutMetrics,
} from '../models/workoutTypes';

/**
 * Helper to format pace from seconds per mile to MM:SS
 */
export function formatPace(secondsPerMile: number): string {
  const minutes = Math.floor(secondsPerMile / 60);
  const seconds = Math.round(secondsPerMile % 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Calculate running metrics from distance and time
 * Used for: Easy runs, Long runs, and overall activity metrics
 */
export function calculateRunMetrics(params: {
  distance_meters: number;
  moving_time_seconds: number;
  average_heartrate: number;
}): BaseWorkoutMetrics {
  const distanceMiles = params.distance_meters / 1609.344;
  const secondsPerMile = params.moving_time_seconds / distanceMiles;

  return {
    distance_miles: distanceMiles,
    pace_seconds_per_mile: secondsPerMile,
    average_heartrate: Math.round(params.average_heartrate),
  };
}

/**
 * Calculate tempo block metrics from lap data
 * Used for: Continuous tempo runs
 */
export function calculateTempoBlockMetrics(params: {
  laps: Array<{
    distance: number;
    moving_time: number;
    average_heartrate: number;
  }>;
}): BaseWorkoutMetrics {
  const totalDistance = params.laps.reduce((sum, lap) => sum + lap.distance, 0);
  const totalTime = params.laps.reduce((sum, lap) => sum + lap.moving_time, 0);
  const avgHr = Math.round(
    params.laps.reduce((sum, lap) => sum + lap.average_heartrate, 0) /
      params.laps.length
  );

  const distanceMiles = totalDistance / 1609.344;
  const secondsPerMile = totalTime / distanceMiles;

  return {
    distance_miles: distanceMiles,
    pace_seconds_per_mile: secondsPerMile,
    average_heartrate: avgHr,
  };
}

/**
 * Calculate interval metrics from work intervals
 * Used for: Interval tempo runs, VO2max intervals, Repetitions
 */
export function calculateIntervalMetrics(params: {
  laps: Array<{
    distance: number;
    moving_time: number;
    average_heartrate: number;
  }>;
}): IntervalWorkoutMetrics {
  // Calculate individual pace for each interval (in seconds per mile)
  const individualPacesSeconds = params.laps.map((lap) => {
    const distanceMiles = lap.distance / 1609.344;
    return lap.moving_time / distanceMiles;
  });

  // Calculate average distance per interval
  const avgDistance =
    params.laps.reduce((sum, lap) => sum + lap.distance, 0) / params.laps.length;
  const distancePerIntervalMiles = avgDistance / 1609.344;

  // Calculate average heart rate across all intervals
  const avgHr = Math.round(
    params.laps.reduce((sum, lap) => sum + lap.average_heartrate, 0) /
      params.laps.length
  );

  return {
    interval_count: params.laps.length,
    distance_per_interval_miles: distancePerIntervalMiles,
    individual_paces_seconds: individualPacesSeconds,
    average_heartrate: avgHr,
  };
}

/**
 * Round distance to nearest standard running distance
 */
function roundToStandardDistance(meters: number): number {
  // Common running distances
  const standards = [100, 200, 300, 400, 600, 800, 1000, 1200, 1600];

  // Find closest standard distance
  let closest = standards[0];
  let minDiff = Math.abs(meters - closest);

  for (const std of standards) {
    const diff = Math.abs(meters - std);
    if (diff < minDiff) {
      minDiff = diff;
      closest = std;
    }
  }

  // If within 15% of standard, use it; otherwise round to nearest 100
  if (minDiff / meters < 0.15) {
    return closest;
  }

  return Math.round(meters / 100) * 100;
}

/**
 * Detect if work intervals form a repeating ladder pattern
 */
function detectLadderPattern(workDistances: number[]): number[] | null {
  if (workDistances.length < 6) return null; // Need at least 2 sets of 3

  // First check if all work intervals are uniform (no ladder)
  const allSame = workDistances.every(d => Math.abs(d - workDistances[0]) / workDistances[0] < 0.1);
  if (allSame) return null; // Not a ladder, just uniform reps

  // Try pattern lengths from 2 to half the total work intervals
  for (let patternLen = 2; patternLen <= Math.floor(workDistances.length / 2); patternLen++) {
    const pattern = workDistances.slice(0, patternLen);

    // Pattern must have VARYING distances (not all the same)
    const patternHasVariation = !pattern.every(d => Math.abs(d - pattern[0]) / pattern[0] < 0.1);
    if (!patternHasVariation) continue; // Skip uniform patterns

    let matches = true;

    // Check if this pattern repeats
    for (let i = patternLen; i < workDistances.length; i++) {
      const expectedDist = pattern[i % patternLen];
      const actualDist = workDistances[i];

      // Allow 10% tolerance for matching
      if (Math.abs(actualDist - expectedDist) / expectedDist > 0.1) {
        matches = false;
        break;
      }
    }

    if (matches && workDistances.length >= patternLen * 2) {
      // Found a repeating pattern with variation, return it
      return pattern;
    }
  }

  return null;
}

/**
 * Analyze repetition workout structure from lap data
 * Used for: Repetition (R) workouts with sets and reps
 *
 * This function analyzes the workout structure to determine:
 * - Number of sets
 * - Number of reps per set
 * - Work interval distance(s)
 * - Recovery interval distance
 * - Between-set recovery distance
 * - Ladder pattern (if work intervals vary)
 *
 * Algorithm:
 * 1. Identify alternating fast/slow pattern by analyzing consecutive laps
 * 2. Work laps: fast (>4.3 m/s), 200-600m
 * 3. Recovery laps: slow (<3.5 m/s), similar distance to work
 * 4. Between-set recovery: long (>600m) slow laps
 * 5. Detect ladder patterns (e.g., 200m, 200m, 400m repeating)
 */
export function calculateRepetitionStructure(params: {
  laps: Array<{
    distance: number;
    moving_time: number;
    average_speed: number;
  }>;
}): RepetitionWorkoutMetrics {
  const laps = params.laps;

  // Identify work laps (fast, short) and recovery types
  const workLaps: number[] = [];
  const regularRecoveryLaps: number[] = [];
  const betweenSetRecoveryLaps: number[] = [];

  for (let i = 0; i < laps.length; i++) {
    const lap = laps[i];

    // Work lap criteria: fast AND short
    if (lap.average_speed > 4.3 && lap.distance >= 180 && lap.distance <= 600) {
      workLaps.push(i);
    }
    // Between-set recovery: slow AND long
    else if (lap.average_speed < 3.5 && lap.distance > 600) {
      betweenSetRecoveryLaps.push(i);
    }
    // Regular recovery: slow AND short
    else if (lap.average_speed < 3.5 && lap.distance >= 150 && lap.distance <= 600) {
      regularRecoveryLaps.push(i);
    }
  }

  // Get work distances in order and round them
  const workDistances = workLaps.map(idx => roundToStandardDistance(laps[idx].distance));

  // Detect ladder pattern
  const ladderPattern = detectLadderPattern(workDistances);

  // Calculate work distance
  let workDistance: number;
  if (ladderPattern) {
    // For ladder, use the first distance in pattern as representative
    workDistance = ladderPattern[0];
  } else {
    // For uniform reps, average all work distances
    const avgWorkDist = workLaps.reduce((sum, idx) => sum + laps[idx].distance, 0) / workLaps.length;
    workDistance = roundToStandardDistance(avgWorkDist);
  }

  // Calculate average regular recovery distance and round to standard
  const avgRecoveryDist = regularRecoveryLaps.length > 0
    ? regularRecoveryLaps.reduce((sum, idx) => sum + laps[idx].distance, 0) / regularRecoveryLaps.length
    : workDistances[0] || 200;
  const recoveryDistance = roundToStandardDistance(avgRecoveryDist);

  // Calculate between-set recovery distance
  const betweenSetRecovery = betweenSetRecoveryLaps.length > 0
    ? roundToStandardDistance(laps[betweenSetRecoveryLaps[0]].distance)
    : 0;

  // Calculate sets and reps per set
  let sets = 1;
  let repsPerSet = workLaps.length;

  if (ladderPattern) {
    // For ladder patterns, sets = total work intervals / pattern length
    sets = Math.floor(workLaps.length / ladderPattern.length);
    repsPerSet = ladderPattern.length;
  } else if (betweenSetRecoveryLaps.length > 0) {
    // Number of sets = number of between-set recoveries + 1
    sets = betweenSetRecoveryLaps.length + 1;
    repsPerSet = Math.round(workLaps.length / sets);
  }

  return {
    sets,
    reps_per_set: repsPerSet,
    work_distance_meters: workDistance,
    recovery_distance_meters: recoveryDistance,
    between_set_recovery_distance_meters: betweenSetRecovery,
    ladder_pattern: ladderPattern || undefined,
  };
}
