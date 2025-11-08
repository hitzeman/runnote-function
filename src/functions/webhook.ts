import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from '@azure/functions';
import { AxiosError } from 'axios';
import {
  ensureValidTokens,
  refreshTokens,
  getActivity,
  updateActivity,
} from '../shared/strava';
import { TokenRow } from '../shared/tokenStore';
import { Activity } from '../models/activity.model';
import { analyzeWorkout } from '../services/workoutAnalysis';
import {
  createActivityUpdate,
  applyRunNoteToDescription,
  formatWorkoutSummary,
} from '../utils/activityFormatter';

// Re-export for backward compatibility
export { applyRunNoteToDescription as applyRunNoteTopLLMSafe };

/**
 * Backward compatibility wrapper for tests
 * @deprecated Use analyzeWorkout() instead for structured results
 */
export async function getRunNoteSummaryFromOpenAI(
  activity: Activity
): Promise<string> {
  const result = await analyzeWorkout(activity);
  return formatWorkoutSummary(result);
}

/**
 * Helper to retry Strava API calls with token refresh on 401/403
 */
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
 *    athlete's access token (refreshing via `refreshTokens()` if expired or unauthorized).
 *
 * 4. **Retrieve activity details** — calls `getActivity()` from the Strava API.
 *    If access is denied (401/403), it retries with a fresh token.
 *
 * 5. **Analyze workout** — uses AI to classify workout type and extract metrics.
 *
 * 6. **Update activity** — updates both the description with RunNote summary and
 *    the title based on workout type.
 *
 * 7. **Error handling** — logs any issues but always returns HTTP 200 to
 *    acknowledge receipt, since Strava expects a 200 response for all webhook events.
 *
 * Usage:
 * - Automatically called by Strava via POST when an athlete uploads a new activity.
 * - Ensures tokens remain valid and updates the Strava activity with AI-generated
 *   workout classification and summary.
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
      if (verify !== process.env.VerifyToken) {
        ctx.warn('Webhook verification failed: invalid verify token');
        return { status: 403, body: 'Invalid verify token' };
      }
      ctx.log('Webhook verification successful');
      return { status: 200, jsonBody: { 'hub.challenge': challenge } };
    }

    // Webhook event (POST)
    try {
      const body = (await req.json()) as any;

      // Validate required webhook fields
      if (!body?.object_type || !body?.aspect_type || !body?.object_id || !body?.owner_id) {
        ctx.warn('Invalid webhook payload: missing required fields', body);
        return { status: 200 }; // Still ACK to Strava
      }

      ctx.log(`Webhook received: ${body.object_type}/${body.aspect_type} - object_id: ${body.object_id}, owner_id: ${body.owner_id}`);

      // Only handle "create" to start (add "update" later if you want)
      if (body?.object_type !== 'activity' || body?.aspect_type !== 'create') {
        ctx.log(`Ignoring ${body.object_type}/${body.aspect_type} event`);
        return { status: 200 };
      }

      const activityId = String(body.object_id);
      const athleteId = String(body.owner_id);

      // Ensure tokens (refresh if expired)
      let rec: TokenRow = await ensureValidTokens(athleteId);

      // GET activity (retry if 401/403)
      const { result: activity, tokenRow: updatedRec } = await withTokenRetry(
        (token) => getActivity(activityId, token),
        rec
      );
      rec = updatedRec;

      // Analyze workout with AI
      const workoutResult = await analyzeWorkout(activity);

      // Create activity update payload
      const updates = createActivityUpdate(activity.description, workoutResult);

      // Check if anything needs updating
      if (
        updates.description !== activity.description ||
        updates.name !== activity.name
      ) {
        const { tokenRow: finalRec } = await withTokenRetry(
          (token) => updateActivity(activityId, updates, token),
          rec
        );
        rec = finalRec;

        ctx.log(
          `Activity ${activityId} updated: ${workoutResult.type} - ${updates.name}`
        );
      } else {
        ctx.log(`Activity ${activityId} - no updates needed`);
      }

      return { status: 200 };
    } catch (err: any) {
      ctx.error(err?.response?.data || err.message);
      return { status: 200 }; // always ACK Strava
    }
  },
});
