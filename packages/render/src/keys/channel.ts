// Channel key (docs/design/03-ux.md §2.1): one input or playback channel. Three styles:
// - full: the name big, underlined in the channel colour, the primary value, a type icon and
//   caption, badges, and a meter on the right.
// - meter: the name over a big meter, peak readout below (for monitoring walls).
// - minimal: the name and state only, in big text, with a signal dot.
// The name is one line: the channel's own name, or its physical label when it has none
// (Channel Detail shows the label). States: muted (teal pad, M chip, dimmed meter), soloed
// (orange pad, S chip), pending (dashed frame), offline (grey, hatched, no values).

import { isHex } from '../color.ts';
import { formatGain, formatLevel, formatPeak, UNKNOWN } from '../format.ts';
import { dot, sourceIcon, type SourceIcon } from '../icons.ts';
import { meterBar, meterPair, meterPairWidth, type MeterLevel } from '../meter.ts';
import {
  background,
  CANVAS,
  chipRow,
  chipsRightAligned,
  chipsWidth,
  dimmed,
  look,
  stateFrames,
  type ChipStyle,
  type KeyState,
  type Look,
  type Placed,
} from '../parts.ts';
import { path, roundRect } from '../svg.ts';
import { fittedText, fitText, measure, text } from '../text.ts';
import type { Theme } from '../theme.ts';

export type ChannelStyle = 'full' | 'meter' | 'minimal';

/** A channel's colour: the mixer's colour number, or a colour of the user's own. */
export type ChannelColor = number | `#${string}`;

export interface ChannelValue {
  /** gain: preamp gain (always finite). level: fader or send, −Infinity = off. */
  readonly kind: 'gain' | 'level';
  /** dB; undefined = not known yet. */
  readonly db: number | undefined;
  /** What the value is, e.g. "GAIN", "FADER", "→ PH 1". */
  readonly caption: string;
}

/**
 * Switches shown as badges. A missing key means the channel does not have that switch (only
 * mic inputs have 48V, Inst and AutoSet); a present key is lit when true.
 */
export interface ChannelBadges {
  readonly phantom?: boolean | undefined;
  readonly phase?: boolean | undefined;
  readonly instrument?: boolean | undefined;
  readonly autoSet?: boolean | undefined;
  /** Stereo pair: no badge, the meter shows two bars. */
  readonly stereo?: boolean | undefined;
}

export interface ChannelKey extends KeyState {
  readonly kind: 'channel';
  readonly style?: ChannelStyle | undefined;
  /** Physical label, e.g. "MIC 9", "AN 1/2": shown when the channel has no name. */
  readonly label: string;
  /** Name from the mixer or the user's alias; empty or equal to the label: the label. */
  readonly name?: string | undefined;
  /** A hardware input or a software playback, for the type icon; undefined: no icon. */
  readonly source?: 'input' | 'playback' | undefined;
  readonly color?: ChannelColor | undefined;
  readonly value?: ChannelValue | undefined;
  /** Left (or mono) and right meter. */
  readonly meter?:
    { readonly left: MeterLevel; readonly right?: MeterLevel | undefined } | undefined;
  readonly badges?: ChannelBadges | undefined;
  readonly muted?: boolean | undefined;
  readonly soloed?: boolean | undefined;
}

// --- shared ------------------------------------------------------------------------------

export const TEXT_X = 7;
/** Badges and the M and S chips: big enough to read at a glance. */
export const CHIP_H = 25;
export const CHIP_SIZE = 18;

/** Meters reach 1 px into the margin: bars bend less than text does. */
export const METER_RIGHT = CANVAS + 1;
export const METER_TOP = 4;
export const METER_BOTTOM = 140;
export const BAR = 11;
export const MONO_BAR = 16;
export const BAR_GAP = 3;

/** Baselines of the full style's rows, shared with the output keys. */
export const NAME_Y = 31;
export const VALUE_Y = 74;
/** Centre of the row with the type icon, the caption and the M and S chips. */
export const CAPTION_CY = 91;
export const BADGES_Y = 111;

export function channelColor(theme: Theme, c: ChannelColor | undefined): string | undefined {
  if (c === undefined) return undefined;
  if (typeof c === 'string') return isHex(c) ? c : undefined;
  return theme.channelColors[c];
}

/** Name to show big, and the physical label ('' when the name is the label). */
export function nameAndLabel(k: { label: string; name?: string | undefined }): [string, string] {
  const name = (k.name ?? '').trim();
  if (name === '' || name.toLowerCase() === k.label.trim().toLowerCase()) return [k.label, ''];
  return [name, k.label];
}

/**
 * The name, big, on one line, with the channel colour as an underline below it (as wide as
 * the name). No colour, or offline: no underline.
 */
export function nameLine(
  theme: Theme,
  k: { readonly color?: ChannelColor | undefined; readonly muted?: boolean | undefined },
  l: Look,
  name: string,
  o: {
    readonly x: number;
    readonly y: number;
    readonly maxWidth: number;
    readonly anchor?: 'start' | 'middle' | undefined;
    readonly sizes?: readonly number[] | undefined;
  },
): string {
  const t = theme.type;
  const f = fittedText(name, {
    face: 'bold',
    sizes: o.sizes ?? [t.medium + 8, t.medium + 4, t.medium],
    maxWidth: o.maxWidth,
    minScaleX: 0.8,
    x: o.x,
    y: o.y,
    anchor: o.anchor,
    fill: l.text,
  });
  const c = channelColor(theme, k.color);
  if (c === undefined || l.offline) return f.svg;
  const w = Math.max(26, f.fit.width);
  const x = o.anchor === 'middle' ? o.x - w / 2 : o.x;
  const fill = dimmed(c, l.background, k.muted === true ? 0.45 : 0);
  return f.svg + path(roundRect({ x, y: o.y + 7, w, h: 5 }, 2.5), { fill });
}

/** A chip style at the badge size. */
export function chipStyle(fill: string, ink: string, outline = false): ChipStyle {
  return { fill, ink, outline: outline || undefined, size: CHIP_SIZE, height: CHIP_H };
}

/** The M and S chips, solo first. */
export function stateChips(
  theme: Theme,
  k: { readonly muted?: boolean | undefined; readonly soloed?: boolean | undefined },
  l: Look,
): Placed[] {
  if (l.offline) return [];
  const out: Placed[] = [];
  if (k.soloed === true)
    out.push({ label: 'S', style: chipStyle(theme.accent.solo, theme.accent.soloInk) });
  if (k.muted === true)
    out.push({ label: 'M', style: chipStyle(theme.accent.mute, theme.accent.muteInk) });
  return out;
}

/** A value in dB, big, with its unit after it. */
export function valueRow(theme: Theme, value: string, l: Look, maxWidth: number): string {
  const t = theme.type;
  const unit = value === UNKNOWN ? '' : 'dB';
  const unitW = unit === '' ? 0 : measure(unit, { face: 'semibold', size: t.small }) + 3;
  const v = fitText(value, {
    face: 'bold',
    sizes: [t.medium + 4, t.medium],
    maxWidth: maxWidth - unitW,
    tabular: true,
    minScaleX: 0.75,
  });
  let out = text(v.text, {
    face: 'bold',
    size: v.size,
    tabular: true,
    scaleX: v.scaleX,
    x: TEXT_X - 1,
    y: VALUE_Y,
    fill: l.text,
  });
  if (unit !== '')
    out += text(unit, {
      face: 'semibold',
      size: t.small,
      x: TEXT_X - 1 + v.width + 3,
      y: VALUE_Y,
      fill: l.subtext,
    });
  return out;
}

/** The type icon and the caption, with the M and S chips on the right. */
export function captionRow(
  theme: Theme,
  icon: SourceIcon | undefined,
  caption: string,
  chips: readonly Placed[],
  l: Look,
  right: number,
): string {
  let out = chipsRightAligned(chips, right, CAPTION_CY - CHIP_H / 2, 4);
  let x = TEXT_X;
  if (icon !== undefined && !l.offline) {
    out += sourceIcon(icon, x, CAPTION_CY, l.subtext);
    x += 22;
  }
  if (caption !== '') {
    const chipsW = chipsWidth(chips, 4);
    out += fittedText(caption.toUpperCase(), {
      face: 'semibold',
      sizes: [theme.type.small],
      maxWidth: right - x - (chipsW > 0 ? chipsW + 4 : 0),
      tracking: 0.6,
      x,
      y: CAPTION_CY + 5.5,
      fill: l.subtext,
    }).svg;
  }
  return out;
}

/** The overflow chip at the end of a badge row that does not fit. */
export function overflowChip(theme: Theme, l: Look): ChipStyle {
  return chipStyle(theme.line, l.subtext, true);
}

function meterOf(k: ChannelKey): {
  left: MeterLevel | undefined;
  right: MeterLevel | undefined;
  stereo: boolean;
} {
  const stereo = k.meter?.right !== undefined || k.badges?.stereo === true;
  return { left: k.meter?.left, right: k.meter?.right, stereo };
}

/** Dims a muted channel's meter; offline draws a grey track. */
function meterLook(k: ChannelKey, l: Look) {
  return { background: l.background, dim: k.muted === true ? 0.5 : 0, off: l.offline };
}

function valueText(v: ChannelValue | undefined, offline: boolean): string {
  if (offline || v === undefined) return UNKNOWN;
  return v.kind === 'gain' ? formatGain(v.db) : formatLevel(v.db);
}

function badgeItems(theme: Theme, b: ChannelBadges | undefined, l: Look, muted: boolean): Placed[] {
  if (b === undefined || l.offline) return [];
  const dim = muted ? 0.4 : 0;
  const on = (label: string, fill: string, ink: string): Placed => ({
    label,
    style: chipStyle(dimmed(fill, l.background, dim), ink),
  });
  const off = (label: string): Placed => ({
    label,
    style: chipStyle(theme.line, l.subtext, true),
  });
  const lit = (label: string) => on(label, l.text, l.background);
  const out: Placed[] = [];
  // 48V is always shown where the channel has it: phantom power is the one to never miss.
  if (b.phantom !== undefined) {
    out.push(b.phantom ? on('48V', theme.accent.phantom, theme.accent.phantomInk) : off('48V'));
  }
  if (b.instrument === true) out.push(lit('INST'));
  if (b.phase === true) out.push(lit('Ø'));
  if (b.autoSet === true) out.push(lit('AS'));
  return out;
}

// --- full --------------------------------------------------------------------------------

function full(theme: Theme, k: ChannelKey, l: Look): string {
  const m = meterOf(k);
  const mw = meterPairWidth(m.stereo, BAR, MONO_BAR, BAR_GAP);
  const meterX = METER_RIGHT - mw;
  const right = meterX - 6;
  const width = right - TEXT_X;
  const [name] = nameAndLabel(k);
  let out = background(theme, l);

  out += nameLine(theme, k, l, name, { x: TEXT_X, y: NAME_Y, maxWidth: width });
  out += valueRow(theme, valueText(k.value, l.offline), l, width);
  const caption = l.offline ? 'OFFLINE' : (k.value?.caption ?? '');
  out += captionRow(theme, k.source, caption, stateChips(theme, k, l), l, right);

  const badges = badgeItems(theme, k.badges, l, k.muted === true);
  out += chipRow(badges, TEXT_X - 2, BADGES_Y, width + 2, 4, overflowChip(theme, l));

  out += meterPair(theme, {
    box: { x: meterX, y: METER_TOP, w: mw, h: METER_BOTTOM - METER_TOP },
    left: m.left,
    right: m.right,
    stereo: m.stereo,
    barWidth: BAR,
    monoWidth: MONO_BAR,
    gap: BAR_GAP,
    ...meterLook(k, l),
  });
  return out + stateFrames(theme, k);
}

// --- meter -------------------------------------------------------------------------------

function meterStyle(theme: Theme, k: ChannelKey, l: Look): string {
  const [name] = nameAndLabel(k);
  const t = theme.type;
  const right = CANVAS - TEXT_X;
  let out = background(theme, l);
  const chips = stateChips(theme, k, l);
  const chipsW = chipsWidth(chips, 4);
  out += chipsRightAligned(chips, right, 9, 4);
  out += nameLine(theme, k, l, name, {
    x: TEXT_X,
    y: NAME_Y,
    maxWidth: right - TEXT_X - (chipsW > 0 ? chipsW + 4 : 0),
  });

  const m = meterOf(k);
  const barW = m.stereo ? 30 : 44;
  const gap = 8;
  const total = m.stereo ? 2 * barW + gap : barW;
  const x0 = (CANVAS - total) / 2;
  const box = { y: 52, h: 64 };
  const ml = meterLook(k, l);
  out += meterBar(theme, { box: { x: x0, w: barW, ...box }, reading: m.left, capHeight: 6, ...ml });
  if (m.stereo)
    out += meterBar(theme, {
      box: { x: x0 + barW + gap, w: barW, ...box },
      reading: m.right,
      capHeight: 6,
      ...ml,
    });

  // Peak readout: the higher side's held peak.
  const peaks = [m.left, m.right].filter((r): r is MeterLevel => r !== undefined);
  const peak = l.offline || peaks.length === 0 ? undefined : Math.max(...peaks.map((r) => r.peak));
  const clip = !l.offline && peaks.some((r) => r.clip);
  const readout = l.offline
    ? 'OFFLINE'
    : peak === undefined
      ? UNKNOWN
      : formatPeak(peak, theme.meter.floorDb);
  const color = clip ? dimmed(theme.meter.clip, l.background, k.muted === true ? 0.3 : 0) : l.text;
  out += fittedText(readout, {
    face: 'bold',
    sizes: [t.medium],
    maxWidth: right - TEXT_X,
    tabular: true,
    x: CANVAS / 2,
    y: 138,
    anchor: 'middle',
    fill: l.offline ? l.subtext : color,
  }).svg;
  return out + stateFrames(theme, k);
}

// --- minimal -----------------------------------------------------------------------------

function minimal(theme: Theme, k: ChannelKey, l: Look): string {
  const [name] = nameAndLabel(k);
  const t = theme.type;
  let out = background(theme, l);
  const cx = CANVAS / 2;
  const width = CANVAS - 2 * TEXT_X;
  out += nameLine(theme, k, l, name, {
    x: cx,
    y: 72,
    maxWidth: width,
    anchor: 'middle',
    sizes: [t.large, t.medium + 4],
  });

  const chips = stateChips(theme, k, l).reverse();
  if (l.offline) {
    out += fittedText('OFFLINE', {
      face: 'semibold',
      sizes: [t.small],
      maxWidth: width,
      tracking: 0.6,
      x: cx,
      y: 116,
      anchor: 'middle',
      fill: l.subtext,
    }).svg;
  } else if (chips.length > 0) {
    const w = chipsWidth(chips, 4);
    out += chipRow(chips, cx - w / 2, 98, width, 4, overflowChip(theme, l));
  }

  // Signal dot: green when either side is above the signal threshold.
  if (!l.offline) {
    const levels = [k.meter?.left, k.meter?.right].filter((r): r is MeterLevel => r !== undefined);
    const signal = levels.some((r) => r.level > theme.meter.signalDb);
    const clip = levels.some((r) => r.clip);
    const fill = clip ? theme.meter.clip : signal ? theme.meter.green : theme.meter.clipOff;
    out += dot(CANVAS - 14, 14, 7, dimmed(fill, l.background, k.muted === true ? 0.4 : 0));
  }
  return out + stateFrames(theme, k);
}

export function renderChannel(theme: Theme, k: ChannelKey): string {
  const l = look(theme, k);
  switch (k.style ?? 'full') {
    case 'full':
      return full(theme, k, l);
    case 'meter':
      return meterStyle(theme, k, l);
    case 'minimal':
      return minimal(theme, k, l);
  }
}
