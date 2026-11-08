import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HttpRequest, InvocationContext } from '@azure/functions';
import { loadActivity } from './helpers';

// Boundaries: Azure Functions registration, Strava HTTP client, OpenAI client.
// Classification and description logic run for real.
vi.mock('@azure/functions', () => ({ app: { http: vi.fn() } }));
const strava = vi.hoisted(() => ({
  ensureValidTokens: vi.fn(),
  refreshTokens: vi.fn(),
  getActivity: vi.fn(),
  updateActivity: vi.fn(),
}));
vi.mock('../src/shared/strava', () => strava);
const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('../src/shared/ai', () => ({ openai: { chat: { completions: { create } } } }));

import { webhookHandler } from '../src/functions/webhook';

const TOKENS = {
  partitionKey: 'athlete',
  rowKey: '42',
  access_token: 'access-1',
  refresh_token: 'refresh-1',
  expires_at: 9999999999,
};
const REFRESHED = { ...TOKENS, access_token: 'access-2', refresh_token: 'refresh-2' };

const ctx = () =>
  ({ log: vi.fn(), warn: vi.fn(), error: vi.fn() }) as unknown as InvocationContext & {
    log: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
const post = (body: unknown) =>
  ({ method: 'POST', query: new URLSearchParams(), json: async () => body }) as unknown as HttpRequest;
const get = (params: Record<string, string>) =>
  ({ method: 'GET', query: new URLSearchParams(params) }) as unknown as HttpRequest;
const createEvent = { object_type: 'activity', aspect_type: 'create', object_id: 123, owner_id: 42 };
const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { response: { status } });

beforeEach(() => {
  process.env.VerifyToken = 'verify-me';
  strava.ensureValidTokens.mockResolvedValue(TOKENS);
  strava.refreshTokens.mockResolvedValue(REFRESHED);
  strava.updateActivity.mockResolvedValue(undefined);
});

describe('GET subscription verification', () => {
  it('echoes hub.challenge when the verify token matches', async () => {
    const res = await webhookHandler(get({ 'hub.verify_token': 'verify-me', 'hub.challenge': 'abc' }), ctx());
    expect(res).toEqual({ status: 200, jsonBody: { 'hub.challenge': 'abc' } });
  });

  it('rejects a wrong verify token with 403', async () => {
    const res = await webhookHandler(get({ 'hub.verify_token': 'nope', 'hub.challenge': 'abc' }), ctx());
    expect(res.status).toBe(403);
  });
});

describe('POST event handling', () => {
  it.each([
    ['missing fields', { object_type: 'activity' }],
    ['non-activity object', { ...createEvent, object_type: 'athlete' }],
    ['activity update', { ...createEvent, aspect_type: 'update' }],
    ['activity delete', { ...createEvent, aspect_type: 'delete' }],
  ])('ACKs and ignores %s without calling Strava', async (_label, body) => {
    const res = await webhookHandler(post(body), ctx());
    expect(res).toEqual({ status: 200 });
    expect(strava.ensureValidTokens).not.toHaveBeenCalled();
  });

  it('annotates a new easy run and keeps existing device text', async () => {
    const activity = loadActivity('easy', 16504177112);
    activity.description = '102 Training Load\n-- from COROS';
    strava.getActivity.mockResolvedValue(activity);

    const res = await webhookHandler(post(createEvent), ctx());

    expect(res).toEqual({ status: 200 });
    expect(strava.ensureValidTokens).toHaveBeenCalledWith('42');
    expect(strava.getActivity).toHaveBeenCalledWith('123', 'access-1');
    expect(strava.updateActivity).toHaveBeenCalledWith(
      '123',
      { description: 'E 8.1 mi @ 8:44/mi (HR 137) --from RunNote\n\n102 Training Load\n-- from COROS' },
      'access-1'
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('renames non-easy workouts', async () => {
    const activity = loadActivity('long', 16656343078);
    activity.description = null;
    activity.name = 'Morning Run';
    strava.getActivity.mockResolvedValue(activity);

    await webhookHandler(post(createEvent), ctx());

    expect(strava.updateActivity).toHaveBeenCalledWith(
      '123',
      { description: 'L 10 mi @ 7:39/mi (HR 155) --from RunNote\n\n', name: 'Long Run' },
      'access-1'
    );
  });

  it('does not re-send a long run that is already annotated and titled', async () => {
    // Fixture description and name are exactly what RunNote wrote in production.
    strava.getActivity.mockResolvedValue(loadActivity('long', 16656343078));
    await webhookHandler(post(createEvent), ctx());
    expect(strava.updateActivity).not.toHaveBeenCalled();
  });

  // Known bug, fixed in a follow-up commit: easy runs never set `name`, so
  // `updates.name !== activity.name` is always true and the PUT always fires.
  it.fails('does not re-send an easy run that is already annotated', async () => {
    strava.getActivity.mockResolvedValue(loadActivity('easy', 16504177112));
    await webhookHandler(post(createEvent), ctx());
    expect(strava.updateActivity).not.toHaveBeenCalled();
  });

  it.each([401, 403])('refreshes tokens and retries once when Strava returns %s', async (status) => {
    strava.getActivity
      .mockRejectedValueOnce(httpError(status))
      .mockResolvedValueOnce({ ...loadActivity('long', 16656343078), name: 'Morning Run' });

    await webhookHandler(post(createEvent), ctx());

    expect(strava.refreshTokens).toHaveBeenCalledWith(TOKENS);
    expect(strava.getActivity.mock.calls).toEqual([
      ['123', 'access-1'],
      ['123', 'access-2'],
    ]);
    // The refreshed token is carried forward to the update call.
    expect(strava.updateActivity).toHaveBeenCalledWith('123', expect.anything(), 'access-2');
  });

  it('does not retry on other HTTP errors, and still ACKs', async () => {
    strava.getActivity.mockRejectedValue(httpError(404));
    const c = ctx();
    const res = await webhookHandler(post(createEvent), c);
    expect(res).toEqual({ status: 200 });
    expect(strava.refreshTokens).not.toHaveBeenCalled();
    expect(c.error).toHaveBeenCalled();
  });

  it('ACKs with 200 when the athlete has no stored tokens', async () => {
    strava.ensureValidTokens.mockRejectedValue(new Error('No tokens for athlete 42'));
    const c = ctx();
    expect(await webhookHandler(post(createEvent), c)).toEqual({ status: 200 });
    expect(c.error).toHaveBeenCalledWith('No tokens for athlete 42');
    expect(strava.getActivity).not.toHaveBeenCalled();
  });

  it('ACKs with 200 and skips the update when classification fails', async () => {
    strava.getActivity.mockResolvedValue(loadActivity('tempo', 16230797726));
    create.mockRejectedValue(new Error('OpenAI down'));
    expect(await webhookHandler(post(createEvent), ctx())).toEqual({ status: 200 });
    expect(strava.updateActivity).not.toHaveBeenCalled();
  });
});
