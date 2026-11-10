// Snapshot key (docs/design/03-ux.md §2.3): the snapshot's name big, on up to two lines, with
// "SNAPSHOT n" above it; without a name, the number big. The loaded snapshot is lit; "EDITED"
// when the mixer reports it changed since loading. While a save waits for its confirming
// second tap the key turns red and says so.

import { CANVAS, chip, chipWidth, frame, type ChipStyle, type KeyState } from '../parts.ts';
import { balancedLines, fitText, text } from '../text.ts';
import type { Theme } from '../theme.ts';
import { caption, CENTER, chrome, functionLook, litLook, WIDTH, word } from './function.ts';

export interface SnapshotKey extends KeyState {
  readonly kind: 'snapshot';
  /** 1-8. */
  readonly n: number;
  /** Name, if known: the mixer does not send it, so it comes from TotalMix's files or settings. */
  readonly name?: string | undefined;
  /** As the mixer reports it; undefined = not known yet. */
  readonly state: 'inactive' | 'active' | 'modified' | undefined;
  /** A save is armed: the next tap within the timeout confirms it. */
  readonly confirmSave?: boolean | undefined;
}

export function renderSnapshot(theme: Theme, k: SnapshotKey): string {
  const n = String(k.n);
  const name = (k.name ?? '').trim();
  if (k.confirmSave === true && k.offline !== true) {
    const l = litLook(theme, theme.accent.confirm);
    const c = chrome(theme, l, frame(theme.accent.record, 4), k);
    return (
      c.under +
      text(`SNAPSHOT ${n}`, {
        face: 'semibold',
        size: theme.type.small,
        tracking: 0.6,
        x: CENTER,
        y: 32,
        anchor: 'middle',
        fill: l.text,
      }) +
      word(theme, 'SAVE?', l, 84) +
      caption(theme, 'tap again to save', l, 118, l.text) +
      c.over
    );
  }
  const active = k.state === 'active' || k.state === 'modified';
  const l = functionLook(theme, { ...k, lit: active });
  const c = chrome(theme, l, '', k);
  let out = c.under;
  const edited: ChipStyle = {
    fill: theme.accent.dim,
    ink: theme.accent.dimInk,
    size: 15,
    height: 19,
  };
  const modified = k.state === 'modified' && k.offline !== true;
  const chipW = modified ? chipWidth('EDITED', edited) : 0;
  if (modified) out += chip('EDITED', CANVAS - 7 - chipW, 9, edited);
  // With a name: the name is what you look for, big, and the number goes to the title.
  const named = name !== '' && k.offline !== true;
  const t = fitText(named ? `SNAPSHOT ${n}` : 'SNAPSHOT', {
    face: 'semibold',
    sizes: [theme.type.small],
    maxWidth: CANVAS - 14 - chipW - 6,
    tracking: 0.6,
  });
  out += text(t.text, {
    face: 'semibold',
    size: t.size,
    tracking: 0.6,
    scaleX: t.scaleX,
    x: 7,
    y: 24,
    fill: l.subtext,
  });
  if (named) {
    // One line as big as it fits; two smaller lines when a name with spaces does not.
    const big = theme.type.medium + 6;
    const lines = balancedLines(name, { face: 'bold', sizes: [big], maxWidth: WIDTH });
    if (lines.length < 2) out += word(theme, name, l, 92, [theme.type.large, big]);
    else
      out += word(theme, lines[0] ?? '', l, 76, [big]) + word(theme, lines[1] ?? '', l, 108, [big]);
    return out + c.over;
  }
  out += word(theme, n, l, 100, [theme.type.display]);
  if (k.offline === true) out += caption(theme, 'OFFLINE', l, 126);
  return out + c.over;
}
