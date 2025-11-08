import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from '@azure/functions';
import { exchangeCodeForToken } from '../shared/strava';
import { saveTokens } from '../shared/tokenStore';
import { validateAndConsumeState } from '../shared/stateStore';

/**
 * Azure Function: authCallback
 *
 * This function handles the OAuth 2.0 callback from Strava after the user authorizes the app.
 * It is the second step in the Strava authentication flow, following the `authConnect` function.
 *
 * When Strava redirects the user back to `/api/auth/callback`, it includes a `code` parameter
 * in the query string. This function:
 * 1. Validates the `state` parameter for CSRF protection.
 * 2. Extracts the `code` from the request.
 * 3. Exchanges that code for an access token and refresh token using `exchangeCodeForToken()`.
 * 4. Saves the tokens (and expiration info) to storage using `saveTokens()`, keyed by athlete ID.
 * 5. Logs which athlete was connected for debugging/audit purposes.
 * 6. Returns a success message so the user knows the connection was successful.
 *
 * Usage:
 * - Called automatically by Strava after user authorizes via `/api/auth/connect`
 * - Stores the authenticated athlete's tokens for future API calls
 * - Responds with "RunNote connected!" once setup is complete
 */

app.http('authCallback', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'auth/callback',
  handler: async (
    req: HttpRequest,
    ctx: InvocationContext
  ): Promise<HttpResponseInit> => {
    // Validate state parameter for CSRF protection
    const state = req.query.get('state');
    if (!state) {
      ctx.warn('OAuth callback missing state parameter');
      return { status: 400, body: 'Invalid request' };
    }

    const isValidState = await validateAndConsumeState(state);
    if (!isValidState) {
      ctx.warn(`OAuth callback with invalid or expired state: ${state}`);
      return { status: 403, body: 'Invalid or expired request' };
    }

    const code = req.query.get('code');
    if (!code) {
      ctx.warn('OAuth callback missing code parameter');
      return { status: 400, body: 'Invalid request' };
    }

    const token = await exchangeCodeForToken(code);
    const athleteId = String(token.athlete.id);

    await saveTokens({
      partitionKey: 'athlete',
      rowKey: athleteId,
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      expires_at: token.expires_at,
    });

    ctx.log(`Connected athlete ${athleteId}`);
    return { status: 200, body: 'RunNote connected! You can close this tab.' };
  },
});
