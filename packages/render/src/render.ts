// The renderer entry point: a key's view model, a theme and an output size in, SVG out.
//
// Every key is drawn on a 144 x 144 content canvas inside a margin (BLEED) that only
// backgrounds, colour bands and frames reach, and the whole key is scaled to `size` (96 on a
// Stream Deck XL, 144 for its high-resolution images, 72 on smaller decks). The margin keeps
// text and meters off the edge of the display, which the keycap bends. Pure: same input, same
// string.

import { renderChannel, type ChannelKey } from './keys/channel.ts';
import { renderControl, type ControlKey } from './keys/control.ts';
import { renderLauncher, type LauncherKey } from './keys/launcher.ts';
import { renderBank, renderPage, type BankKey, type PageKey } from './keys/nav.ts';
import { renderOutput, type OutputKey } from './keys/output.ts';
import { renderRecorder, type RecorderKey } from './keys/recorder.ts';
import { renderSnapshot, type SnapshotKey } from './keys/snapshot.ts';
import { renderStatus, type StatusKey } from './keys/status.ts';
import { renderStep, type StepKey } from './keys/step.ts';
import { renderToggle, type ToggleKey } from './keys/toggle.ts';
import { BLEED, CANVAS } from './parts.ts';
import { document } from './svg.ts';
import { DARK, type Theme } from './theme.ts';

/** Everything a key can show. */
export type KeyView =
  | ChannelKey
  | OutputKey
  | ToggleKey
  | SnapshotKey
  | StatusKey
  | BankKey
  | PageKey
  | StepKey
  | RecorderKey
  | ControlKey
  | LauncherKey;

export type KeyKind = KeyView['kind'];

export function renderKey(view: KeyView, theme: Theme = DARK, size = CANVAS): string {
  return document(draw(view, theme), size, CANVAS, BLEED);
}

function draw(view: KeyView, theme: Theme): string {
  switch (view.kind) {
    case 'channel':
      return renderChannel(theme, view);
    case 'output':
      return renderOutput(theme, view);
    case 'toggle':
      return renderToggle(theme, view);
    case 'snapshot':
      return renderSnapshot(theme, view);
    case 'status':
      return renderStatus(theme, view);
    case 'bank':
      return renderBank(theme, view);
    case 'page':
      return renderPage(theme, view);
    case 'step':
      return renderStep(theme, view);
    case 'recorder':
      return renderRecorder(theme, view);
    case 'control':
      return renderControl(theme, view);
    case 'launcher':
      return renderLauncher(theme, view);
  }
}

/** A data URL for an SVG, e.g. for the Stream Deck `setImage` call. */
export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf8,${encodeURIComponent(svg)}`;
}
