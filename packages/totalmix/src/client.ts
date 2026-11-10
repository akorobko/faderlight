// TotalMixClient: connection state machine, paced sync and optimistic commands on top of the
// address map. Transport-agnostic: it sends through an OscLink and is fed with received
// messages; connectTotalMix() (connect.ts) wires it to a UDP transport.
//
// What the capture taught (docs/protocol/global-osc.md §8) and how it is handled here:
// - No heartbeat: poll /sendstate about once a second; stale after 3 polls without a reply.
// - Numeric writes are not echoed: show the value as pending, ask for it again shortly after
//   the write (/sendchan, /sendsubmix or /sendsettings) and let that reply settle it.
// - Only visible channels exist: the store's channel list comes from the full sync, which
//   removes what it does not report.
// - A restart shows up as a new source port: sync again.
// - Linking or splitting a stereo pair in TotalMix changes which strips exist, but TotalMix
//   only reports the new stereo setting: sync again shortly after, so the channel list follows.
//
//   idle --start--> probing --status reply--> syncing --replies, then quiet--> live
//                      ^                         |  no reply                   | 3 polls unanswered
//                      +-------------------------+                             v
//                                       syncing <--status reply-- stale <------+

import { EventEmitter } from 'node:events';
import {
  keyOf,
  type ConnectionState,
  type Key,
  type MixerStore,
  type Target,
  type Update,
  type Value,
} from '@faderlight/model';
import { formatMessage, type Endpoint, type OscMessage } from '@faderlight/osc';
import { systemClock, type Clock, type TimerHandle } from './clock.ts';
import {
  confirmRequestFor,
  decodeMessage,
  encodeCommand,
  encodeRequest,
  type Request,
} from './protocol.ts';
import { RequestQueue, type RequestPacing } from './requests.ts';

export interface OscLink {
  /** Sends one message; false when it could not be sent (socket not open). */
  send(message: OscMessage): boolean;
}

export interface ClientOptions extends RequestPacing {
  /** /sendstate interval while probing, live or stale (default 1000 ms). */
  readonly pollIntervalMs: number;
  /** Unanswered polls before live turns stale (default 3). */
  readonly staleAfterMisses: number;
  /** A full sync is complete after this long without state messages (default 150 ms). */
  readonly syncQuietMs: number;
  /** Give up a full sync that gets no reply at all after this long (default 3000 ms). */
  readonly syncTimeoutMs: number;
  /** Delay between a write and the request that confirms it (default 75 ms). */
  readonly confirmDelayMs: number;
  /** Roll a write back when the confirming reply has not settled it after this long (default 1000 ms). */
  readonly confirmTimeoutMs: number;
  /** Sync again this long after the last change of a strip's stereo setting while live (default 250 ms). */
  readonly layoutSyncDelayMs: number;
}

export const DEFAULT_CLIENT_OPTIONS: ClientOptions = {
  pollIntervalMs: 1000,
  staleAfterMisses: 3,
  syncQuietMs: 150,
  syncTimeoutMs: 3000,
  confirmDelayMs: 75,
  confirmTimeoutMs: 1000,
  layoutSyncDelayMs: 250,
  spacingMs: 10,
  heavySpacingMs: 100,
};

export interface ClientEvents {
  state: [state: ConnectionState, previous: ConnectionState];
  /** A write was rolled back: no confirming reply, the request could not be sent, or the connection was lost. */
  commandFailed: [target: Target, value: Value, reason: string];
  /** A message the address map does not know. */
  unknownMessage: [message: OscMessage, reason: string];
}

interface PendingCommand {
  readonly target: Target;
  readonly value: Value;
  /** Bumped by every new write to the same target; stale callbacks compare it. */
  readonly seq: number;
  timeoutTimer: TimerHandle | undefined;
}

/** Writes waiting for the same confirming request, sent once after the last of them. */
interface ConfirmGroup {
  readonly request: Request;
  timer: TimerHandle | undefined;
  /** Store key → seq of the write it confirms. */
  readonly members: Map<Key, number>;
}

export class TotalMixClient extends EventEmitter<ClientEvents> {
  readonly store: MixerStore;
  readonly options: ClientOptions;
  private readonly link: OscLink;
  private readonly clock: Clock;
  private readonly queue: RequestQueue;
  private current: ConnectionState = 'idle';
  private pollTimer: TimerHandle | undefined;
  private missedPolls = 0;
  /** Bumped on every state change, so callbacks from an earlier sync can tell they are stale. */
  private syncToken = 0;
  private syncSent = false;
  /** The dump went quiet; a /sendstate behind it checks TotalMix is still answering. */
  private syncFence = false;
  /** That /sendstate has gone out: the next status reply completes the sync. */
  private syncFenceSent = false;
  private syncQuietTimer: TimerHandle | undefined;
  private syncTimeoutTimer: TimerHandle | undefined;
  private layoutSyncTimer: TimerHandle | undefined;
  private readonly pending = new Map<Key, PendingCommand>();
  private readonly confirmGroups = new Map<string, ConfirmGroup>();
  private seq = 0;

  constructor(
    link: OscLink,
    store: MixerStore,
    options: Partial<ClientOptions> & { readonly clock?: Clock } = {},
  ) {
    super();
    this.link = link;
    this.store = store;
    this.clock = options.clock ?? systemClock;
    this.options = { ...DEFAULT_CLIENT_OPTIONS, ...options };
    this.queue = new RequestQueue(
      (r) => this.link.send(encodeRequest(r)),
      this.clock,
      this.options,
    );
  }

  get state(): ConnectionState {
    return this.current;
  }

  // --- lifecycle --------------------------------------------------------------------------

  /** The link is up: start probing. Does nothing unless idle. */
  start(): void {
    if (this.current !== 'idle') return;
    this.enterPolling('probing');
  }

  /** The link is down or the client is shut: back to idle, writes in flight are rolled back. */
  stop(): void {
    if (this.current === 'idle') return;
    this.leaveState();
    this.failAllPending('stopped');
    this.queue.clear();
    this.store.abortSync();
    this.setState('idle');
  }

  /** The sender's port changed (TotalMix restarted): sync again if we were in sync. */
  sourceChanged(previous: Endpoint | undefined): void {
    if (previous === undefined) return;
    if (this.current === 'live' || this.current === 'syncing') this.enterSyncing();
  }

  /** Requests a full sync now (no-op while idle). */
  resync(): void {
    if (this.current !== 'idle') this.enterSyncing();
  }

  /** Asks TotalMix for part of the state, e.g. a channel that came into view. */
  refresh(request: Request): void {
    if (this.current !== 'idle') this.queue.enqueue(request, 'normal');
  }

  // --- receiving --------------------------------------------------------------------------

  /** Feeds the messages of one received datagram. */
  receive(messages: readonly OscMessage[]): void {
    if (this.current === 'idle') return;
    const now = this.clock.now();
    const updates: Update[] = [];
    let status = false;
    let layout = false;
    for (const m of messages) {
      const d = decodeMessage(m);
      if (d.kind === 'meter') {
        this.store.meters.push(d.bus, d.index, d.db, now);
      } else if (d.kind === 'unknown') {
        this.emit('unknownMessage', m, d.reason);
      } else {
        updates.push({ target: d.target, value: d.value });
        if (d.target.scope === 'status') status = true;
        else if (this.current === 'live' && this.changesLayout(d.target, d.value)) layout = true;
      }
    }
    if (updates.length === 0) return;
    this.store.applyDevice(updates);
    this.settlePending(updates);
    if (status) this.onStatusReply();
    if (this.current === 'syncing' && this.syncSent && !this.syncFence) this.onSyncReply();
    if (layout && this.current === 'live') this.scheduleLayoutSync();
  }

  /**
   * A known strip turned stereo or mono. The right channel of a new pair stays in the store,
   * and the right channel of a split pair is not reported, until a full sync. A value seen for
   * the first time is not a change: a channel that came into view reports its setting too.
   */
  private changesLayout(target: Target, value: Value): boolean {
    if (target.scope !== 'channel' || target.field !== 'stereo') return false;
    const before = this.store.value(target);
    return before !== undefined && before !== value;
  }

  /** One full sync after a burst of layout changes (TotalMix sends them in quick succession). */
  private scheduleLayoutSync(): void {
    this.clock.clearTimeout(this.layoutSyncTimer);
    this.layoutSyncTimer = this.clock.setTimeout(() => {
      this.layoutSyncTimer = undefined;
      if (this.current === 'live') this.enterSyncing();
    }, this.options.layoutSyncDelayMs);
  }

  private onStatusReply(): void {
    this.missedPolls = 0;
    if (this.current === 'probing' || this.current === 'stale') this.enterSyncing();
    else if (this.current === 'syncing' && this.syncFenceSent) this.completeSync();
  }

  // --- states -----------------------------------------------------------------------------

  private setState(state: ConnectionState): void {
    const previous = this.current;
    if (state === previous) return;
    this.current = state;
    this.store.setConnection(state);
    this.emit('state', state, previous);
  }

  private leaveState(): void {
    this.clock.clearTimeout(this.pollTimer);
    this.clock.clearTimeout(this.syncQuietTimer);
    this.clock.clearTimeout(this.syncTimeoutTimer);
    this.clock.clearTimeout(this.layoutSyncTimer);
    this.pollTimer = this.syncQuietTimer = this.syncTimeoutTimer = this.layoutSyncTimer = undefined;
    this.syncToken++;
    this.syncSent = false;
    this.syncFence = false;
    this.syncFenceSent = false;
  }

  /** probing, live and stale all poll /sendstate; live counts the misses. */
  private enterPolling(state: 'probing' | 'live' | 'stale'): void {
    this.leaveState();
    this.missedPolls = 0;
    this.setState(state);
    if (state !== 'live') this.poll();
    this.schedulePoll();
  }

  private schedulePoll(): void {
    this.pollTimer = this.clock.setTimeout(() => {
      this.pollTimer = undefined;
      if (this.current === 'live' && this.missedPolls >= this.options.staleAfterMisses) {
        this.lostContact();
        return;
      }
      this.poll();
      this.schedulePoll();
    }, this.options.pollIntervalMs);
  }

  private poll(): void {
    if (this.current === 'live') this.missedPolls++;
    this.queue.enqueue({ type: 'state' }, 'high');
  }

  private enterSyncing(): void {
    this.leaveState();
    this.setState('syncing');
    this.store.beginSync();
    const token = this.syncToken;
    this.queue.enqueue({ type: 'all', routes: 'on' }, 'high', (sent) => {
      if (token !== this.syncToken) return;
      if (!sent) {
        this.syncFailed();
        return;
      }
      this.syncSent = true;
      this.armSyncTimeout();
    });
  }

  /** Fails the sync when nothing (no dump, no fence reply) arrives in time. */
  private armSyncTimeout(): void {
    this.clock.clearTimeout(this.syncTimeoutTimer);
    const token = this.syncToken;
    this.syncTimeoutTimer = this.clock.setTimeout(() => {
      this.syncTimeoutTimer = undefined;
      if (token === this.syncToken) this.syncFailed();
    }, this.options.syncTimeoutMs);
  }

  private onSyncReply(): void {
    this.clock.clearTimeout(this.syncTimeoutTimer);
    this.syncTimeoutTimer = undefined;
    this.clock.clearTimeout(this.syncQuietTimer);
    this.syncQuietTimer = this.clock.setTimeout(() => {
      this.syncQuietTimer = undefined;
      // The dump went quiet. Before trusting it as complete (and removing what it left out),
      // check TotalMix is still answering: its reply to /sendstate comes after the dump.
      this.syncFence = true;
      const token = this.syncToken;
      this.queue.enqueue({ type: 'state' }, 'high', (sent) => {
        if (token !== this.syncToken) return;
        if (!sent) {
          this.syncFailed();
          return;
        }
        this.syncFenceSent = true;
        this.armSyncTimeout();
      });
    }, this.options.syncQuietMs);
  }

  private completeSync(): void {
    this.store.endSync();
    this.enterPolling('live');
  }

  private syncFailed(): void {
    this.store.abortSync();
    this.lostContact();
  }

  /** No answer: stale if we had a picture of the mixer, still probing if not. */
  private lostContact(): void {
    this.failAllPending('connection lost');
    this.store.meters.reset();
    this.enterPolling(this.store.synced ? 'stale' : 'probing');
  }

  // --- commands ---------------------------------------------------------------------------

  /**
   * Writes a value. It shows as pending at once and is confirmed or corrected by TotalMix's
   * reply to a follow-up request; without a reply it is rolled back (`commandFailed`).
   * Returns false, changing nothing, unless live or syncing. Throws for invalid writes.
   */
  set(target: Target, value: Value): boolean {
    return this.write(target, value, encodeCommand({ type: 'set', target, value }));
  }

  /** Loads snapshot 1-8; shows it as active until TotalMix confirms. */
  loadSnapshot(n: number): boolean {
    return this.write(
      { scope: 'snapshot', n },
      'active',
      encodeCommand({ type: 'loadSnapshot', n }),
    );
  }

  private write(target: Target, value: Value, msg: OscMessage): boolean {
    if (this.current !== 'live' && this.current !== 'syncing') return false;
    if (!this.link.send(msg)) return false;
    this.store.setPending(target, value);
    this.track(target, value);
    return true;
  }

  private track(target: Target, value: Value): void {
    const key = keyOf(target);
    this.clearPending(key);
    const seq = ++this.seq;
    this.pending.set(key, { target, value, seq, timeoutTimer: undefined });

    // Writes answered by the same request (two settings of one channel, Dim and a group, a
    // stream of fader steps) share one confirming request, sent after the last write.
    const request = confirmRequestFor(target);
    const groupKey = formatMessage(encodeRequest(request));
    let group = this.confirmGroups.get(groupKey);
    if (!group) {
      group = { request, timer: undefined, members: new Map() };
      this.confirmGroups.set(groupKey, group);
    }
    group.members.set(key, seq);
    this.clock.clearTimeout(group.timer);
    const flushing = group;
    group.timer = this.clock.setTimeout(() => {
      this.confirmGroups.delete(groupKey);
      this.sendConfirm(flushing);
    }, this.options.confirmDelayMs);
  }

  private sendConfirm(group: ConfirmGroup): void {
    this.queue.enqueue(group.request, 'high', (sent) => {
      for (const [key, seq] of group.members) {
        const cmd = this.pending.get(key);
        if (cmd?.seq !== seq) continue; // superseded or settled
        if (!sent) {
          this.fail(key, 'confirming request not sent');
          continue;
        }
        this.store.awaitReply(cmd.target);
        cmd.timeoutTimer = this.clock.setTimeout(() => {
          cmd.timeoutTimer = undefined;
          if (this.pending.get(key)?.seq === seq) this.fail(key, 'no confirmation');
        }, this.options.confirmTimeoutMs);
      }
    });
  }

  private settlePending(updates: readonly Update[]): void {
    if (this.pending.size === 0) return;
    for (const u of updates) {
      const key = keyOf(u.target);
      if (this.pending.has(key) && !this.store.isPending(u.target)) this.clearPending(key);
    }
  }

  private clearPending(key: Key): void {
    const cmd = this.pending.get(key);
    if (!cmd) return;
    this.clock.clearTimeout(cmd.timeoutTimer);
    this.pending.delete(key);
  }

  private fail(key: Key, reason: string): void {
    const cmd = this.pending.get(key);
    if (!cmd) return;
    this.clearPending(key);
    if (this.store.rollback(cmd.target)) this.emit('commandFailed', cmd.target, cmd.value, reason);
  }

  private failAllPending(reason: string): void {
    for (const group of this.confirmGroups.values()) this.clock.clearTimeout(group.timer);
    this.confirmGroups.clear();
    for (const key of [...this.pending.keys()]) this.fail(key, reason);
  }
}
