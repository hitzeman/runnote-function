/**
 * Workout type classification
 */
export type WorkoutType = 'L' | 'T' | 'E' | 'V' | 'R';

/**
 * Tempo workout structure (Interval vs Continuous)
 */
export type TempoStructure = 'interval' | 'continuous';

/**
 * Base metrics for all workout types
 */
export interface BaseWorkoutMetrics {
  distance_miles: number;
  pace_seconds_per_mile: number;
  average_heartrate: number;
}

/**
 * Metrics specific to interval workouts
 */
export interface IntervalWorkoutMetrics {
  interval_count: number;
  distance_per_interval_miles: number;
  individual_paces_seconds: number[];
  average_heartrate: number;
}

/**
 * Metrics specific to repetition workouts
 * Captures the structure of R workouts (sets, reps, distances)
 *
 * Supports both uniform patterns (e.g., "10 x 200m") and mixed patterns (e.g., "4 x (200m, 200m, 400m)")
 */
export interface RepetitionWorkoutMetrics {
  sets: number;
  reps_per_set: number;

  /**
   * Work interval distances in meters
   * - Single number for uniform patterns: 200 (means all intervals are 200m)
   * - Array for mixed patterns: [200, 200, 400] (pattern that repeats)
   */
  work_distance_meters: number | number[];

  /**
   * Recovery interval distances in meters
   * - Single number for uniform recovery: 200
   * - Array for mixed recovery: [200, 300] (if recovery varies within pattern)
   */
  recovery_distance_meters: number | number[];

  /**
   * Distance for recovery between sets (in meters)
   * Only applies when sets > 1
   */
  between_set_recovery_distance_meters: number;
}

/**
 * Structured output from LLM workout analysis
 */
export interface WorkoutAnalysisResult {
  /**
   * Primary workout type classification
   * L = Long Run, T = Tempo, E = Easy, V = VO2max, R = Repetitions
   */
  type: WorkoutType;

  /**
   * For Tempo runs, specifies if interval or continuous
   */
  structure?: TempoStructure;

  /**
   * Metrics for continuous workouts (Easy, Long, Continuous Tempo)
   */
  metrics?: BaseWorkoutMetrics;

  /**
   * Metrics for interval workouts
   */
  interval_metrics?: IntervalWorkoutMetrics;

  /**
   * Metrics for repetition workouts
   */
  repetition_metrics?: RepetitionWorkoutMetrics;
}

/**
 * Activity update payload
 */
export interface ActivityUpdate {
  description?: string;
  name?: string;
}
