import { describe, expect, it } from 'vitest';
import { encodeRequest, RequestQueue, type Request } from '../src/index.ts';
import { FakeClock } from './fakes.ts';
import { formatMessage } from '@faderlight/osc';

function setup(up = true) {
  const clock = new FakeClock();
  const sent: { at: number; text: string }[] = [];
  const link = { up };
  const queue = new RequestQueue(
    (r: Request) => {
      if (!link.up) return false;
      sent.push({ at: clock.now(), text: formatMessage(encodeRequest(r)) });
      return true;
    },
    clock,
    { spacingMs: 10, heavySpacingMs: 100 },
  );
  return { clock, sent, queue, link };
}

describe('RequestQueue', () => {
  it('sends the first request at once and the next ones spaced', () => {
    const { clock, sent, queue } = setup();
    queue.enqueue({ type: 'state' });
    queue.enqueue({ type: 'settings' });
    expect(sent.map((s) => s.text)).toEqual(['/sendstate f:1']);
    expect(queue.size).toBe(1);
    clock.advance(10);
    expect(sent.map((s) => [s.at, s.text])).toEqual([
      [0, '/sendstate f:1'],
      [10, '/sendsettings f:1'],
    ]);
  });

  it('reports whether each request went out', () => {
    const { queue, link } = setup();
    const results: boolean[] = [];
    queue.enqueue({ type: 'state' }, 'normal', (sent) => results.push(sent));
    link.up = false;
    queue.enqueue({ type: 'mix' }, 'normal', (sent) => results.push(sent));
    expect(results).toEqual([true]);
  });

  it('joins a request that is already waiting and calls every callback', () => {
    const { clock, sent, queue } = setup();
    queue.enqueue({ type: 'mix' }); // heavy: the next request waits 100 ms
    const calls: string[] = [];
    queue.enqueue({ type: 'submix', output: 2 }, 'normal', () => calls.push('a'));
    queue.enqueue({ type: 'submix', output: 2 }, 'high', () => calls.push('b'));
    expect(queue.size).toBe(1);
    clock.advance(100);
    expect(sent.map((s) => s.text)).toEqual(['/sendmix f:1', '/sendsubmix/2 f:1']);
    expect(calls).toEqual(['a', 'b']);
  });

  it('drops waiting requests on clear() and tells their callbacks', () => {
    const { clock, sent, queue } = setup();
    queue.enqueue({ type: 'mix' });
    const results: boolean[] = [];
    queue.enqueue({ type: 'settings' }, 'normal', (s) => results.push(s));
    queue.clear();
    clock.advance(1000);
    expect(sent).toHaveLength(1);
    expect(results).toEqual([false]);
    expect(clock.pendingTimers).toBe(0);
  });
});
