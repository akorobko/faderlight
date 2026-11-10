// Edits of the settings draft that keep it tidy: an emptied box takes its entry out, so a draft
// that was changed and changed back compares equal to what the plugin has.

import type { ChannelSettings, ColorHex, GlobalSettings } from '@faderlight/deck';

/** A map with one entry set, or taken out (undefined). */
export function withEntry<T>(
  map: Readonly<Record<string, T>>,
  key: string,
  value: T | undefined,
): Record<string, T> {
  const rest = Object.fromEntries(Object.entries(map).filter(([k]) => k !== key));
  return value === undefined ? rest : { ...rest, [key]: value };
}

export const channelKey = (bus: string, index: number): string => `${bus}/${String(index)}`;

/** One channel's settings changed; fields set to undefined (or an empty name) go away. */
export function withChannel(
  draft: GlobalSettings,
  key: string,
  change: {
    readonly name?: string | undefined;
    readonly color?: ColorHex | undefined;
    readonly hidden?: boolean | undefined;
  },
): GlobalSettings {
  const merged: Record<string, unknown> = { ...draft.channels[key], ...change };
  const next: { name?: string; color?: ColorHex; hidden?: boolean } = {};
  if (typeof merged.name === 'string' && merged.name.trim() !== '') next.name = merged.name;
  if (typeof merged.color === 'string') next.color = merged.color as ColorHex;
  if (merged.hidden === true) next.hidden = true;
  const value: ChannelSettings | undefined = Object.keys(next).length > 0 ? next : undefined;
  return { ...draft, channels: withEntry(draft.channels, key, value) };
}

/** Where a Level Preset's level is kept: "main/1", "phones2/3", "4/1" (an output index). */
export interface PresetName {
  readonly output: 'main' | `phones${1 | 2 | 3 | 4}` | number;
  readonly n: number;
}

export function parsePreset(key: string): PresetName | undefined {
  const m = /^(main|phones[1-4]|\d+)\/([1-8])$/.exec(key);
  if (!m?.[1] || !m[2]) return undefined;
  const output = /^\d+$/.test(m[1]) ? Number(m[1]) : (m[1] as PresetName['output']);
  return { output, n: Number(m[2]) };
}
