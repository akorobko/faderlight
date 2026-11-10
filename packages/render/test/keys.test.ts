// Behaviour of the key renderers that the golden images do not spell out.

import { describe, expect, it } from 'vitest';
import {
  channelColor,
  DARK,
  look,
  nameAndLabel,
  renderKey,
  type ChannelKey,
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
