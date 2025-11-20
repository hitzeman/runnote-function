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
 * Find repeating pattern in an array of values
 * Returns the pattern and number of complete repetitions, or null if no pattern found
 *
 * Note: Prefers shorter patterns over longer ones (e.g., [200,200,400] over [200,200,400,200,200,400])
 * Allows for incomplete patterns at the end (e.g., [200,400,200,200,400,200,200,400] has pattern [200,400,200] x 2 + partial)
 */
function findRepeatingPattern(arr: number[]): {
  pattern: number[];
  sets: number;
} | null {
  // Try pattern lengths from 1 to half the array length
  // Start from SMALLEST patterns to prefer simpler repeating units
  for (let len = 1; len <= Math.floor(arr.length / 2); len++) {
    const pattern = arr.slice(0, len);
    let fullSets = 0;
    let isValidPattern = true;

    // Check if this pattern repeats throughout the array
    for (let i = 0; i < arr.length; i += len) {
      const segment = arr.slice(i, i + len);

      if (segment.length === len) {
        // Full segment - check if it matches the pattern
        if (JSON.stringify(segment) === JSON.stringify(pattern)) {
          fullSets++;
        } else {
          // Pattern doesn't match - not a valid pattern
          isValidPattern = false;
          break;
        }
      } else if (segment.length > 0) {
        // Partial segment at the end - this is OK for repetition workouts
        // (athlete might not complete the final rep)
        // Just verify the partial matches the start of the pattern
        const partialPattern = pattern.slice(0, segment.length);
        if (JSON.stringify(segment) !== JSON.stringify(partialPattern)) {
          isValidPattern = false;
        }
        // Don't count the partial set
        break;
      }
    }

    // If we found at least 2 complete repetitions of this pattern, return it
    if (isValidPattern && fullSets >= 2) {
      return { pattern, sets: fullSets };
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
 * - Number of reps per set (or pattern of reps)
 * - Work interval distance(s)
 * - Recovery interval distance(s)
 * - Between-set recovery distance
 *
 * Algorithm:
 * 1. Identify alternating fast/slow pattern by analyzing consecutive laps
 * 2. Work laps: fast (>4.3 m/s), 200-600m
 * 3. Recovery laps: slow (<3.5 m/s), similar distance to work
 * 4. Between-set recovery: long (>600m) slow laps
 * 5. Detect repeating patterns in work/recovery distances (e.g., 200, 200, 400)
 */
export function calculateRepetitionStructure(params: {
  laps: Array<{
    distance: number;
    moving_time: number;
    average_speed: number;
  }>;
}): RepetitionWorkoutMetrics {
  const laps = params.laps;

  // Validate input
  if (!laps || laps.length === 0) {
    throw new Error('calculateRepetitionStructure: No laps provided');
  }

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
    // Regular recovery: slow AND short
    else if (lap.average_speed < 3.5 && lap.distance >= 150 && lap.distance <= 600) {
      regularRecoveryLaps.push(i);
    }
    // Between-set recovery: slow AND long, BUT must be BETWEEN work intervals
    // (not at the beginning or end, which would be warmup/cooldown)
    else if (
      lap.average_speed < 3.5 &&
      lap.distance > 600 &&
      lap.distance <= 2000 && // Cap at 2000m to exclude warmup/cooldown
      i > 0 && // Not the first lap (would be warmup)
      i < laps.length - 3 // Not in the last 3 laps (would be cooldown)
    ) {
      // Check if there are work laps both before and after this lap
      const hasWorkBefore = workLaps.some(idx => idx < i);
      const hasWorkAfter = laps.slice(i + 1).some(
        lap => lap.average_speed > 4.3 && lap.distance >= 180 && lap.distance <= 600
      );

      if (hasWorkBefore && hasWorkAfter) {
        betweenSetRecoveryLaps.push(i);
      }
    }
  }

  // Validate that we found work laps
  if (workLaps.length === 0) {
    throw new Error(
      'calculateRepetitionStructure: No work laps found. This does not appear to be a repetition workout. Work laps must be 180-600m and >4.3 m/s.'
    );
  }

  // Round all work distances to standard distances
  const workDistances = workLaps.map((idx) =>
    roundToStandardDistance(laps[idx].distance)
  );

  // Round all recovery distances to standard distances
  const recoveryDistances = regularRecoveryLaps.map((idx) =>
    roundToStandardDistance(laps[idx].distance)
  );

  // Calculate between-set recovery distance
  const betweenSetRecovery =
    betweenSetRecoveryLaps.length > 0
      ? roundToStandardDistance(laps[betweenSetRecoveryLaps[0]].distance)
      : 0;

  // Detect repeating patterns in work intervals
  const workPattern = findRepeatingPattern(workDistances);

  // Detect repeating patterns in recovery intervals
  const recoveryPattern = findRepeatingPattern(recoveryDistances);

  // Calculate sets and reps per set
  let sets = 1;
  let repsPerSet: number;
  let workDistance: number | number[];
  let recoveryDistance: number | number[];

  if (betweenSetRecoveryLaps.length > 0) {
    // Number of sets = number of between-set recoveries + 1
    sets = betweenSetRecoveryLaps.length + 1;
  }

  if (workPattern) {
    // We found a repeating pattern in work distances
    if (workPattern.pattern.length === 1) {
      // Uniform pattern: all work intervals are the same distance
      workDistance = workPattern.pattern[0];

      if (betweenSetRecoveryLaps.length > 0) {
        // We have between-set recoveries, so calculate reps per set
        sets = betweenSetRecoveryLaps.length + 1;
        repsPerSet = Math.round(workPattern.sets / sets);
      } else {
        // No between-set recoveries, so it's a single set
        sets = 1;
        repsPerSet = workPattern.sets;
      }
    } else {
      // Mixed pattern: work intervals vary (e.g., 200, 200, 400)
      workDistance = workPattern.pattern;
      repsPerSet = workPattern.pattern.length;

      // Number of sets = number of times the pattern repeats
      if (betweenSetRecoveryLaps.length > 0) {
        // We have explicit between-set recovery markers
        sets = betweenSetRecoveryLaps.length + 1;
      } else {
        // No between-set recovery, pattern repeats = sets
        sets = workPattern.sets;
      }
    }
  } else {
    // No repeating pattern found - fall back to averaging
    const avgWorkDist =
      workDistances.reduce((sum, d) => sum + d, 0) / workDistances.length;
    workDistance = roundToStandardDistance(avgWorkDist);

    if (betweenSetRecoveryLaps.length > 0) {
      sets = betweenSetRecoveryLaps.length + 1;
      repsPerSet = Math.round(workLaps.length / sets);
    } else {
      sets = 1;
      repsPerSet = workLaps.length;
    }
  }

  // Handle recovery distances
  if (recoveryPattern && recoveryPattern.pattern.length > 1) {
    // Mixed recovery pattern
    recoveryDistance = recoveryPattern.pattern;
  } else if (recoveryDistances.length > 0) {
    // Uniform recovery - average them
    const avgRecoveryDist =
      recoveryDistances.reduce((sum, d) => sum + d, 0) / recoveryDistances.length;
    recoveryDistance = roundToStandardDistance(avgRecoveryDist);
  } else {
    // No recovery laps found - default to work distance
    recoveryDistance = Array.isArray(workDistance)
      ? workDistance[0]
      : workDistance;
  }

  return {
    sets,
    reps_per_set: repsPerSet,
    work_distance_meters: workDistance,
    recovery_distance_meters: recoveryDistance,
    between_set_recovery_distance_meters: betweenSetRecovery,
  };
}
