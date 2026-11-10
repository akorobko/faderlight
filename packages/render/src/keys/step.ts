// Volume step keys (docs/design/03-ux.md §2.2): ▲ or ▼ with the target's name and current
// level. Lit while held (the key repeats with acceleration); the arrow dims at the limit.

import { formatLevel } from '../format.ts';
import { triangle } from '../icons.ts';
import type { KeyState } from '../parts.ts';
import type { Theme } from '../theme.ts';
import { CENTER, chrome, functionLook, title, word } from './function.ts';

export interface StepKey extends KeyState {
  readonly kind: 'step';
  readonly direction: 'up' | 'down';
  /** What it changes, e.g. "MAIN", "PHONES 1". */
  readonly target: string;
  /** The target's level in dB now. */
  readonly db: number | undefined;
  /** Held down and repeating. */
  readonly held?: boolean | undefined;
  /** The level cannot go further this way. */
  readonly atLimit?: boolean | undefined;
}

export function renderStep(theme: Theme, k: StepKey): string {
  const l = functionLook(theme, { ...k, lit: k.held === true });
  const c = chrome(theme, l, '', k);
  const arrow = k.atLimit === true || k.offline === true ? theme.line : l.text;
  const value =
    k.offline === true ? 'OFFLINE' : `${formatLevel(k.db)}${k.db === undefined ? '' : ' dB'}`;
  return (
    c.under +
    title(theme, k.target.toUpperCase(), l, 28) +
    triangle(CENTER, 66, 38, k.direction, arrow) +
    word(theme, value, l, 122, [theme.type.medium, theme.type.small]) +
    c.over
  );
}
