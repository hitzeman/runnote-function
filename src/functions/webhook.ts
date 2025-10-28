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
      const body = (await req.json()) as any;

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

      // Add markers to run note description so we can swap section out while persisting previous description
      // Add LLM call to analyze the run data and prepare new description
      const current = act.description || '';
      const newDescription = 'Easy run\n --from RunNote \n';
      const next = `${newDescription} ${current} `;

      // Update if changed (retry if 401/403)
      try {
        await updateActivityDescription(activityId, next, rec.access_token);
      } catch (e) {
        const err = e as AxiosError;
        if (
          err.response &&
          (err.response.status === 401 || err.response.status === 403)
        ) {
          rec = await refreshTokens(rec);
          await updateActivityDescription(activityId, next, rec.access_token);
        } else {
          throw e;
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
