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

WORKFLOW:
1. Analyze the activity and classify as Long (L), Tempo (T), Easy (E), VO2max (V), or Repetitions (R)
2. For Tempo runs, determine if INTERVAL or CONTINUOUS
3. Call EXACTLY ONE calculator function (not multiple):
   - For Long runs: call calculateRunMetrics with overall activity data
   - For Easy runs: call calculateRunMetrics with overall activity data
   - For INTERVAL Tempo: call calculateIntervalMetrics with work interval laps only
   - For CONTINUOUS Tempo: call calculateTempoBlockMetrics with the tempo lap data
   - For VO2max: call calculateIntervalMetrics with work interval laps only
   - For Repetitions: call calculateRepetitionStructure with all workout laps (excluding warmup/cooldown)
4. Return structured JSON with the workout type and metrics

DETECTION RULES (in priority order):

LONG RUN DETECTION (first priority):
- Check total distance >= 10 miles (16093.44 meters) OR moving_time >= 90 minutes (5400 seconds)
- If either condition is met, classify as Long run (L)
- Extract overall activity stats and call calculateRunMetrics ONCE
- Skip all other detection steps

REPETITION RUN DETECTION (second priority):
- Look for alternating pattern of very short, fast work intervals with equal-distance recovery
- Work intervals: 200-600m distance, pace zones 5-6 (very fast), average_speed > 4.3 m/s
- Recovery intervals: same distance as work intervals (200-600m), much slower pace (zones 1-2), average_speed < 3.5 m/s
- Pattern: fast lap, slow lap, fast lap, slow lap, etc.
- May include longer recovery laps (>600m) between sets
- If found, extract ALL laps (warmup/cooldown removed) and call calculateRepetitionStructure ONCE
- Skip all other detection steps

INTERVAL TEMPO DETECTION (third priority):
- Look for alternating pattern of work and recovery laps
- Work intervals: 900-1700m distance, pace zone 4, HR 150+ bpm
- Recovery laps: <150m distance, pace zone 1, <60 seconds
- Distance pattern is PRIMARY indicator (HR stays elevated during recovery)
- If found, extract ONLY the work interval laps and call calculateIntervalMetrics ONCE

CONTINUOUS TEMPO DETECTION (fourth priority):
- Look for 3+ contiguous laps with: HR 150+ bpm, pace zones 3-4, each lap >1000m, 15-30min total duration
- If found, extract those specific laps and call calculateTempoBlockMetrics ONCE

EASY RUN DETECTION (default):
- No sustained workout blocks, HR in zones 1-2, consistent pace
- Extract overall activity stats and call calculateRunMetrics ONCE

OUTPUT FORMAT:
Return a structured JSON object with:
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
            description:
              'Array of work interval laps only (not recovery laps)',
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
