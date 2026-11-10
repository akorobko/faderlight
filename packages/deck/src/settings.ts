// Global settings: what the plugin keeps in the Stream Deck app's global settings, with a
// version number and migrations, so a settings object written by any earlier build can be read.
//
// readGlobalSettings() never throws. Whatever it gets (nothing, an old version, a damaged object),
// it returns complete settings: known fields are checked and clamped, missing ones take their
// defaults, and `changed` says whether the result should be written back. Settings from a newer
// build are read as far as they go but never written back, so a downgrade cannot destroy them.

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = Record<string, JsonValue>;

/** The current settings version. Bump it with a migration in MIGRATIONS. */
export const SETTINGS_VERSION = 1;

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

export interface GlobalSettings {
  readonly version: typeof SETTINGS_VERSION;
  readonly connection: ConnectionSettings;
  readonly gestures: GestureSettings;
  readonly frames: FrameSettings;
  readonly detail: DetailSettings;
  readonly theme: ThemeName;
}

export const DEFAULT_SETTINGS: GlobalSettings = {
  version: SETTINGS_VERSION,
  connection: { host: '127.0.0.1', sendPort: 7002, listenPort: 9002 },
  gestures: { longPressMs: 450, doubleTapMs: 250, repeatDelayMs: 400, repeatIntervalMs: 100 },
  frames: { budgetPerSecond: 120, maxKeyFps: 15, meterFps: 12 },
  detail: { timeoutSec: 20 },
  theme: 'dark',
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
};

const isObject = (v: unknown): v is JsonObject =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

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

  choice<T extends string>(path: string, fallback: T, options: readonly T[]): T {
    const v = this.get(path);
    if (v === undefined) return fallback;
    if (typeof v === 'string' && (options as readonly string[]).includes(v)) return v as T;
    this.problems.push(`${path}: expected one of ${options.join(', ')}`);
    return fallback;
  }
}
