import {
  WorkoutAnalysisResult,
  WorkoutType,
  ActivityUpdate,
} from '../models/workoutTypes';
import { formatPace } from '../services/workoutCalculations';

/**
 * Generate activity title based on workout type
 */
export function generateActivityTitle(workoutType: WorkoutType): string {
  const titles: Record<WorkoutType, string> = {
    L: 'Long Run',
    T: 'Tempo Run',
    E: 'Easy Run',
    V: 'VO2max Intervals',
    R: 'Repetition Run',
  };
  return titles[workoutType];
}

/**
 * Format workout analysis result into a human-readable summary
 */
export function formatWorkoutSummary(result: WorkoutAnalysisResult): string {
  const { type, structure, metrics, interval_metrics, repetition_metrics } = result;

  // Repetition workouts - format as structural description
  if (repetition_metrics) {
    const { sets, reps_per_set, work_distance_meters, recovery_distance_meters, between_set_recovery_distance_meters } = repetition_metrics;

    // Format distances in meters
    const workDist = `${work_distance_meters}m`;
    const recDist = `${recovery_distance_meters}m`;

    // Build the workout structure description
    let description: string;
    if (sets === 1) {
      // Single set: "10 x 200m R w/200m jog"
      description = `${reps_per_set} x ${workDist} R w/${recDist} jog`;
    } else {
      // Multiple sets with between-set recovery
      const betweenSetDist = between_set_recovery_distance_meters > 0
        ? `${between_set_recovery_distance_meters}m`
        : recDist;

      // Format: "2 x(8 x 200m R w/200m jog) w/800m jog"
      description = `${sets} x(${reps_per_set} x ${workDist} R w/${recDist} jog) w/${betweenSetDist} jog`;
    }

    return description;
  }

  // Interval workouts (Tempo intervals, VO2max)
  if (interval_metrics) {
    const formattedPaces = interval_metrics.individual_paces_seconds
      .map((pace) => formatPace(pace))
      .join(', ');

    const distance =
      interval_metrics.distance_per_interval_miles < 1
        ? `${interval_metrics.distance_per_interval_miles.toFixed(1)} mi`
        : `${Math.round(interval_metrics.distance_per_interval_miles)} mi`;

    return `${type} ${interval_metrics.interval_count} x ${distance} @ ${formattedPaces}`;
  }

  // Continuous workouts (Easy, Long, Continuous Tempo)
  if (metrics) {
    const distance =
      metrics.distance_miles >= 10
        ? `${Math.round(metrics.distance_miles)} mi`
        : `${metrics.distance_miles.toFixed(1)} mi`;

    const pace = formatPace(metrics.pace_seconds_per_mile);
    const hr = Math.round(metrics.average_heartrate);

    // Tempo runs show "avg" pace, others show HR
    if (type === 'T' && structure === 'continuous') {
      return `${type} ${distance} @ avg ${pace}/mi`;
    } else {
      return `${type} ${distance} @ ${pace}/mi (HR ${hr})`;
    }
  }

  // Fallback
  return `${type} run`;
}

/**
 * Apply RunNote summary to activity description
 * Ensures exactly one RunNote line at the top using the provided summary.
 * - Strips ANY existing line that ends with `--from RunNote` (case/space tolerant)
 * - Sanitizes the summary to a single line
 * - Preserves all other lines (e.g., COROS), in original order
 */
export function applyRunNoteToDescription(
  existingDescription: string | null | undefined,
  summary: string,
  marker = '--from RunNote'
): string {
  const desc = (existingDescription ?? '').replace(/\r\n/g, '\n');

  // Collapse the summary to one line (no newlines, no trailing spaces)
  let summaryLine = summary.replace(/\s*\n+\s*/g, ' ').trim();

  // Strip any existing "--from RunNote" markers from the summary (case-insensitive)
  // This prevents duplicate markers if the LLM includes them
  summaryLine = summaryLine.replace(/\s*--\s*from\s*RunNote\s*/gi, '').trim();

  // Build the canonical RunNote line we want to appear once
  const runNoteLine = `${summaryLine} ${marker}`;

  // Match any line that ends with the marker (allow varying spaces/case)
  const endsWithMarker = new RegExp(`\\s*--\\s*from\\s*RunNote\\s*$`, 'i');

  // Keep every non-empty line that is NOT a previous RunNote line
  const kept = desc
    .split(/\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0 && !endsWithMarker.test(l.trim()));

  // Assemble final: canonical RunNote line on top, others below
  if (kept.length === 0) {
    return `${runNoteLine}\n\n`;
  } else {
    return `${runNoteLine}\n\n${kept.join('\n')}`;
  }
}

/**
 * Create activity update payload with description and title
 */
export function createActivityUpdate(
  existingDescription: string | null | undefined,
  workoutResult: WorkoutAnalysisResult
): ActivityUpdate {
  const summary = formatWorkoutSummary(workoutResult);
  const title = generateActivityTitle(workoutResult.type);
  const description = applyRunNoteToDescription(existingDescription, summary);

  return {
    description,
    name: title,
  };
}
