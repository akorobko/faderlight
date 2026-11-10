import { describe, expect, it } from 'vitest';
import {
  channel,
  controlRoom,
  keyOf,
  MixerStore,
  route,
  sameValue,
  type StoreChange,
  type Target,
} from '../src/index.ts';

const mute = channel('input', 8, 'mute');
const volume = channel('output', 2, 'volume');
const name = channel('input', 8, 'name');

function recorder(store: MixerStore): StoreChange[] {
  const changes: StoreChange[] = [];
  store.subscribe((c) => changes.push(c));
  return changes;
}

const keys = (c: StoreChange | undefined): string[] => [...(c?.keys ?? [])].sort();

describe('device values', () => {
  it('stores confirmed values and raises one event per batch', () => {
    const store = new MixerStore();
    const changes = recorder(store);
    store.applyDevice([
      { target: mute, value: false },
      { target: name, value: 'OC 818' },
    ]);
    expect(store.get(mute)).toEqual({ target: mute, value: false, state: 'confirmed' });
    expect(store.value(name)).toBe('OC 818');
    expect(changes).toHaveLength(1);
    expect(keys(changes[0])).toEqual([keyOf(mute), keyOf(name)].sort());
    expect(changes[0]?.connection).toBe(false);
  });

  it('raises no event when a value is reported again unchanged', () => {
    const store = new MixerStore();
    store.applyDevice([{ target: volume, value: -20 }]);
    const changes = recorder(store);
    store.applyDevice([{ target: volume, value: -20 }]);
    store.applyDevice([]);
    expect(changes).toEqual([]);
  });

  it('merges nested batches into one event', () => {
    const store = new MixerStore();
    const changes = recorder(store);
    store.batch(() => {
      store.applyDevice([{ target: mute, value: true }]);
      store.setConnection('live');
      store.applyDevice([{ target: volume, value: -3 }]);
    });
    expect(changes).toHaveLength(1);
    expect(changes[0]?.connection).toBe(true);
    expect(keys(changes[0])).toEqual([keyOf(volume), keyOf(mute)].sort());
    expect(store.connection).toBe('live');
  });

  it('unsubscribes', () => {
    const store = new MixerStore();
    const changes: StoreChange[] = [];
    const off = store.subscribe((c) => changes.push(c));
    off();
    store.applyDevice([{ target: mute, value: true }]);
    expect(changes).toEqual([]);
  });
});

describe('pending writes', () => {
  it('confirms when the device reports the written value', () => {
    const store = new MixerStore();
    store.applyDevice([{ target: mute, value: false }]);
    const changes = recorder(store);
    store.setPending(mute, true);
    expect(store.get(mute)).toMatchObject({ value: true, state: 'pending' });
    store.applyDevice([{ target: mute, value: true }]);
    expect(store.get(mute)).toMatchObject({ value: true, state: 'confirmed' });
    expect(changes).toHaveLength(2);
  });

  it('keeps a different value that arrives before the confirming request aside', () => {
    const store = new MixerStore();
    store.applyDevice([{ target: volume, value: -20 }]);
    store.setPending(volume, -10);
    // An older reply crossing our write: not taken as the answer.
    store.applyDevice([{ target: volume, value: -21 }]);
    expect(store.get(volume)).toMatchObject({ value: -10, state: 'pending' });
    // No answer in time: back to the latest device value.
    expect(store.rollback(volume)).toBe(true);
    expect(store.get(volume)).toMatchObject({ value: -21, state: 'confirmed' });
  });

  it('takes the device value as a correction once the confirming request went out', () => {
    const store = new MixerStore();
    store.applyDevice([{ target: volume, value: -20 }]);
    store.setPending(volume, 12);
    store.awaitReply(volume);
    store.applyDevice([{ target: volume, value: 6 }]); // clamped by the device
    expect(store.get(volume)).toMatchObject({ value: 6, state: 'confirmed' });
  });

  it('treats values equal as float32 as the same', () => {
    const store = new MixerStore();
    store.setPending(volume, -3.535715);
    store.applyDevice([{ target: volume, value: Math.fround(-3.535715) }]);
    expect(store.get(volume)?.state).toBe('confirmed');
    expect(sameValue(-Infinity, -Infinity)).toBe(true);
    expect(sameValue(0.1, Math.fround(0.1))).toBe(true);
    expect(sameValue(0.1, 0.2)).toBe(false);
    expect(sameValue('a', 'a')).toBe(true);
    expect(sameValue(true, 1)).toBe(false);
  });

  it('rolls back to unknown when the device never reported the target', () => {
    const store = new MixerStore();
    const hidden = channel('input', 0, 'mute');
    store.setPending(hidden, true);
    expect(store.rollback(hidden)).toBe(true);
    expect(store.get(hidden)).toBeUndefined();
  });

  it('does nothing when rolling back a confirmed value', () => {
    const store = new MixerStore();
    store.applyDevice([{ target: mute, value: false }]);
    expect(store.rollback(mute)).toBe(false);
    expect(store.isPending(mute)).toBe(false);
  });

  it('a newer write needs its own confirming request', () => {
    const store = new MixerStore();
    store.applyDevice([{ target: volume, value: -20 }]);
    store.setPending(volume, -19);
    store.awaitReply(volume);
    store.setPending(volume, -18);
    store.applyDevice([{ target: volume, value: -19 }]); // answer to the first write
    expect(store.get(volume)).toMatchObject({ value: -18, state: 'pending' });
  });
});

describe('full sync', () => {
  const routeOn: Target = route('input', 8, 2, 'fader');
  const hiddenName = channel('input', 0, 'name');

  it('removes what the dump did not report: hidden channels, routes that are off', () => {
    const store = new MixerStore();
    store.applyDevice([
      { target: name, value: 'OC 818' },
      { target: hiddenName, value: 'AN 1' },
      { target: routeOn, value: -3 },
      { target: controlRoom('dim'), value: false },
    ]);
    expect(store.synced).toBe(false);
    const changes = recorder(store);
    store.beginSync();
    store.applyDevice([
      { target: name, value: 'OC 818' },
      { target: controlRoom('dim'), value: false },
    ]);
    store.endSync();
    expect(store.get(hiddenName)).toBeUndefined();
    expect(store.get(routeOn)).toBeUndefined();
    expect(store.value(name)).toBe('OC 818');
    expect(store.synced).toBe(true);
    expect(keys(changes.at(-1))).toEqual([keyOf(hiddenName), keyOf(routeOn)].sort());
  });

  it('keeps pending values and everything when the sync is aborted', () => {
    const store = new MixerStore();
    store.applyDevice([{ target: hiddenName, value: 'AN 1' }]);
    store.setPending(mute, true);
    store.beginSync();
    store.abortSync();
    store.endSync(); // no sync in progress: nothing happens
    expect(store.value(hiddenName)).toBe('AN 1');
    store.beginSync();
    store.endSync();
    expect(store.get(hiddenName)).toBeUndefined();
    expect(store.get(mute)).toMatchObject({ value: true, state: 'pending' });
  });

  it('clears values, meters and the synced flag', () => {
    const store = new MixerStore();
    store.meters.push('input', 8, -20, 0);
    store.beginSync();
    store.applyDevice([{ target: name, value: 'OC 818' }]);
    store.endSync();
    const changes = recorder(store);
    store.clear();
    expect(store.size).toBe(0);
    expect(store.synced).toBe(false);
    expect(store.meters.has('input', 8)).toBe(false);
    expect(keys(changes[0])).toEqual([keyOf(name)]);
  });
});

describe('connection state', () => {
  it('raises an event only on change', () => {
    const store = new MixerStore();
    const changes = recorder(store);
    store.setConnection('idle');
    store.setConnection('probing');
    store.setConnection('probing');
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ connection: true });
    expect(changes[0]?.keys.size).toBe(0);
  });
});
