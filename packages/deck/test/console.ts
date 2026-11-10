// A Stream Deck XL full of Console Slots, like the bundled profile, on a loopback mixer.
import { DEFAULT_SETTINGS, DeckRuntime, type GlobalSettings, type Layout } from '../src/index.ts';
import { renderJson, TestHost } from './host.ts';
import { Loopback } from './loopback.ts';

export function consoleDeck(
  mixer = new Loopback().connect(),
  settings: GlobalSettings = DEFAULT_SETTINGS,
  layout?: Layout,
) {
  const host = new TestHost();
  const deck = new DeckRuntime({
    mixer,
    host,
    clock: mixer.clock,
    settings,
    render: renderJson,
    consoleProfile: 'profiles/Console',
    layout,
  });
  const id = (column: number, row: number, device = 'XL') =>
    `${device}:${String(column)},${String(row)}`;
  const fill = (device = 'XL') => {
    for (let row = 0; row < 4; row++) {
      for (let column = 0; column < 8; column++) {
        deck.appear({
          id: id(column, row, device),
          device,
          kind: 'slot',
          coordinates: { column, row },
          settings: {},
        });
      }
    }
  };
  fill();
  const advance = (ms: number) => {
    mixer.clock.advance(ms);
  };
  advance(200);
  const row = (r: number, device = 'XL') =>
    Array.from({ length: 8 }, (_, c) => host.view(id(c, r, device)));
  const tap = (column: number, r: number, device = 'XL') => {
    deck.down(id(column, r, device));
    advance(30);
    deck.up(id(column, r, device));
    advance(300);
  };
  const hold = (column: number, r: number) => {
    deck.down(id(column, r));
    advance(DEFAULT_SETTINGS.gestures.longPressMs + 50);
    deck.up(id(column, r));
    advance(300);
  };
  return { mixer, host, deck, id, fill, advance, row, tap, hold };
}
