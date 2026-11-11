// Draft edits on the settings pages: an emptied box takes its entry out, so a draft changed and
// changed back is equal to the saved settings again.
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@faderlight/deck';
import { parsePreset, withChannel, withEntry } from '../ui/edits.ts';

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
