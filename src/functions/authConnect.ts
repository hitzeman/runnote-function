import { app, HttpRequest, HttpResponseInit } from '@azure/functions';
import { generateState, saveState } from '../shared/stateStore';

/**
 * Azure Function: authConnect
 *
 * This function initiates the Strava OAuth 2.0 authorization flow.
 * When a user visits the `/api/auth/connect` endpoint, it builds a redirect URL
 * pointing to Strava's authorization page with the required parameters:
 * - client_id (from environment variables)
 * - redirect_uri (where Strava sends the authorization code after user approval)
 * - response_type=code (to request an authorization code)
 * - scope (permissions requested for reading/writing activities)
 * - state (CSRF protection token, validated on callback)
 *
 * Once called, this function responds with a 302 redirect to Strava's
 * authorization URL. The user is then prompted to authorize the application.
 *
 * After the user grants access, Strava redirects back to your `authCallback` function
 * (defined separately) with an authorization code, which can then be exchanged for
 * an access token.
 *
 * Usage:
 * - Frontend or user manually visits `/api/auth/connect`
 * - Redirects to Strava's OAuth consent page
 * - Upon approval, Strava calls `/api/auth/callback` with a code
 */

app.http('authConnect', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'auth/connect',
  handler: async (_req: HttpRequest): Promise<HttpResponseInit> => {
    const clientId = process.env.STRAVA_CLIENT_ID!;
    const redirectUri = process.env.AUTH_CALLBACK_URL!;
    const scope = 'read,activity:read,activity:write'; // these can come from configuration object in the future

    // Validate HTTPS in production
    const isLocalDev =
      redirectUri.includes('localhost') ||
      redirectUri.includes('127.0.0.1') ||
      redirectUri.includes('UseDevelopmentStorage');

    if (!isLocalDev && !redirectUri.startsWith('https://')) {
      throw new Error(
        'AUTH_CALLBACK_URL must use HTTPS in production environments'
      );
    }

    // Generate CSRF protection token
    const state = generateState();
    await saveState(state);

    const url = new URL(process.env.STRAVA_OAUTH_URL!);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('approval_prompt', 'auto');
    url.searchParams.set('scope', scope);
    url.searchParams.set('state', state);

    return { status: 302, headers: { Location: url.toString() } };
  },
});
