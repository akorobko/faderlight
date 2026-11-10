// Key specs: what a key is, independent of how it got onto the deck. A specific action dropped
// onto any page gets its spec from its own settings (specFromAction); a Console slot gets its
// spec from the layout (layout.ts). Both kinds of keys share the controllers (controllers.ts).
// Specs are plain JSON, so a layout can be stored in the global settings.

import type { Bus } from '@faderlight/model';
import type { ChannelStyle, ToggleFunction } from '@faderlight/render';
import type { ActionKind } from './actions.ts';
import type { JsonObject, JsonValue } from './settings.ts';

/** Which output a key controls. */
export type OutputRef =
  /** The output TotalMix uses as Main (/controlroom/mainout). */
  | { readonly role: 'main' }
  /** The output assigned to Phones 1-4. */
  | { readonly role: 'phones'; readonly n: 1 | 2 | 3 | 4 }
  /** A fixed output strip, by its left index. */
  | { readonly role: 'output'; readonly index: number };

export type ChannelTap = 'mute' | 'solo' | 'none';
export type ChannelHold = 'detail' | 'solo' | 'phantom' | 'none';

export interface ChannelSpec {
  readonly type: 'channel';
  readonly bus: Bus;
  /** Left index of the strip; undefined: the first visible strip of the bus. */
  readonly index?: number | undefined;
  readonly style?: ChannelStyle | undefined;
  /** What a tap does (default mute). */
  readonly tap?: ChannelTap | undefined;
  /** What a long press does (default: open the Channel Detail overlay). */
  readonly hold?: ChannelHold | undefined;
}

export type Direction = 'prev' | 'next';

/** One key of the Channel Detail overlay (detail.ts). */
export type DetailControl =
  | 'back'
  | 'header'
  | 'gainDown'
  | 'gainUp'
  | 'phantom'
  | 'phase'
  | 'instrument'
  | 'autoSet'
  | 'mute'
  | 'solo'
  | 'faderDown'
  | 'faderUp'
  | 'meter'
  | 'lowCut'
  | 'eq'
  | 'dynamics'
  | 'send'
  | 'fxSend'
  | 'panLeft'
  | 'panRight'
  | 'prev'
  | 'next'
  | 'sendDown'
  | 'sendUp'
  | 'clearClip'
  | 'none';

export interface DetailSpec {
  readonly type: 'detail';
  readonly control: DetailControl;
  /** For `send`: which visible output (from 0). */
  readonly n?: number | undefined;
}

export type KeySpec =
  | { readonly type: 'empty' }
  | ChannelSpec
  | { readonly type: 'output'; readonly output: OutputRef }
  | { readonly type: 'step'; readonly output: OutputRef; readonly direction: 'up' | 'down' }
  | { readonly type: 'snapshot'; readonly n: number }
  | { readonly type: 'toggle'; readonly function: ToggleFunction }
  | { readonly type: 'status' }
  /** A saved level for an output: a tap sets it, a long press saves the current level. */
  | PresetSpec
  // Console layout keys (layout.ts):
  /** The n-th strip (from 0) of one of the page's banks (default the first). */
  | {
      readonly type: 'strip';
      readonly n: number;
      readonly style?: ChannelStyle | undefined;
      readonly bank?: number | undefined;
    }
  /** Moves one of the page's banks (default the first); a long press switches its source. */
  | { readonly type: 'bank'; readonly direction: Direction; readonly bank?: number | undefined }
  /** Goes to page `to`, or else the next (or previous) page; a long press to the first. */
  | {
      readonly type: 'page';
      readonly direction?: Direction | undefined;
      readonly to?: number | undefined;
    }
  /** Switches the deck to the Console profile. */
  | { readonly type: 'console' }
  /** Leaves the Console for the profile the deck showed before it. */
  | { readonly type: 'exit' }
  | DetailSpec;

export interface PresetSpec {
  readonly type: 'preset';
  readonly output: OutputRef;
  /** Which of the output's presets (1-8). */
  readonly n: number;
}

/** Where a preset's level is kept in the global settings, e.g. "main/1", "phones2/1", "4/1". */
export function presetKey(spec: PresetSpec): string {
  const o = spec.output;
  const out =
    o.role === 'main' ? 'main' : o.role === 'phones' ? `phones${String(o.n)}` : String(o.index);
  return `${out}/${String(spec.n)}`;
}

export type SpecType = KeySpec['type'];

export const EMPTY: KeySpec = { type: 'empty' };

// --- action settings ----------------------------------------------------------------------

const str = (v: JsonValue | undefined): string | undefined =>
  typeof v === 'string' ? v : undefined;

function int(v: JsonValue | undefined, min: number, max: number): number | undefined {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : undefined;
}

function oneOf<T extends string>(v: JsonValue | undefined, options: readonly T[]): T | undefined {
  return typeof v === 'string' && (options as readonly string[]).includes(v) ? (v as T) : undefined;
}

/** "main", "phones1"-"phones4" or an output index; anything else is Main. */
export function outputRefFrom(v: JsonValue | undefined): OutputRef {
  const index = int(v, 0, 1023);
  if (index !== undefined) return { role: 'output', index };
  const phones = /^phones([1-4])$/.exec(str(v) ?? '');
  if (phones) return { role: 'phones', n: Number(phones[1]) as 1 | 2 | 3 | 4 };
  return { role: 'main' };
}

/**
 * The spec of a specific action from its settings. Settings come from the Property Inspector
 * (M5); missing or unusable values fall back to defaults, so an action that was just dropped
 * onto a key does something sensible.
 */
export function specFromAction(kind: ActionKind, settings: JsonObject): KeySpec {
  switch (kind) {
    case 'channel':
      return {
        type: 'channel',
        bus: oneOf(settings.bus, ['input', 'playback'] as const) ?? 'input',
        index: int(settings.index, 0, 1023),
        style: oneOf(settings.style, ['full', 'meter', 'minimal'] as const),
        tap: oneOf(settings.tap, ['mute', 'solo', 'none'] as const),
        hold: oneOf(settings.hold, ['detail', 'solo', 'phantom', 'none'] as const),
      };
    case 'output':
      return { type: 'output', output: outputRefFrom(settings.output) };
    case 'phones':
      return {
        type: 'output',
        output: { role: 'phones', n: (int(settings.n, 1, 4) ?? 1) as 1 | 2 | 3 | 4 },
      };
    case 'snapshot':
      return { type: 'snapshot', n: int(settings.n, 1, 8) ?? 1 };
    case 'monitor':
      return {
        type: 'toggle',
        function:
          oneOf(settings.function, ['dim', 'mono', 'talkback', 'speakerB', 'external'] as const) ??
          'dim',
      };
    case 'global':
      return {
        type: 'toggle',
        function: oneOf(settings.function, ['solo'] as const) ? 'globalSolo' : 'globalMute',
      };
    case 'status':
      return { type: 'status' };
    case 'step':
      return {
        type: 'step',
        output: outputRefFrom(settings.output),
        direction: oneOf(settings.direction, ['up', 'down'] as const) ?? 'up',
      };
    case 'console':
      return { type: 'console' };
    case 'preset':
      return {
        type: 'preset',
        output: outputRefFrom(settings.output),
        n: int(settings.n, 1, 8) ?? 1,
      };
    case 'exit':
      return { type: 'exit' };
    case 'slot':
    case 'test-image':
      // Not specs of their own: the runtime resolves these.
      return EMPTY;
  }
}
