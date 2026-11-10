import { describe, expect, it } from 'vitest';
import {
  activeSnapshot,
  channel,
  controlRoom,
  detectProfile,
  deviceModel,
  deviceProfile,
  FIREFACE_UFX_III,
  genericProfile,
  mainOutput,
  MixerStore,
  phonesOutput,
  route,
  routeLevel,
  snapshot,
  strips,
  stripOf,
  type Update,
} from '../src/index.ts';

describe('Fireface UFX III profile', () => {
  const p = FIREFACE_UFX_III;

  it('has 94, 54 and 34 channels per bus at single, double and quad speed', () => {
    for (const bus of ['input', 'playback', 'output'] as const) {
      expect(p.channelCount(bus)).toBe(94);
      expect(p.channelCount(bus, 'double')).toBe(54);
      expect(p.channelCount(bus, 'quad')).toBe(34);
    }
  });

  it.each([
    ['input', 0, 'single', 'AN 1'],
    ['input', 7, 'single', 'AN 8'],
    ['input', 8, 'single', 'Mic 9'],
    ['input', 11, 'single', 'Mic 12'],
    ['input', 12, 'single', 'AES L'],
    ['input', 13, 'single', 'AES R'],
    ['input', 14, 'single', 'ADAT 1'],
    ['input', 29, 'single', 'ADAT 16'],
    ['input', 30, 'single', 'MADI 1'],
    ['input', 93, 'single', 'MADI 64'],
    ['input', 21, 'double', 'ADAT 8'],
    ['input', 22, 'double', 'MADI 1'],
    ['input', 17, 'quad', 'ADAT 4'],
    ['input', 18, 'quad', 'MADI 1'],
    ['output', 2, 'single', 'AN 3'],
    ['output', 8, 'single', 'PH 9'],
    ['output', 11, 'single', 'PH 12'],
    ['playback', 8, 'single', 'PH 9'],
    ['input', 94, 'single', 'In 95'],
  ] as const)('labels %s %i at %s speed as %s', (bus, index, speed, label) => {
    expect(p.label(bus, index, speed)).toBe(label);
  });

  it.each([
    ['input', 2, true, 'AN 3/4'],
    ['input', 8, true, 'Mic 9/10'],
    ['input', 4, false, 'AN 5'],
    ['input', 12, true, 'AES'],
    ['input', 14, true, 'ADAT 1/2'],
    ['output', 8, true, 'PH 9/10'],
    ['output', 10, true, 'PH 11/12'],
    ['output', 30, true, 'MADI 1/2'],
  ] as const)('labels the %s strip at %i (stereo %s) as %s', (bus, index, stereo, label) => {
    expect(p.stripLabel(bus, index, stereo)).toBe(label);
  });

  it('knows the preamp gain ranges', () => {
    expect(p.inputGain(8)).toEqual({ min: 0, max: 75, step: 1, minAboveZero: 8 });
    expect(p.inputGain(11, { instrument: true })).toEqual({ min: 8, max: 50, step: 1 });
    expect(p.inputGain(0)).toEqual({ min: 0, max: 12, step: 0.5 });
    expect(p.inputGain(12)).toBeUndefined();
  });
});

describe('profile detection', () => {
  it('finds the UFX III by its reported model name', () => {
    expect(detectProfile('Fireface UFX III').id).toBe('fireface-ufx-iii');
    expect(detectProfile(' fireface ufx iii ').id).toBe('fireface-ufx-iii');
  });

  it('falls back to a generic profile with numbered labels', () => {
    const p = detectProfile('Fireface 802');
    expect(p.id).toBe('generic');
    expect(p.model).toBe('Fireface 802');
    expect(p.label('input', 0)).toBe('In 1');
    expect(p.label('playback', 3)).toBe('Play 4');
    expect(p.stripLabel('output', 4, true)).toBe('Out 5/6');
    expect(p.channelCount('input')).toBeUndefined();
    expect(p.inputGain(8)).toBeUndefined();
    expect(detectProfile(undefined).id).toBe('generic');
    expect(genericProfile('x').label('output', 0)).toBe('Out 1');
  });
});

describe('selectors', () => {
  // A small slice of the baseline capture's state.
  const updates: Update[] = [
    { target: { scope: 'status', field: 'device' }, value: 'Fireface UFX III' },
    { target: channel('input', 8, 'name'), value: 'OC 818' },
    { target: channel('input', 8, 'stereo'), value: true },
    { target: channel('input', 4, 'name'), value: 'RD 2000' },
    { target: channel('input', 4, 'stereo'), value: false },
    { target: channel('output', 2, 'name'), value: 'Main' },
    { target: channel('output', 2, 'stereo'), value: true },
    { target: channel('output', 8, 'name'), value: 'Phones 1' },
    { target: channel('output', 8, 'stereo'), value: true },
    { target: controlRoom('mainOut'), value: 2 },
    { target: controlRoom('phones1'), value: 8 },
    { target: controlRoom('phones2'), value: -1 },
    { target: snapshot(1), value: 'inactive' },
    { target: snapshot(2), value: 'modified' },
    { target: route('input', 8, 2, 'fader'), value: -3.5 },
  ];
  const store = new MixerStore();
  store.applyDevice(updates);

  it('lists the strips the device reported, with names and physical labels', () => {
    expect(strips(store, 'input')).toEqual([
      { bus: 'input', index: 4, right: undefined, stereo: false, name: 'RD 2000', label: 'AN 5' },
      { bus: 'input', index: 8, right: 9, stereo: true, name: 'OC 818', label: 'Mic 9/10' },
    ]);
    expect(strips(store, 'playback')).toEqual([]);
    expect(stripOf(store, 'input', 9)?.name).toBe('OC 818');
    expect(stripOf(store, 'input', 5)).toBeUndefined();
  });

  it('skips the right channel of a pair linked since the last full sync', () => {
    // AN 5 and AN 6 were two mono strips; then AN 5/6 was linked in TotalMix, which reports
    // the left index as stereo. The name at AN 6 stays until a full sync removes it.
    const s = new MixerStore();
    s.applyDevice([
      { target: { scope: 'status', field: 'device' }, value: 'Fireface UFX III' },
      { target: channel('input', 4, 'name'), value: 'RD 2000' },
      { target: channel('input', 4, 'stereo'), value: false },
      { target: channel('input', 5, 'name'), value: 'AN 6' },
      { target: channel('input', 5, 'stereo'), value: false },
    ]);
    expect(strips(s, 'input').map((x) => x.index)).toEqual([4, 5]);
    s.applyDevice([{ target: channel('input', 4, 'stereo'), value: true }]);
    expect(strips(s, 'input')).toEqual([
      { bus: 'input', index: 4, right: 5, stereo: true, name: 'RD 2000', label: 'AN 5/6' },
    ]);
    expect(stripOf(s, 'input', 5)?.name).toBe('RD 2000');
  });

  it('finds Main and the phones through the control room assignment', () => {
    expect(mainOutput(store)?.name).toBe('Main');
    expect(mainOutput(store)?.label).toBe('AN 3/4');
    expect(phonesOutput(store, 1)?.label).toBe('PH 9/10');
    expect(phonesOutput(store, 2)).toBeUndefined();
    expect(phonesOutput(store, 3)).toBeUndefined();
  });

  it('reports the device, its profile and the loaded snapshot', () => {
    expect(deviceModel(store)).toBe('Fireface UFX III');
    expect(deviceProfile(store).id).toBe('fireface-ufx-iii');
    expect(activeSnapshot(store)).toEqual({ n: 2, modified: true });
    expect(activeSnapshot(new MixerStore())).toBeUndefined();
  });

  it('reads a route that is not reported as off only after a full sync', () => {
    const s = new MixerStore();
    s.applyDevice(updates);
    expect(routeLevel(s, 'input', 8, 2)).toBe(-3.5);
    expect(routeLevel(s, 'input', 4, 2)).toBeUndefined();
    s.beginSync();
    s.applyDevice(updates);
    s.endSync();
    expect(routeLevel(s, 'input', 4, 2)).toBe(-Infinity);
  });
});
