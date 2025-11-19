import { Activity } from '../models/activity.model';
import { WorkoutAnalysisResult } from '../models/workoutTypes';
import { openai } from '../shared/ai';
import {
  calculateRunMetrics,
  calculateTempoBlockMetrics,
  calculateIntervalMetrics,
  calculateRepetitionStructure,
} from './workoutCalculations';

/**
 * System prompt for workout analysis
 */
const SYSTEM_PROMPT = `You analyze running workouts from Strava activity data to classify and summarize them.

You have access to calculator tools that perform accurate arithmetic. IMPORTANT: Call exactly ONE tool function, then return structured results.

⚠️ CRITICAL WORKFLOW - FOLLOW THIS EXACT SEQUENCE:

STEP 1: CHECK LAPS ARRAY FIRST (DO NOT LOOK AT OVERALL STATS YET!)
Before looking at average_heartrate, average_speed, or any overall stats, you MUST analyze the activity.laps array to detect interval patterns.

STEP 2: APPLY DETECTION RULES IN THIS EXACT ORDER:

🔍 REPETITION (R) DETECTION - HIGHEST PRIORITY:
DO THIS FIRST, BEFORE considering overall stats!

WHY: R workouts have DECEIVING overall stats that look like Easy runs:
- Overall avg HR: 135-145 bpm (looks easy)
- Overall avg speed: 2.8-3.2 m/s (looks easy)
- But laps reveal: alternating 200m @4.5-5.0 m/s with 200m @2.0 m/s

HOW TO DETECT:
1. Examine activity.laps array (NOT splits_metric or splits_standard)
2. Look for ALTERNATING fast/slow pattern:
   - Fast laps: 200-600m distance, average_speed > 4.3 m/s (work intervals)
   - Slow laps: SIMILAR distance (180-600m), average_speed < 3.5 m/s (recovery)
   - Speed differential between consecutive laps: > 1.5 m/s
3. Pattern: fast, slow, fast, slow, fast, slow... (at least 6 work intervals = 12 total laps)
4. May have longer slow laps (>600m) between sets - this is normal
5. First lap may be warmup (>1000m, slow) - exclude it
6. Last lap(s) may be cooldown (>1000m, slow) - exclude them

EXAMPLE R WORKOUT LAPS:
Lap 1: 2500m @2.7 m/s (warmup - EXCLUDE)
Lap 2: 200m @4.55 m/s (work)
Lap 3: 200m @2.9 m/s (recovery)
Lap 4: 200m @4.65 m/s (work)
Lap 5: 200m @2.5 m/s (recovery)
...continues for 8 reps...
Lap 18: 800m @2.9 m/s (between-set recovery)
Lap 19: 200m @4.5 m/s (work)
...continues for 8 more reps...
Lap 35: 1500m @2.9 m/s (cooldown - EXCLUDE)

IF R DETECTED: Call calculateRepetitionStructure with workout laps (exclude warmup/cooldown), then returnWorkoutResult with type="R"

🏃 LONG RUN DETECTION:
- Check: distance >= 16093.44 meters OR moving_time >= 5400 seconds
- IF TRUE: Call calculateRunMetrics with overall stats, then returnWorkoutResult with type="L"

⚡ INTERVAL TEMPO DETECTION:
- Look for: 900-1700m work intervals with <150m recoveries
- Work intervals: HR 150+, pace zone 4
- Recovery: <60 seconds, <150m
- IF TRUE: Call calculateIntervalMetrics with work laps only, then returnWorkoutResult with type="T", structure="interval"

🎯 CONTINUOUS TEMPO DETECTION:
- Look for: 3+ contiguous laps >1000m each, HR 150+, total 15-30min
- IF TRUE: Call calculateTempoBlockMetrics with tempo laps, then returnWorkoutResult with type="T", structure="continuous"

🐢 EASY RUN DETECTION (fallback):
- ONLY if no interval patterns found above
- Check: NO alternating fast/slow in laps (speed differential < 1.5 m/s between consecutive laps)
- Consistent pace, HR 115-145, max HR < 160
- Call calculateRunMetrics with overall stats, then returnWorkoutResult with type="E"

STEP 3: CALL ONE CALCULATOR FUNCTION
Based on detected type, call the appropriate function ONCE.

STEP 4: RETURN RESULTS
Call returnWorkoutResult with the structured output.

⚠️ COMMON MISTAKES TO AVOID:
❌ DO NOT classify as Easy if laps show alternating fast/slow pattern
❌ DO NOT look at average_heartrate before checking laps
❌ DO NOT ignore max_heartrate (high max_heartrate = intervals, even if avg is low)
❌ DO NOT call multiple calculator functions
❌ DO NOT skip lap analysis

OUTPUT FORMAT:
{
  "type": "L" | "T" | "E" | "V" | "R",
  "structure": "interval" | "continuous" (only for Tempo runs),
  "metrics": { distance_miles, pace_seconds_per_mile, average_heartrate } (for continuous workouts),
  "interval_metrics": { interval_count, distance_per_interval_miles, individual_paces_seconds[], average_heartrate } (for interval workouts),
  "repetition_metrics": { sets, reps_per_set, work_distance_meters, recovery_distance_meters, between_set_recovery_distance_meters } (for repetition workouts)
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
        'Calculate accurate metrics for interval workouts from work interval lap data. Use this for interval tempo runs, VO2max intervals, and repetitions. Pass ONLY the work interval laps, not recovery laps.',
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
      name: 'calculateRepetitionStructure',
      description:
        'Analyze repetition workout structure from lap data. Use this for repetition (R) workouts. Pass all workout laps excluding warmup/cooldown.',
      parameters: {
        type: 'object',
        properties: {
          laps: {
            type: 'array',
            description:
              'Array of all workout laps (work + recovery), excluding warmup/cooldown',
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
                average_speed: {
                  type: 'number',
                  description: 'Lap average speed in m/s',
                },
              },
              required: ['distance', 'moving_time', 'average_speed'],
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
            enum: ['L', 'T', 'E', 'V', 'R'],
            description:
              'Workout type: L=Long, T=Tempo, E=Easy, V=VO2max, R=Repetitions',
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
          repetition_metrics: {
            type: 'object',
            description: 'Metrics for repetition workouts (from calculation)',
            properties: {
              sets: { type: 'number' },
              reps_per_set: { type: 'number' },
              work_distance_meters: { type: 'number' },
              recovery_distance_meters: { type: 'number' },
              between_set_recovery_distance_meters: { type: 'number' },
            },
          },
        },
        required: ['type'],
      },
    },
  },
];

/**
 * Analyze a Strava activity and return structured workout classification
 */
export async function analyzeWorkout(
  activity: Activity
): Promise<WorkoutAnalysisResult> {
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
      } else if (functionName === 'calculateRepetitionStructure') {
        calculationResult = calculateRepetitionStructure(functionArgs);
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

  // Last resort fallback
  throw new Error('Failed to analyze workout: no calculation results');
}
