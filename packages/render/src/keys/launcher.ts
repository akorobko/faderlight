// Console launcher key: the Faderlight mark and the name of the interface it opens the Console
// for, e.g. "Fireface UFX III" on two lines. Before the mixer has answered it says "Console".

import { logo } from '../icons.ts';
import type { KeyState } from '../parts.ts';
import { balancedLines } from '../text.ts';
import type { Theme } from '../theme.ts';
import { CENTER, chrome, functionLook, WIDTH, word } from './function.ts';

export interface LauncherKey extends KeyState {
  readonly kind: 'launcher';
  /** Device model without serial number; left out until the mixer has answered. */
  readonly device?: string | undefined;
}

export function renderLauncher(theme: Theme, k: LauncherKey): string {
  const { look: l } = functionLook(theme, k);
  const c = chrome(theme, l, '', k);
  const off = l.offline;
  const mark = logo(CENTER, 38, 54, {
    track: theme.line,
    cap: off ? l.subtext : l.text,
    accent: off ? l.subtext : theme.accent.mute,
    meter: theme.meter.clipOff,
    green: off ? theme.line : theme.meter.green,
    yellow: off ? theme.line : theme.meter.yellowColor,
  });
  const name = (k.device ?? '').trim() || 'Console';
  const big = theme.type.medium + 4;
  const lines = balancedLines(name, { face: 'bold', sizes: [big], maxWidth: WIDTH });
  const text =
    lines.length < 2
      ? word(theme, name, l, 112, [big, theme.type.medium])
      : word(theme, lines[0] ?? '', l, 100, [big]) + word(theme, lines[1] ?? '', l, 128, [big]);
  return c.under + mark + text + c.over;
}
