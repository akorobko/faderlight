// Status key (docs/design/03-ux.md §2.3 and §6): the link to the mixer at a glance. A link
// dot and word on top (green live, amber connecting or syncing, red no reply, grey off), the
// device model large, then sample rate, clock and DSP load when the mixer reports them, or
// why the link is down.

import { mix } from '../color.ts';
import { formatRate } from '../format.ts';
import { circle } from '../svg.ts';
import { background, CANVAS, look, rule } from '../parts.ts';
import { balancedLines, fittedText, fitText, text } from '../text.ts';
import type { Theme } from '../theme.ts';

/** The connection states of the mixer client (packages/model ConnectionState). */
export type LinkState = 'idle' | 'probing' | 'syncing' | 'live' | 'stale';

export interface StatusKey {
  readonly kind: 'status';
  readonly link: LinkState;
  /** Device model without serial number, e.g. "Fireface UFX III". */
  readonly device?: string | undefined;
  /** Hz, when known (Global OSC does not report it yet). */
  readonly sampleRate?: number | undefined;
  readonly clock?: 'locked' | 'unlocked' | undefined;
  /** DSP load 0-1, when known. */
  readonly dsp?: number | undefined;
  /** Heartbeat: toggled on each reply while live, so the dot blinks. */
  readonly beat?: boolean | undefined;
  /** Why the link is down, e.g. "No reply on port 9002". */
  readonly message?: string | undefined;
}

const WORDS: Readonly<Record<LinkState, string>> = {
  idle: 'OFF',
  probing: 'CONNECTING',
  syncing: 'SYNCING',
  live: 'LIVE',
  stale: 'NO REPLY',
};

const X = 7;
const WIDTH = CANVAS - 2 * X;

export function renderStatus(theme: Theme, k: StatusKey): string {
  const down = k.link === 'idle' || k.link === 'stale';
  const l = down ? { ...look(theme, {}), subtext: theme.normal.subtext } : look(theme, {});
  const t = theme.type;
  const color =
    k.link === 'live'
      ? theme.link.live
      : k.link === 'stale'
        ? theme.link.lost
        : k.link === 'idle'
          ? theme.link.idle
          : theme.link.busy;
  let out = background(theme, l);

  // Link dot (a ring between heartbeats) and word, big enough to read from an angle.
  const dotFill = k.link === 'live' && k.beat === false ? mix(color, l.background, 0.6) : color;
  out += circle(X + 8, 21, 8, { fill: dotFill });
  out += fittedText(WORDS[k.link], {
    face: 'bold',
    sizes: [t.medium, t.small + 3, t.small],
    maxWidth: WIDTH - 22,
    minScaleX: 0.75,
    tracking: 0.4,
    x: X + 22,
    y: 29,
    fill: color,
  }).svg;

  // Device model, on up to two lines: large, or smaller when the mixer's figures follow.
  const extras =
    !down &&
    k.link !== 'probing' &&
    (k.sampleRate !== undefined || k.clock !== undefined || k.dsp !== undefined);
  const size = extras ? t.medium : t.medium + 8;
  const lineH = extras ? 23 : 32;
  const device = (k.device ?? '').trim();
  let y = extras ? 56 : 70;
  if (device !== '') {
    const lines = balancedLines(device, { face: 'bold', sizes: [size], maxWidth: WIDTH });
    for (const line of lines) {
      out += fittedText(line, {
        face: 'bold',
        sizes: [size, t.medium],
        maxWidth: WIDTH,
        minScaleX: 0.78,
        x: X,
        y,
        fill: down ? l.subtext : l.text,
      }).svg;
      y += lineH;
    }
  } else {
    out += text('No device', { face: 'bold', size, x: X, y, fill: l.subtext });
  }

  if (down || k.link === 'probing') {
    // Why the link is down, on up to two lines.
    const message =
      k.message ??
      (k.link === 'idle'
        ? 'Not connected'
        : k.link === 'stale'
          ? 'Mixer not answering'
          : 'Waiting for reply');
    const lines = balancedLines(message, { face: 'semibold', sizes: [t.small], maxWidth: WIDTH });
    let my = 136 - (lines.length - 1) * 18;
    for (const line of lines) {
      const fit = fitText(line, { face: 'semibold', sizes: [t.small], maxWidth: WIDTH });
      out += text(fit.text, {
        face: 'semibold',
        size: fit.size,
        scaleX: fit.scaleX,
        x: X,
        y: my,
        fill: down ? color : l.subtext,
      });
      my += 18;
    }
    return out;
  }

  // Sample rate, then clock and DSP on one line: each only when the mixer reports it.
  if (!extras) return out;
  out += rule(X, CANVAS - X, 92, theme.line);
  if (k.sampleRate !== undefined) {
    out += fittedText(formatRate(k.sampleRate), {
      face: 'bold',
      sizes: [t.medium],
      maxWidth: WIDTH,
      tabular: true,
      x: X,
      y: 116,
      fill: l.text,
    }).svg;
  }
  if (k.clock !== undefined) {
    const locked = k.clock === 'locked';
    out += text(locked ? 'LOCK' : 'NO LOCK', {
      face: 'bold',
      size: t.small,
      tracking: 0.4,
      x: X,
      y: 138,
      fill: locked ? theme.link.live : theme.link.lost,
    });
  }
  if (k.dsp !== undefined) {
    const pct = `DSP ${String(Math.round(Math.max(0, Math.min(1, k.dsp)) * 100))}%`;
    out += text(pct, {
      face: 'semibold',
      size: t.small,
      tabular: true,
      x: CANVAS - X,
      y: 138,
      anchor: 'end',
      fill: l.subtext,
    });
  }
  return out;
}
