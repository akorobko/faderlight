// Toggle keys for monitoring and global switches (docs/design/03-ux.md §2.3): Dim, Mono,
// Talkback, Speaker B, External input, Global Mute and Global Solo. Lit in the switch's
// colour when on, with a filled lamp; off shows an outlined lamp.

import type { KeyState } from '../parts.ts';
import type { Theme } from '../theme.ts';
import { caption, chrome, functionLook, lamp, title, word } from './function.ts';

export type ToggleFunction =
  'dim' | 'mono' | 'talkback' | 'speakerB' | 'external' | 'globalMute' | 'globalSolo';

export interface ToggleKey extends KeyState {
  readonly kind: 'toggle';
  readonly function: ToggleFunction;
  /** undefined = not known yet. */
  readonly on: boolean | undefined;
  /** Bottom line, e.g. "−20 dB" for Dim, "3 soloed" for Global Solo. */
  readonly caption?: string | undefined;
}

const LABELS: Readonly<Record<ToggleFunction, { readonly title: string; readonly word: string }>> =
  {
    dim: { title: 'MONITOR', word: 'DIM' },
    mono: { title: 'MONITOR', word: 'MONO' },
    talkback: { title: 'TALKBACK', word: 'TALK' },
    speakerB: { title: 'SPEAKERS', word: 'SPK B' },
    external: { title: 'MONITOR', word: 'EXT IN' },
    globalMute: { title: 'GLOBAL', word: 'MUTE' },
    globalSolo: { title: 'GLOBAL', word: 'SOLO' },
  };

function colorOf(theme: Theme, f: ToggleFunction): string {
  switch (f) {
    case 'dim':
      return theme.accent.dim;
    case 'globalMute':
      return theme.accent.mute;
    case 'globalSolo':
      return theme.accent.solo;
    default:
      return theme.accent.active;
  }
}

export function renderToggle(theme: Theme, k: ToggleKey): string {
  const color = colorOf(theme, k.function);
  const { look: l, frame } = functionLook(theme, { ...k, lit: k.on === true, color });
  const c = chrome(theme, l, frame, k);
  const label = LABELS[k.function];
  const bottom = k.offline === true ? 'OFFLINE' : (k.caption ?? (k.on === undefined ? '––' : ''));
  return (
    c.under +
    lamp(k.on, color, l, theme) +
    title(theme, label.title, l, 40) +
    word(theme, label.word, l, 86) +
    caption(theme, bottom, l, 120) +
    c.over
  );
}
