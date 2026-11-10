import { controlRoom } from '@faderlight/model';
import { fullMixer, studioMixer } from '@faderlight/simulator';
import { describe, expect, it } from 'vitest';
import {
  CONSOLE_LAYOUT,
  EMPTY,
  keyAt,
  moveBank,
  nextBankSource,
  clampBank,
  type KeySpec,
  type Layout,
} from '../src/index.ts';
import { FakeClock } from './clock.ts';
import { consoleDeck } from './console.ts';
import { Loopback } from './loopback.ts';

describe('bank arithmetic', () => {
  it('moves by its size and wraps around at both ends', () => {
    const at = { source: 'input', offset: 0 } as const;
    expect(moveBank(at, 7, 20, 'next')).toEqual({ source: 'input', offset: 7 });
    expect(moveBank({ ...at, offset: 7 }, 7, 20, 'next')).toEqual({ source: 'input', offset: 14 });
    expect(moveBank({ ...at, offset: 14 }, 7, 20, 'next')).toEqual({ source: 'input', offset: 0 });
    expect(moveBank(at, 7, 20, 'prev')).toEqual({ source: 'input', offset: 14 });
    expect(moveBank(at, 7, 5, 'next')).toEqual({ source: 'input', offset: 0 });
    expect(nextBankSource({ source: 'output', offset: 14 })).toEqual({
      source: 'playback+output',
      offset: 0,
    });
    expect(nextBankSource({ source: 'playback+output', offset: 7 })).toEqual({
      source: 'input',
      offset: 0,
    });
    expect(clampBank({ ...at, offset: 21 }, 7, 10)).toEqual({ source: 'input', offset: 7 });
  });

  it('finds keys by coordinates, and nothing outside the grid', () => {
    expect(keyAt(CONSOLE_LAYOUT, 0, { column: 6, row: 0 })).toEqual({ type: 'status' });
    expect(keyAt(CONSOLE_LAYOUT, 0, { column: 8, row: 0 })).toEqual({ type: 'empty' });
    expect(keyAt(CONSOLE_LAYOUT, 5, { column: 0, row: 0 })).toEqual({ type: 'empty' });
    expect(keyAt(CONSOLE_LAYOUT, 0, undefined)).toEqual({ type: 'empty' });
    for (const page of CONSOLE_LAYOUT.pages) expect(page.keys).toHaveLength(32);
  });
});

const names = (views: readonly (Record<string, unknown> | undefined)[]) =>
  views.map((v) => (v === undefined ? '' : (v.name ?? v.kind)));

describe('the Console layout', () => {
  it('lays out the Console page like docs/design/03-ux.md §4', () => {
    const { row } = consoleDeck();
    expect(row(0).map((v) => v?.kind)).toEqual([
      ...Array<string>(6).fill('snapshot'),
      'status',
      'page',
    ]);
    expect(row(0)[7]).toMatchObject({ name: 'INPUTS', index: 1, count: 3 });
    // The studio session shows four inputs: the rest of the row is blank, and so is its Bank
    // key, since everything fits.
    expect(names(row(1))).toEqual(['Synth', 'Vocal', 'Guitar', 'Room', '', '', '', '']);
    // Playback, then the outputs that are not Main or Phones (the studio session has none).
    expect(names(row(2))).toEqual(['DAW', 'Browser', '', '', '', '', '', '']);
    expect(names(row(3))).toEqual([
      'Main',
      'Phones 1',
      'Phones 2',
      'control',
      'toggle',
      'toggle',
      '',
      'control',
    ]);
    expect(row(3)[4]).toMatchObject({ function: 'dim' });
    expect(row(3)[5]).toMatchObject({ function: 'mono' });
    expect(row(3)[3]).toMatchObject({ title: 'MAIN PRESET', word: 'SET', caption: 'hold to save' });
    expect(row(3)[7]).toMatchObject({ title: 'CONSOLE', word: 'EXIT', arrow: 'left' });
  });

  it('slots act like the specific actions', () => {
    const { tap, mixer, row } = consoleDeck();
    tap(4, 3);
    expect(mixer.store.value(controlRoom('dim'))).toBe(true);
    tap(1, 1);
    expect(row(1)[1]).toMatchObject({ name: 'Vocal', muted: true });
  });

  it('a row that fits has a blank Bank key that does nothing', () => {
    const { tap, hold, row, host } = consoleDeck();
    tap(7, 1);
    hold(7, 1);
    hold(7, 2);
    expect(names(row(1)).slice(0, 4)).toEqual(['Synth', 'Vocal', 'Guitar', 'Room']);
    expect(row(1)[7]).toBeUndefined();
    expect(row(2)[7]).toBeUndefined();
    expect(host.alerts).toEqual([]);
  });

  it('each channel row has its own bank, and a long press switches its source', () => {
    const { tap, hold, row } = consoleDeck(new Loopback(new FakeClock(), fullMixer()).connect());
    expect(row(1)[0]).toMatchObject({ label: 'AN 1/2' });
    expect(row(1)[7]).toMatchObject({ first: 1, last: 7, atEnd: false });
    tap(7, 1);
    expect(row(1)[0]).toMatchObject({ label: 'ADAT 1/2' });
    expect(row(1)[7]).toMatchObject({ first: 8, last: 14 });
    // The other row did not move.
    expect(row(2)[7]).toMatchObject({ row: 'PLAY + OUT', first: 1, last: 7 });
    hold(7, 1);
    expect(row(1)[7]).toMatchObject({ row: 'PLAYBACK', first: 1 });
    expect(row(1)[0]).toMatchObject({ kind: 'channel', value: { kind: 'level' } });
  });

  it('keeps a Bank key that switched to a source that fits, so it can switch back', () => {
    const sim = studioMixer();
    for (const n of [2, 3, 4, 5]) sim.setVisible('input', n, true);
    const { hold, row } = consoleDeck(new Loopback(new FakeClock(), sim).connect());
    expect(row(1)[7]).toMatchObject({ row: 'INPUTS', total: 8 });
    hold(7, 1);
    expect(row(1)[7]).toMatchObject({ row: 'PLAYBACK', total: 2, atEnd: true });
    hold(7, 1);
    expect(row(1)[7]).toMatchObject({ row: 'OUTPUTS' });
  });

  it('the playback and output row leaves out Main and the Phones outputs', () => {
    const { tap, row } = consoleDeck(new Loopback(new FakeClock(), fullMixer()).connect());
    const bank = row(2)[7] as { total: number };
    let seen: unknown[] = [];
    for (let i = 0; i < Math.ceil(bank.total / 7); i++) {
      seen = [...seen, ...row(2).slice(0, 7)];
      tap(7, 2);
    }
    const outputs = seen.filter((v) => (v as { kind?: string } | undefined)?.kind === 'output');
    expect(outputs.length).toBeGreaterThan(0);
    expect(outputs.map((v) => (v as { label: string }).label)).not.toContain('AN 1/2');
  });

  it('the top-right key goes to the next page, and back to the Console from the others', () => {
    const { tap, hold, row, deck } = consoleDeck();
    tap(7, 0);
    expect(deck.pageOf('XL')).toBe(1);
    expect(names(row(0)).slice(0, 4)).toEqual(['Synth', 'Vocal', 'Guitar', 'Room']);
    expect(row(0)[0]).toMatchObject({ style: 'meter' });
    expect(row(0)[7]).toMatchObject({ kind: 'page', name: 'CONSOLE', direction: 'prev' });
    expect(row(3)[7]).toMatchObject({ kind: 'page', name: 'OUTPUTS', index: 2 });
    tap(7, 3);
    expect(names(row(0)).slice(0, 3)).toEqual(['Main', 'Phones 1', 'Phones 2']);
    expect(row(3)[6]).toBeUndefined(); // the three outputs fit: no Bank key
    expect(row(3)[7]).toMatchObject({ kind: 'page', name: 'INPUTS', direction: 'prev' });
    tap(7, 0);
    expect(deck.pageOf('XL')).toBe(0);
    tap(7, 0);
    hold(7, 3);
    expect(deck.pageOf('XL')).toBe(0);
  });

  it('Exit goes back to the profile the deck showed before', () => {
    const { tap, host } = consoleDeck();
    tap(7, 3);
    expect(host.profiles).toEqual([['XL', undefined]]);
  });

  it('a Level Preset saves the current level on a long press and sets it on a tap', () => {
    const { tap, hold, row, host, mixer, id } = consoleDeck();
    const main = { scope: 'channel', bus: 'output', index: 0, field: 'volume' } as const;
    tap(3, 3);
    expect(host.alerts).toEqual([id(3, 3)]);
    hold(3, 3);
    expect(host.oks).toEqual([id(3, 3)]);
    expect(host.saved.at(-1)).toMatchObject({ levels: { 'main/1': -20 } });
    expect(row(3)[3]).toMatchObject({ word: '−20.0 dB', lit: true, caption: 'now' });
    mixer.set(main, -32.5);
    tap(5, 3);
    expect(row(3)[3]).toMatchObject({ lit: false, caption: 'hold to save' });
    tap(3, 3);
    expect(mixer.store.value(main)).toBe(-20);
    expect(row(3)[3]).toMatchObject({ lit: true });
  });

  it('a key held while the page changes still releases what it was', () => {
    const talk = { type: 'toggle', function: 'talkback' } as const;
    const next = { type: 'page', direction: 'next' } as const;
    const page = (name: string, keys: readonly KeySpec[]) => ({
      name,
      keys: [...keys, ...Array<KeySpec>(32 - keys.length).fill(EMPTY)],
    });
    const layout: Layout = {
      columns: 8,
      rows: 4,
      pages: [page('A', [talk, next]), page('B', [EMPTY, next])],
    };
    const { deck, id, advance, tap, mixer } = consoleDeck(undefined, undefined, layout);
    const talkback = controlRoom('talkback');
    deck.down(id(0, 0));
    advance(100);
    expect(mixer.store.value(talkback)).toBe(true);
    tap(1, 0);
    deck.up(id(0, 0));
    advance(500);
    expect(mixer.store.value(talkback)).toBe(false);
  });

  it('each device has its own page', () => {
    const { fill, tap, deck, advance } = consoleDeck();
    fill('XL2');
    advance(200);
    tap(7, 0, 'XL2');
    expect(deck.pageOf('XL2')).toBe(1);
    expect(deck.pageOf('XL')).toBe(0);
  });

  it('the Console launcher switches to the Console profile', () => {
    const { deck, host, advance } = consoleDeck();
    deck.appear({ id: 'launch', device: 'XL', kind: 'console', settings: {} });
    advance(100);
    expect(host.view('launch')).toMatchObject({ kind: 'launcher', device: 'Fireface UFX III' });
    deck.down('launch');
    deck.up('launch');
    expect(host.profiles).toEqual([['XL', 'profiles/Console']]);
  });
});
