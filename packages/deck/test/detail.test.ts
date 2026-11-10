import { channel, route } from '@faderlight/model';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, DETAIL_KEYS, formatPan, stepGain } from '../src/index.ts';
import { consoleDeck } from './console.ts';

describe('overlay helpers', () => {
  it('has a key for every place of the XL', () => {
    expect(DETAIL_KEYS).toHaveLength(32);
  });

  it('steps preamp gain within its range and over the gap above 0 dB', () => {
    const mic = { min: 0, max: 75, step: 1, minAboveZero: 8 };
    expect(stepGain(42, 'up', mic)).toBe(43);
    expect(stepGain(0, 'up', mic)).toBe(8);
    expect(stepGain(8, 'down', mic)).toBe(0);
    expect(stepGain(75, 'up', mic)).toBe(75);
    expect(stepGain(6, 'up', { min: 0, max: 12, step: 0.5 })).toBe(6.5);
  });

  it('formats pan like TotalMix', () => {
    expect(formatPan(0)).toBe('C');
    expect(formatPan(-0.25)).toBe('L25');
    expect(formatPan(1)).toBe('R100');
  });
});

describe('the Channel Detail overlay', () => {
  /** The Console with the overlay open on Vocal (Mic 9): a long press on its slot. */
  function vocalDetail() {
    const c = consoleDeck();
    c.hold(1, 1);
    return c;
  }

  it('opens with a long press on a channel slot and shows that channel', () => {
    const { row } = vocalDetail();
    expect(row(0)[0]).toMatchObject({ kind: 'control', word: 'BACK' });
    expect(row(0)[1]).toMatchObject({ kind: 'channel', name: 'Vocal', style: 'full' });
    expect(row(0)[2]).toMatchObject({ title: 'Gain', arrow: 'down', word: '+42 dB' });
    expect(row(0)[4]).toMatchObject({ word: '48V', switch: true });
    expect(row(1)[0]).toMatchObject({ word: 'MUTE', switch: false });
    expect(row(1)[2]).toMatchObject({ title: 'Fader', word: '−6.0' });
    expect(row(1)[4]).toMatchObject({ kind: 'channel', style: 'meter' });
    expect(row(2).slice(0, 3)).toMatchObject([
      { title: '→ AN 1/2', caption: 'Main', word: '−6.0', lit: true },
      { title: '→ PH 9/10', caption: 'Phones 1', word: '−3.0', lit: false },
      { title: '→ PH 11/12', caption: 'Phones 2', word: '−6.0' },
    ]);
    // Only three outputs are visible: the other send keys are blank.
    expect(row(2)[3]).toBeUndefined();
    expect(row(3)[1]).toMatchObject({ arrow: 'right', word: 'MIC 10' });
  });

  it('changes gain, 48V, mute and the fader of the channel', () => {
    const { tap, mixer, row } = vocalDetail();
    tap(3, 0);
    tap(4, 0);
    tap(0, 1);
    tap(3, 1);
    const store = mixer.store;
    expect(store.value(channel('input', 8, 'gain'))).toBe(43);
    expect(store.value(channel('input', 8, 'phantom'))).toBe(false);
    expect(store.value(channel('input', 8, 'mute'))).toBe(true);
    expect(store.value(route('input', 8, 0, 'fader'))).toBe(-5.5);
    expect(row(0)[2]).toMatchObject({ word: '+43 dB' });
  });

  it('a send key selects the submix the send and pan keys change', () => {
    const { tap, mixer, row } = vocalDetail();
    tap(1, 2);
    expect(row(2)[1]).toMatchObject({ lit: true });
    expect(row(2)[0]).toMatchObject({ lit: false });
    expect(row(3)[3]).toMatchObject({ title: 'Send → PH 9/10', word: '−3.0' });
    tap(3, 3);
    tap(7, 2);
    expect(mixer.store.value(route('input', 8, 8, 'fader'))).toBe(-2.5);
    expect(mixer.store.value(route('input', 8, 8, 'balance'))).toBeCloseTo(0.05);
    expect(row(2)[7]).toMatchObject({ title: 'Pan PH 9/10', word: 'R5' });
  });

  it('goes to the next channel and back, and closes with Back', () => {
    const { tap, row, deck } = vocalDetail();
    tap(1, 3);
    expect(row(0)[1]).toMatchObject({ name: 'Guitar' });
    tap(0, 3);
    expect(row(0)[1]).toMatchObject({ name: 'Vocal' });
    tap(7, 3);
    expect(row(0)[0]).toMatchObject({ kind: 'snapshot' });
    expect(deck.pageOf('XL')).toBe(0);
  });

  it('closes by itself after the timeout without a press', () => {
    const { row, advance, tap } = vocalDetail();
    advance(DEFAULT_SETTINGS.detail.timeoutSec * 1000 - 1000);
    tap(5, 0);
    advance(DEFAULT_SETTINGS.detail.timeoutSec * 1000 - 1000);
    expect(row(0)[0]).toMatchObject({ word: 'BACK' });
    advance(2000);
    expect(row(0)[0]).toMatchObject({ kind: 'snapshot' });
  });

  it('clears the clip of the channel', () => {
    const { mixer, row, advance, tap } = vocalDetail();
    mixer.store.meters.push('input', 8, Math.fround(6), mixer.clock.now());
    advance(200);
    expect(row(3)[6]).toMatchObject({ word: 'CLEAR', lit: true, caption: 'clipped' });
    tap(6, 3);
    expect(row(3)[6]).toMatchObject({ lit: false });
  });

  it('from a key on another profile, switches to the Console and back', () => {
    const c = consoleDeck();
    // Leave the Console: its slots go away, a Channel key of another profile appears.
    for (let r = 0; r < 4; r++) for (let col = 0; col < 8; col++) c.deck.disappear(c.id(col, r));
    c.deck.appear({
      id: 'own',
      device: 'XL',
      kind: 'channel',
      coordinates: { column: 2, row: 0 },
      settings: { bus: 'input', index: 9 },
    });
    c.advance(100);
    c.deck.down('own');
    c.advance(DEFAULT_SETTINGS.gestures.longPressMs + 50);
    c.deck.up('own');
    expect(c.host.profiles).toEqual([['XL', 'profiles/Console']]);
    c.deck.disappear('own');
    c.fill();
    c.advance(200);
    expect(c.row(0)[1]).toMatchObject({ name: 'Guitar' });
    c.tap(0, 0);
    expect(c.host.profiles).toEqual([
      ['XL', 'profiles/Console'],
      ['XL', undefined],
    ]);
  });
});
