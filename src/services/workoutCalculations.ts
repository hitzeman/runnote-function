import {
  BaseWorkoutMetrics,
  IntervalWorkoutMetrics,
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
