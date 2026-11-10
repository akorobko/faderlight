// Control keys of the Channel Detail overlay (docs/design/03-ux.md §3.1): one parameter of one
// channel each. Three shapes on the function-key layout:
// - a switch (48V, Ø, INST, AUTOSET, MUTE, SOLO, LOW CUT, EQ, DYN): a lamp on top, lit in its
//   colour when on;
// - a ± or ◀ ▶ key (gain, fader, send, pan, previous and next channel): an arrow with the
//   value under it, lit while held, the arrow dimmed at the limit;
// - a plain key (a send to select, FX send, Back, Clear clip): title, word and caption, lit
//   when selected.

import type { Direction } from '../icons.ts';
import { triangle } from '../icons.ts';
import type { KeyState } from '../parts.ts';
import type { Theme } from '../theme.ts';
import { CENTER, caption, chrome, functionLook, lamp, title, word } from './function.ts';

export type ControlColor = 'mute' | 'solo' | 'phantom' | 'active' | 'dim' | 'record';

export interface ControlKey extends KeyState {
  readonly kind: 'control';
  /** Small title on top, e.g. "GAIN", "→ PH 1". */
  readonly title: string;
  /** The big word or value, e.g. "48V", "+42 dB". */
  readonly word?: string | undefined;
  /** Bottom line, e.g. "80 Hz", "selected". */
  readonly caption?: string | undefined;
  /** A switch: its state (undefined: not known yet). Leave out for keys that are no switch. */
  readonly switch?: boolean | 'unknown' | undefined;
  /** An arrow above the word, for ± and ◀ ▶ keys. */
  readonly arrow?: Direction | undefined;
  /** Lit without being a switch: a selected send, a ± key held down. */
  readonly lit?: boolean | undefined;
  /** Colour when lit (default: the active colour). */
  readonly color?: ControlColor | undefined;
  /** An arrow key that cannot go further: the arrow dims. */
  readonly atLimit?: boolean | undefined;
}

function colorOf(theme: Theme, c: ControlColor | undefined): string {
  return theme.accent[c ?? 'active'];
}

export function renderControl(theme: Theme, k: ControlKey): string {
  const color = colorOf(theme, k.color);
  const on = k.switch === undefined ? undefined : k.switch === 'unknown' ? undefined : k.switch;
  const lit = k.lit === true || on === true;
  const { look: l, frame } = functionLook(theme, { ...k, lit, color });
  const c = chrome(theme, l, frame, k);
  const bottom = k.offline === true ? 'OFFLINE' : (k.caption ?? '');
  if (k.switch !== undefined) {
    return (
      c.under +
      lamp(on, color, l, theme) +
      title(theme, k.title.toUpperCase(), l, 40) +
      word(theme, k.word ?? '', l, 86) +
      caption(theme, bottom, l, 120) +
      c.over
    );
  }
  if (k.arrow !== undefined) {
    const arrow = k.atLimit === true || k.offline === true ? theme.line : l.text;
    const value = k.offline === true ? 'OFFLINE' : (k.word ?? '');
    return (
      c.under +
      title(theme, k.title.toUpperCase(), l, 28) +
      triangle(CENTER, 66, 38, k.arrow, arrow) +
      word(theme, value, l, 122, [theme.type.medium, theme.type.small]) +
      c.over
    );
  }
  return (
    c.under +
    title(theme, k.title.toUpperCase(), l, 30) +
    word(theme, k.word ?? '', l, 84) +
    caption(theme, bottom, l, 122) +
    c.over
  );
}
