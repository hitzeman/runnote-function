import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from '@azure/functions';
import axios, { AxiosError } from 'axios';
import {
  ensureValidTokens,
  refreshTokens,
  getActivity,
  updateActivityDescription,
} from '../shared/strava';
import { TokenRow } from '../shared/tokenStore';
import { Activity } from '../models/activity.model';
import { openai } from '../shared/ai';

// OpenAI System Prompt for Run Analysis with Function Calling
const SYSTEM_PROMPT = `You analyze running workouts from Strava activity data to classify and summarize them.

You have access to calculator tools that perform accurate arithmetic. IMPORTANT: Call exactly ONE tool function, then format the result.

WORKFLOW:
1. Analyze the activity and classify as Long (L), Tempo (T), or Easy (E)
2. For Tempo runs, determine if INTERVAL or CONTINUOUS
3. Call EXACTLY ONE calculator function (not multiple):
   - For Long runs: call calculateRunMetrics with overall activity data
   - For Easy runs: call calculateRunMetrics with overall activity data
   - For INTERVAL Tempo: call calculateIntervalMetrics with work interval laps only
   - For CONTINUOUS Tempo: call calculateTempoBlockMetrics with the tempo lap data
4. Use the calculation result to format your final response

LONG RUN DETECTION (first priority):
- Check total distance >= 10 miles (16093.44 meters) OR moving_time >= 90 minutes (5400 seconds)
- If either condition is met, classify as Long run (L)
- Extract overall activity stats and call calculateRunMetrics ONCE
- Skip all other detection steps

INTERVAL TEMPO DETECTION (second priority):
- Look for alternating pattern of work and recovery laps
- Work intervals: 900-1700m distance, pace zone 4, HR 150+ bpm
- Recovery laps: <150m distance, pace zone 1, <60 seconds
- Distance pattern is PRIMARY indicator (HR stays elevated during recovery)
- If found, extract ONLY the work interval laps and call calculateIntervalMetrics ONCE

CONTINUOUS TEMPO DETECTION (third priority):
- Look for 3+ contiguous laps with: HR 150+ bpm, pace zones 3-4, each lap >1000m, 15-30min total duration
- If found, extract those specific laps and call calculateTempoBlockMetrics ONCE

EASY RUN DETECTION (default):
- No sustained workout blocks, HR in zones 1-2, consistent pace
- Extract overall activity stats and call calculateRunMetrics ONCE

OUTPUT FORMAT:
After receiving the calculation result, respond with EXACTLY ONE formatted summary line:
- Long: "L {distance} mi @ {pace}/mi (HR {hr})"
- Interval Tempo: "T {count} x {interval_distance} @ {pace1}, {pace2}, {pace3}"
- Continuous Tempo: "T {distance} mi @ avg {pace}/mi"
- Easy: "E {distance} mi @ {pace}/mi (HR {hr})"
- Distance formatting: Use 1 decimal (e.g., 0.6 mi) for distances under 1 mile, whole numbers (e.g., 1km) for metric
- Return ONLY the summary line, nothing else (no markers, no extra text)`;

// Helper to format pace from seconds per mile to MM:SS
function formatPace(secondsPerMile: number): string {
  const minutes = Math.floor(secondsPerMile / 60);
  const seconds = Math.round(secondsPerMile % 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// Tool function: Calculate running metrics from distance and time
function calculateRunMetrics(params: {
  distance_meters: number;
  moving_time_seconds: number;
  average_heartrate: number;
}): string {
  const distanceMiles = params.distance_meters / 1609.344;
  const secondsPerMile = params.moving_time_seconds / distanceMiles;
  const pace = formatPace(secondsPerMile);
  const hr = Math.round(params.average_heartrate);

  return JSON.stringify({
    distance_miles: distanceMiles,
    pace: pace,
    hr: hr,
  });
}

// Tool function: Calculate tempo block metrics from lap data
function calculateTempoBlockMetrics(params: {
  laps: Array<{
    distance: number;
    moving_time: number;
    average_heartrate: number;
  }>;
}): string {
  const totalDistance = params.laps.reduce((sum, lap) => sum + lap.distance, 0);
  const totalTime = params.laps.reduce((sum, lap) => sum + lap.moving_time, 0);
  const avgHr = Math.round(
    params.laps.reduce((sum, lap) => sum + lap.average_heartrate, 0) /
      params.laps.length
  );

  const distanceMiles = totalDistance / 1609.344;
  const secondsPerMile = totalTime / distanceMiles;
  const pace = formatPace(secondsPerMile);

  return JSON.stringify({
    distance_miles: distanceMiles,
    pace: pace,
    hr: avgHr,
  });
}

// Tool function: Calculate interval metrics from work intervals
function calculateIntervalMetrics(params: {
  laps: Array<{
    distance: number;
    moving_time: number;
    average_heartrate: number;
  }>;
}): string {
  // Calculate individual pace for each interval
  const individualPaces = params.laps.map((lap) => {
    const distanceMiles = lap.distance / 1609.344;
    const secondsPerMile = lap.moving_time / distanceMiles;
    return formatPace(secondsPerMile);
  });

  // Calculate average distance per interval
  const avgDistance = params.laps.reduce((sum, lap) => sum + lap.distance, 0) / params.laps.length;
  const distancePerIntervalMiles = avgDistance / 1609.344;

  // Calculate average heart rate across all intervals
  const avgHr = Math.round(
    params.laps.reduce((sum, lap) => sum + lap.average_heartrate, 0) / params.laps.length
  );

  return JSON.stringify({
    interval_count: params.laps.length,
    distance_per_interval_miles: distancePerIntervalMiles,
    individual_paces: individualPaces,
    hr: avgHr,
  });
}

// Helper to retry Strava API calls with token refresh on 401/403
async function withTokenRetry<T>(
  operation: (accessToken: string) => Promise<T>,
  tokenRow: TokenRow
): Promise<{ result: T; tokenRow: TokenRow }> {
  try {
    const result = await operation(tokenRow.access_token);
    return { result, tokenRow };
  } catch (e) {
    const err = e as AxiosError;
    if (
      err.response &&
      (err.response.status === 401 || err.response.status === 403)
    ) {
      const refreshedTokenRow = await refreshTokens(tokenRow);
      const result = await operation(refreshedTokenRow.access_token);
      return { result, tokenRow: refreshedTokenRow };
    }
    throw e;
  }
}

export async function getRunNoteSummaryFromOpenAI(
  act: Activity
): Promise<string> {
  // Define the tools available to the LLM
  const tools = [
    {
      type: 'function' as const,
      function: {
        name: 'calculateRunMetrics',
        description:
          'Calculate accurate running metrics (distance, pace, HR) from raw activity data. Use this for easy runs.',
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
          'Calculate accurate metrics for interval tempo workouts from work interval lap data. Use this for interval tempo runs (e.g., 6x1km, 4x1mi). Pass ONLY the work interval laps, not recovery laps.',
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
  ];

  const messages: any[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Analyze this Strava activity and provide a summary.

Activity data:
${JSON.stringify(act)}`,
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

  // Handle tool calls
  while (response.choices[0].finish_reason === 'tool_calls') {
    const toolCalls = response.choices[0].message.tool_calls;
    if (!toolCalls) break;

    // Add assistant's message with tool calls
    messages.push(response.choices[0].message);

    // Execute each tool call
    for (const toolCall of toolCalls) {
      // Type assertion needed for OpenAI SDK
      const functionName = (toolCall as any).function.name;
      const functionArgs = JSON.parse((toolCall as any).function.arguments);

      let functionResponse: string;
      if (functionName === 'calculateRunMetrics') {
        functionResponse = calculateRunMetrics(functionArgs);
      } else if (functionName === 'calculateTempoBlockMetrics') {
        functionResponse = calculateTempoBlockMetrics(functionArgs);
      } else if (functionName === 'calculateIntervalMetrics') {
        functionResponse = calculateIntervalMetrics(functionArgs);
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

  // Return the final text response
  const finalMessage = response.choices[0].message.content?.trim();
  return finalMessage || 'Easy run';
}

/**
 * Azure Function: webhook
 *
 * This function handles incoming **Strava webhook events** that notify RunNote when
 * an athlete performs certain actions — such as creating, updating, or deleting activities.
 *
 * Currently, it listens for **activity creation events** (aspect_type = "create")
 * and performs the following workflow:
 *
 * 1. **Receive Strava webhook payload** — triggered automatically by Strava when
 *    a connected athlete uploads a new activity.
 *
 * 2. **Validate the event type** — ignores non-activity or non-create events for now.
 *
 * 3. **Fetch athlete tokens** — uses `ensureValidTokens()` to retrieve or refresh the
 *    athlete’s access token (refreshing via `refreshTokens()` if expired or unauthorized).
 *
 * 4. **Retrieve activity details** — calls `getActivity()` from the Strava API.
 *    If access is denied (401/403), it retries with a fresh token.
 *
 * 5. **Generate and update description** — appends a RunNote marker or note to the
 *    activity’s description (later, this will include LLM-generated analysis text).
 *
 * 6. **Save the updated activity** — calls `updateActivityDescription()` to push
 *    the new description back to Strava.
 *
 * 7. **Error handling** — logs any issues but always returns HTTP 200 to
 *    acknowledge receipt, since Strava expects a 200 response for all webhook events.
 *
 * Usage:
 * - Automatically called by Strava via POST when an athlete uploads a new activity.
 * - Ensures tokens remain valid and updates the Strava activity description
 *   with RunNote’s generated summary or tag.
 */

app.http('webhook', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  handler: async (
    req: HttpRequest,
    ctx: InvocationContext
  ): Promise<HttpResponseInit> => {
    // Strava verification (GET)
    if (req.method === 'GET') {
      const verify = req.query.get('hub.verify_token');
      const challenge = req.query.get('hub.challenge');
      if (verify !== process.env.VerifyToken)
        return { status: 403, body: 'Invalid verify token' };
      return { status: 200, jsonBody: { 'hub.challenge': challenge } };
    }

    // Webhook event (POST)
    try {
      const body = (await req.json()) as any; // add model

      // Only handle "create" to start (add "update" later if you want)
      if (body?.object_type !== 'activity' || body?.aspect_type !== 'create') {
        return { status: 200 };
      }

      const activityId = String(body.object_id);
      const athleteId = String(body.owner_id);

      // Ensure tokens (refresh if expired)
      let rec: TokenRow = await ensureValidTokens(athleteId);

      // GET activity (retry if 401/403)
      const { result: act, tokenRow: updatedRec } = await withTokenRetry(
        (token) => getActivity(activityId, token),
        rec
      );
      rec = updatedRec;

      const llmSummary = await getRunNoteSummaryFromOpenAI(act);

      const current = act.description || '';
      const next = applyRunNoteTopLLMSafe(current, llmSummary);

      if (next !== current) {
        const { tokenRow: finalRec } = await withTokenRetry(
          (token) => updateActivityDescription(activityId, next, token),
          rec
        );
        rec = finalRec;
      }

      ctx.log(`Activity ${activityId} updated with RunNote`);

      return { status: 200 };
    } catch (err: any) {
      ctx.error(err?.response?.data || err.message);
      return { status: 200 }; // always ACK Strava
    }
  },
});

// Ensures exactly one RunNote line at the top using the provided summary.
// - Strips ANY existing line that ends with `--from RunNote` (case/space tolerant)
// - Sanitizes the LLM summary to a single line
// - Preserves all other lines (e.g., COROS), in original order
export function applyRunNoteTopLLMSafe(
  existing: string | null | undefined,
  llmSummary: string, // e.g., "Tempo: 4×1k @ 6:10/mi (R90s)"
  marker = '--from RunNote'
): string {
  const desc = (existing ?? '').replace(/\r\n/g, '\n');

  // Collapse the LLM summary to one line (no newlines, no trailing spaces)
  let summaryLine = llmSummary.replace(/\s*\n+\s*/g, ' ').trim();

  // Strip any existing "--from RunNote" markers from the LLM summary (case-insensitive)
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
