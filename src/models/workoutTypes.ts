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
 */
export interface RepetitionWorkoutMetrics {
  sets: number;
  reps_per_set: number;
  work_distance_meters: number;
  recovery_distance_meters: number;
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
