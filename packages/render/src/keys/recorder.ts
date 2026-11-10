// Recorder key (docs/design/03-ux.md §2.3, the interface's built-in USB recorder): transport
// state as a symbol and word, elapsed time below. Recording lights the key red. Starting a
// recording needs a confirming second tap; while armed the key says so.

import { formatTime } from '../format.ts';
import { pauseBars, playTriangle, recordDot, stopSquare } from '../icons.ts';
import { frame, type KeyState } from '../parts.ts';
import { text } from '../text.ts';
import type { Theme } from '../theme.ts';
import { caption, CENTER, chrome, functionLook, litLook, word } from './function.ts';

export type RecorderState = 'notReady' | 'stopped' | 'recording' | 'playing' | 'paused';

export interface RecorderKey extends KeyState {
  readonly kind: 'recorder';
  /** undefined = not known yet. */
  readonly state: RecorderState | undefined;
  /** Elapsed seconds of the current recording or playback. */
  readonly time?: number | undefined;
  /** Recording is armed: the next tap within the timeout starts it. */
  readonly confirmRecord?: boolean | undefined;
}

const WORDS: Readonly<Record<RecorderState, string>> = {
  notReady: 'NOT READY',
  stopped: 'STOP',
  recording: 'REC',
  playing: 'PLAY',
  paused: 'PAUSE',
};

export function renderRecorder(theme: Theme, k: RecorderKey): string {
  const head = (fill: string) =>
    text('DUREC', { face: 'semibold', size: theme.type.small, tracking: 0.6, x: 14, y: 24, fill });
  if (k.confirmRecord === true && k.offline !== true) {
    const l = litLook(theme, theme.accent.confirm);
    const c = chrome(theme, l, frame(theme.accent.record, 4), k);
    return (
      c.under +
      head(l.subtext) +
      recordDot(CENTER, 58, 30, theme.accent.record) +
      word(theme, 'REC?', l, 106) +
      caption(theme, 'tap again to record', l, 130, l.text) +
      c.over
    );
  }

  const recording = k.state === 'recording';
  const { look: l, frame: litFrame } = functionLook(theme, {
    ...k,
    lit: recording,
    color: theme.accent.record,
  });
  const c = chrome(theme, l, litFrame, k);
  let out = c.under + head(l.subtext);

  const offline = k.offline === true;
  const symbolColor = offline
    ? l.subtext
    : k.state === 'recording'
      ? theme.accent.record
      : k.state === 'playing'
        ? theme.accent.play
        : k.state === 'notReady' || k.state === undefined
          ? theme.line
          : l.text;
  const cy = 58;
  switch (k.state) {
    case 'recording':
      out += recordDot(CENTER, cy, 30, symbolColor);
      break;
    case 'playing':
      out += playTriangle(CENTER, cy, 32, symbolColor);
      break;
    case 'paused':
      out += pauseBars(CENTER, cy, 28, symbolColor);
      break;
    default:
      out += stopSquare(CENTER, cy, 28, symbolColor);
  }

  const state = offline ? 'OFFLINE' : k.state === undefined ? '––' : WORDS[k.state];
  const small = offline || k.state === 'notReady' || k.state === undefined;
  out += small ? caption(theme, state, l, 108) : word(theme, state, l, 108, [theme.type.medium]);
  const showTime = !offline && k.state !== 'notReady' && k.state !== undefined;
  if (showTime) {
    out += text(formatTime(k.time ?? 0), {
      face: 'bold',
      size: theme.type.small,
      tabular: true,
      x: CENTER,
      y: 132,
      anchor: 'middle',
      fill: l.subtext,
    });
  }
  return out + c.over;
}
