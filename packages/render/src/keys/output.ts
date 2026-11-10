// Output keys (docs/design/03-ux.md §2.2): Main out, a Phones output, or any output. A big
// volume in dB, the output's name, a stereo meter, and for Main the monitor chips that are
// on (DIM, MONO, SPK B, EXT, TB). Muted is teal like an input. A role TotalMix has no output
// for says "Not assigned".

import { formatLevel, UNKNOWN } from '../format.ts';
import { headphones } from '../icons.ts';
import { meterPair, meterPairWidth, type MeterLevel } from '../meter.ts';
import {
  background,
  CANVAS,
  chipRow,
  chipsRightAligned,
  chipsWidth,
  look,
  stateFrames,
  type ChipStyle,
  type KeyState,
  type Placed,
} from '../parts.ts';
import { fittedText, fitText, measure, text } from '../text.ts';
import type { Theme } from '../theme.ts';
import { colorBand, nameAndLabel, type ChannelColor } from './channel.ts';

export type OutputRole = 'main' | 'phones' | 'output';

/** Control-room switches shown on the Main key (only the ones that are on). */
export interface MonitorChips {
  readonly dim?: boolean | undefined;
  readonly mono?: boolean | undefined;
  readonly speakerB?: boolean | undefined;
  readonly external?: boolean | undefined;
  readonly talkback?: boolean | undefined;
}

export interface OutputKey extends KeyState {
  readonly kind: 'output';
  readonly role: OutputRole;
  /** Top line; defaults to "MAIN", "PHONES" or "OUTPUT". */
  readonly title?: string | undefined;
  /** Physical label of the output, e.g. "AN 1/2", "PH 9/10". */
  readonly label: string;
  /** The output's name or alias. */
  readonly name?: string | undefined;
  readonly color?: ChannelColor | undefined;
  /** Volume in dB, −Infinity = off, undefined = not known yet. */
  readonly volume: number | undefined;
  readonly meter?:
    { readonly left: MeterLevel; readonly right?: MeterLevel | undefined } | undefined;
  readonly muted?: boolean | undefined;
  readonly monitor?: MonitorChips | undefined;
  /** TotalMix has no output in this role (Phones 2 not set up): says so, no hatching. */
  readonly unassigned?: boolean | undefined;
}

const DEFAULT_TITLE: Readonly<Record<OutputRole, string>> = {
  main: 'MAIN',
  phones: 'PHONES',
  output: 'OUTPUT',
};

const TEXT_X = 7;
const CHIP_H = 19;

export function renderOutput(theme: Theme, k: OutputKey): string {
  if (k.unassigned === true && k.offline !== true) return renderUnassigned(theme, k);
  const l = look(theme, k);
  const t = theme.type;
  // Outputs are usually pairs: without a reading yet, draw two empty bars.
  const stereo = k.meter === undefined || k.meter.right !== undefined;
  const mw = meterPairWidth(stereo, 11, 16, 3);
  const meterX = CANVAS - 7 - mw;
  const right = meterX - 6;
  const width = right - TEXT_X;
  const band = colorBand(theme, k, l, 57);
  let out = background(theme, l) + band.svg;

  // Row 1: title (with a headphone glyph for Phones), M chip on the right.
  const chips: Placed[] =
    k.muted === true && !l.offline
      ? [
          {
            label: 'M',
            style: { fill: theme.accent.mute, ink: theme.accent.muteInk, size: 15, height: CHIP_H },
          },
        ]
      : [];
  out += chipsRightAligned(chips, right, 8, 3);
  out += titleRow(theme, k, band.subtext, right - chipsWidth(chips, 3) - 4);

  // Row 2: the output's name (or its label).
  const [name, label] = nameAndLabel(k);
  out += fittedText(name, {
    face: 'semibold',
    sizes: [t.medium, t.small],
    maxWidth: width,
    minScaleX: 0.78,
    x: TEXT_X,
    y: 49,
    fill: band.text,
  }).svg;

  // Volume.
  const value = l.offline ? UNKNOWN : formatLevel(k.volume);
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

  // Caption: the physical label when a name took the second row.
  const caption = l.offline ? 'OFFLINE' : label;
  if (caption !== '') {
    out += fittedText(caption, {
      face: 'semibold',
      sizes: [t.small],
      maxWidth: width,
      tracking: 0.6,
      x: TEXT_X,
      y: 110,
      fill: l.subtext,
    }).svg;
  }

  // Monitor chips (Main): only the switches that are on.
  if (!l.offline && k.monitor !== undefined) {
    const m = k.monitor;
    const lit = (label: string, fill: string, ink: string): Placed => ({
      label,
      style: { fill, ink, size: 15, height: CHIP_H },
    });
    const items: Placed[] = [];
    if (m.dim === true) items.push(lit('DIM', theme.accent.dim, theme.accent.dimInk));
    if (m.mono === true) items.push(lit('MONO', theme.accent.active, theme.accent.activeInk));
    if (m.speakerB === true) items.push(lit('B', theme.accent.active, theme.accent.activeInk));
    if (m.external === true) items.push(lit('EXT', theme.accent.active, theme.accent.activeInk));
    if (m.talkback === true) items.push(lit('TB', theme.accent.active, theme.accent.activeInk));
    const overflow: ChipStyle = {
      fill: theme.line,
      ink: l.subtext,
      outline: true,
      size: 15,
      height: CHIP_H,
    };
    out += chipRow(items, TEXT_X - 2, 117, width + 2, 3, overflow);
  }

  out += meterPair(theme, {
    box: { x: meterX, y: 8, w: mw, h: 128 },
    left: k.meter?.left,
    right: k.meter?.right,
    stereo,
    barWidth: 11,
    monoWidth: 16,
    gap: 3,
    background: l.background,
    dim: k.muted === true ? 0.5 : 0,
    off: l.offline,
  });
  return out + stateFrames(theme, k);
}

/** The title, after a headphone glyph for Phones. */
function titleRow(theme: Theme, k: OutputKey, fill: string, right: number): string {
  let out = '';
  let x = TEXT_X;
  if (k.role === 'phones') {
    out += headphones(TEXT_X + 8, 17, 17, fill);
    x += 21;
  }
  const tf = fitText(k.title ?? DEFAULT_TITLE[k.role], {
    face: 'semibold',
    sizes: [theme.type.small],
    maxWidth: right - x,
    tracking: 0.5,
    minScaleX: 0.72,
  });
  return (
    out +
    text(tf.text, {
      face: 'semibold',
      size: tf.size,
      tracking: 0.5,
      scaleX: tf.scaleX,
      x,
      y: 23,
      fill,
    })
  );
}

/** A role TotalMix has no output for: the title and "Not assigned", nothing to control. */
function renderUnassigned(theme: Theme, k: OutputKey): string {
  const l = look(theme, {});
  let out = background(theme, l) + titleRow(theme, k, l.subtext, CANVAS - TEXT_X);
  let y = 76;
  for (const line of ['Not', 'assigned']) {
    out += text(line, { face: 'semibold', size: theme.type.medium, x: TEXT_X, y, fill: l.subtext });
    y += 26;
  }
  return out;
}
