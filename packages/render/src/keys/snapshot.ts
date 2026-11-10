// Snapshot key (docs/design/03-ux.md §2.3): the snapshot's number big, its name below. The
// loaded snapshot is lit; "EDITED" when the mixer reports it changed since loading. While a
// save waits for its confirming second tap the key turns red and says so.

import { CANVAS, chip, chipWidth, frame, type ChipStyle, type KeyState } from '../parts.ts';
import { fitText, text } from '../text.ts';
import type { Theme } from '../theme.ts';
import { caption, CENTER, chrome, functionLook, litLook, word } from './function.ts';

export interface SnapshotKey extends KeyState {
  readonly kind: 'snapshot';
  /** 1-8. */
  readonly n: number;
  /** Name, if known (the mixer does not send snapshot names yet). */
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
  const { look: l, frame: litFrame } = functionLook(theme, { ...k, lit: active });
  const c = chrome(theme, l, litFrame, k);
  let out = c.under;
  const edited: ChipStyle = {
    fill: theme.accent.dim,
    ink: theme.accent.dimInk,
    size: 15,
    height: 19,
  };
  const modified = k.state === 'modified' && k.offline !== true;
  const chipW = modified ? chipWidth('EDITED', edited) : 0;
  if (modified) out += chip('EDITED', CANVAS - 10 - chipW, 10, edited);
  const t = fitText('SNAPSHOT', {
    face: 'semibold',
    sizes: [theme.type.small],
    maxWidth: CANVAS - 24 - chipW - 6,
    tracking: 0.6,
  });
  out += text(t.text, {
    face: 'semibold',
    size: t.size,
    tracking: 0.6,
    scaleX: t.scaleX,
    x: 14,
    y: 24,
    fill: l.subtext,
  });
  out += word(theme, n, l, name === '' ? 100 : 90, [theme.type.display]);
  out += caption(
    theme,
    k.offline === true ? 'OFFLINE' : name,
    l,
    126,
    k.offline === true ? undefined : l.text,
  );
  return out + c.over;
}
