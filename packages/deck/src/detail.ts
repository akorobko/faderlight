// The Channel Detail overlay (docs/design/03-ux.md §3.1): a long press on a channel key turns
// the whole Console into that channel's control surface. On a Console profile the slots show
// the overlay at once; from a key on another profile the deck switches to the Console profile
// first, and Back switches back. It closes after `detail.timeoutSec` without a press.
//
//  BACK    header  GAIN −  GAIN +  48V     Ø       INST    AUTOSET
//  MUTE    SOLO    FADER − FADER + meter   LOW CUT EQ      DYN
//  → out1  → out2  → out3  → out4  → out5  FX SEND PAN ◀   PAN ▶      (tap: send for the ± keys)
//  ◀ PREV  NEXT ▶  SEND −  SEND +  -       -       CLEAR   BACK
//
// The meter key shows the channel's physical label ("MIC 9"), which the channel keys leave out
// when the channel has a name. The fader keys set the channel's level into Main (an input's fader is its route into a
// submix); the send keys set the route into the selected submix, or the FX send. The five send
// keys are the first five visible outputs. Pan is the pan of the route into the selected
// submix. Keys for something the channel does not have (gain on a playback channel, 48V on a
// line input) are blank.

import {
  channelValue,
  deviceProfile,
  routeLevel,
  stripOf,
  strips,
  type Bus,
  type ChannelField,
  type MixerStore,
  type SourceBus,
  type Strip,
  type Target,
} from '@faderlight/model';
import { formatGain, formatLevel, type ControlKey, type KeyView } from '@faderlight/render';
import {
  channelView,
  isOnline,
  stepVolume,
  type Controller,
  type KeyContext,
  type SendTarget,
} from './controllers.ts';
import { stepSize, VOLUME_ACCELERATION, type Gesture, type GestureOptions } from './gestures.ts';
import type { DetailControl, DetailSpec, Direction, KeySpec } from './specs.ts';

const d = (control: DetailControl, n?: number): DetailSpec => ({ type: 'detail', control, n });

/** The overlay on an 8 x 4 deck, row by row. */
export const DETAIL_KEYS: readonly KeySpec[] = [
  ...(
    ['back', 'header', 'gainDown', 'gainUp', 'phantom', 'phase', 'instrument', 'autoSet'] as const
  ).map((c) => d(c)),
  ...(['mute', 'solo', 'faderDown', 'faderUp', 'meter', 'lowCut', 'eq', 'dynamics'] as const).map(
    (c) => d(c),
  ),
  ...[0, 1, 2, 3, 4].map((n) => d('send', n)),
  d('fxSend'),
  d('panLeft'),
  d('panRight'),
  ...(['prev', 'next', 'sendDown', 'sendUp', 'none', 'none', 'clearClip', 'back'] as const).map(
    (c) => d(c),
  ),
];

/** Pan of a route (−1 to 1) as TotalMix shows it: L100 ... C ... R100. */
export function formatPan(v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return '––';
  const p = Math.round(v * 100);
  if (p === 0) return 'C';
  return p < 0 ? `L${String(-p)}` : `R${String(p)}`;
}

/** The next preamp gain a ± key sets, within the device's range (and its gap above 0 dB). */
export function stepGain(
  db: number,
  direction: 'up' | 'down',
  range: {
    readonly min: number;
    readonly max: number;
    readonly step: number;
    readonly minAboveZero?: number;
  },
): number {
  const gap = range.minAboveZero;
  if (gap !== undefined) {
    if (direction === 'up' && db < gap) return gap;
    if (direction === 'down' && db <= gap) return range.min;
  }
  const next =
    Math.round((direction === 'up' ? db + range.step : db - range.step) / range.step) * range.step;
  return Math.min(range.max, Math.max(range.min, next));
}

// --- reading ------------------------------------------------------------------------------

interface Channel {
  readonly store: MixerStore;
  readonly strip: Strip;
  readonly bus: SourceBus;
  readonly main: number | undefined;
  readonly send: SendTarget | undefined;
}

function channelOf(ctx: KeyContext): Channel | undefined {
  const state = ctx.nav.detail();
  if (!state) return undefined;
  const store = ctx.mixer.store;
  const strip = stripOf(store, state.bus, state.index);
  if (!strip) return undefined;
  const mainOut = store.value({ scope: 'controlRoom', field: 'mainOut' });
  const main = typeof mainOut === 'number' && mainOut >= 0 ? mainOut : undefined;
  return { store, strip, bus: state.bus, main, send: state.send ?? main };
}

const target = (c: Channel, field: ChannelField, index = c.strip.index): Target => ({
  scope: 'channel',
  bus: c.bus,
  index,
  field,
});

const routeTarget = (c: Channel, output: number, field: 'fader' | 'balance' | 'solo'): Target => ({
  scope: 'route',
  source: c.bus,
  index: c.strip.index,
  output,
  field,
});

const physical = (c: Channel): number[] =>
  c.strip.right === undefined ? [c.strip.index] : [c.strip.index, c.strip.right];

function switchState(c: Channel, field: ChannelField): boolean | undefined {
  const v = channelValue(c.store, c.bus, c.strip.index, field);
  return typeof v === 'boolean' ? v : undefined;
}

function gainRange(c: Channel) {
  if (c.bus !== 'input') return undefined;
  const instrument = switchState(c, 'instrument') === true;
  return deviceProfile(c.store).inputGain(c.strip.index, { instrument });
}

function outputLabel(store: MixerStore, output: number | undefined): string {
  if (output === undefined) return '';
  return (
    stripOf(store, 'output', output)?.label ?? deviceProfile(store).label('output', output)
  ).toUpperCase();
}

/** The level the ± send keys change, and where it is written. */
function sendLevel(c: Channel): {
  db: number | undefined;
  target: Target | undefined;
  label: string;
} {
  if (c.send === 'fx') {
    const t = target(c, 'fxSend');
    const v = c.store.value(t);
    return { db: typeof v === 'number' ? v : undefined, target: t, label: 'FX' };
  }
  if (c.send === undefined) return { db: undefined, target: undefined, label: '' };
  return {
    db: routeLevel(c.store, c.bus, c.strip.index, c.send),
    target: routeTarget(c, c.send, 'fader'),
    label: outputLabel(c.store, c.send),
  };
}

// --- views --------------------------------------------------------------------------------

type Shown = Omit<ControlKey, 'kind'>;

function control(
  c: Channel,
  shown: Shown,
  pending: readonly (Target | undefined)[] = [],
): ControlKey {
  return {
    kind: 'control',
    ...shown,
    pending: pending.some((t) => t !== undefined && c.store.isPending(t)),
    offline: !isOnline(c.store),
  };
}

const SWITCHES: Partial<
  Record<
    DetailControl,
    { field: ChannelField; title: string; word: string; color?: ControlKey['color'] }
  >
> = {
  phantom: { field: 'phantom', title: 'Phantom', word: '48V', color: 'phantom' },
  phase: { field: 'phase', title: 'Phase', word: 'Ø' },
  instrument: { field: 'instrument', title: 'Input', word: 'INST' },
  autoSet: { field: 'autoSet', title: 'Autoset', word: 'AUTO' },
  mute: { field: 'mute', title: 'Channel', word: 'MUTE', color: 'mute' },
  eq: { field: 'eq.enable', title: 'EQ', word: 'EQ' },
  dynamics: { field: 'dynamics.enable', title: 'Dynamics', word: 'DYN' },
};

function detailView(spec: DetailSpec, ctx: KeyContext): KeyView | undefined {
  const c = channelOf(ctx);
  if (spec.control === 'back') {
    return { kind: 'control', title: 'Detail', arrow: 'left', word: 'BACK' };
  }
  if (!c) return undefined;
  const held = ctx.held;
  const sw = SWITCHES[spec.control];
  if (sw) {
    const on = switchState(c, sw.field);
    if (on === undefined) return undefined;
    return control(c, { title: sw.title, word: sw.word, switch: on, color: sw.color }, [
      target(c, sw.field),
    ]);
  }
  switch (spec.control) {
    case 'header':
      return channelView({ type: 'channel', bus: c.bus, index: c.strip.index, style: 'full' }, ctx);
    case 'meter': {
      // With the physical label: the channel keys and the header show only the name.
      const view = channelView(
        { type: 'channel', bus: c.bus, index: c.strip.index, style: 'meter' },
        ctx,
      );
      return view?.kind === 'channel' ? { ...view, name: undefined } : view;
    }
    case 'gainDown':
    case 'gainUp': {
      const range = gainRange(c);
      const gain = c.store.value(target(c, 'gain'));
      if (!range || typeof gain !== 'number') return undefined;
      const up = spec.control === 'gainUp';
      return control(
        c,
        {
          title: 'Gain',
          arrow: up ? 'up' : 'down',
          word: `${formatGain(gain)} dB`,
          lit: held,
          atLimit: up ? gain >= range.max : gain <= range.min,
        },
        [target(c, 'gain')],
      );
    }
    case 'solo': {
      if (c.main === undefined) return undefined;
      const t = routeTarget(c, c.main, 'solo');
      const v = c.store.value(t);
      return control(c, { title: 'Channel', word: 'SOLO', switch: v === true, color: 'solo' }, [t]);
    }
    case 'faderDown':
    case 'faderUp': {
      if (c.main === undefined) return undefined;
      const db = routeLevel(c.store, c.bus, c.strip.index, c.main);
      const up = spec.control === 'faderUp';
      return control(
        c,
        {
          title: 'Fader',
          arrow: up ? 'up' : 'down',
          word: formatLevel(db),
          lit: held,
          atLimit: db !== undefined && (up ? db >= 6 : db === -Infinity),
        },
        [routeTarget(c, c.main, 'fader')],
      );
    }
    case 'lowCut': {
      const on = switchState(c, 'lowCut.enable');
      if (on === undefined) return undefined;
      const hz = c.store.value(target(c, 'lowCut.freq'));
      return control(
        c,
        {
          title: 'Low cut',
          word: typeof hz === 'number' ? `${String(Math.round(hz))} Hz` : 'LOW CUT',
          switch: on,
        },
        [target(c, 'lowCut.enable')],
      );
    }
    case 'send': {
      const out = strips(c.store, 'output')[spec.n ?? 0];
      if (!out) return undefined;
      return control(
        c,
        {
          title: `→ ${out.label.toUpperCase()}`,
          word: formatLevel(routeLevel(c.store, c.bus, c.strip.index, out.index)),
          caption: out.name,
          lit: c.send === out.index,
        },
        [routeTarget(c, out.index, 'fader')],
      );
    }
    case 'fxSend': {
      const v = c.store.value(target(c, 'fxSend'));
      if (typeof v !== 'number') return undefined;
      return control(
        c,
        { title: 'FX send', word: formatLevel(v), caption: 'FX', lit: c.send === 'fx' },
        [target(c, 'fxSend')],
      );
    }
    case 'panLeft':
    case 'panRight': {
      if (c.send === undefined || c.send === 'fx') return undefined;
      const t = routeTarget(c, c.send, 'balance');
      const v = c.store.value(t);
      const pan = typeof v === 'number' ? v : 0;
      const left = spec.control === 'panLeft';
      return control(
        c,
        {
          title: `Pan ${outputLabel(c.store, c.send)}`,
          arrow: left ? 'left' : 'right',
          word: formatPan(pan),
          lit: held,
          atLimit: left ? pan <= -1 : pan >= 1,
        },
        [t],
      );
    }
    case 'prev':
    case 'next': {
      const to = neighbour(c.store, c.bus, c.strip.index, spec.control);
      return control(c, {
        title: 'Channel',
        arrow: spec.control === 'next' ? 'right' : 'left',
        word: to?.label.toUpperCase() ?? '',
      });
    }
    case 'sendDown':
    case 'sendUp': {
      const s = sendLevel(c);
      if (!s.target) return undefined;
      const up = spec.control === 'sendUp';
      return control(
        c,
        {
          title: `Send → ${s.label}`,
          arrow: up ? 'up' : 'down',
          word: formatLevel(s.db),
          lit: held,
          atLimit: s.db !== undefined && (up ? s.db >= 6 : s.db === -Infinity),
        },
        [s.target],
      );
    }
    case 'clearClip': {
      const clipped = physical(c).some((i) => c.store.meters.read(c.bus, i, ctx.now).clip);
      return control(c, {
        title: 'Meter',
        word: 'CLEAR',
        caption: clipped ? 'clipped' : 'clip & peak',
        lit: clipped,
        color: 'record',
      });
    }
    default:
      return undefined;
  }
}

// --- gestures -----------------------------------------------------------------------------

const REPEATING: ReadonlySet<DetailControl> = new Set([
  'gainDown',
  'gainUp',
  'faderDown',
  'faderUp',
  'sendDown',
  'sendUp',
  'panLeft',
  'panRight',
]);

function flip(ctx: KeyContext, c: Channel, targets: readonly Target[]): void {
  const first = targets[0];
  const v = first && c.store.value(first);
  if (typeof v !== 'boolean') {
    ctx.alert();
    return;
  }
  let ok = true;
  for (const t of targets) ok = ctx.mixer.set(t, !v) && ok;
  if (!ok) ctx.alert();
}

function stepLevel(
  ctx: KeyContext,
  t: Target | undefined,
  up: boolean,
  heldMs: number,
  first: boolean,
): void {
  const db = t && ctx.mixer.store.value(t);
  const from =
    typeof db === 'number'
      ? db
      : t?.scope === 'route' && ctx.mixer.store.synced
        ? -Infinity
        : undefined;
  if (!t || from === undefined) {
    if (first) ctx.alert();
    return;
  }
  const next = stepVolume(from, up ? 'up' : 'down', stepSize(heldMs, VOLUME_ACCELERATION));
  if (next !== from && !ctx.mixer.set(t, next) && first) ctx.alert();
}

function detailGesture(spec: DetailSpec, g: Gesture, ctx: KeyContext): void {
  if (spec.control === 'back') {
    if (g.type === 'tap') ctx.nav.closeDetail();
    return;
  }
  const c = channelOf(ctx);
  if (!c) return;
  if (g.type === 'repeat') {
    const first = g.count === 0;
    switch (spec.control) {
      case 'gainDown':
      case 'gainUp': {
        const range = gainRange(c);
        const gain = c.store.value(target(c, 'gain'));
        if (!range || typeof gain !== 'number') return;
        const next = stepGain(gain, spec.control === 'gainUp' ? 'up' : 'down', range);
        if (next === gain) return;
        // Per side: both channels of a stereo strip.
        let ok = true;
        for (const i of physical(c)) ok = ctx.mixer.set(target(c, 'gain', i), next) && ok;
        if (!ok && first) ctx.alert();
        return;
      }
      case 'faderDown':
      case 'faderUp':
        if (c.main !== undefined) {
          stepLevel(
            ctx,
            routeTarget(c, c.main, 'fader'),
            spec.control === 'faderUp',
            g.heldMs,
            first,
          );
        }
        return;
      case 'sendDown':
      case 'sendUp':
        stepLevel(ctx, sendLevel(c).target, spec.control === 'sendUp', g.heldMs, first);
        return;
      case 'panLeft':
      case 'panRight': {
        if (c.send === undefined || c.send === 'fx') return;
        const t = routeTarget(c, c.send, 'balance');
        const v = c.store.value(t);
        const pan = typeof v === 'number' ? v : 0;
        const next = Math.max(
          -1,
          Math.min(1, Math.round((pan + (spec.control === 'panRight' ? 0.05 : -0.05)) * 100) / 100),
        );
        if (next !== pan && !ctx.mixer.set(t, next) && first) ctx.alert();
        return;
      }
      default:
        return;
    }
  }
  if (g.type !== 'tap') return;
  const sw = SWITCHES[spec.control];
  if (sw) {
    // Per-side settings (phase, gain) go to both channels of a stereo strip.
    const sides = sw.field === 'phase' ? physical(c) : [c.strip.index];
    flip(
      ctx,
      c,
      sides.map((i) => target(c, sw.field, i)),
    );
    return;
  }
  switch (spec.control) {
    case 'solo':
      if (c.main === undefined) ctx.alert();
      else flip(ctx, c, [routeTarget(c, c.main, 'solo')]);
      return;
    case 'lowCut':
      flip(ctx, c, [target(c, 'lowCut.enable')]);
      return;
    case 'send': {
      const out = strips(c.store, 'output')[spec.n ?? 0];
      if (out) ctx.nav.selectSend(out.index);
      return;
    }
    case 'fxSend':
      ctx.nav.selectSend('fx');
      return;
    case 'prev':
    case 'next':
      ctx.nav.moveDetail(spec.control);
      return;
    case 'clearClip':
      for (const i of physical(c)) c.store.meters.clearHold(c.bus, i, ctx.now);
      ctx.ok();
      return;
    default:
      return;
  }
}

export const detailController: Controller<DetailSpec> = {
  options: (spec, ctx): GestureOptions =>
    REPEATING.has(spec.control)
      ? {
          repeat: {
            delayMs: ctx.settings.gestures.repeatDelayMs,
            intervalMs: ctx.settings.gestures.repeatIntervalMs,
          },
        }
      : {},
  view: detailView,
  gesture: detailGesture,
  // Clear Clip lights up when the channel clips.
  animated: (spec) => spec.control === 'clearClip',
};

/** The strip before or after one, wrapping around, among the visible strips of its bus. */
export function neighbour(
  store: MixerStore,
  bus: Bus,
  index: number,
  direction: Direction,
): Strip | undefined {
  const list = strips(store, bus);
  const i = list.findIndex((s) => s.index === index);
  if (list.length === 0) return undefined;
  if (i < 0) return list[0];
  return list[(i + (direction === 'next' ? 1 : list.length - 1)) % list.length];
}
