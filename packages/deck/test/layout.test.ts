import { controlRoom } from '@faderlight/model';
import { fullMixer } from '@faderlight/simulator';
import { describe, expect, it } from 'vitest';
import { CONSOLE_LAYOUT, keyAt, moveBank, nextBankBus, clampBank } from '../src/index.ts';
import { FakeClock } from './clock.ts';
import { consoleDeck } from './console.ts';
import { Loopback } from './loopback.ts';

describe('bank arithmetic', () => {
  it('moves by its size and wraps around at both ends', () => {
    const at = { bus: 'input', offset: 0 } as const;
    expect(moveBank(at, 8, 20, 'next')).toEqual({ bus: 'input', offset: 8 });
    expect(moveBank({ ...at, offset: 8 }, 8, 20, 'next')).toEqual({ bus: 'input', offset: 16 });
    expect(moveBank({ ...at, offset: 16 }, 8, 20, 'next')).toEqual({ bus: 'input', offset: 0 });
    expect(moveBank(at, 8, 20, 'prev')).toEqual({ bus: 'input', offset: 16 });
    expect(moveBank(at, 8, 5, 'next')).toEqual({ bus: 'input', offset: 0 });
    expect(nextBankBus({ bus: 'output', offset: 16 })).toEqual({ bus: 'input', offset: 0 });
    expect(clampBank({ ...at, offset: 24 }, 8, 10)).toEqual({ bus: 'input', offset: 8 });
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
    // The studio session shows four inputs: the rest of the bank is blank.
    expect(names(row(1))).toEqual(['Synth', 'Vocal', 'Guitar', 'Room', '', '', '', '']);
    expect(names(row(2))).toEqual([
      'Main',
      'Phones 1',
      'Phones 2',
      '',
      'toggle',
      'toggle',
      'toggle',
      'bank',
    ]);
    expect(row(2)[3]).toMatchObject({ kind: 'output', label: 'AN 3', offline: true });
    expect(row(2)[7]).toMatchObject({ row: 'INPUTS', first: 1, last: 4, total: 4, atEnd: true });
    expect(row(3).map((v) => v?.kind)).toEqual([
      ...Array<string>(6).fill('step'),
      'toggle',
      'toggle',
    ]);
  });

  it('slots act like the specific actions', () => {
    const { tap, mixer, row } = consoleDeck();
    tap(4, 2);
    expect(mixer.store.value(controlRoom('dim'))).toBe(true);
    tap(1, 1);
    expect(row(1)[1]).toMatchObject({ name: 'Vocal', muted: true });
  });

  it('a bank key moves the channel row, and a long press switches it to playback', () => {
    const { tap, hold, row } = consoleDeck(new Loopback(new FakeClock(), fullMixer()).connect());
    expect(row(1)[0]).toMatchObject({ label: 'AN 1/2' });
    expect(row(2)[7]).toMatchObject({ first: 1, last: 8, atEnd: false });
    tap(7, 2);
    expect(row(1)[0]).toMatchObject({ label: 'ADAT 3/4' });
    expect(row(2)[7]).toMatchObject({ first: 9, last: 16 });
    hold(7, 2);
    expect(row(2)[7]).toMatchObject({ row: 'PLAYBACK', first: 1 });
    expect(row(1)[0]).toMatchObject({ kind: 'channel', value: { kind: 'level' } });
  });

  it('a page key goes through the pages, and a long press back to the first', () => {
    const { tap, hold, row, deck } = consoleDeck();
    tap(7, 0);
    expect(deck.pageOf('XL')).toBe(1);
    expect(names(row(0)).slice(0, 4)).toEqual(['Synth', 'Vocal', 'Guitar', 'Room']);
    expect(row(0)[0]).toMatchObject({ style: 'meter' });
    expect(row(3)[7]).toMatchObject({ kind: 'page', name: 'OUTPUTS', index: 2 });
    tap(7, 3);
    expect(names(row(0)).slice(0, 3)).toEqual(['Main', 'Phones 1', 'Phones 2']);
    expect(row(3)[6]).toMatchObject({ row: 'OUTPUTS', total: 3 });
    tap(7, 3);
    expect(deck.pageOf('XL')).toBe(0);
    tap(7, 0);
    hold(7, 3);
    expect(deck.pageOf('XL')).toBe(0);
  });

  it('each device has its own page', () => {
    const { fill, tap, deck, advance } = consoleDeck();
    fill('XL2');
    advance(200);
    tap(7, 0, 'XL2');
    expect(deck.pageOf('XL2')).toBe(1);
    expect(deck.pageOf('XL')).toBe(0);
  });

  it('a key held while the page changes still releases what it was', () => {
    const { deck, id, advance, tap, mixer } = consoleDeck();
    const talkback = controlRoom('talkback');
    deck.down(id(6, 2));
    advance(100);
    expect(mixer.store.value(talkback)).toBe(true);
    tap(7, 0);
    deck.up(id(6, 2));
    advance(500);
    expect(mixer.store.value(talkback)).toBe(false);
  });

  it('the Console launcher switches to the Console profile', () => {
    const { deck, host, advance } = consoleDeck();
    deck.appear({ id: 'launch', device: 'XL', kind: 'console', settings: {} });
    advance(100);
    expect(host.view('launch')).toMatchObject({ kind: 'page', name: 'CONSOLE' });
    deck.down('launch');
    deck.up('launch');
    expect(host.profiles).toEqual([['XL', 'profiles/Console']]);
  });
});
