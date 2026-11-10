// The contact sheet: every golden case at 144 px (1:1), grouped and captioned, so a reviewer
// sees all keys in one picture (renders/contact-sheet.png, attached to renderer PRs).

import { CANVAS, DARK, renderKey, text, fitText, type KeyView } from '../src/index.ts';
import { CASES, type Case } from './cases.ts';

const MARGIN = 40;
const COLUMNS = 8;
const GAP_X = 20;
const CAPTION_H = 30;
const GAP_Y = 18;
const GROUP_TITLE_H = 44;
const PAGE_BG = '#0c0d10';
const TITLE = '#e8eaee';
const CAPTION = '#9aa1ac';

export const SHEET_WIDTH = MARGIN * 2 + COLUMNS * CANVAS + (COLUMNS - 1) * GAP_X;

/** A key's SVG placed at (x, y) inside a larger SVG. */
function place(svg: string, x: number, y: number): string {
  return svg.replace('<svg ', `<svg x="${String(x)}" y="${String(y)}" `);
}

function caption(
  s: string,
  x: number,
  y: number,
  width: number,
  size: number,
  fill: string,
): string {
  const fit = fitText(s, { face: 'semibold', sizes: [size], maxWidth: width });
  return text(fit.text, { face: 'semibold', size, scaleX: fit.scaleX, x, y, fill });
}

function groups(cases: readonly Case[]): [string, Case[]][] {
  const out = new Map<string, Case[]>();
  for (const c of cases) {
    const list = out.get(c.group) ?? [];
    list.push(c);
    out.set(c.group, list);
  }
  return [...out];
}

export interface DeckPage {
  readonly title: string;
  /** Keys row by row, 8 per row; undefined: a blank key. */
  readonly keys: readonly (KeyView | undefined)[];
}

/** Builds the sheet SVG: grouped cases, then optional deck pages drawn at XL size (96 px). */
export function contactSheet(
  cases: readonly Case[] = CASES,
  pages: readonly DeckPage[] = [],
): string {
  let body = '';
  let y = MARGIN;
  body += caption('Faderlight key renders', MARGIN, y + 26, 900, 30, TITLE);
  body += caption(
    'Keys at 144 px, 1:1. A Stream Deck XL shows them at 96 px.',
    MARGIN,
    y + 52,
    1100,
    17,
    CAPTION,
  );
  y += 76;

  for (const [group, list] of groups(cases)) {
    y += 16;
    body += caption(group.toUpperCase(), MARGIN, y + 20, SHEET_WIDTH - 2 * MARGIN, 16, CAPTION);
    y += GROUP_TITLE_H - 16;
    for (let i = 0; i < list.length; i += COLUMNS) {
      list.slice(i, i + COLUMNS).forEach((c, col) => {
        const x = MARGIN + col * (CANVAS + GAP_X);
        body += place(renderKey(c.view, c.theme ?? DARK, CANVAS), x, y);
        body += caption(c.title, x, y + CANVAS + 20, CANVAS, 15, TITLE);
      });
      y += CANVAS + CAPTION_H + GAP_Y;
    }
  }

  const KEY = 96;
  const KEY_GAP = 14;
  for (const page of pages) {
    y += 16;
    body += caption(
      page.title.toUpperCase(),
      MARGIN,
      y + 20,
      SHEET_WIDTH - 2 * MARGIN,
      16,
      CAPTION,
    );
    y += GROUP_TITLE_H - 8;
    const rows = Math.ceil(page.keys.length / 8);
    const deckW = 8 * KEY + 7 * KEY_GAP + 2 * 28;
    const deckH = rows * KEY + (rows - 1) * KEY_GAP + 2 * 24;
    const deckX = MARGIN;
    body += `<rect x="${String(deckX)}" y="${String(y)}" width="${String(deckW)}" height="${String(deckH)}" rx="22" fill="#1b1d21"/>`;
    page.keys.forEach((k, i) => {
      const x = deckX + 28 + (i % 8) * (KEY + KEY_GAP);
      const ky = y + 24 + Math.floor(i / 8) * (KEY + KEY_GAP);
      body +=
        k === undefined
          ? `<rect x="${String(x)}" y="${String(ky)}" width="${String(KEY)}" height="${String(KEY)}" fill="#000000"/>`
          : place(renderKey(k, DARK, KEY), x, ky);
    });
    y += deckH + GAP_Y + 12;
  }

  const height = y + MARGIN - GAP_Y;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${String(SHEET_WIDTH)}" height="${String(height)}">` +
    `<rect width="${String(SHEET_WIDTH)}" height="${String(height)}" fill="${PAGE_BG}"/>${body}</svg>`
  );
}
