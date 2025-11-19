import { Activity } from '../models/activity.model';

/**
 * Pre-detection result for workout classification
 */
export interface PreDetectionResult {
  /** True if we can confidently classify this as an easy run without AI */
  isEasyRun: boolean;
  /** Confidence level (0-1) in the easy run classification */
  confidence: number;
  /** Reason for the classification */
  reason: string;
}

/**
 * Pre-detect if a workout is an easy run using simple heuristics.
 * This allows us to use a cheaper/faster model for obvious easy runs.
 *
 * Easy Run Characteristics (from data analysis):
 * - Max speed: ≤4.6 m/s
 * - Max HR: ≤165 bpm
 * - Consistent lap pacing (no alternating fast/slow intervals)
 * - No short recovery laps (<150m)
 * - No high-speed work intervals (>4.0 m/s)
 *
 * @param activity Strava activity data
 * @returns PreDetectionResult indicating if this is likely an easy run
 */
export function preDetectEasyRun(activity: Activity): PreDetectionResult {
  // Safety check: must have laps data
  if (!activity.laps || activity.laps.length === 0) {
    return {
      isEasyRun: false,
      confidence: 0,
      reason: 'No laps data available',
    };
  }

  // Check 1: Overall max HR (strong signal for easy runs)
  const maxHR = activity.max_heartrate;
  if (maxHR && maxHR > 165) {
    return {
      isEasyRun: false,
      confidence: 0.95,
      reason: `High max HR (${maxHR} bpm) indicates workout intensity`,
    };
  }

  // Check 2: Overall max speed (strong signal for easy runs)
  const maxSpeed = activity.max_speed;
  if (maxSpeed && maxSpeed > 4.6) {
    return {
      isEasyRun: false,
      confidence: 0.9,
      reason: `High max speed (${maxSpeed.toFixed(2)} m/s) indicates workout intervals`,
    };
  }

  // Check 3: Look for interval patterns in laps
  const hasShortRecoveryLaps = activity.laps.some(
    (lap) => lap.distance && lap.distance < 150
  );
  const hasHighSpeedWorkLaps = activity.laps.some(
    (lap) => lap.average_speed && lap.average_speed > 4.0
  );

  if (hasShortRecoveryLaps) {
    return {
      isEasyRun: false,
      confidence: 0.9,
      reason: 'Short recovery laps detected (interval workout pattern)',
    };
  }

  if (hasHighSpeedWorkLaps) {
    return {
      isEasyRun: false,
      confidence: 0.85,
      reason: 'High-speed work intervals detected',
    };
  }

  // Check 4: Look for alternating pace patterns (repetitions)
  // Calculate speed differential between consecutive laps
  let maxSpeedDifferential = 0;
  for (let i = 1; i < activity.laps.length; i++) {
    const prevSpeed = activity.laps[i - 1].average_speed;
    const currSpeed = activity.laps[i].average_speed;
    if (prevSpeed && currSpeed) {
      const diff = Math.abs(currSpeed - prevSpeed);
      maxSpeedDifferential = Math.max(maxSpeedDifferential, diff);
    }
  }

  if (maxSpeedDifferential > 1.5) {
    return {
      isEasyRun: false,
      confidence: 0.85,
      reason: `Large pace variations between laps (${maxSpeedDifferential.toFixed(2)} m/s differential)`,
    };
  }

  // If we've passed all checks, this is very likely an easy run
  return {
    isEasyRun: true,
    confidence: 0.9,
    reason: 'Consistent pace, moderate HR, no interval patterns detected',
  };
}
