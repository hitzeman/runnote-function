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

// OpenAI System Prompt for Run Analysis
const SYSTEM_PROMPT = `You analyze running workouts from Strava activity data to classify them as Tempo (T) or Easy (E) runs.

TEMPO RUN DETECTION:
1. Examine the "laps" array for contiguous laps that form a workout block
2. A tempo block has ALL these characteristics:
   - Heart rate sustained at 150+ bpm (check average_heartrate)
   - Pace zone is 3 or 4 (check pace_zone field)
   - Duration: 15-40 minutes total
   - Significantly faster than warmup/cooldown laps
3. If found, calculate the tempo block:
   - Sum moving_time and distance for those laps
   - Convert meters to miles: divide by 1609.344
   - Calculate pace: seconds_per_mile = total_seconds / total_miles
   - Convert to MM:SS format

EASY RUN DETECTION:
1. If no tempo block exists, it's an easy run
2. Easy runs have these patterns:
   - Heart rate mostly in zones 1-2 (typically 115-145 bpm)
   - No sustained elevated HR (no blocks with 150+ bpm sustained)
   - Consistent pace throughout, no clear "workout block"
   - Max HR may briefly spike but doesn't sustain high
3. For easy runs, use overall activity stats:
   - Use "distance" field (in meters) for total distance
   - Use "moving_time" field (in seconds) for total time
   - Use "average_heartrate" field for HR
   - Calculate overall pace

CALCULATIONS:
- Distance: meters / 1609.344 = miles
- Pace: (moving_time_seconds / distance_miles) formatted as MM:SS
- Round distance: if >= 10 mi use whole number, else 1 decimal
- Round HR: to nearest whole number

RESPONSE FORMAT:
For Tempo:
{
  "type": "T",
  "distance": 3.1,
  "pace": "6:38",
  "hr": 161
}

For Easy:
{
  "type": "E",
  "distance": 7.3,
  "pace": "9:05",
  "hr": 124
}`;

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
  const userPrompt = `Analyze this Strava activity. Determine if it's a Tempo (T) run with a clear workout block, or an Easy (E) run.

Return your response as JSON.

Activity data:
${JSON.stringify(act)}`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
  });

  const jsonText = completion.choices[0]?.message?.content?.trim();
  if (!jsonText) return 'Easy run';

  const data = JSON.parse(jsonText);

  if (data.type === 'T') {
    return `T ${data.distance} mi @ avg ${data.pace}/mi`;
  } else {
    // Format distance: whole number if >= 10, else 1 decimal
    const distStr =
      data.distance >= 10
        ? Math.round(data.distance).toString()
        : data.distance.toFixed(1);
    return `E ${distStr} mi @ ${data.pace}/mi (HR ${data.hr})`;
  }
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
  const summaryLine = llmSummary.replace(/\s*\n+\s*/g, ' ').trim();

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
