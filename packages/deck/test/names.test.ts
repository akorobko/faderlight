// Names, colours and hidden channels from the Control Center (settings v3) on the keys: they win
// over what TotalMix reports, and a hidden channel leaves the Console's banks.
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type GlobalSettings } from '../src/index.ts';
import { consoleDeck } from './console.ts';
import { Loopback } from './loopback.ts';

const names = (row: readonly (Record<string, unknown> | undefined)[]) =>
  row.map((v) => (v?.name as string | undefined) ?? v?.kind ?? '');

const settings = (change: Partial<GlobalSettings>): GlobalSettings => ({
  ...DEFAULT_SETTINGS,
  ...change,
});

describe('settings from the Control Center on the keys', () => {
  it('a snapshot name set there wins over TotalMix’s', () => {
    const { row } = consoleDeck(
      new Loopback().connect(),
      settings({ snapshots: { '2': 'Vocals only' } }),
    );
    expect(row(0)[1]).toMatchObject({ kind: 'snapshot', n: 2, name: 'Vocals only' });
  });

  it('a channel name and colour set there win over TotalMix’s', () => {
    const { row } = consoleDeck(
      new Loopback().connect(),
      settings({
        channels: { 'input/8': { name: 'Lead vox', color: '#ff0000' } },
        // Guitar has TotalMix colour 6.
        colors: { '6': '#123456' },
      }),
    );
    expect(row(1)[1]).toMatchObject({ name: 'Lead vox', color: '#ff0000' });
    expect(row(1)[2]).toMatchObject({ name: 'Guitar', color: '#123456' });
    // Synth (colour 5) keeps the theme's colour for its number.
    expect(row(1)[0]).toMatchObject({ name: 'Synth', color: 5 });
  });

  it('a hidden channel leaves the banks, and comes back when shown again', () => {
    const { row, deck, advance } = consoleDeck(
      new Loopback().connect(),
      settings({ channels: { 'input/8': { hidden: true }, 'playback/2': { hidden: true } } }),
    );
    expect(names(row(1)).slice(0, 4)).toEqual(['Synth', 'Guitar', 'Room', '']);
    expect(names(row(2)).slice(0, 2)).toEqual(['DAW', '']);
    deck.configure(DEFAULT_SETTINGS);
    advance(200);
    expect(names(row(1)).slice(0, 4)).toEqual(['Synth', 'Vocal', 'Guitar', 'Room']);
  });

  it('names an output key by the name set there', () => {
    const { row } = consoleDeck(
      new Loopback().connect(),
      settings({ channels: { 'output/8': { name: 'Cans A' } } }),
    );
    expect(row(3)[1]).toMatchObject({ kind: 'output', name: 'Cans A' });
  });
});
