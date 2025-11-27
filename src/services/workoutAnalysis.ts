import { Activity } from '../models/activity.model';
import { WorkoutAnalysisResult } from '../models/workoutTypes';
import { openai } from '../shared/ai';
import {
  calculateRunMetrics,
  calculateTempoBlockMetrics,
  calculateIntervalMetrics,
} from './workoutCalculations';

/**
 * System prompt for workout analysis
 */
const SYSTEM_PROMPT = `You analyze running workouts from Strava activity data to classify and summarize them.

⚠️ IMPORTANT CONTEXT:
You are ONLY called for TEMPO workouts (workouts with laps in pace zones 3+).
Easy and Long runs are detected FIRST using pace zones (all laps in zones 1-2) and NEVER reach you.
Your job is to analyze TEMPO RUN STRUCTURE ONLY.

You have access to calculator tools that perform accurate arithmetic. IMPORTANT: Call exactly ONE tool function, then return structured results.

⚠️ CRITICAL WORKFLOW:

STEP 1: ANALYZE THE LAPS ARRAY FIRST
Examine activity.laps to find tempo workout patterns. DO NOT use overall average stats yet.

STEP 2: CHECK FOR CRUISE INTERVAL TEMPO FIRST (HIGHEST PRIORITY!)

Since you ONLY receive tempo workouts, check for cruise intervals before continuous tempo.

⚡ CONTINUOUS TEMPO DETECTION - SECOND PRIORITY:

CONTINUOUS TEMPO RUN structure:
- 1-2 warmup laps: pace zone 1 or 2
- TEMPO BLOCK: 2+ consecutive laps with ALL of:
  * Distance per lap: >1000m (e.g., 1600m = 1 mile)
  * Pace zone: 3 or 4
  * Total duration: 10-40 minutes
- 1-2 cooldown laps: pace zone 1 or 2

CONTINUOUS TEMPO DETECTION ALGORITHM:
1. Scan activity.laps array (NOT splits_metric or splits_standard) for consecutive "hard" laps
2. Hard lap criteria: ALL of these must be true:
   - pace_zone is 3 or 4
   - distance >= 1000m (this is for main tempo laps)
3. Find the FIRST hard lap (this starts the tempo block)
4. Find consecutive hard laps after it (these continue the tempo block)
5. Check if there's a SHORT tail lap immediately after (<500m, same pace zone) - include it!
6. All laps BEFORE the first hard lap = warmup (EXCLUDE)
7. All laps AFTER the last hard/tail lap = cooldown (EXCLUDE)
8. Extract ONLY the tempo laps (hard laps + tail lap if present)
9. Call calculateTempoBlockMetrics with ONLY these laps
10. Return type="T", structure="continuous"

CONCRETE EXAMPLE - CONTINUOUS TEMPO:
Activity: 11301m (7 miles), 3334 seconds (55 min)
Laps:
  Lap 1: 1609m, pace_zone 1 ← warmup
  Lap 2: 1609m, pace_zone 2 ← warmup
  Lap 3: 1609m, pace_zone 4 ← TEMPO START
  Lap 4: 1609m, pace_zone 3 ← TEMPO
  Lap 5: 1609m, pace_zone 4 ← TEMPO
  Lap 6: 200m,  pace_zone 4 ← TEMPO END (short tail)
  Lap 7: 1609m, pace_zone 2 ← cooldown
  Lap 8: 1445m, pace_zone 1 ← cooldown

Analysis:
- Scan activity.laps array:
  * Lap 1-2: pace_zone 1-2 → WARMUP (exclude)
  * Lap 3: 1609m, pace_zone 4 → FIRST HARD LAP (include)
  * Lap 4: 1609m, pace_zone 3 → hard lap (include)
  * Lap 5: 1609m, pace_zone 4 → hard lap (include)
  * Lap 6: 200m, pace_zone 4 → short tail at same effort (include)
  * Lap 7-8: pace_zone 1-2 → COOLDOWN (exclude)
- Tempo laps: [lap3, lap4, lap5, lap6] (indices 2, 3, 4, 5 in zero-indexed array)
- CRITICAL: Pass these 4 lap objects to calculateTempoBlockMetrics
- Tempo block totals: 1609 + 1609 + 1609 + 200 = 5027m (3.12 miles), 1232 seconds
- Expected result: 3.1 miles at 6:36/mi pace
- ❌ DO NOT include laps 1-2 (warmup) or laps 7-8 (cooldown)
- ❌ DO NOT use overall activity stats (diluted by warmup/cooldown)

⚡ CRUISE INTERVAL TEMPO DETECTION - FIRST PRIORITY (CHECK BEFORE CONTINUOUS):

CRITICAL: Check for cruise intervals BEFORE checking for continuous tempo!

CRUISE INTERVAL PATTERN (classic tempo workout):
- Warmup lap(s): pace zone 1 or 2
- REPEATING PATTERN:
  * Work interval: 900-1700m (typically 1 mile = 1609m), pace_zone 3 or 4
  * Short recovery: <200m, <90 seconds, any pace zone (athlete stays moving)
- Cooldown lap(s): pace zone 1 or 2

DETECTION ALGORITHM:
1. Scan activity.laps to identify work intervals:
   - Distance: 900-1700m (e.g., 1 mile intervals = 1609m)
   - Pace zone: 3 or 4
2. Between each pair of work intervals, check for recovery lap:
   - Distance: <200m
   - Duration: <90 seconds
   - (pace zone doesn't matter - athlete keeps moving slowly)
3. Count work intervals - must have 2 or more
4. If pattern matches: Call calculateIntervalMetrics with ONLY work interval laps
5. Return type="T", structure="interval"

CONCRETE EXAMPLE - CRUISE INTERVALS (3 x 1 mile):
Activity: 12991m (8 miles), 4113 seconds (68 min)
Laps:
  Lap 1: 3218m, pace_zone 1 ← warmup
  Lap 2: 1609m, pace_zone 4, 383s ← WORK #1
  Lap 3: 98m, 60s ← recovery
  Lap 4: 1609m, pace_zone 4, 384s ← WORK #2
  Lap 5: 99m, 60s ← recovery
  Lap 6: 1609m, pace_zone 4, 382s ← WORK #3
  Lap 7: 101m, 60s ← recovery
  Lap 8: 3218m, pace_zone 1 ← cooldown

Analysis:
- Found 3 work intervals (laps 2, 4, 6): each 1609m, pace_zone 4
- Recovery laps between (laps 3, 5, 7): each ~100m, 60s
- CRITICAL: Pass ONLY work laps [lap2, lap4, lap6] to calculateIntervalMetrics
- Expected output: "T 3 x 1 mi @ 6:24, 6:24, 6:23"
- ❌ DO NOT classify as continuous tempo
- ❌ DO NOT include warmup, cooldown, or recovery laps in metrics

⚠️ FALLBACK CASE (should be rare):
If you receive a workout that doesn't match cruise interval or continuous tempo patterns,
it may have been misclassified. Analyze it as a tempo run anyway since you only receive
workouts with laps in pace zones 3+.

STEP 3: DECISION TREE FOR TEMPO WORKOUTS (FOLLOW IN ORDER!)

START HERE:
├─ Do laps show CRUISE INTERVAL pattern (work intervals 900-1700m with <200m recoveries)?
│  ├─ YES → Extract work laps only, call calculateIntervalMetrics, return type="T", structure="interval"
│  └─ NO → Continue to next check
│
└─ Do laps show CONTINUOUS TEMPO pattern (2+ consecutive hard laps >1000m)?
   ├─ YES → Extract tempo laps, call calculateTempoBlockMetrics, return type="T", structure="continuous"
   └─ NO → Treat as continuous tempo with all hard laps (fallback)

STEP 4: CALL ONE CALCULATOR FUNCTION
Based on detected type above, call the appropriate function ONCE.

STEP 5: RETURN RESULTS
Call returnWorkoutResult with the structured output.

⚠️ COMMON MISTAKES TO AVOID:
❌ DO NOT use overall activity stats - analyze lap-by-lap pace zones instead
❌ DO NOT call multiple calculator functions - call exactly ONE
❌ DO NOT skip lap analysis - pace zones in laps are the key to classification
❌ DO NOT use splits_metric or splits_standard - ONLY use activity.laps array
❌ DO NOT include warmup or cooldown laps in tempo calculations
❌ DO NOT pass ALL laps to calculateTempoBlockMetrics - only pass the tempo laps (zones 3-4)

⚠️ CRITICAL DATA SOURCE:
- Always use: activity.laps (the manual lap array)
- Never use: splits_metric (kilometer splits) or splits_standard (mile splits)
- The laps array has the correct lap-by-lap data for detecting workout structure

OUTPUT FORMAT:
{
  "type": "L" | "T" | "E" | "V",
  "structure": "interval" | "continuous" (only for Tempo runs),
  "metrics": { distance_miles, pace_seconds_per_mile, average_heartrate } (for continuous workouts),
  "interval_metrics": { interval_count, distance_per_interval_miles, individual_paces_seconds[], average_heartrate } (for interval workouts)
}`;

/**
 * Tool definitions for OpenAI function calling
 */
const tools = [
  {
    type: 'function' as const,
    function: {
      name: 'calculateRunMetrics',
      description:
        'Calculate accurate running metrics (distance, pace, HR) from raw activity data. Use this for easy runs and long runs.',
      parameters: {
        type: 'object',
        properties: {
          distance_meters: {
            type: 'number',
            description: 'Total distance in meters',
          },
          moving_time_seconds: {
            type: 'number',
            description: 'Total moving time in seconds',
          },
          average_heartrate: {
            type: 'number',
            description: 'Average heart rate in bpm',
          },
        },
        required: [
          'distance_meters',
          'moving_time_seconds',
          'average_heartrate',
        ],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'calculateTempoBlockMetrics',
      description:
        'Calculate accurate metrics for a continuous tempo workout block from lap data. Use this for continuous tempo runs.',
      parameters: {
        type: 'object',
        properties: {
          laps: {
            type: 'array',
            description: 'Array of laps that form the tempo block',
            items: {
              type: 'object',
              properties: {
                distance: {
                  type: 'number',
                  description: 'Lap distance in meters',
                },
                moving_time: {
                  type: 'number',
                  description: 'Lap moving time in seconds',
                },
                average_heartrate: {
                  type: 'number',
                  description: 'Lap average HR in bpm',
                },
              },
              required: ['distance', 'moving_time', 'average_heartrate'],
            },
          },
        },
        required: ['laps'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'calculateIntervalMetrics',
      description:
        'Calculate accurate metrics for interval workouts from work interval lap data. Use this for interval tempo runs and VO2max intervals. Pass ONLY the work interval laps, not recovery laps.',
      parameters: {
        type: 'object',
        properties: {
          laps: {
            type: 'array',
            description: 'Array of work interval laps only (not recovery laps)',
            items: {
              type: 'object',
              properties: {
                distance: {
                  type: 'number',
                  description: 'Lap distance in meters',
                },
                moving_time: {
                  type: 'number',
                  description: 'Lap moving time in seconds',
                },
                average_heartrate: {
                  type: 'number',
                  description: 'Lap average HR in bpm',
                },
              },
              required: ['distance', 'moving_time', 'average_heartrate'],
            },
          },
        },
        required: ['laps'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'returnWorkoutResult',
      description:
        'Return the final structured workout analysis result after calling calculation functions. Must be called after exactly one calculation function.',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['L', 'T', 'E', 'V'],
            description:
              'Workout type: L=Long, T=Tempo, E=Easy, V=VO2max',
          },
          structure: {
            type: 'string',
            enum: ['interval', 'continuous'],
            description:
              'For Tempo runs only, specifies interval or continuous structure',
          },
          metrics: {
            type: 'object',
            description: 'Metrics for continuous workouts (from calculation)',
            properties: {
              distance_miles: { type: 'number' },
              pace_seconds_per_mile: { type: 'number' },
              average_heartrate: { type: 'number' },
            },
          },
          interval_metrics: {
            type: 'object',
            description: 'Metrics for interval workouts (from calculation)',
            properties: {
              interval_count: { type: 'number' },
              distance_per_interval_miles: { type: 'number' },
              individual_paces_seconds: {
                type: 'array',
                items: { type: 'number' },
              },
              average_heartrate: { type: 'number' },
            },
          },
        },
        required: ['type'],
      },
    },
  },
];

/**
 * Check if activity is an easy run based on pace zones
 * Easy runs have ALL laps in pace zones 1 or 2
 */
function isEasyRun(activity: Activity): boolean {
  // Must have laps data
  if (!activity.laps || activity.laps.length === 0) {
    return false;
  }

  // Check if ALL laps are in pace zones 1 or 2
  // This is the key differentiator:
  // - Easy runs: all laps in zones 1-2
  // - Tempo runs: have laps in zones 3-4
  return activity.laps.every(
    (lap) => lap.pace_zone === 1 || lap.pace_zone === 2
  );
}

/**
 * Check if activity is a long run (>= 10 miles or >= 90 minutes)
 */
function isLongRun(activity: Activity): boolean {
  const TEN_MILES_METERS = 16093.44;
  const NINETY_MINUTES_SECONDS = 5400;

  return (
    activity.distance >= TEN_MILES_METERS ||
    activity.moving_time >= NINETY_MINUTES_SECONDS
  );
}

/**
 * Analyze a Strava activity and return structured workout classification
 *
 * PRIORITY ORDER:
 * 1. Easy/Long Runs (all laps in pace zones 1-2) - NO AI, cost-effective
 * 2. Tempo Runs (laps in zones 3+) - AI analysis:
 *    a. Cruise Intervals (work intervals with short recoveries)
 *    b. Continuous Tempo (sustained tempo block)
 */
export async function analyzeWorkout(
  activity: Activity
): Promise<WorkoutAnalysisResult> {
  // STEP 1: Check for easy/long run FIRST (most common, most cost-effective, NO AI)
  // Easy runs have ALL laps in pace zones 1 or 2
  if (isEasyRun(activity)) {
    const metrics = calculateRunMetrics({
      distance_meters: activity.distance,
      moving_time_seconds: activity.moving_time,
      average_heartrate: activity.average_heartrate,
    });

    // Distinguish between Long Run and Easy Run
    const type = isLongRun(activity) ? 'L' : 'E';

    return {
      type: type,
      metrics: metrics,
    };
  }

  // STEP 2: Use OpenAI for complex workouts (tempo, VO2max)
  // These have laps in pace zones 3+ and need detailed analysis
  const messages: any[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Analyze this Strava activity and provide structured workout classification.

Activity data:
${JSON.stringify(activity)}`,
    },
  ];

  // Function calling loop
  let response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.2,
    messages: messages,
    tools: tools,
    tool_choice: 'auto',
  });

  let calculationResult: any = null;

  // Handle tool calls
  while (response.choices[0].finish_reason === 'tool_calls') {
    const toolCalls = response.choices[0].message.tool_calls;
    if (!toolCalls) break;

    // Add assistant's message with tool calls
    messages.push(response.choices[0].message);

    // Execute each tool call
    for (const toolCall of toolCalls) {
      const functionName = (toolCall as any).function.name;
      const functionArgs = JSON.parse((toolCall as any).function.arguments);

      let functionResponse: string;

      if (functionName === 'calculateRunMetrics') {
        calculationResult = calculateRunMetrics(functionArgs);
        functionResponse = JSON.stringify(calculationResult);
      } else if (functionName === 'calculateTempoBlockMetrics') {
        calculationResult = calculateTempoBlockMetrics(functionArgs);
        functionResponse = JSON.stringify(calculationResult);
      } else if (functionName === 'calculateIntervalMetrics') {
        calculationResult = calculateIntervalMetrics(functionArgs);
        functionResponse = JSON.stringify(calculationResult);
      } else if (functionName === 'returnWorkoutResult') {
        // Final result function - return the structured result
        return functionArgs as WorkoutAnalysisResult;
      } else {
        functionResponse = JSON.stringify({ error: 'Unknown function' });
      }

      // Add function response to messages
      messages.push({
        role: 'tool',
        tool_call_id: (toolCall as any).id,
        content: functionResponse,
      });
    }

    // Get next response from the model
    response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      messages: messages,
      tools: tools,
      tool_choice: 'auto',
    });
  }

  // Fallback: if the model doesn't call returnWorkoutResult, construct from calculation
  // This should rarely happen with good prompts
  if (calculationResult) {
    if ('interval_count' in calculationResult) {
      return {
        type: 'T',
        structure: 'interval',
        interval_metrics: calculationResult,
      };
    } else {
      return {
        type: 'E',
        metrics: calculationResult,
      };
    }
  }

  // Last resort fallback: default to easy run
  // If OpenAI fails or returns nothing, assume it's an easy run
  const metrics = calculateRunMetrics({
    distance_meters: activity.distance,
    moving_time_seconds: activity.moving_time,
    average_heartrate: activity.average_heartrate,
  });

  const type = isLongRun(activity) ? 'L' : 'E';

  return {
    type: type,
    metrics: metrics,
  };
}
