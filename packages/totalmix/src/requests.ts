// Paced state requests: TotalMix answers fast, but a full dump of a large interface is thousands
// of messages (docs/protocol/global-osc.md §3), so requests go out one at a time, spaced, with
// a longer gap after the heavy ones. A request already waiting is not queued twice.

import { formatMessage } from '@faderlight/osc';
import type { Clock, TimerHandle } from './clock.ts';
import { encodeRequest, type Request } from './protocol.ts';

export interface RequestPacing {
  /** Gap after a request (default 10 ms). */
  readonly spacingMs: number;
  /** Gap after /sendall or /sendmix (default 100 ms, about what a UFX III dump took in the capture). */
  readonly heavySpacingMs: number;
}

export const DEFAULT_PACING: RequestPacing = { spacingMs: 10, heavySpacingMs: 100 };

export type Priority = 'high' | 'normal';

/** Called once the request went out (`sent` true) or could not be sent (false). */
export type SentCallback = (sent: boolean) => void;

interface Queued {
  readonly request: Request;
  priority: Priority;
  readonly callbacks: SentCallback[];
}

const isHeavy = (r: Request): boolean => r.type === 'all' || r.type === 'mix';

export class RequestQueue {
  private readonly send: (request: Request) => boolean;
  private readonly clock: Clock;
  private readonly pacing: RequestPacing;
  private readonly waiting = new Map<string, Queued>();
  private nextAt = -Infinity;
  private timer: TimerHandle | undefined;

  constructor(
    send: (request: Request) => boolean,
    clock: Clock,
    pacing: Partial<RequestPacing> = {},
  ) {
    this.send = send;
    this.clock = clock;
    this.pacing = { ...DEFAULT_PACING, ...pacing };
  }

  get size(): number {
    return this.waiting.size;
  }

  /** Queues a request; if the same request is already waiting, joins it (and raises its priority). */
  enqueue(request: Request, priority: Priority = 'normal', onSent?: SentCallback): void {
    const key = formatMessage(encodeRequest(request));
    const existing = this.waiting.get(key);
    if (existing) {
      if (priority === 'high') existing.priority = 'high';
      if (onSent) existing.callbacks.push(onSent);
    } else {
      this.waiting.set(key, { request, priority, callbacks: onSent ? [onSent] : [] });
    }
    this.pump();
  }

  /** Drops everything waiting; their callbacks get `false`. */
  clear(): void {
    this.clock.clearTimeout(this.timer);
    this.timer = undefined;
    const dropped = [...this.waiting.values()];
    this.waiting.clear();
    for (const q of dropped) for (const cb of q.callbacks) cb(false);
  }

  private pump(): void {
    if (this.timer !== undefined || this.waiting.size === 0) return;
    const wait = this.nextAt - this.clock.now();
    if (wait > 0) {
      this.timer = this.clock.setTimeout(() => {
        this.timer = undefined;
        this.pump();
      }, wait);
      return;
    }
    const next = this.takeNext();
    if (!next) return;
    const sent = this.send(next.request);
    this.nextAt =
      this.clock.now() +
      (isHeavy(next.request) ? this.pacing.heavySpacingMs : this.pacing.spacingMs);
    for (const cb of next.callbacks) cb(sent);
    this.pump();
  }

  private takeNext(): Queued | undefined {
    let pick: [string, Queued] | undefined;
    for (const entry of this.waiting) {
      if (entry[1].priority === 'high') {
        pick = entry;
        break;
      }
      pick ??= entry;
    }
    if (pick) this.waiting.delete(pick[0]);
    return pick?.[1];
  }
}
