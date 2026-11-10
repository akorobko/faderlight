// The renderer entry point: a key's view model, a theme and an output size in, SVG out.
//
// Every key is drawn on a 144 x 144 canvas and scaled to `size` (96 on a Stream Deck XL,
// 144 for its high-resolution images, 72 on smaller decks). Pure: same input, same string.

import { renderChannel, type ChannelKey } from './keys/channel.ts';
import { CANVAS } from './parts.ts';
import { document } from './svg.ts';
import { DARK, type Theme } from './theme.ts';

/** Everything a key can show. */
export type KeyView = ChannelKey;

export type KeyKind = KeyView['kind'];

export function renderKey(view: KeyView, theme: Theme = DARK, size = CANVAS): string {
  return document(renderChannel(theme, view), size, CANVAS);
}

/** A data URL for an SVG, e.g. for the Stream Deck `setImage` call. */
export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf8,${encodeURIComponent(svg)}`;
}
