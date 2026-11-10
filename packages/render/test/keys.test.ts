// Behaviour of the key renderers that the golden images do not spell out.

import { describe, expect, it } from 'vitest';
import {
  channelColor,
  DARK,
  mix,
  look,
  nameAndLabel,
  renderKey,
  type ChannelKey,
  type KeyView,
} from '../src/index.ts';

const mic: ChannelKey = {
  kind: 'channel',
  label: 'MIC 9',
  name: 'Vocal',
  value: { kind: 'gain', db: 42, caption: 'Gain' },
  meter: { left: { level: -20, peak: -12, clip: false } },
  badges: { phantom: true },
};

describe('channel key', () => {
  it('shows the label alone when there is no name, or the name is the label', () => {
    expect(nameAndLabel({ label: 'MIC 9', name: 'Vocal' })).toEqual(['Vocal', 'MIC 9']);
    expect(nameAndLabel({ label: 'MIC 9', name: '' })).toEqual(['MIC 9', '']);
    expect(nameAndLabel({ label: 'MIC 9', name: ' mic 9 ' })).toEqual(['MIC 9', '']);
    expect(nameAndLabel({ label: 'AN 1' })).toEqual(['AN 1', '']);
  });

  it("maps TotalMix's colour numbers and custom colours to underline colours", () => {
    expect(channelColor(DARK, undefined)).toBeUndefined();
    expect(channelColor(DARK, 0)).toBeUndefined();
    // 1 is TotalMix's "no colour"; 3, 5 and 6 are its orange, blue and green.
    expect(channelColor(DARK, 1)).toBeUndefined();
    expect(channelColor(DARK, 3)).toBe('#ff6e0a');
    expect(channelColor(DARK, 5)).toBe('#3c8cff');
    expect(channelColor(DARK, 6)).toBe('#00f027');
    expect(channelColor(DARK, 99)).toBeUndefined();
    expect(channelColor(DARK, '#123456')).toBe('#123456');
    expect(channelColor(DARK, '#nope')).toBeUndefined();
  });

  it('draws offline over muted over soloed over normal', () => {
    expect(look(DARK, {}).background).toBe(DARK.normal.background);
    expect(look(DARK, { soloed: true }).background).toBe(DARK.soloed.background);
    expect(look(DARK, { muted: true, soloed: true }).background).toBe(DARK.muted.background);
    expect(look(DARK, { muted: true, offline: true }).background).toBe(DARK.offline.background);
  });

  it('marks state with colour and shape, on the pad and never at the edge', () => {
    const normal = renderKey(mic);
    expect(normal).not.toContain(DARK.accent.solo);
    expect(normal).not.toContain('stroke-dasharray');
    const soloed = renderKey({ ...mic, soloed: true });
    expect(soloed).toContain(`fill="${DARK.soloed.background}"`);
    expect(soloed).toContain(`fill="${DARK.accent.solo}"`); // the S chip
    expect(soloed).not.toContain(`stroke="${DARK.accent.solo}"`);
    expect(renderKey({ ...mic, pending: true })).toContain('stroke-dasharray');
    const muted = renderKey({ ...mic, muted: true });
    expect(muted).toContain(`fill="${DARK.accent.mute}"`);
    // The tint is on the pad; the whole key keeps the plain background to its edge.
    expect(muted).toContain(
      `<rect x="-14" y="-14" width="172" height="172" fill="${DARK.normal.background}"/>`,
    );
    expect(muted).toMatch(
      new RegExp(
        `<rect x="-3" y="-3" width="150" height="150" rx="13" fill="${DARK.muted.background}"`,
      ),
    );
  });

  it('shows one name: the channel name, else the physical label', () => {
    const shown = (k: ChannelKey) => renderKey(k).length;
    expect(shown({ ...mic, name: 'Vocal' })).not.toBe(shown({ ...mic, name: 'Other' }));
    expect(renderKey({ ...mic, name: '' })).toBe(renderKey({ ...mic, name: 'mic 9' }));
  });

  it('underlines the name in the channel colour', () => {
    expect(renderKey({ ...mic, color: 5 })).toContain('fill="#3c8cff"');
    expect(renderKey({ ...mic, color: 1 })).toBe(renderKey(mic));
  });

  it('lights 48V red only when on, and hides badges a channel does not have', () => {
    expect(renderKey(mic)).toContain(`fill="${DARK.accent.phantom}"`);
    expect(renderKey({ ...mic, badges: { phantom: false } })).not.toContain(DARK.accent.phantom);
    const none = renderKey({ ...mic, badges: undefined });
    expect(none.length).toBeLessThan(renderKey({ ...mic, badges: { phantom: false } }).length);
  });

  it('drops values, chips and badges when offline', () => {
    const offline = renderKey({ ...mic, muted: true, soloed: true, pending: true, offline: true });
    expect(offline).not.toContain(DARK.accent.mute);
    expect(offline).not.toContain(DARK.accent.solo);
    expect(offline).not.toContain(DARK.accent.phantom);
    expect(offline).not.toContain('stroke-dasharray');
    expect(offline).toContain(DARK.offline.hatch);
  });

  it('renders every style', () => {
    for (const style of ['full', 'meter', 'minimal'] as const) {
      expect(renderKey({ ...mic, style })).toMatch(/^<svg .*<\/svg>$/);
    }
  });
});

describe('other keys', () => {
  // A lit key is a dark tint of its colour on the pad; a key waiting for a second tap also
  // has a frame in it.
  const lit = (view: KeyView, color: string) =>
    renderKey(view).includes(`fill="${mix(color, DARK.normal.background, 0.72)}"`);
  const framed = (view: KeyView, color: string) => renderKey(view).includes(`stroke="${color}"`);

  it('light toggles in their own colour when on', () => {
    expect(lit({ kind: 'toggle', function: 'dim', on: true }, DARK.accent.dim)).toBe(true);
    expect(lit({ kind: 'toggle', function: 'dim', on: false }, DARK.accent.dim)).toBe(false);
    expect(lit({ kind: 'toggle', function: 'globalMute', on: true }, DARK.accent.mute)).toBe(true);
    expect(lit({ kind: 'toggle', function: 'globalSolo', on: true }, DARK.accent.solo)).toBe(true);
  });

  it('light the loaded snapshot, edited or not', () => {
    const frame = DARK.lit.frame;
    expect(lit({ kind: 'snapshot', n: 1, state: 'active' }, frame)).toBe(true);
    expect(lit({ kind: 'snapshot', n: 1, state: 'modified' }, frame)).toBe(true);
    expect(lit({ kind: 'snapshot', n: 1, state: 'inactive' }, frame)).toBe(false);
    expect(renderKey({ kind: 'snapshot', n: 1, state: 'modified' })).toContain(DARK.accent.dim);
  });

  it('turn red while a save or a recording waits for confirmation', () => {
    expect(
      framed({ kind: 'snapshot', n: 2, state: 'active', confirmSave: true }, DARK.accent.record),
    ).toBe(true);
    expect(
      framed({ kind: 'recorder', state: 'stopped', confirmRecord: true }, DARK.accent.record),
    ).toBe(true);
    expect(lit({ kind: 'recorder', state: 'recording', time: 1 }, DARK.accent.record)).toBe(true);
    expect(lit({ kind: 'recorder', state: 'stopped', time: 1 }, DARK.accent.record)).toBe(false);
  });

  it('colour the status link by state', () => {
    expect(renderKey({ kind: 'status', link: 'live' })).toContain(DARK.link.live);
    expect(renderKey({ kind: 'status', link: 'syncing' })).toContain(DARK.link.busy);
    expect(renderKey({ kind: 'status', link: 'stale' })).toContain(DARK.link.lost);
    expect(renderKey({ kind: 'status', link: 'idle' })).toContain(DARK.link.idle);
  });

  it('dim the arrow at the end of a bank or the limit of a step', () => {
    const arrow = (view: KeyView) => renderKey(view).includes(`fill="${DARK.line}"`);
    expect(
      arrow({
        kind: 'bank',
        direction: 'prev',
        row: 'IN',
        first: 1,
        last: 8,
        total: 94,
        atEnd: true,
      }),
    ).toBe(true);
    expect(
      arrow({ kind: 'bank', direction: 'next', row: 'IN', first: 1, last: 8, total: 94 }),
    ).toBe(false);
    expect(arrow({ kind: 'step', direction: 'up', target: 'MAIN', db: 6, atLimit: true })).toBe(
      true,
    );
  });
});
