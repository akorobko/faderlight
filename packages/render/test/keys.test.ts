// Behaviour of the key renderers that the golden images do not spell out.

import { describe, expect, it } from 'vitest';
import {
  channelColor,
  DARK,
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

  it('maps mixer colour numbers and custom colours to tab colours', () => {
    expect(channelColor(DARK, undefined)).toBeUndefined();
    expect(channelColor(DARK, 0)).toBeUndefined();
    expect(channelColor(DARK, 1)).toBe(DARK.channelColors[1]);
    expect(channelColor(DARK, '#123456')).toBe('#123456');
    expect(channelColor(DARK, '#nope')).toBeUndefined();
  });

  it('draws offline over muted over normal', () => {
    expect(look(DARK, {}).background).toBe(DARK.normal.background);
    expect(look(DARK, { muted: true }).background).toBe(DARK.muted.background);
    expect(look(DARK, { muted: true, offline: true }).background).toBe(DARK.offline.background);
  });

  it('marks state with colour and shape', () => {
    const normal = renderKey(mic);
    expect(normal).not.toContain(DARK.accent.solo);
    expect(normal).not.toContain('stroke-dasharray');
    expect(renderKey({ ...mic, soloed: true })).toContain(`stroke="${DARK.accent.solo}"`);
    expect(renderKey({ ...mic, pending: true })).toContain('stroke-dasharray');
    expect(renderKey({ ...mic, muted: true })).toContain(`fill="${DARK.accent.mute}"`);
    expect(renderKey({ ...mic, muted: true })).toContain(`fill="${DARK.muted.background}"`);
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
  const lit = (view: KeyView, color: string) => renderKey(view).includes(`stroke="${color}"`);

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
      lit({ kind: 'snapshot', n: 2, state: 'active', confirmSave: true }, DARK.accent.record),
    ).toBe(true);
    expect(
      lit({ kind: 'recorder', state: 'stopped', confirmRecord: true }, DARK.accent.record),
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
