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
 * Analyze repetition workout structure from lap data
 * Used for: Repetition (R) workouts with sets and reps
 *
 * This function analyzes the workout structure to determine:
 * - Number of sets
 * - Number of reps per set
 * - Work interval distance
 * - Recovery interval distance
 * - Between-set recovery distance
 */
export function calculateRepetitionStructure(params: {
  laps: Array<{
    distance: number;
    moving_time: number;
    average_speed: number;
  }>;
}): RepetitionWorkoutMetrics {
  // Find work and recovery laps based on speed differential
  // Work laps are significantly faster than recovery laps
  const avgSpeed = params.laps.reduce((sum, lap) => sum + lap.average_speed, 0) / params.laps.length;
  const workLaps = params.laps.filter(lap => lap.average_speed > avgSpeed);
  const recoveryLaps = params.laps.filter(lap => lap.average_speed <= avgSpeed);

  // Determine work distance (most common distance among fast laps)
  const workDistance = Math.round(workLaps[0]?.distance || 200);

  // Determine recovery distance (most common short distance among slow laps)
  const shortRecoveryLaps = recoveryLaps.filter(lap => lap.distance < 400);
  const recoveryDistance = Math.round(shortRecoveryLaps[0]?.distance || workDistance);

  // Find between-set recovery (long slow laps)
  const longRecoveryLaps = recoveryLaps.filter(lap => lap.distance >= 600);
  const betweenSetRecovery = longRecoveryLaps.length > 0
    ? Math.round(longRecoveryLaps[0].distance)
    : 0;

  // Calculate sets and reps per set
  let sets = 1;
  let repsPerSet = workLaps.length;

  if (longRecoveryLaps.length > 0) {
    // If there are long recovery laps, they separate sets
    sets = longRecoveryLaps.length + 1;
    repsPerSet = Math.round(workLaps.length / sets);
  }

  return {
    sets,
    reps_per_set: repsPerSet,
    work_distance_meters: workDistance,
    recovery_distance_meters: recoveryDistance,
    between_set_recovery_distance_meters: betweenSetRecovery,
  };
}
