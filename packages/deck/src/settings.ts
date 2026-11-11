// Global settings: what the plugin keeps in the Stream Deck app's global settings, with a
// version number and migrations, so a settings object written by any earlier build can be read.
//
// readGlobalSettings() never throws. Whatever it gets (nothing, an old version, a damaged object),
// it returns complete settings: known fields are checked and clamped, missing ones take their
// defaults, and `changed` says whether the result should be written back. Settings from a newer
// build are read as far as they go but never written back, so a downgrade cannot destroy them.

import { readLayout, type Layout } from './layout.ts';

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = Record<string, JsonValue>;

/** The current settings version. Bump it with a migration in MIGRATIONS. */
export const SETTINGS_VERSION = 3;

export interface ConnectionSettings {
  /** Computer running TotalMix (default 127.0.0.1). */
  readonly host: string;
  /** TotalMix "Port incoming" (default 7002). */
  readonly sendPort: number;
  /** TotalMix "Port outgoing" (default 9002; 0 picks a free port, for tests). */
  readonly listenPort: number;
}

export interface GestureSettings {
  /** Held this long, a press is a long press (default 450 ms). */
  readonly longPressMs: number;
  /** A second press this soon after a tap is a double tap (default 250 ms). */
  readonly doubleTapMs: number;
  /** Held ± keys start repeating after this long (default 400 ms)... */
  readonly repeatDelayMs: number;
  /** ...and then step every this many ms (default 100 ms). */
  readonly repeatIntervalMs: number;
}

export interface FrameSettings {
  /** Key images sent per second, all keys together (default 120). */
  readonly budgetPerSecond: number;
  /** Images per second for one key at most (default 15). */
  readonly maxKeyFps: number;
  /** Meter refresh rate (default 12; 0 draws meters only when something else changes). */
  readonly meterFps: number;
}

export interface DetailSettings {
  /** The Channel Detail overlay closes after this long without a key press (default 20 s, 0 = never). */
  readonly timeoutSec: number;
}

export type ThemeName = 'dark' | 'high-contrast';

/** Saved output levels of the Level Preset keys, in dB, by presetKey() (e.g. "main/1"). */
export type LevelPresets = Readonly<Record<string, number>>;

/** Snapshot names set in the Control Center, by number ("1"-"8"): they win over TotalMix's. */
export type SnapshotNameSettings = Readonly<Record<string, string>>;

/** A key colour, as #rrggbb. */
export type ColorHex = `#${string}`;

/** Key colours for TotalMix's channel colour numbers ("0"-"31"), over the theme's own. */
export type ColorSettings = Readonly<Record<string, ColorHex>>;

/** What the Control Center changes about one channel, by "input/8", "playback/0", "output/0". */
export interface ChannelSettings {
  /** A name for the keys instead of TotalMix's. */
  readonly name?: string;
  /** A key colour instead of the one for TotalMix's colour number. */
  readonly color?: ColorHex;
  /** Left out of the Console's banks (specific actions still show it). */
  readonly hidden?: boolean;
}

export type ChannelSettingsMap = Readonly<Record<string, ChannelSettings>>;

/** Longest snapshot or channel name kept. */
export const NAME_MAX = 40;
/** Highest TotalMix colour number a mapping is kept for. */
export const COLOR_NUMBER_MAX = 31;

/** The lowest and highest level a preset can hold (TotalMix's fader range). */
export const PRESET_MIN_DB = -65;
export const PRESET_MAX_DB = 6;

export interface GlobalSettings {
  readonly version: typeof SETTINGS_VERSION;
  readonly connection: ConnectionSettings;
  readonly gestures: GestureSettings;
  readonly frames: FrameSettings;
  readonly detail: DetailSettings;
  readonly theme: ThemeName;
  readonly levels: LevelPresets;
  readonly snapshots: SnapshotNameSettings;
  readonly colors: ColorSettings;
  readonly channels: ChannelSettingsMap;
  /** The Console's layout from the Control Center's layout builder; undefined: the default. */
  readonly layout?: Layout | undefined;
}

/** The settings of one channel, by its bus and left index. */
export function channelSettings(
  settings: GlobalSettings,
  bus: string,
  index: number,
): ChannelSettings | undefined {
  return settings.channels[`${bus}/${String(index)}`];
}

export const DEFAULT_SETTINGS: GlobalSettings = {
  version: SETTINGS_VERSION,
  connection: { host: '127.0.0.1', sendPort: 7002, listenPort: 9002 },
  gestures: { longPressMs: 450, doubleTapMs: 250, repeatDelayMs: 400, repeatIntervalMs: 100 },
  frames: { budgetPerSecond: 120, maxKeyFps: 15, meterFps: 12 },
  detail: { timeoutSec: 20 },
  theme: 'dark',
  levels: {},
  snapshots: {},
  colors: {},
  channels: {},
};

export interface ReadSettings {
  readonly settings: GlobalSettings;
  /** The stored object differs from `settings`: write `settings` back. */
  readonly changed: boolean;
  /** Written by a newer build: use, but do not write back. */
  readonly newer: boolean;
  /** Fields that were missing a valid value, e.g. "gestures.longPressMs: 5 is below 200". */
  readonly problems: readonly string[];
}

/**
 * Migrations, by the version they upgrade from. Each takes the stored object of that version
 * and returns one of the next version; field checks run after the last one.
 */
const MIGRATIONS: Readonly<Record<number, (stored: JsonObject) => JsonObject>> = {
  // Version 0: anything stored before settings had a version (development builds). Its fields,
  // where present, already have today's names.
  0: (stored) => ({ ...stored, version: 1 }),
  // Version 1 had no level presets.
  1: (stored) => ({ ...stored, version: 2, levels: {} }),
  // Version 2 had no names, colours or channel settings of its own.
  2: (stored) => ({ ...stored, version: 3, snapshots: {}, colors: {}, channels: {} }),
};

const isObject = (v: unknown): v is JsonObject =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isColor = (v: string): boolean => /^#[0-9a-f]{6}$/i.test(v);

/** Reads stored global settings of any version into current, complete settings. */
export function readGlobalSettings(stored: unknown): ReadSettings {
  const problems: string[] = [];
  let data: JsonObject = isObject(stored) ? stored : {};
  if (!isObject(stored) && stored !== undefined && stored !== null) {
    problems.push('settings: not an object, using defaults');
  }
  const rawVersion = data.version;
  let version =
    typeof rawVersion === 'number' && Number.isInteger(rawVersion) && rawVersion >= 0
      ? rawVersion
      : 0;
  const newer = version > SETTINGS_VERSION;
  while (version < SETTINGS_VERSION) {
    const migrate = MIGRATIONS[version];
    if (!migrate) throw new Error(`no settings migration from version ${String(version)}`);
    data = migrate(data);
    version++;
  }

  const read = new Reader(data, problems);
  const settings: GlobalSettings = {
    version: SETTINGS_VERSION,
    connection: {
      host: read.text('connection.host', DEFAULT_SETTINGS.connection.host),
      sendPort: read.int('connection.sendPort', DEFAULT_SETTINGS.connection.sendPort, 1, 65535),
      listenPort: read.int(
        'connection.listenPort',
        DEFAULT_SETTINGS.connection.listenPort,
        0,
        65535,
      ),
    },
    gestures: {
      longPressMs: read.int(
        'gestures.longPressMs',
        DEFAULT_SETTINGS.gestures.longPressMs,
        200,
        2000,
      ),
      doubleTapMs: read.int(
        'gestures.doubleTapMs',
        DEFAULT_SETTINGS.gestures.doubleTapMs,
        100,
        600,
      ),
      repeatDelayMs: read.int(
        'gestures.repeatDelayMs',
        DEFAULT_SETTINGS.gestures.repeatDelayMs,
        150,
        1500,
      ),
      repeatIntervalMs: read.int(
        'gestures.repeatIntervalMs',
        DEFAULT_SETTINGS.gestures.repeatIntervalMs,
        30,
        500,
      ),
    },
    frames: {
      budgetPerSecond: read.int(
        'frames.budgetPerSecond',
        DEFAULT_SETTINGS.frames.budgetPerSecond,
        10,
        500,
      ),
      maxKeyFps: read.int('frames.maxKeyFps', DEFAULT_SETTINGS.frames.maxKeyFps, 1, 30),
      meterFps: read.int('frames.meterFps', DEFAULT_SETTINGS.frames.meterFps, 0, 30),
    },
    detail: {
      timeoutSec: read.int('detail.timeoutSec', DEFAULT_SETTINGS.detail.timeoutSec, 0, 600),
    },
    theme: read.choice('theme', DEFAULT_SETTINGS.theme, ['dark', 'high-contrast'] as const),
    levels: read.levels('levels'),
    snapshots: read.snapshots('snapshots'),
    colors: read.colors('colors'),
    channels: read.channels('channels'),
    ...read.layout('layout'),
  };

  const changed =
    !newer && JSON.stringify(sorted(data)) !== JSON.stringify(sorted(toJson(settings)));
  return { settings, changed, newer, problems };
}

/** The settings as a JSON object for the Stream Deck app. */
export function toJson(settings: GlobalSettings): JsonObject {
  return JSON.parse(JSON.stringify(settings)) as JsonObject;
}

/** Key order does not matter when deciding whether to write back. */
function sorted(v: JsonValue): JsonValue {
  if (Array.isArray(v)) return v.map(sorted);
  if (!isObject(v)) return v;
  return Object.fromEntries(
    Object.keys(v)
      .sort()
      .map((k) => [k, sorted(v[k] ?? null)]),
  );
}

class Reader {
  private readonly data: JsonObject;
  private readonly problems: string[];

  constructor(data: JsonObject, problems: string[]) {
    this.data = data;
    this.problems = problems;
  }

  private get(path: string): JsonValue | undefined {
    let v: JsonValue | undefined = this.data;
    for (const part of path.split('.')) {
      if (!isObject(v)) return undefined;
      v = v[part];
    }
    return v;
  }

  text(path: string, fallback: string): string {
    const v = this.get(path);
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
    if (v !== undefined) this.problems.push(`${path}: expected text`);
    return fallback;
  }

  int(path: string, fallback: number, min: number, max: number): number {
    const v = this.get(path);
    if (v === undefined) return fallback;
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      this.problems.push(`${path}: expected a number`);
      return fallback;
    }
    const n = Math.round(v);
    if (n < min) {
      this.problems.push(`${path}: ${String(v)} is below ${String(min)}`);
      return min;
    }
    if (n > max) {
      this.problems.push(`${path}: ${String(v)} is above ${String(max)}`);
      return max;
    }
    return n;
  }

  /** Level presets: numbers in the fader's range, rounded to tenths; others are dropped. */
  levels(path: string): LevelPresets {
    const v = this.get(path);
    if (v === undefined) return {};
    if (!isObject(v)) {
      this.problems.push(`${path}: expected an object`);
      return {};
    }
    const out: Record<string, number> = {};
    for (const [key, db] of Object.entries(v)) {
      if (typeof db === 'number' && db >= PRESET_MIN_DB && db <= PRESET_MAX_DB) {
        out[key] = Math.round(db * 10) / 10;
      } else {
        this.problems.push(
          `${path}.${key}: expected a level from ${String(PRESET_MIN_DB)} to ${String(PRESET_MAX_DB)} dB`,
        );
      }
    }
    return out;
  }

  /** The Console's layout, if one is stored (as `{layout}`, to spread). */
  layout(path: string): { layout?: Layout } {
    const layout = readLayout(this.get(path), path, this.problems);
    return layout ? { layout } : {};
  }

  private object(path: string): JsonObject {
    const v = this.get(path);
    if (v === undefined) return {};
    if (!isObject(v)) {
      this.problems.push(`${path}: expected an object`);
      return {};
    }
    return v;
  }

  /** Snapshot names 1-8: trimmed, at most NAME_MAX characters; empty ones are dropped. */
  snapshots(path: string): SnapshotNameSettings {
    const out: Record<string, string> = {};
    for (const [key, name] of Object.entries(this.object(path))) {
      if (!/^[1-8]$/.test(key)) {
        this.problems.push(`${path}.${key}: expected a snapshot number from 1 to 8`);
      } else if (typeof name !== 'string') {
        this.problems.push(`${path}.${key}: expected text`);
      } else if (name.trim() !== '') {
        out[key] = name.trim().slice(0, NAME_MAX);
      }
    }
    return out;
  }

  /** Colours by TotalMix colour number: #rrggbb, lower case. */
  colors(path: string): ColorSettings {
    const out: Record<string, ColorHex> = {};
    for (const [key, color] of Object.entries(this.object(path))) {
      const n = Number(key);
      if (!/^\d+$/.test(key) || n > COLOR_NUMBER_MAX) {
        this.problems.push(
          `${path}.${key}: expected a colour number from 0 to ${String(COLOR_NUMBER_MAX)}`,
        );
      } else if (typeof color !== 'string' || !isColor(color)) {
        this.problems.push(`${path}.${key}: expected a colour like #3c8cff`);
      } else {
        out[String(n)] = color.toLowerCase() as ColorHex;
      }
    }
    return out;
  }

  /** Channel settings by "bus/index"; a channel with nothing left is dropped. */
  channels(path: string): ChannelSettingsMap {
    const out: Record<string, ChannelSettings> = {};
    for (const [key, v] of Object.entries(this.object(path))) {
      const at = `${path}.${key}`;
      if (!/^(input|playback|output)\/\d{1,4}$/.test(key)) {
        this.problems.push(`${at}: expected a channel like input/8`);
        continue;
      }
      if (!isObject(v)) {
        this.problems.push(`${at}: expected an object`);
        continue;
      }
      const c: { name?: string; color?: ColorHex; hidden?: boolean } = {};
      if (typeof v.name === 'string' && v.name.trim() !== '') {
        c.name = v.name.trim().slice(0, NAME_MAX);
      } else if (v.name !== undefined && v.name !== '') {
        this.problems.push(`${at}.name: expected text`);
      }
      if (typeof v.color === 'string' && isColor(v.color)) {
        c.color = v.color.toLowerCase() as ColorHex;
      } else if (v.color !== undefined) {
        this.problems.push(`${at}.color: expected a colour like #3c8cff`);
      }
      if (v.hidden === true) c.hidden = true;
      else if (v.hidden !== undefined && v.hidden !== false) {
        this.problems.push(`${at}.hidden: expected true or false`);
      }
      if (Object.keys(c).length > 0) out[key] = c;
    }
    return out;
  }

  choice<T extends string>(path: string, fallback: T, options: readonly T[]): T {
    const v = this.get(path);
    if (v === undefined) return fallback;
    if (typeof v === 'string' && (options as readonly string[]).includes(v)) return v as T;
    this.problems.push(`${path}: expected one of ${options.join(', ')}`);
    return fallback;
  }
}
