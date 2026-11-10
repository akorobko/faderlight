// Key controllers: one per spec type. A controller turns mixer state into what the key shows (a
// view model for packages/render) and the key's gestures into mixer commands. Pure apart from
// the commands: everything comes in through the KeyContext.
//
// Protocol facts used here (docs/protocol/global-osc.md): Main is the output in
// /controlroom/mainout, not a fixed one; an input has no fader of its own, its level is the
// route into a submix (here: into Main); solo is reported per route, for the submix TotalMix
// shows, so a channel's solo is read and written on its route into Main (writing it is
// inferred, see the PR's hardware questions).

import {
  channelValue,
  deviceModel,
  deviceProfile,
  mainOutput,
  NO_CHANNEL,
  phonesOutput,
  routeLevel,
  stripOf,
  strips,
  type Bus,
  type ChannelField,
  type MixerStore,
  type SnapshotState,
  type SourceBus,
  type Strip,
  type Target,
  type Value,
} from '@faderlight/model';
import {
  formatGain,
  type ChannelKey,
  type ChannelValue,
  type KeyView,
  type MeterLevel,
  type OutputKey,
  type StatusKey,
  type ToggleFunction,
} from '@faderlight/render';
import { FADER_MAX_DB, FADER_MIN_DB } from '@faderlight/totalmix';
import { stepSize, VOLUME_ACCELERATION, type Gesture, type GestureOptions } from './gestures.ts';
import type { BankPosition } from './layout.ts';
import type { GlobalSettings } from './settings.ts';
import type { ChannelSpec, Direction, KeySpec, OutputRef } from './specs.ts';

/** What controllers need from the mixer client (TotalMixClient has all of it). */
export interface MixerControl {
  readonly store: MixerStore;
  /** Writes a value; false when not connected. */
  set(target: Target, value: Value): boolean;
  loadSnapshot(n: number): boolean;
  /** Reads the whole mixer again. */
  resync(): void;
}

/** Where a bank is, and how far it can go. */
export interface BankState extends BankPosition {
  readonly size: number;
  /** Strips the bus has now. */
  readonly total: number;
}

/** Where the ± send keys of the Channel Detail overlay go: a submix (its output) or FX. */
export type SendTarget = number | 'fx';

/** The channel the Channel Detail overlay shows. */
export interface DetailState {
  readonly bus: SourceBus;
  readonly index: number;
  /** The send the ± send keys and pan change (default: Main). */
  readonly send?: SendTarget | undefined;
}

/** Navigation on the key's device that the controllers can ask for. */
export interface Navigator {
  /** Opens the Channel Detail overlay for a strip; false when it cannot be shown. */
  openDetail(bus: Bus, index: number): boolean;
  /** The bank of the Console page shown; undefined when the page has none. */
  bank(): BankState | undefined;
  moveBank(direction: Direction): void;
  /** Switches the bank to the next bus (inputs, playback, outputs). */
  nextBankBus(): void;
  /** The Console page shown, from 0. */
  readonly page: number;
  readonly pages: readonly string[];
  goToPage(index: number): void;
  /** Switches the device to the Console profile; false when there is none. */
  openConsole(): boolean;
  /** The channel the Channel Detail overlay shows; undefined when it is closed. */
  detail(): DetailState | undefined;
  /** Closes the overlay (and goes back to the profile it was opened from). */
  closeDetail(): void;
  /** Shows the previous or next channel of the same bus. */
  moveDetail(direction: Direction): void;
  selectSend(send: SendTarget): void;
}

export interface KeyContext {
  readonly mixer: MixerControl;
  /** Now, on the clock the meters are stamped with. */
  readonly now: number;
  readonly settings: GlobalSettings;
  /** The key is held down. */
  readonly held: boolean;
  /** State kept for this key across gestures, e.g. the Talkback latch. */
  readonly memo: Record<string, unknown>;
  readonly nav: Navigator;
  /** Shows the app's "did not work" mark on the key. */
  alert(): void;
  /** Shows the app's "done" mark on the key. */
  ok(): void;
}

export interface Controller<S extends KeySpec> {
  /** What the key listens for. */
  options(spec: S, ctx: KeyContext): GestureOptions;
  /** What the key shows; undefined: nothing (a blank key). */
  view(spec: S, ctx: KeyContext): KeyView | undefined;
  gesture(spec: S, gesture: Gesture, ctx: KeyContext): void;
  /** The key follows the meters without showing one (keys with a meter always do). */
  animated?(spec: S): boolean;
}

// --- reading the mixer --------------------------------------------------------------------

/** The mixer is answering (or reading its state): values are current. */
export const isOnline = (store: MixerStore): boolean =>
  store.connection === 'live' || store.connection === 'syncing';

const upper = (s: string): string => s.toUpperCase();

/** Index of the output TotalMix uses as Main, if known. */
function mainIndex(store: MixerStore): number | undefined {
  const v = store.value({ scope: 'controlRoom', field: 'mainOut' });
  return typeof v === 'number' && v !== NO_CHANNEL ? v : undefined;
}

/** A strip by its left index, or the first visible strip of the bus. */
export function resolveStrip(store: MixerStore, bus: Bus, index?: number): Strip | undefined {
  return index === undefined ? strips(store, bus)[0] : stripOf(store, bus, index);
}

export function resolveOutput(store: MixerStore, ref: OutputRef): Strip | undefined {
  switch (ref.role) {
    case 'main':
      return mainOutput(store);
    case 'phones':
      return phonesOutput(store, ref.n);
    case 'output':
      return stripOf(store, 'output', ref.index);
  }
}

function outputTitle(ref: OutputRef): string | undefined {
  switch (ref.role) {
    case 'main':
      return 'MAIN';
    case 'phones':
      return `PHONES ${String(ref.n)}`;
    case 'output':
      return undefined;
  }
}

function meterOf(
  store: MixerStore,
  strip: Strip,
  now: number,
): { left: MeterLevel; right?: MeterLevel } {
  const left = store.meters.read(strip.bus, strip.index, now);
  return strip.right === undefined
    ? { left }
    : { left, right: store.meters.read(strip.bus, strip.right, now) };
}

const field = (bus: Bus, index: number, f: ChannelField): Target => ({
  scope: 'channel',
  bus,
  index,
  field: f,
});

const sourceBus = (bus: Bus): SourceBus | undefined =>
  bus === 'input' || bus === 'playback' ? bus : undefined;

/** The route of a strip into Main, for its level and solo. */
function mainRoute(store: MixerStore, strip: Strip, f: 'fader' | 'solo'): Target | undefined {
  const source = sourceBus(strip.bus);
  const main = mainIndex(store);
  if (source === undefined || main === undefined) return undefined;
  return { scope: 'route', source, index: strip.index, output: main, field: f };
}

const anyPending = (store: MixerStore, targets: readonly (Target | undefined)[]): boolean =>
  targets.some((t) => t !== undefined && store.isPending(t));

/** Physical channels of a strip: per-side settings (gain, phase) are written to both. */
const sides = (strip: Strip): number[] =>
  strip.right === undefined ? [strip.index] : [strip.index, strip.right];

/** Flips a switch; alerts when its state is not known or the write could not go out. */
function toggle(ctx: KeyContext, target: Target): void {
  const current = ctx.mixer.store.value(target);
  if (typeof current !== 'boolean' || !ctx.mixer.set(target, !current)) ctx.alert();
}

// --- channel ------------------------------------------------------------------------------

export function channelView(spec: ChannelSpec, ctx: KeyContext): KeyView | undefined {
  const store = ctx.mixer.store;
  const strip = resolveStrip(store, spec.bus, spec.index);
  if (spec.bus === 'output') {
    const index = strip?.index ?? spec.index;
    if (index === undefined) return undefined;
    return outputView({ role: 'output', index }, ctx);
  }
  if (!strip) {
    // Not visible in TotalMix (or not read yet): say which channel the key is for.
    const label =
      spec.index === undefined
        ? upper(spec.bus)
        : upper(deviceProfile(store).label(spec.bus, spec.index));
    return { kind: 'channel', style: spec.style, label, offline: true };
  }
  const value = (f: ChannelField) => channelValue(store, strip.bus, strip.index, f);
  const sw = (f: ChannelField) => {
    const v = value(f);
    return typeof v === 'boolean' ? v : undefined;
  };
  const gain = value('gain');
  const fader = mainRoute(store, strip, 'fader');
  const solo = mainRoute(store, strip, 'solo');
  const main = mainIndex(store);
  const primary: ChannelValue =
    typeof gain === 'number'
      ? { kind: 'gain', db: gain, caption: 'Gain' }
      : {
          kind: 'level',
          db:
            main === undefined
              ? undefined
              : routeLevel(store, strip.bus as SourceBus, strip.index, main),
          caption: 'Fader',
        };
  const color = value('color');
  return {
    kind: 'channel',
    style: spec.style,
    label: upper(strip.label),
    name: strip.name,
    color: typeof color === 'number' ? color : undefined,
    value: primary,
    meter: meterOf(store, strip, ctx.now),
    badges: {
      phantom: sw('phantom'),
      phase: sw('phase'),
      instrument: sw('instrument'),
      autoSet: sw('autoSet'),
      stereo: strip.stereo,
    },
    muted: value('mute') === true,
    soloed: solo !== undefined && store.value(solo) === true,
    pending: anyPending(store, [
      field(strip.bus, strip.index, 'mute'),
      field(strip.bus, strip.index, 'phantom'),
      ...sides(strip).map((i) => field(strip.bus, i, 'gain')),
      solo,
      fader,
    ]),
    offline: !isOnline(store),
  } satisfies ChannelKey;
}

const channelController: Controller<ChannelSpec> = {
  options: (spec, ctx) => ({
    longPressMs: (spec.hold ?? 'detail') === 'none' ? undefined : ctx.settings.gestures.longPressMs,
  }),
  view: channelView,
  gesture: (spec, g, ctx) => {
    if (g.type !== 'tap' && g.type !== 'longPress') return;
    const store = ctx.mixer.store;
    const strip = resolveStrip(store, spec.bus, spec.index);
    if (!strip || !isOnline(store)) {
      ctx.alert();
      return;
    }
    const action = g.type === 'tap' ? (spec.tap ?? 'mute') : (spec.hold ?? 'detail');
    switch (action) {
      case 'mute':
        toggle(ctx, field(strip.bus, strip.index, 'mute'));
        return;
      case 'solo': {
        const solo = mainRoute(store, strip, 'solo');
        if (solo) toggle(ctx, solo);
        else ctx.alert();
        return;
      }
      case 'phantom':
        toggle(ctx, field(strip.bus, strip.index, 'phantom'));
        return;
      case 'detail':
        if (!ctx.nav.openDetail(strip.bus, strip.index)) ctx.alert();
        return;
      case 'none':
        return;
    }
  },
};

// --- outputs ------------------------------------------------------------------------------

export function outputView(ref: OutputRef, ctx: KeyContext): OutputKey {
  const store = ctx.mixer.store;
  const strip = resolveOutput(store, ref);
  const role = ref.role === 'output' ? 'output' : ref.role;
  const title = outputTitle(ref);
  if (!strip) {
    return {
      kind: 'output',
      role,
      title,
      label: ref.role === 'output' ? upper(deviceProfile(store).label('output', ref.index)) : '',
      name: ref.role === 'output' ? '' : 'Not assigned',
      volume: undefined,
      offline: true,
    };
  }
  const value = (f: ChannelField) => channelValue(store, 'output', strip.index, f);
  const cr = (f: 'dim' | 'mainMono' | 'speakerB' | 'externalIn' | 'talkback') =>
    store.value({ scope: 'controlRoom', field: f }) === true;
  const volume = value('volume');
  const color = value('color');
  return {
    kind: 'output',
    role,
    title,
    label: upper(strip.label),
    name: strip.name,
    color: typeof color === 'number' ? color : undefined,
    volume: typeof volume === 'number' ? volume : undefined,
    meter: meterOf(store, strip, ctx.now),
    muted: value('mute') === true,
    monitor:
      ref.role === 'main'
        ? {
            dim: cr('dim'),
            mono: cr('mainMono'),
            speakerB: cr('speakerB'),
            external: cr('externalIn'),
            talkback: cr('talkback'),
          }
        : undefined,
    pending: anyPending(store, [
      field('output', strip.index, 'volume'),
      field('output', strip.index, 'mute'),
    ]),
    offline: !isOnline(store),
  };
}

const outputController: Controller<Extract<KeySpec, { type: 'output' }>> = {
  options: () => ({}),
  view: (spec, ctx) => outputView(spec.output, ctx),
  gesture: (spec, g, ctx) => {
    if (g.type !== 'tap') return;
    const strip = resolveOutput(ctx.mixer.store, spec.output);
    if (!strip) ctx.alert();
    else toggle(ctx, field('output', strip.index, 'mute'));
  },
};

/** The next volume a ± key sets: off below the fader's lowest position, +6 dB at most. */
export function stepVolume(db: number, direction: 'up' | 'down', size: number): number {
  const from = db === -Infinity ? FADER_MIN_DB - size : db;
  const to = Math.round((direction === 'up' ? from + size : from - size) * 10) / 10;
  if (to < FADER_MIN_DB) return -Infinity;
  return Math.min(FADER_MAX_DB, to);
}

const stepController: Controller<Extract<KeySpec, { type: 'step' }>> = {
  options: (_spec, ctx) => ({
    repeat: {
      delayMs: ctx.settings.gestures.repeatDelayMs,
      intervalMs: ctx.settings.gestures.repeatIntervalMs,
    },
  }),
  view: (spec, ctx) => {
    const store = ctx.mixer.store;
    const strip = resolveOutput(store, spec.output);
    const volume = strip ? channelValue(store, 'output', strip.index, 'volume') : undefined;
    const db = typeof volume === 'number' ? volume : undefined;
    const target =
      outputTitle(spec.output) ?? (strip ? upper(strip.label) : upper(spec.output.role));
    return {
      kind: 'step',
      direction: spec.direction,
      target,
      db,
      held: ctx.held,
      atLimit:
        db !== undefined && (spec.direction === 'up' ? db >= FADER_MAX_DB : db === -Infinity),
      pending: strip !== undefined && store.isPending(field('output', strip.index, 'volume')),
      offline: !isOnline(store) || strip === undefined,
    };
  },
  gesture: (spec, g, ctx) => {
    if (g.type !== 'repeat') return;
    const store = ctx.mixer.store;
    const strip = resolveOutput(store, spec.output);
    const target = strip && field('output', strip.index, 'volume');
    const db = target && store.value(target);
    if (!target || typeof db !== 'number') {
      if (g.count === 0) ctx.alert();
      return;
    }
    const next = stepVolume(db, spec.direction, stepSize(g.heldMs, VOLUME_ACCELERATION));
    if (next !== db && !ctx.mixer.set(target, next) && g.count === 0) ctx.alert();
  },
};

// --- snapshots, switches, status ----------------------------------------------------------

const snapshotController: Controller<Extract<KeySpec, { type: 'snapshot' }>> = {
  options: () => ({}),
  view: (spec, ctx) => {
    const store = ctx.mixer.store;
    const target: Target = { scope: 'snapshot', n: spec.n };
    return {
      kind: 'snapshot',
      n: spec.n,
      state: store.value(target) as SnapshotState | undefined,
      pending: store.isPending(target),
      offline: !isOnline(store),
    };
  },
  gesture: (spec, g, ctx) => {
    // Saving is not offered: no capture has shown a Global OSC address for it yet.
    if (g.type === 'tap' && !ctx.mixer.loadSnapshot(spec.n)) ctx.alert();
  },
};

/** The mixer switch behind each toggle key. */
export function toggleTarget(f: ToggleFunction): Target {
  switch (f) {
    case 'dim':
      return { scope: 'controlRoom', field: 'dim' };
    case 'mono':
      return { scope: 'controlRoom', field: 'mainMono' };
    case 'talkback':
      return { scope: 'controlRoom', field: 'talkback' };
    case 'speakerB':
      return { scope: 'controlRoom', field: 'speakerB' };
    case 'external':
      return { scope: 'controlRoom', field: 'externalIn' };
    case 'globalMute':
      return { scope: 'global', field: 'mute' };
    case 'globalSolo':
      return { scope: 'global', field: 'solo' };
  }
}

function toggleCaption(
  f: ToggleFunction,
  store: MixerStore,
  on: boolean | undefined,
): string | undefined {
  switch (f) {
    case 'dim': {
      const db = store.value({ scope: 'controlRoom', field: 'dimReduction' });
      return typeof db === 'number' && Number.isFinite(db) ? `${formatGain(db)} dB` : undefined;
    }
    case 'mono':
      return 'Main out';
    case 'talkback':
      return on === true ? 'talking' : 'hold to talk';
    case 'globalSolo': {
      let n = 0;
      for (const e of store.entries()) {
        if (e.target.scope === 'route' && e.target.field === 'solo' && e.value === true) n++;
      }
      return n > 0 ? `${String(n)} soloed` : undefined;
    }
    default:
      return undefined;
  }
}

const toggleController: Controller<Extract<KeySpec, { type: 'toggle' }>> = {
  // Talkback is momentary (on while held) and latches with a double tap.
  options: (spec, ctx) =>
    spec.function === 'talkback' ? { doubleTapMs: ctx.settings.gestures.doubleTapMs } : {},
  view: (spec, ctx) => {
    const store = ctx.mixer.store;
    const target = toggleTarget(spec.function);
    const v = store.value(target);
    const on = typeof v === 'boolean' ? v : undefined;
    return {
      kind: 'toggle',
      function: spec.function,
      on,
      caption: toggleCaption(spec.function, store, on),
      pending: store.isPending(target),
      offline: !isOnline(store),
    };
  },
  gesture: (spec, g, ctx) => {
    const target = toggleTarget(spec.function);
    if (spec.function !== 'talkback') {
      if (g.type === 'tap') toggle(ctx, target);
      return;
    }
    const memo = ctx.memo as { latched?: boolean; swallowRelease?: boolean };
    switch (g.type) {
      case 'press':
        if (memo.latched === true) {
          memo.latched = false;
          memo.swallowRelease = true;
          if (!ctx.mixer.set(target, false)) ctx.alert();
        } else if (!ctx.mixer.set(target, true)) {
          ctx.alert();
        }
        return;
      case 'doubleTap':
        memo.latched = true;
        return;
      case 'release':
        if (memo.swallowRelease === true) memo.swallowRelease = false;
        else if (memo.latched !== true) ctx.mixer.set(target, false);
        return;
      default:
        return;
    }
  },
};

export function statusView(store: MixerStore, listenPort: number): StatusKey {
  const link = store.connection;
  const message =
    link === 'probing'
      ? `No reply on port ${String(listenPort)}`
      : link === 'stale'
        ? 'TotalMix stopped answering'
        : link === 'idle'
          ? 'Not connected'
          : undefined;
  return { kind: 'status', link, device: deviceModel(store), message };
}

const statusController: Controller<Extract<KeySpec, { type: 'status' }>> = {
  options: (_spec, ctx) => ({ longPressMs: ctx.settings.gestures.longPressMs }),
  view: (_spec, ctx) => statusView(ctx.mixer.store, ctx.settings.connection.listenPort),
  gesture: (_spec, g, ctx) => {
    // Tap will open the Control Center (M5); hold reads the whole mixer again.
    if (g.type !== 'longPress') return;
    if (isOnline(ctx.mixer.store)) {
      ctx.mixer.resync();
      ctx.ok();
    } else {
      ctx.alert();
    }
  },
};

// --- console navigation -------------------------------------------------------------------

const BANK_ROW: Readonly<Record<Bus, string>> = {
  input: 'INPUTS',
  playback: 'PLAYBACK',
  output: 'OUTPUTS',
};

const bankController: Controller<Extract<KeySpec, { type: 'bank' }>> = {
  options: (_spec, ctx) => ({ longPressMs: ctx.settings.gestures.longPressMs }),
  view: (spec, ctx) => {
    const b = ctx.nav.bank();
    const last = b ? Math.min(b.offset + b.size, b.total) : 0;
    return {
      kind: 'bank',
      direction: spec.direction,
      row: b ? BANK_ROW[b.bus] : '',
      first: b && b.total > 0 ? b.offset + 1 : 0,
      last,
      total: b?.total ?? 0,
      // The next press wraps around to the other end.
      atEnd: !b || (spec.direction === 'next' ? last >= b.total : b.offset === 0),
      offline: !b || !isOnline(ctx.mixer.store),
    };
  },
  gesture: (spec, g, ctx) => {
    if (!ctx.nav.bank()) {
      if (g.type === 'tap' || g.type === 'longPress') ctx.alert();
      return;
    }
    if (g.type === 'tap') ctx.nav.moveBank(spec.direction);
    else if (g.type === 'longPress') ctx.nav.nextBankBus();
  },
};

const pageController: Controller<Extract<KeySpec, { type: 'page' }>> = {
  options: (_spec, ctx) => ({ longPressMs: ctx.settings.gestures.longPressMs }),
  view: (spec, ctx) => {
    const { page, pages } = ctx.nav;
    const count = Math.max(1, pages.length);
    const to = (page + (spec.direction === 'next' ? 1 : count - 1)) % count;
    return {
      kind: 'page',
      direction: spec.direction,
      name: upper(pages[to] ?? ''),
      index: page + 1,
      count,
    };
  },
  gesture: (spec, g, ctx) => {
    const count = ctx.nav.pages.length;
    if (count === 0) return;
    if (g.type === 'tap') {
      ctx.nav.goToPage((ctx.nav.page + (spec.direction === 'next' ? 1 : count - 1)) % count);
    } else if (g.type === 'longPress') {
      ctx.nav.goToPage(0);
    }
  },
};

const consoleController: Controller<Extract<KeySpec, { type: 'console' }>> = {
  options: () => ({}),
  view: (_spec, ctx) => ({ kind: 'launcher', device: deviceModel(ctx.mixer.store) }),
  gesture: (_spec, g, ctx) => {
    if (g.type === 'tap' && !ctx.nav.openConsole()) ctx.alert();
  },
};

const emptyController: Controller<Extract<KeySpec, { type: 'empty' }>> = {
  options: () => ({}),
  view: () => undefined,
  gesture: () => undefined,
};

/** Controllers for every spec type but the overlay's (detail.ts); keys.ts has them all. */
export const CONTROLLERS: {
  readonly [T in Exclude<KeySpec['type'], 'detail'>]: Controller<Extract<KeySpec, { type: T }>>;
} = {
  empty: emptyController,
  channel: channelController,
  output: outputController,
  step: stepController,
  snapshot: snapshotController,
  toggle: toggleController,
  status: statusController,
  bank: bankController,
  page: pageController,
  console: consoleController,
  // A strip key is resolved into a channel key before it gets here (runtime.ts).
  strip: emptyController as unknown as Controller<Extract<KeySpec, { type: 'strip' }>>,
};
