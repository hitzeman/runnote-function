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

function fmtPaceFromMs(ms: number | undefined) {
  if (!ms || ms <= 0) return null;
  const paceSecPerKm = 1000 / ms; // seconds per km
  const m = Math.floor(paceSecPerKm / 60);
  const s = Math.round(paceSecPerKm % 60)
    .toString()
    .padStart(2, '0');
  return `${m}:${s}/km`;
}

export async function getRunNoteSummaryFromOpenAI(
  act: Activity
): Promise<string> {
  const sys = `You are a running coach who summarizes structured workouts from Strava activity data. 
  Your athletes follow Jack Daniels training plans and workouts which are usually broken up into:
  R pace for repeition
  I pace for interval
  T pace for threshold
  M pace for marathon
  E pace for easy`;

  const usr = `Activity JSON:
${JSON.stringify(act, null, 2)}

Rules:
- Use miles and min/mi pace.
- Include workout structure (e.g., 3x1mi at T pace, 5K T pace, 5x1k I at /mi pace, easy run).
- Be concise: one descriptive line only.`;

  const res = await openai.responses.create({
    model: 'gpt-4.1-mini',
    input: [
      { role: 'system', content: sys },
      { role: 'user', content: usr },
    ],
  });

  return res.output_text?.trim() || 'Easy run';
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
      let act: any;
      try {
        act = await getActivity(activityId, rec.access_token);
      } catch (e) {
        const err = e as AxiosError;
        if (
          err.response &&
          (err.response.status === 401 || err.response.status === 403)
        ) {
          rec = await refreshTokens(rec);
          act = await getActivity(activityId, rec.access_token);
        } else {
          throw e;
        }
      }

      // 1) Ask your LLM for the summary (string), e.g. "Easy run" or "Tempo 4×1k ..."
      //const llmSummary = 'Easy run'; // <- today hard-coded; later replace with LLM output

      const llmSummary = await getRunNoteSummaryFromOpenAI(act);

      // 2) Normalize
      const current = act.description || '';
      const next = applyRunNoteTopLLMSafe(current, llmSummary);

      // 3) Only update if changed (retry with refresh as you already do)
      // if (next !== current) {
      //   await updateActivityDescription(activityId, next, rec.access_token);
      // }

      // Update if changed (retry if 401/403)
      // try {
      //   await updateActivityDescription(activityId, next, rec.access_token);
      // } catch (e) {
      //   const err = e as AxiosError;
      //   if (
      //     err.response &&
      //     (err.response.status === 401 || err.response.status === 403)
      //   ) {
      //     rec = await refreshTokens(rec);
      //     await updateActivityDescription(activityId, next, rec.access_token);
      //   } else {
      //     throw e;
      //   }
      // }

      if (next !== current) {
        try {
          await updateActivityDescription(activityId, next, rec.access_token);
        } catch (e) {
          // If token expired, refresh once and retry
          if (
            (e as any)?.response?.status === 401 ||
            (e as any)?.response?.status === 403
          ) {
            rec = await refreshTokens(rec);
            await updateActivityDescription(activityId, next, rec.access_token);
          } else {
            throw e;
          }
        }
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
    return `${runNoteLine}\n`;
  } else {
    return `${runNoteLine}\n${kept.join('\n')}`;
  }
}
