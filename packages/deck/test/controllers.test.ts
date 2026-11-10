import { describe, expect, it } from 'vitest';
import { MixerStore } from '@faderlight/model';
import {
  ACTION_KINDS,
  controllerFor,
  DEFAULT_SETTINGS,
  outputRefFrom,
  specFromAction,
  statusView,
  stepVolume,
  type KeyContext,
} from '../src/index.ts';
import { Loopback } from './loopback.ts';

describe('specFromAction', () => {
  it('gives every action a spec, with defaults for missing settings', () => {
    expect(specFromAction('channel', {})).toEqual({
      type: 'channel',
      bus: 'input',
      index: undefined,
      style: undefined,
      tap: undefined,
      hold: undefined,
    });
    expect(specFromAction('output', {})).toEqual({ type: 'output', output: { role: 'main' } });
    expect(specFromAction('phones', {})).toEqual({
      type: 'output',
      output: { role: 'phones', n: 1 },
    });
    expect(specFromAction('snapshot', {})).toEqual({ type: 'snapshot', n: 1 });
    expect(specFromAction('monitor', {})).toEqual({ type: 'toggle', function: 'dim' });
    expect(specFromAction('global', {})).toEqual({ type: 'toggle', function: 'globalMute' });
    expect(specFromAction('global', { function: 'solo' })).toEqual({
      type: 'toggle',
      function: 'globalSolo',
    });
    expect(specFromAction('step', {})).toEqual({
      type: 'step',
      output: { role: 'main' },
      direction: 'up',
    });
    for (const kind of ACTION_KINDS) expect(specFromAction(kind, {}).type).toBeTypeOf('string');
  });

  it('ignores settings it cannot use', () => {
    expect(
      specFromAction('channel', { bus: 'aux', index: 1.5, style: 'huge', tap: 'solo' }),
    ).toMatchObject({ bus: 'input', index: undefined, style: undefined, tap: 'solo' });
    expect(specFromAction('snapshot', { n: 9 })).toEqual({ type: 'snapshot', n: 1 });
    expect(specFromAction('phones', { n: 4 })).toMatchObject({ output: { n: 4 } });
    expect(specFromAction('monitor', { function: 'globalMute' })).toMatchObject({
      function: 'dim',
    });
  });

  it('reads output references', () => {
    expect(outputRefFrom('main')).toEqual({ role: 'main' });
    expect(outputRefFrom('phones2')).toEqual({ role: 'phones', n: 2 });
    expect(outputRefFrom(12)).toEqual({ role: 'output', index: 12 });
    expect(outputRefFrom('phones5')).toEqual({ role: 'main' });
    expect(outputRefFrom(-1)).toEqual({ role: 'main' });
  });
});

describe('stepVolume', () => {
  it('steps in tenths, stops at +6 dB and turns off below the lowest fader position', () => {
    expect(stepVolume(-20, 'up', 0.5)).toBe(-19.5);
    expect(stepVolume(-0.30000001, 'up', 0.1)).toBe(-0.2);
    expect(stepVolume(5.5, 'up', 3)).toBe(6);
    expect(stepVolume(-64.5, 'down', 1)).toBe(-Infinity);
    expect(stepVolume(-Infinity, 'up', 0.5)).toBe(-65);
    expect(stepVolume(-Infinity, 'down', 0.5)).toBe(-Infinity);
  });
});

describe('controllers', () => {
  const context = (mixer: Loopback): KeyContext => ({
    mixer,
    now: mixer.clock.now(),
    settings: DEFAULT_SETTINGS,
    held: false,
    memo: {},
    nav: {
      openDetail: () => false,
      bank: () => undefined,
      moveBank: () => undefined,
      nextBankSource: () => undefined,
      page: 0,
      pages: [],
      goToPage: () => undefined,
      openConsole: () => false,
      exitConsole: () => undefined,
      detail: () => undefined,
      closeDetail: () => undefined,
      moveDetail: () => undefined,
      selectSend: () => undefined,
    },
    alert: () => undefined,
    ok: () => undefined,
    savePreset: () => undefined,
    snapshotName: () => undefined,
    openControlCenter: () => false,
  });

  it('Dim shows how much it takes off, Global Solo how many channels are soloed', () => {
    const mixer = new Loopback();
    mixer.sim.setValue('/controlroom/dimreduction', -20);
    mixer.sim.setValue('/mix/in/8/0/solo', 1);
    mixer.sim.setValue('/mix/in/9/0/solo', 1);
    mixer.connect();
    const ctx = context(mixer);
    const dim = { type: 'toggle', function: 'dim' } as const;
    const solo = { type: 'toggle', function: 'globalSolo' } as const;
    expect(controllerFor(dim).view(dim, ctx)).toMatchObject({ caption: '−20 dB' });
    expect(controllerFor(solo).view(solo, ctx)).toMatchObject({ caption: '2 soloed' });
  });

  it('a step key at its limit says so', () => {
    const mixer = new Loopback();
    mixer.sim.setValue('/output/0/volume', 6);
    mixer.connect();
    const up = { type: 'step', output: { role: 'main' }, direction: 'up' } as const;
    const down = { ...up, direction: 'down' } as const;
    expect(controllerFor(up).view(up, context(mixer))).toMatchObject({ atLimit: true, db: 6 });
    expect(controllerFor(down).view(down, context(mixer))).toMatchObject({ atLimit: false });
  });

  it('the status key explains why it is not live', () => {
    const store = new MixerStore();
    expect(statusView(store, 9002)).toMatchObject({ link: 'idle', message: 'Not connected' });
    store.setConnection('probing');
    expect(statusView(store, 9002)).toMatchObject({ message: 'No reply on port 9002' });
    store.setConnection('live');
    expect(statusView(store, 9002).message).toBeUndefined();
  });
});
