// Output keys (docs/design/03-ux.md §2.2): Main out, a Phones output, or any output. Laid out
// like a channel key: the output's name big with a colour underline, the volume, the role as
// the caption beside a speaker or headphone icon, a stereo meter, and for Main the monitor
// chips that are on (DIM, MONO, B, EXT, TB). Muted is a teal pad like an input. A role
// TotalMix has no output for says "Not assigned".

import { formatLevel, UNKNOWN } from '../format.ts';
import { meterPair, meterPairWidth, type MeterLevel } from '../meter.ts';
import {
  background,
  CANVAS,
  chipRow,
  look,
  stateFrames,
  type KeyState,
  type Placed,
} from '../parts.ts';
import { text } from '../text.ts';
import type { Theme } from '../theme.ts';
import {
  BADGES_Y,
  BAR,
  BAR_GAP,
  captionRow,
  chipStyle,
  METER_BOTTOM,
  METER_RIGHT,
  METER_TOP,
  MONO_BAR,
  NAME_Y,
  nameAndLabel,
  nameLine,
  overflowChip,
  stateChips,
  TEXT_X,
  valueRow,
  type ChannelColor,
} from './channel.ts';

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
  /** The role, shown as the caption; defaults to "MAIN", "PHONES" or "OUTPUT". */
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

export function renderOutput(theme: Theme, k: OutputKey): string {
  if (k.unassigned === true && k.offline !== true) return renderUnassigned(theme, k);
  const l = look(theme, k);
  // Outputs are usually pairs: without a reading yet, draw two empty bars.
  const stereo = k.meter === undefined || k.meter.right !== undefined;
  const mw = meterPairWidth(stereo, BAR, MONO_BAR, BAR_GAP);
  const meterX = METER_RIGHT - mw;
  const right = meterX - 6;
  const width = right - TEXT_X;
  const title = k.title ?? DEFAULT_TITLE[k.role];
  // The name, else the physical label; the role when neither is known.
  const [named] = nameAndLabel(k);
  const name = named !== '' ? named : title;
  let out = background(theme, l);

  out += nameLine(theme, k, l, name, {
    x: TEXT_X,
    y: NAME_Y,
    maxWidth: width,
  });
  out += valueRow(theme, l.offline ? UNKNOWN : formatLevel(k.volume), l, width);
  // The caption says what the output is for, unless the name already does.
  const caption = l.offline
    ? 'OFFLINE'
    : name.trim().toLowerCase() === title.toLowerCase()
      ? 'VOLUME'
      : title;
  out += captionRow(
    theme,
    k.role === 'phones' ? 'phones' : 'output',
    caption,
    stateChips(theme, k, l),
    l,
    right,
  );

  // Monitor chips (Main): only the switches that are on.
  if (!l.offline && k.monitor !== undefined) {
    const m = k.monitor;
    const active = (label: string): Placed => ({
      label,
      style: chipStyle(theme.accent.active, theme.accent.activeInk),
    });
    const items: Placed[] = [];
    if (m.dim === true)
      items.push({ label: 'DIM', style: chipStyle(theme.accent.dim, theme.accent.dimInk) });
    if (m.mono === true) items.push(active('MONO'));
    if (m.speakerB === true) items.push(active('B'));
    if (m.external === true) items.push(active('EXT'));
    if (m.talkback === true) items.push(active('TB'));
    out += chipRow(items, TEXT_X - 2, BADGES_Y, width + 2, 4, overflowChip(theme, l));
  }

  out += meterPair(theme, {
    box: { x: meterX, y: METER_TOP, w: mw, h: METER_BOTTOM - METER_TOP },
    left: k.meter?.left,
    right: k.meter?.right,
    stereo,
    barWidth: BAR,
    monoWidth: MONO_BAR,
    gap: BAR_GAP,
    background: l.background,
    dim: k.muted === true ? 0.5 : 0,
    off: l.offline,
  });
  return out + stateFrames(theme, k);
}

/** A role TotalMix has no output for: the role and "Not assigned", nothing to control. */
function renderUnassigned(theme: Theme, k: OutputKey): string {
  const l = look(theme, {});
  const title = k.title ?? DEFAULT_TITLE[k.role];
  let out = background(theme, l);
  out += nameLine(theme, {}, l, title, { x: TEXT_X, y: NAME_Y, maxWidth: CANVAS - 2 * TEXT_X });
  let y = 82;
  for (const line of ['Not', 'assigned']) {
    out += text(line, { face: 'semibold', size: theme.type.medium, x: TEXT_X, y, fill: l.subtext });
    y += 27;
  }
  return out;
}
