import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Activity } from '../src/models/activity.model';
import { formatWorkoutSummary } from '../src/utils/activityFormatter';
import { loadActivity, loadAll } from './helpers';

// OpenAI boundary: every test scripts the model's responses explicitly.
const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('../src/shared/ai', () => ({ openai: { chat: { completions: { create } } } }));

import { analyzeWorkout, isEasyRun, isLongRun } from '../src/services/workoutAnalysis';

type ToolCall = { name: string; args: unknown };
const toolCallsResponse = (...calls: ToolCall[]) => ({
  choices: [
    {
      finish_reason: 'tool_calls',
      message: {
        role: 'assistant',
        content: null,
        tool_calls: calls.map((c, i) => ({
          id: `call_${i}`,
          type: 'function',
          function: { name: c.name, arguments: JSON.stringify(c.args) },
        })),
      },
    },
  ],
});
const stopResponse = () => ({
  choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'done' } }],
});
const lapsForTool = (a: Activity, idx: number[]) =>
  idx.map((i) => {
    const lap = a.laps![i];
    return { distance: lap.distance, moving_time: lap.moving_time, average_heartrate: lap.average_heartrate };
  });

beforeEach(() => create.mockReset());

describe('deterministic classification (no LLM call)', () => {
  // Each fixture's stored description begins with the summary RunNote wrote
  // for it in production. Re-deriving it locally must give the same line.
  const annotated = [...loadAll('easy'), ...loadAll('long')]
    .map((a) => [a.id, a.description?.split(' --from RunNote')[0]] as const)
    .filter((x): x is readonly [number, string] => !!x[1] && /^[EL] /.test(x[1]));

  it.each(annotated)('activity %s reproduces its production summary "%s"', async (id, expected) => {
    const set = id === 16656343078 ? 'long' : 'easy';
    const result = await analyzeWorkout(loadActivity(set, id));
    expect(formatWorkoutSummary(result)).toBe(expected);
    expect(create).not.toHaveBeenCalled();
  });

  it('classifies >= 10 mi as Long even when some laps are in pace zone 3', async () => {
    const a = loadActivity('long', 16656343078);
    expect(a.laps!.some((l) => l.pace_zone === 3)).toBe(true);
    expect((await analyzeWorkout(a)).type).toBe('L');
  });

  it('classifies >= 90 minutes as Long regardless of distance', () => {
    const a = loadActivity('easy', 16504177112);
    a.distance = 8 * 1609.344;
    a.moving_time = 5400;
    expect(isLongRun(a)).toBe(true);
    a.moving_time = 5399;
    expect(isLongRun(a)).toBe(false);
  });

  it('treats 10 mi as the Long threshold (inclusive)', () => {
    const a = loadActivity('easy', 16504177112);
    a.distance = 16093.44;
    expect(isLongRun(a)).toBe(true);
    a.distance = 16093.43;
    expect(isLongRun(a)).toBe(false);
  });

  it('isEasyRun requires every lap in pace zone 1-2', () => {
    const a = loadActivity('easy', 16504177112);
    expect(isEasyRun(a)).toBe(true);
    a.laps![3].pace_zone = 3;
    expect(isEasyRun(a)).toBe(false);
  });

  it('isEasyRun is false without laps, or with zone-0 laps (zones unavailable)', () => {
    const a = loadActivity('easy', 16504177112);
    a.laps = [];
    expect(isEasyRun(a)).toBe(false);
    expect(isEasyRun(loadActivity('tempo', 14703153220))).toBe(false);
  });
});

describe('LLM path (tempo / intervals)', () => {
  it('sends the full activity, including laps, with the configured model and tools', async () => {
    const a = loadActivity('tempo', 16230797726);
    create.mockResolvedValueOnce(stopResponse());
    await analyzeWorkout(a);

    expect(create).toHaveBeenCalledTimes(1);
    const req = create.mock.calls[0][0];
    expect(req.model).toBe('gpt-4o-mini');
    expect(req.temperature).toBe(0.2);
    expect(req.messages[0].role).toBe('system');
    expect(req.messages[1].content).toContain(JSON.stringify(a));
    expect(req.messages[1].content).toContain('"pace_zone":3');
    expect(req.tools.map((t: { function: { name: string } }) => t.function.name)).toEqual([
      'calculateRunMetrics',
      'calculateTempoBlockMetrics',
      'calculateIntervalMetrics',
      'returnWorkoutResult',
    ]);
  });

  it('executes calculator tool calls locally and returns the model result', async () => {
    const a = loadActivity('tempo', 16230797726);
    const block = lapsForTool(a, [4, 5, 6, 7]);
    const final = {
      type: 'T',
      structure: 'continuous',
      metrics: { distance_miles: 3.11, pace_seconds_per_mile: 397.6, average_heartrate: 163 },
    };
    create
      .mockResolvedValueOnce(toolCallsResponse({ name: 'calculateTempoBlockMetrics', args: { laps: block } }))
      .mockResolvedValueOnce(toolCallsResponse({ name: 'returnWorkoutResult', args: final }));

    const result = await analyzeWorkout(a);
    expect(result).toEqual(final);
    expect(formatWorkoutSummary(result)).toBe('T 3.1 mi @ avg 6:38/mi');

    // The second request carries our locally computed tool output back to the model.
    const toolMsg = create.mock.calls[1][0].messages.find((m: { role: string }) => m.role === 'tool');
    const computed = JSON.parse(toolMsg.content);
    expect(computed.distance_miles).toBeCloseTo(5011.28 / 1609.344, 3);
    expect(computed.pace_seconds_per_mile).toBeCloseTo(1238 / (5011.28 / 1609.344), 3);
  });

  it('falls back to the last interval calculation if the model never returns a result', async () => {
    const a = loadActivity('tempo', 16581133185);
    create
      .mockResolvedValueOnce(
        toolCallsResponse({ name: 'calculateIntervalMetrics', args: { laps: lapsForTool(a, [1, 3, 5]) } })
      )
      .mockResolvedValueOnce(stopResponse());

    const result = await analyzeWorkout(a);
    expect(result.type).toBe('T');
    expect(result.structure).toBe('interval');
    expect(result.interval_metrics?.interval_count).toBe(3);
    expect(formatWorkoutSummary(result)).toBe('T 3 x 1 mi @ 6:23, 6:24, 6:22');
  });

  it('labels a non-interval fallback calculation as E (current behaviour)', async () => {
    // Documents existing behaviour: a continuous-tempo calculation that the
    // model never confirms is reported as an Easy run, not a Tempo run.
    const a = loadActivity('tempo', 16230797726);
    create
      .mockResolvedValueOnce(
        toolCallsResponse({ name: 'calculateTempoBlockMetrics', args: { laps: lapsForTool(a, [4, 5, 6, 7]) } })
      )
      .mockResolvedValueOnce(stopResponse());
    expect((await analyzeWorkout(a)).type).toBe('E');
  });

  it('falls back to overall activity stats when the model makes no tool calls', async () => {
    const a = loadActivity('tempo', 16230797726);
    create.mockResolvedValueOnce(stopResponse());
    expect(formatWorkoutSummary(await analyzeWorkout(a))).toBe('E 7.4 mi @ 8:04/mi (HR 138)');
  });

  it('answers unknown tool names with an error message and keeps going', async () => {
    const a = loadActivity('tempo', 16230797726);
    create
      .mockResolvedValueOnce(toolCallsResponse({ name: 'deleteEverything', args: {} }))
      .mockResolvedValueOnce(stopResponse());
    await analyzeWorkout(a);
    const toolMsg = create.mock.calls[1][0].messages.find((m: { role: string }) => m.role === 'tool');
    expect(JSON.parse(toolMsg.content)).toEqual({ error: 'Unknown function' });
  });

  it('propagates OpenAI errors to the caller', async () => {
    create.mockRejectedValueOnce(new Error('429 rate limited'));
    await expect(analyzeWorkout(loadActivity('tempo', 16230797726))).rejects.toThrow('429');
  });
});
