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
    R: 'Repetitions',
  };
  return titles[workoutType];
}

/**
 * Format workout analysis result into a human-readable summary
 */
export function formatWorkoutSummary(result: WorkoutAnalysisResult): string {
  const { type, structure, metrics, interval_metrics } = result;

  // Interval workouts (Tempo intervals, VO2max, Repetitions)
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
