// A layout of the user's own in the global settings (the Control Center's layout builder): it is
// checked key by key, the Console Slots follow it at once, and the builder's previews show its
// keys as the deck would.
import { describe, expect, it } from 'vitest';
import {
  CONSOLE_LAYOUT,
  DEFAULT_SETTINGS,
  EMPTY,
  LAYOUT_TEMPLATES,
  readGlobalSettings,
  readKeySpec,
  readLayout,
  toJson,
  type GlobalSettings,
  type JsonObject,
  type KeySpec,
  type Layout,
} from '../src/index.ts';
import { consoleDeck } from './console.ts';
import { Loopback } from './loopback.ts';

const page = (name: string, keys: KeySpec[], banks?: Layout['pages'][number]['banks']) => ({
  name,
  ...(banks ? { banks } : {}),
  keys: [...keys, ...Array.from({ length: 32 - keys.length }, () => EMPTY)],
});

const withLayout = (layout: Layout): GlobalSettings => ({ ...DEFAULT_SETTINGS, layout });

describe('a layout in the global settings', () => {
  it('reads back every template as it was written', () => {
    for (const t of LAYOUT_TEMPLATES) {
      const problems: string[] = [];
      const json = JSON.parse(JSON.stringify(t.layout)) as JsonObject;
      expect(readLayout(json, 'layout', problems), t.id).toEqual(json);
      expect(problems, t.id).toEqual([]);
      // 8 x 4 keys on every page.
      for (const p of t.layout.pages) expect(p.keys, `${t.id} ${p.name}`).toHaveLength(32);
    }
    const read = readGlobalSettings(toJson(withLayout(CONSOLE_LAYOUT)));
    expect(read.problems).toEqual([]);
    expect(read.changed).toBe(false);
    expect(read.settings.layout).toEqual(JSON.parse(JSON.stringify(CONSOLE_LAYOUT)));
  });

  it('has none by default, so the Console uses the default layout', () => {
    const read = readGlobalSettings(toJson(DEFAULT_SETTINGS));
    expect(read.settings.layout).toBeUndefined();
    expect('layout' in read.settings).toBe(false);
  });

  it('leaves a key that is not one empty, and says which', () => {
    const problems: string[] = [];
    const layout = readLayout(
      {
        columns: 8,
        rows: 4,
        pages: [
          {
            name: '  Mine  ',
            banks: [
              { source: 'input', size: 7 },
              { source: 'aux', size: 3 },
            ],
            keys: [
              { type: 'snapshot', n: 9 },
              { type: 'toggle', function: 'dim' },
              { type: 'detail', control: 'back' },
              { type: 'strip', n: 0, style: 'huge' },
            ],
          },
        ],
      },
      'layout',
      problems,
    );
    expect(layout?.pages[0]?.name).toBe('Mine');
    expect(layout?.pages[0]?.banks).toEqual([{ source: 'input', size: 7 }]);
    expect(layout?.pages[0]?.keys.slice(0, 4)).toEqual([
      EMPTY,
      { type: 'toggle', function: 'dim' },
      EMPTY,
      // An unknown style is left out: the key keeps the default one.
      { type: 'strip', n: 0 },
    ]);
    expect(layout?.pages[0]?.keys).toHaveLength(32);
    expect(problems).toEqual([
      'layout.pages.0.keys: expected 32 keys',
      'layout.pages.0.banks.1: expected a bank like {"source": "input", "size": 7}',
      'layout.pages.0.keys.0: not a key',
      'layout.pages.0.keys.2: not a key',
    ]);
  });

  it('refuses something that is not a layout, and keeps the default', () => {
    const read = readGlobalSettings({ ...toJson(DEFAULT_SETTINGS), layout: { pages: [] } });
    expect(read.settings.layout).toBeUndefined();
    expect(read.problems).toEqual(['layout: expected a layout with columns, rows and pages']);
  });

  it('reads each kind of key', () => {
    const keys: KeySpec[] = [
      { type: 'channel', bus: 'input', index: 8, style: 'meter', tap: 'solo', hold: 'phantom' },
      { type: 'channel', bus: 'output' },
      { type: 'output', output: { role: 'phones', n: 2 } },
      { type: 'step', output: { role: 'output', index: 4 }, direction: 'down' },
      { type: 'preset', output: { role: 'main' }, n: 3 },
      { type: 'snapshot', n: 8 },
      { type: 'toggle', function: 'globalSolo' },
      { type: 'status' },
      { type: 'strip', n: 3, style: 'minimal', bank: 1 },
      { type: 'bank', direction: 'prev', bank: 1 },
      { type: 'page', to: 2 },
      { type: 'page', direction: 'prev' },
      { type: 'console' },
      { type: 'exit' },
      EMPTY,
    ];
    for (const k of keys)
      expect(readKeySpec(JSON.parse(JSON.stringify(k)) as JsonObject)).toEqual(k);
    expect(readKeySpec({ type: 'output', output: { role: 'phones', n: 5 } })).toBeUndefined();
    expect(readKeySpec({ type: 'channel', bus: 'aux' })).toBeUndefined();
  });
});

describe('the Console with a layout of its own', () => {
  const mine: Layout = {
    columns: 8,
    rows: 4,
    pages: [
      page(
        'Mine',
        [
          { type: 'snapshot', n: 3 },
          { type: 'strip', n: 0 },
          { type: 'strip', n: 1 },
          { type: 'bank', direction: 'next' },
          { type: 'page', direction: 'next' },
        ],
        [{ source: 'playback', size: 2 }],
      ),
      page('Two', [{ type: 'toggle', function: 'dim' }]),
    ],
  };

  it('the slots show it, and follow a new one at once', () => {
    const { row, deck, advance, tap } = consoleDeck(new Loopback().connect(), withLayout(mine));
    const top = row(0);
    expect(top[0]).toMatchObject({ kind: 'snapshot', n: 3 });
    expect(top[1]).toMatchObject({ kind: 'channel', name: 'DAW' });
    expect(top[2]).toMatchObject({ kind: 'channel' });
    expect(top[4]).toMatchObject({ kind: 'page', name: 'TWO' });
    tap(4, 0);
    expect(deck.pageOf('XL')).toBe(1);
    expect(row(0)[0]).toMatchObject({ kind: 'toggle', function: 'dim' });
    // Back to the default layout: page 2 (Inputs) is still there, so the deck stays on it.
    deck.configure(DEFAULT_SETTINGS);
    advance(200);
    expect(deck.pageOf('XL')).toBe(1);
    expect(row(0)[7]).toMatchObject({ kind: 'page', name: 'CONSOLE' });
    // A layout with one page: the deck goes to it.
    deck.configure(withLayout({ ...mine, pages: [mine.pages[1] ?? page('?', [])] }));
    advance(200);
    expect(deck.pageOf('XL')).toBe(0);
    expect(row(0)[0]).toMatchObject({ kind: 'toggle', function: 'dim' });
  });

  it('previews a page as the deck would draw it, banks at their start', () => {
    const { deck } = consoleDeck(new Loopback().connect());
    const draft: GlobalSettings = {
      ...withLayout(mine),
      snapshots: { '3': 'Draft name' },
      channels: { 'playback/0': { hidden: true } },
    };
    const images = deck.preview(draft, 0);
    expect(images).toHaveLength(32);
    expect(images[0]).toMatch(/^data:image\/svg\+xml/);
    // The draft's names and hidden channels count, though they are not saved.
    const views = deck.previewViews(draft, 0);
    expect(views[0]).toMatchObject({ kind: 'snapshot', name: 'Draft name' });
    expect(views[1]).toMatchObject({ kind: 'channel' });
    expect(views[1]).not.toMatchObject({ name: 'DAW' });
    expect(views[5]).toBeUndefined();
    expect(deck.preview(draft, 5)).toEqual([]);
  });
});
