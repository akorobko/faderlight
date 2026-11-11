// Draft edits on the settings pages: an emptied box takes its entry out, so a draft changed and
// changed back is equal to the saved settings again.
import { describe, expect, it } from 'vitest';
import {
  CONSOLE_LAYOUT,
  DEFAULT_SETTINGS,
  EMPTY,
  readGlobalSettings,
  toJson,
  type KeySpec,
  type Layout,
} from '@faderlight/deck';
import {
  addPage,
  movePage,
  parsePreset,
  removePage,
  setKey,
  swapKeys,
  tidyLayout,
  withChannel,
  withEntry,
  withLayout,
} from '../ui/edits.ts';

describe('settings draft edits', () => {
  it('sets and takes out map entries', () => {
    expect(withEntry({ '1': 'a' }, '2', 'b')).toEqual({ '1': 'a', '2': 'b' });
    expect(withEntry({ '1': 'a', '2': 'b' }, '1', undefined)).toEqual({ '2': 'b' });
  });

  it('drops a channel whose fields are all back to TotalMix’s', () => {
    let d = withChannel(DEFAULT_SETTINGS, 'input/8', { name: 'Lead vox', color: '#ff0000' });
    expect(d.channels).toEqual({ 'input/8': { name: 'Lead vox', color: '#ff0000' } });
    d = withChannel(d, 'input/8', { name: '  ' });
    expect(d.channels).toEqual({ 'input/8': { color: '#ff0000' } });
    d = withChannel(d, 'input/8', { hidden: true });
    d = withChannel(d, 'input/8', { color: undefined, hidden: false });
    expect(d.channels).toEqual({});
    expect(JSON.stringify(d)).toBe(JSON.stringify(DEFAULT_SETTINGS));
  });

  it('reads Level Preset keys', () => {
    expect(parsePreset('main/1')).toEqual({ output: 'main', n: 1 });
    expect(parsePreset('phones2/8')).toEqual({ output: 'phones2', n: 8 });
    expect(parsePreset('4/3')).toEqual({ output: 4, n: 3 });
    expect(parsePreset('main/9')).toBeUndefined();
    expect(parsePreset('aux/1')).toBeUndefined();
  });
});

describe('layout edits', () => {
  const pageOf = (keys: KeySpec[], name = 'P'): Layout['pages'][number] => ({
    name,
    keys: [...keys, ...Array.from({ length: 32 - keys.length }, () => EMPTY)],
  });
  const layout = (...pages: Layout['pages'][number][]): Layout => ({ columns: 8, rows: 4, pages });

  it('numbers the strip keys of each bank in reading order and sizes the banks', () => {
    const tidy = tidyLayout(
      layout({
        ...pageOf([
          { type: 'strip', n: 5, bank: 1 },
          { type: 'strip', n: 0 },
          { type: 'strip', n: 9, bank: 1, style: 'meter' },
          { type: 'bank', direction: 'next', bank: 2 },
        ]),
        banks: [{ source: 'output', size: 7 }],
      }),
    ).pages[0];
    expect(tidy?.keys.slice(0, 3)).toEqual([
      { type: 'strip', n: 0, bank: 1 },
      { type: 'strip', n: 0, bank: 0 },
      { type: 'strip', n: 1, style: 'meter', bank: 1 },
    ]);
    // Bank 1 keeps where it starts; a bank only a Bank key names gets one key's worth.
    expect(tidy?.banks).toEqual([
      { source: 'output', size: 1 },
      { source: 'input', size: 2 },
      { source: 'input', size: 1 },
    ]);
  });

  it('leaves the default layout as it is, and the settings without one', () => {
    expect(tidyLayout(CONSOLE_LAYOUT)).toEqual(JSON.parse(JSON.stringify(CONSOLE_LAYOUT)));
    const changed = withLayout(DEFAULT_SETTINGS, swapKeys(CONSOLE_LAYOUT, 0, 0, 1), CONSOLE_LAYOUT);
    expect(changed.layout?.pages[0]?.keys[0]).toEqual({ type: 'snapshot', n: 2 });
    const back = withLayout(
      changed,
      swapKeys(changed.layout ?? CONSOLE_LAYOUT, 0, 0, 1),
      CONSOLE_LAYOUT,
    );
    expect('layout' in back).toBe(false);
    expect(JSON.stringify(back)).toBe(JSON.stringify(DEFAULT_SETTINGS));
  });

  it('writes a layout the plugin reads back unchanged', () => {
    const mine = withLayout(
      DEFAULT_SETTINGS,
      setKey(addPage(CONSOLE_LAYOUT, 'Extras'), 3, 0, { type: 'strip', n: 0, bank: 0 }),
      CONSOLE_LAYOUT,
    );
    const read = readGlobalSettings(toJson(mine));
    expect(read.problems).toEqual([]);
    expect(JSON.stringify(read.settings)).toBe(JSON.stringify(mine));
  });

  it('page keys follow their page when pages move or go', () => {
    const three = layout(
      pageOf([{ type: 'page', to: 2 }], 'A'),
      pageOf([{ type: 'page', to: 0 }], 'B'),
      pageOf([{ type: 'page', to: 1 }], 'C'),
    );
    const moved = movePage(three, 2, 0);
    expect(moved.pages.map((p) => p.name)).toEqual(['C', 'A', 'B']);
    expect(moved.pages.map((p) => p.keys[0])).toEqual([
      { type: 'page', to: 2 },
      { type: 'page', to: 0 },
      { type: 'page', to: 1 },
    ]);
    const removed = removePage(three, 0);
    expect(removed.pages.map((p) => p.name)).toEqual(['B', 'C']);
    // B went to A, which is gone: it goes to the next page now.
    expect(removed.pages.map((p) => p.keys[0])).toEqual([
      { type: 'page', direction: 'next' },
      { type: 'page', to: 0 },
    ]);
    expect(removePage(layout(pageOf([])), 0).pages).toHaveLength(1);
  });
});
