import axios, { AxiosError } from 'axios';
import { getTokens, saveTokens, TokenRow } from './tokenStore';

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing setting: ${name}`);
  return v;
}

export async function exchangeCodeForToken(code: string) {
  const { data } = await axios.post(
    'https://www.strava.com/api/v3/oauth/token',
    {
      client_id: getEnv('STRAVA_CLIENT_ID'),
      client_secret: getEnv('STRAVA_CLIENT_SECRET'),
      code,
      grant_type: 'authorization_code',
    }
  );
  return data;
}

export async function refreshTokens(old: TokenRow): Promise<TokenRow> {
  const { data } = await axios.post(
    'https://www.strava.com/api/v3/oauth/token',
    {
      client_id: getEnv('STRAVA_CLIENT_ID'),
      client_secret: getEnv('STRAVA_CLIENT_SECRET'),
      grant_type: 'refresh_token',
      refresh_token: old.refresh_token,
    }
  );
  const updated: TokenRow = {
    partitionKey: 'athlete',
    rowKey: old.rowKey,
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at,
  };
  await saveTokens(updated);
  return updated;
}

function isExpired(expires_at: number, skew = 60) {
  const now = Math.floor(Date.now() / 1000);
  return expires_at <= now + skew;
}

export async function ensureValidTokens(athleteId: string): Promise<TokenRow> {
  const rec = await getTokens(athleteId);
  if (!rec)
    throw new Error(
      `No tokens for athlete ${athleteId}. Connect via /api/auth/connect first.`
    );
  if (isExpired(rec.expires_at)) return await refreshTokens(rec);
  return rec;
}

export async function getActivity(activityId: string, accessToken: string) {
  const { data } = await axios.get(
    `https://www.strava.com/api/v3/activities/${activityId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  return data;
}

export async function updateActivity(
  activityId: string,
  updates: { description?: string; name?: string },
  accessToken: string
) {
  await axios.put(
    `https://www.strava.com/api/v3/activities/${activityId}`,
    updates,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
}

// Deprecated: Use updateActivity instead
export async function updateActivityDescription(
  activityId: string,
  description: string,
  accessToken: string
) {
  await updateActivity(activityId, { description }, accessToken);
}
