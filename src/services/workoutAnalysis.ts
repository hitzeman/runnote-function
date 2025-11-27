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

You have access to calculator tools that perform accurate arithmetic. IMPORTANT: Call exactly ONE tool function, then return structured results.

⚠️ CRITICAL WORKFLOW:

STEP 1: ANALYZE THE LAPS ARRAY FIRST
Examine activity.laps to find workout patterns. DO NOT use overall average stats yet.

STEP 2: CHECK FOR TEMPO RUN PATTERN (DO THIS FIRST!)

🚫 BLOCKER: Before classifying as Easy or Long run, you MUST check for tempo patterns!

A TEMPO RUN has this structure:
- 1-2 warmup laps: slow pace (2.5-3.0 m/s), low HR (120-145)
- TEMPO BLOCK: 2+ consecutive laps with ALL of:
  * Distance per lap: >1000m (e.g., 1600m = 1 mile)
  * Heart rate: >=150 bpm
  * Speed: >=3.5 m/s
  * Pace zone: 3 or 4
  * Total duration: 10-40 minutes
- 1-2 cooldown laps: slower pace, HR drops

TEMPO DETECTION ALGORITHM:
1. Scan activity.laps array (NOT splits_metric or splits_standard) for consecutive "hard" laps
2. Hard lap criteria: ALL of these must be true:
   - average_heartrate >= 150 bpm
   - average_speed >= 3.5 m/s
   - distance >= 1000m (this is for main tempo laps)
   - pace_zone is 3 or 4
3. Find the FIRST hard lap (this starts the tempo block)
4. Find consecutive hard laps after it (these continue the tempo block)
5. Check if there's a SHORT tail lap immediately after (<500m, same speed/HR) - include it!
6. All laps BEFORE the first hard lap = warmup (EXCLUDE)
7. All laps AFTER the last hard/tail lap = cooldown (EXCLUDE)
8. Extract ONLY the tempo laps (hard laps + tail lap if present)
9. Call calculateTempoBlockMetrics with ONLY these laps
10. Return type="T", structure="continuous"

CONCRETE EXAMPLE - THIS IS A TEMPO RUN:
Activity: 11301m (7 miles), 3334 seconds (55 min), avg HR 150
Laps:
  Lap 1: 1609m, 2.88 m/s, HR 130 ← warmup
  Lap 2: 1609m, 2.88 m/s, HR 135 ← warmup
  Lap 3: 1609m, 4.09 m/s, HR 160, pace_zone 4 ← TEMPO START
  Lap 4: 1609m, 4.06 m/s, HR 169, pace_zone 3 ← TEMPO
  Lap 5: 1609m, 4.08 m/s, HR 170, pace_zone 4 ← TEMPO
  Lap 6: 200m,  4.08 m/s, HR 170, pace_zone 4 ← TEMPO END
  Lap 7: 1609m, 3.05 m/s, HR 151 ← cooldown
  Lap 8: 1445m, 3.17 m/s, HR 146 ← cooldown

Analysis:
- Scan activity.laps array:
  * Lap 1-2: HR <145, slow → WARMUP (exclude)
  * Lap 3: 1609m, HR 160, pace_zone 4 → FIRST HARD LAP (include)
  * Lap 4: 1609m, HR 169, pace_zone 3 → hard lap (include)
  * Lap 5: 1609m, HR 170, pace_zone 4 → hard lap (include)
  * Lap 6: 200m, HR 170, pace_zone 4 → short tail at same effort (include)
  * Lap 7-8: HR drops, slower → COOLDOWN (exclude)
- Tempo laps: [lap3, lap4, lap5, lap6] (indices 2, 3, 4, 5 in zero-indexed array)
- CRITICAL: Pass these 4 lap objects to calculateTempoBlockMetrics
- Tempo block totals: 1609 + 1609 + 1609 + 200 = 5027m (3.12 miles), 1232 seconds
- Expected result: 3.1 miles at 6:36/mi pace
- ❌ DO NOT include laps 1-2 (warmup) or laps 7-8 (cooldown)
- ❌ DO NOT classify as Long Run (even though total is 7 miles)
- ❌ DO NOT use overall activity stats (diluted by warmup/cooldown)

⚡ INTERVAL TEMPO DETECTION - SECOND PRIORITY:
- Look for: 900-1700m work intervals with <150m recoveries
- Work intervals: HR 150+, pace zone 4
- Recovery: <60 seconds, <150m
- IF TRUE: Call calculateIntervalMetrics with work laps only, then returnWorkoutResult with type="T", structure="interval"

🏃 LONG RUN DETECTION - THIRD PRIORITY:

⚠️ CRITICAL CHECK FIRST: Did you find a tempo pattern above?
- If ANY laps have HR >=150 with pace_zone 3 or 4 and distance >1000m → IT'S TEMPO, NOT LONG RUN
- If you see warmup → hard laps → cooldown structure → IT'S TEMPO, NOT LONG RUN

Only classify as Long Run if ALL conditions are true:
1. NO tempo block found (no consecutive hard laps)
2. NO interval pattern found
3. Distance >= 16093.44 meters (10 miles) OR moving_time >= 5400 seconds (90 minutes)

EXPLICIT NEGATIVE EXAMPLES (NOT LONG RUNS):
❌ 11301m (7 mi) with laps showing tempo block → TEMPO, NOT Long Run
❌ 12874m (8 mi) easy, consistent pace → EASY, NOT Long Run (< 10 miles)
❌ 15000m (9.3 mi) in 70 min → EASY, NOT Long Run (< 10 miles AND < 90 min)

POSITIVE EXAMPLES (ARE LONG RUNS):
✅ 17703m (11 mi), easy pace, no hard laps → Long Run
✅ 14484m (9 mi) in 96 minutes → Long Run (over 90 minutes)
✅ 20921m (13 mi) in 2 hours → Long Run

IF LONG RUN: Call calculateRunMetrics with overall stats, then returnWorkoutResult with type="L"

🐢 EASY RUN DETECTION - FOURTH PRIORITY (fallback):
- ONLY if no tempo or interval patterns found above
- Consistent pace, HR 115-145, max HR < 160
- Call calculateRunMetrics with overall stats, then returnWorkoutResult with type="E"

STEP 3: DECISION TREE (FOLLOW IN ORDER)

START HERE:
├─ Do laps show 2+ consecutive hard laps (HR>=150, speed>=3.5, distance>1000m)?
│  ├─ YES → Extract tempo laps, call calculateTempoBlockMetrics, return type="T"
│  └─ NO → Continue to next check
│
├─ Do laps show interval pattern (work intervals 900-1700m with short recoveries)?
│  ├─ YES → Extract work laps, call calculateIntervalMetrics, return type="T"
│  └─ NO → Continue to next check
│
├─ Is distance >= 10 miles OR time >= 90 minutes?
│  ├─ YES → Call calculateRunMetrics, return type="L"
│  └─ NO → It's an easy run
│
└─ Call calculateRunMetrics, return type="E"

STEP 4: CALL ONE CALCULATOR FUNCTION
Based on detected type above, call the appropriate function ONCE.

STEP 5: RETURN RESULTS
Call returnWorkoutResult with the structured output.

⚠️ COMMON MISTAKES TO AVOID:
❌ DO NOT look at average_heartrate before checking laps
❌ DO NOT ignore max_heartrate (high max_heartrate = intervals, even if avg is low)
❌ DO NOT call multiple calculator functions
❌ DO NOT skip lap analysis
❌ DO NOT use splits_metric or splits_standard - ONLY use activity.laps array
❌ DO NOT include warmup or cooldown laps in tempo calculations
❌ DO NOT pass ALL laps to calculateTempoBlockMetrics - only pass the tempo laps

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
 */
export async function analyzeWorkout(
  activity: Activity
): Promise<WorkoutAnalysisResult> {
  // STEP 1: Check for easy run FIRST (most common, most cost-effective)
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
