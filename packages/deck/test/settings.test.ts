import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, readGlobalSettings, SETTINGS_VERSION, toJson } from '../src/index.ts';

describe('readGlobalSettings', () => {
  it('gives the defaults for a first start and asks to write them', () => {
    for (const stored of [undefined, null, {}]) {
      const r = readGlobalSettings(stored);
      expect(r.settings).toEqual(DEFAULT_SETTINGS);
      expect(r.changed).toBe(true);
      expect(r.newer).toBe(false);
      expect(r.problems).toEqual([]);
    }
  });

  it('reads current settings back unchanged', () => {
    const r = readGlobalSettings(toJson(DEFAULT_SETTINGS));
    expect(r.settings).toEqual(DEFAULT_SETTINGS);
    expect(r.changed).toBe(false);
  });

  it('ignores key order when deciding to write back', () => {
    const stored = toJson(DEFAULT_SETTINGS);
    const reversed = Object.fromEntries(Object.entries(stored).reverse());
    expect(readGlobalSettings(reversed).changed).toBe(false);
  });

  it('migrates unversioned settings and keeps their fields', () => {
    const r = readGlobalSettings({ connection: { host: '192.168.1.20', sendPort: 7001 } });
    expect(r.settings.version).toBe(SETTINGS_VERSION);
    expect(r.settings.connection).toEqual({
      host: '192.168.1.20',
      sendPort: 7001,
      listenPort: 9002,
    });
    expect(r.changed).toBe(true);
  });

  it('clamps out-of-range numbers and reports them', () => {
    const r = readGlobalSettings({
      version: 1,
      gestures: { longPressMs: 5, doubleTapMs: 9000 },
      frames: { meterFps: 12.4 },
    });
    expect(r.settings.gestures.longPressMs).toBe(200);
    expect(r.settings.gestures.doubleTapMs).toBe(600);
    expect(r.settings.frames.meterFps).toBe(12);
    expect(r.problems).toEqual([
      'gestures.longPressMs: 5 is below 200',
      'gestures.doubleTapMs: 9000 is above 600',
    ]);
  });

  it('replaces values of the wrong type with defaults', () => {
    const r = readGlobalSettings({
      version: 1,
      connection: { host: '  ', sendPort: 'x' },
      theme: 'pink',
      detail: [],
    });
    expect(r.settings.connection).toEqual(DEFAULT_SETTINGS.connection);
    expect(r.settings.theme).toBe('dark');
    expect(r.settings.detail).toEqual(DEFAULT_SETTINGS.detail);
    expect(r.problems).toEqual([
      'connection.host: expected text',
      'connection.sendPort: expected a number',
      'theme: expected one of dark, high-contrast',
    ]);
  });

  it('starts over from defaults when the stored value is not an object', () => {
    const r = readGlobalSettings('garbage');
    expect(r.settings).toEqual(DEFAULT_SETTINGS);
    expect(r.problems).toEqual(['settings: not an object, using defaults']);
  });

  it('reads settings from a newer build but never writes them back', () => {
    const r = readGlobalSettings({ version: 99, theme: 'high-contrast', somethingNew: true });
    expect(r.newer).toBe(true);
    expect(r.changed).toBe(false);
    expect(r.settings.theme).toBe('high-contrast');
  });

  it('drops fields it does not know when writing back', () => {
    const r = readGlobalSettings({ ...toJson(DEFAULT_SETTINGS), stale: 1 });
    expect(r.changed).toBe(true);
    expect(toJson(r.settings)).not.toHaveProperty('stale');
  });
});
