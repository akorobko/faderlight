// Channel key (docs/design/03-ux.md §2.1): one input or playback channel. Three styles:
// - full: colour tab, label and name, a primary value, badges and a meter on the right edge.
// - meter: label and name over a big meter, peak readout below (for monitoring walls).
// - minimal: name and state only, in big text, with a signal dot.
// States: muted (teal key, M chip, dimmed meter), soloed (orange frame, S chip), pending
// (dashed frame), offline (grey, hatched, no values).

import { isHex } from '../color.ts';
import { formatGain, formatLevel, formatPeak, UNKNOWN } from '../format.ts';
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
import { dot } from '../icons.ts';
import { path, roundedRect } from '../svg.ts';
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
  /** Stereo pair (∞). */
  readonly stereo?: boolean | undefined;
}

export interface ChannelKey extends KeyState {
  readonly kind: 'channel';
  readonly style?: ChannelStyle | undefined;
  /** Physical label, e.g. "MIC 9", "AN 1/2". */
  readonly label: string;
  /** Name from the mixer or the user's alias; empty or equal to the label: label only. */
  readonly name?: string | undefined;
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

const TAB_TOP = 12;
const TAB_HEIGHT = 38;
const TEXT_X = 13;
const CHIP_H = 19;

export function channelColor(theme: Theme, c: ChannelColor | undefined): string | undefined {
  if (c === undefined) return undefined;
  if (typeof c === 'string') return isHex(c) ? c : undefined;
  if (c <= 0) return undefined;
  return theme.channelColors[c % theme.channelColors.length];
}

/** Name to show big, and the small label above it ('' when the name is the label). */
export function nameAndLabel(k: { label: string; name?: string | undefined }): [string, string] {
  const name = (k.name ?? '').trim();
  if (name === '' || name.toLowerCase() === k.label.trim().toLowerCase()) return [k.label, ''];
  return [name, k.label];
}

/** The channel colour as a tab on the left edge, next to label and name. */
export function colorTab(
  theme: Theme,
  k: { readonly color?: ChannelColor | undefined; readonly muted?: boolean | undefined },
  l: Look,
): string {
  const c = channelColor(theme, k.color);
  if (c === undefined) return '';
  const fill = l.offline
    ? theme.offline.subtext
    : dimmed(c, l.background, k.muted === true ? 0.45 : 0);
  return path(roundedRect({ x: 0, y: TAB_TOP, w: 6, h: TAB_HEIGHT }, [0, 3, 3, 0]), { fill });
}

function stateChips(theme: Theme, k: ChannelKey, l: Look): Placed[] {
  if (l.offline) return [];
  const chip = (fill: string, ink: string): ChipStyle => ({ fill, ink, size: 15, height: CHIP_H });
  const out: Placed[] = [];
  if (k.soloed === true)
    out.push({ label: 'S', style: chip(theme.accent.solo, theme.accent.soloInk) });
  if (k.muted === true)
    out.push({ label: 'M', style: chip(theme.accent.mute, theme.accent.muteInk) });
  return out;
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
    style: { fill: dimmed(fill, l.background, dim), ink, size: 15, height: CHIP_H },
  });
  const off = (label: string): Placed => ({
    label,
    style: { fill: theme.line, ink: l.subtext, outline: true, size: 15, height: CHIP_H },
  });
  const lit = (label: string) => on(label, l.text, l.background);
  const out: Placed[] = [];
  // 48V is always shown where the channel has it: phantom power is the one to never miss.
  if (b.phantom !== undefined) {
    out.push(b.phantom ? on('48V', theme.accent.phantom, theme.accent.phantomInk) : off('48V'));
  }
  if (b.phase === true) out.push(lit('Ø'));
  if (b.instrument === true) out.push(lit('INST'));
  if (b.autoSet === true) out.push(lit('AS'));
  if (b.stereo === true) out.push(lit('∞'));
  return out;
}

// --- full --------------------------------------------------------------------------------

const METER_TOP = 8;
const METER_BOTTOM = 136;
const METER_RIGHT = CANVAS - 7;
const BAR = 11;
const MONO_BAR = 16;
const BAR_GAP = 3;

function full(theme: Theme, k: ChannelKey, l: Look): string {
  const m = meterOf(k);
  const mw = meterPairWidth(m.stereo, BAR, MONO_BAR, BAR_GAP);
  const meterX = METER_RIGHT - mw;
  const right = meterX - 6;
  const width = right - TEXT_X;
  const [name, label] = nameAndLabel(k);
  const t = theme.type;
  let out = background(theme, l) + colorTab(theme, k, l);

  // Row 1: label, state chips on the right.
  const chips = stateChips(theme, k, l);
  const chipsW = chipsWidth(chips, 3);
  out += chipsRightAligned(chips, right, 8, 3);
  if (label !== '') {
    const fit = fitText(label, {
      face: 'semibold',
      sizes: [t.small],
      maxWidth: width - chipsW - 4,
      tracking: 0.4,
    });
    out += text(fit.text, {
      face: 'semibold',
      size: fit.size,
      tracking: 0.4,
      scaleX: fit.scaleX,
      x: TEXT_X,
      y: 23,
      fill: l.subtext,
    });
  }

  // Row 2: name.
  const nameMax = label === '' ? width - chipsW - 4 : width;
  const nameY = label === '' ? 28 : 49;
  out += fittedText(name, {
    face: 'semibold',
    sizes: [t.medium, t.small],
    maxWidth: nameMax,
    x: TEXT_X,
    y: nameY,
    fill: l.text,
    minScaleX: 0.78,
  }).svg;

  // Primary value with its unit, caption below.
  const value = valueText(k.value, l.offline);
  const unit = value === UNKNOWN ? '' : 'dB';
  const unitW = unit === '' ? 0 : measure(unit, { face: 'semibold', size: t.small }) + 3;
  const v = fitText(value, {
    face: 'bold',
    sizes: [t.large, t.medium],
    maxWidth: width - unitW,
    tabular: true,
    minScaleX: 0.75,
  });
  out += text(v.text, {
    face: 'bold',
    size: v.size,
    tabular: true,
    scaleX: v.scaleX,
    x: TEXT_X - 1,
    y: 90,
    fill: l.text,
  });
  if (unit !== '')
    out += text(unit, {
      face: 'semibold',
      size: t.small,
      x: TEXT_X - 1 + v.width + 3,
      y: 90,
      fill: l.subtext,
    });
  const caption = l.offline ? 'OFFLINE' : (k.value?.caption ?? '');
  if (caption !== '') {
    out += fittedText(caption.toUpperCase(), {
      face: 'semibold',
      sizes: [t.small],
      maxWidth: width,
      tracking: 0.6,
      x: TEXT_X,
      y: 110,
      fill: l.subtext,
    }).svg;
  }

  // Badges.
  const badges = badgeItems(theme, k.badges, l, k.muted === true);
  const overflow: ChipStyle = {
    fill: theme.line,
    ink: l.subtext,
    outline: true,
    size: 15,
    height: CHIP_H,
  };
  out += chipRow(badges, TEXT_X - 2, 117, width + 2, 3, overflow);

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
  const [name, label] = nameAndLabel(k);
  const t = theme.type;
  const right = CANVAS - 9;
  let out = background(theme, l) + colorTab(theme, k, l);
  const chips = stateChips(theme, k, l);
  const chipsW = chipsWidth(chips, 3);
  out += chipsRightAligned(chips, right, 8, 3);
  const width = right - TEXT_X;
  if (label !== '') {
    const fit = fitText(label, {
      face: 'semibold',
      sizes: [t.small],
      maxWidth: width - chipsW - 4,
      tracking: 0.4,
    });
    out += text(fit.text, {
      face: 'semibold',
      size: fit.size,
      tracking: 0.4,
      scaleX: fit.scaleX,
      x: TEXT_X,
      y: 23,
      fill: l.subtext,
    });
  }
  const nameY = label === '' ? 28 : 47;
  out += fittedText(name, {
    face: 'semibold',
    sizes: [t.medium, t.small],
    maxWidth: label === '' ? width - chipsW - 4 : width,
    x: TEXT_X,
    y: nameY,
    fill: l.text,
    minScaleX: 0.78,
  }).svg;

  const m = meterOf(k);
  const barW = m.stereo ? 30 : 44;
  const gap = 8;
  const total = m.stereo ? 2 * barW + gap : barW;
  const x0 = (CANVAS - total) / 2;
  const box = { y: 56, h: 60 };
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
    maxWidth: width,
    tabular: true,
    x: CANVAS / 2,
    y: 137,
    anchor: 'middle',
    fill: l.offline ? l.subtext : color,
  }).svg;
  return out + stateFrames(theme, k);
}

// --- minimal -----------------------------------------------------------------------------

function minimal(theme: Theme, k: ChannelKey, l: Look): string {
  const [name, label] = nameAndLabel(k);
  const t = theme.type;
  let out = background(theme, l) + colorTab(theme, k, l);
  const cx = CANVAS / 2;
  const width = CANVAS - 2 * 14;
  if (label !== '') {
    out += fittedText(label, {
      face: 'semibold',
      sizes: [t.small],
      maxWidth: width - 24,
      tracking: 0.4,
      x: cx,
      y: 32,
      anchor: 'middle',
      fill: l.subtext,
    }).svg;
  }
  out += fittedText(name, {
    face: 'bold',
    sizes: [t.large, t.medium],
    maxWidth: width,
    x: cx,
    y: 80,
    anchor: 'middle',
    fill: l.text,
    minScaleX: 0.75,
  }).svg;

  const chips = stateChips(theme, k, l).reverse();
  if (l.offline) {
    out += fittedText('OFFLINE', {
      face: 'semibold',
      sizes: [t.small],
      maxWidth: width,
      tracking: 0.6,
      x: cx,
      y: 114,
      anchor: 'middle',
      fill: l.subtext,
    }).svg;
  } else if (chips.length > 0) {
    const w = chipsWidth(chips, 4);
    out += chipRow(
      chips,
      cx - w / 2,
      98,
      width,
      4,
      chips[0]?.style ?? { fill: '', ink: '', size: 15, height: CHIP_H },
    );
  }

  // Signal dot: green when either side is above the signal threshold.
  if (!l.offline) {
    const levels = [k.meter?.left, k.meter?.right].filter((r): r is MeterLevel => r !== undefined);
    const signal = levels.some((r) => r.level > theme.meter.signalDb);
    const clip = levels.some((r) => r.clip);
    const fill = clip ? theme.meter.clip : signal ? theme.meter.green : theme.meter.clipOff;
    out += dot(CANVAS - 18, 18, 6, dimmed(fill, l.background, k.muted === true ? 0.4 : 0));
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
