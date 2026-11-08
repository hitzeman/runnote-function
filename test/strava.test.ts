import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Boundaries: axios (Strava HTTP) and Azure Table Storage.
const axios = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn(), put: vi.fn() }));
vi.mock('axios', () => ({ default: axios }));
const store = vi.hoisted(() => ({ getTokens: vi.fn(), saveTokens: vi.fn() }));
vi.mock('../src/shared/tokenStore', () => store);

import { ensureValidTokens, refreshTokens, updateActivity } from '../src/shared/strava';

const NOW_S = 1_750_000_000;
const row = (expires_at: number) => ({
  partitionKey: 'athlete',
  rowKey: '42',
  access_token: 'old-access',
  refresh_token: 'old-refresh',
  expires_at,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW_S * 1000);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  axios.post.mockResolvedValue({
    data: { access_token: 'new-access', refresh_token: 'new-refresh', expires_at: NOW_S + 21600 },
  });
});
afterEach(() => vi.useRealTimers());

describe('ensureValidTokens', () => {
  it('throws a helpful error when the athlete never connected', async () => {
    store.getTokens.mockResolvedValue(null);
    await expect(ensureValidTokens('42')).rejects.toThrow(/Connect via \/api\/auth\/connect/);
  });

  it('returns stored tokens that are comfortably unexpired', async () => {
    store.getTokens.mockResolvedValue(row(NOW_S + 3600));
    expect((await ensureValidTokens('42')).access_token).toBe('old-access');
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('refreshes tokens expiring within the 60s skew window', async () => {
    store.getTokens.mockResolvedValue(row(NOW_S + 60));
    expect((await ensureValidTokens('42')).access_token).toBe('new-access');
  });

  it('does not refresh tokens expiring just outside the skew window', async () => {
    store.getTokens.mockResolvedValue(row(NOW_S + 61));
    await ensureValidTokens('42');
    expect(axios.post).not.toHaveBeenCalled();
  });
});

describe('refreshTokens', () => {
  it('posts the refresh grant and persists the rotated tokens', async () => {
    const updated = await refreshTokens(row(NOW_S - 10));

    expect(axios.post).toHaveBeenCalledWith('https://www.strava.com/api/v3/oauth/token', {
      client_id: 'test-client',
      client_secret: 'test-secret',
      grant_type: 'refresh_token',
      refresh_token: 'old-refresh',
    });
    const expected = {
      partitionKey: 'athlete',
      rowKey: '42',
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      expires_at: NOW_S + 21600,
    };
    expect(updated).toEqual(expected);
    expect(store.saveTokens).toHaveBeenCalledWith(expected);
  });
});

describe('updateActivity', () => {
  it('PUTs only the provided fields with a bearer token', async () => {
    await updateActivity('123', { description: 'x' }, 'tok');
    expect(axios.put).toHaveBeenCalledWith(
      'https://www.strava.com/api/v3/activities/123',
      { description: 'x' },
      { headers: { Authorization: 'Bearer tok' } }
    );
  });
});
