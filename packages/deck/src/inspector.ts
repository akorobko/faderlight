// What a key's Property Inspector shows (docs/design/03-ux.md §5.1). The plugin builds it here,
// from the action's settings and the live mixer, and the inspector page (packages/plugin/pi)
// only draws it: so the page has no rules of its own, and lists such as the channel picker
// follow the mixer while the inspector is open. Every choice is a list to pick from.

import {
  deviceModel,
  mainOutput,
  phonesOutput,
  stripOf,
  strips,
  type Bus,
  type MixerStore,
  type Strip,
} from '@faderlight/model';
import type { ToggleFunction } from '@faderlight/render';
import type { Clock, TimerHandle } from '@faderlight/totalmix';
import { ACTIONS, type ActionKind } from './actions.ts';
import type { GlobalSettings, JsonObject, JsonValue } from './settings.ts';
import {
  presetKey,
  specFromAction,
  type DetailControl,
  type KeySpec,
  type OutputRef,
} from './specs.ts';

/** A setting's value; null: not set, the action's default applies. */
export type InspectorValue = string | number | null;

export interface InspectorOption {
  readonly value: InspectorValue;
  readonly label: string;
  /** Options with a group are shown under its heading. */
  readonly group?: string;
}

export interface InspectorField {
  /** The action setting it changes. */
  readonly key: string;
  readonly label: string;
  readonly value: InspectorValue;
  readonly options: readonly InspectorOption[];
  readonly help?: string;
}

export type InspectorStatusState = 'ok' | 'busy' | 'fail' | 'off';

export interface InspectorView {
  /** The action's name. */
  readonly title: string;
  /** What the key is now, in a sentence. */
  readonly summary: string;
  /** More about the action, when it needs saying. */
  readonly note?: string;
  readonly fields: readonly InspectorField[];
  /** The connection to TotalMix. */
  readonly status: { readonly state: InspectorStatusState; readonly text: string };
  /** The Control Center section the inspector's button opens. */
  readonly section: string;
}

/** What the plugin needs to know about a key, besides its action and settings. */
export interface InspectorInput {
  readonly kind: ActionKind;
  readonly settings: JsonObject;
  readonly store: MixerStore;
  readonly global: GlobalSettings;
  /** What a Console Slot shows now (the runtime knows the page and the bank). */
  readonly slot?: KeySpec | undefined;
  readonly snapshotName: (n: number) => string | undefined;
}

// --- messages between the inspector page and the plugin -----------------------------------

/** From the inspector page (in a `sendToPlugin` payload). */
export type InspectorRequest =
  | { readonly event: 'hello' }
  | { readonly event: 'set'; readonly key: string; readonly value: InspectorValue }
  | { readonly event: 'openControlCenter' };

/** To the inspector page (in a `sendToPropertyInspector` payload). */
export interface InspectorUpdate {
  readonly event: 'view';
  readonly view: InspectorView;
}

export function readInspectorRequest(payload: JsonValue): InspectorRequest | undefined {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return undefined;
  switch (payload.event) {
    case 'hello':
    case 'openControlCenter':
      return { event: payload.event };
    case 'set': {
      const { key, value } = payload;
      if (typeof key !== 'string') return undefined;
      if (value !== null && typeof value !== 'string' && typeof value !== 'number')
        return undefined;
      return { event: 'set', key, value };
    }
    default:
      return undefined;
  }
}

// --- the view -------------------------------------------------------------------------------

const BUS_WORD: Readonly<Record<Bus, string>> = {
  input: 'Input',
  playback: 'Playback',
  output: 'Output',
};

const TOGGLE_WORD: Readonly<Record<ToggleFunction, string>> = {
  dim: 'Dim',
  mono: 'Mono',
  talkback: 'Talkback',
  speakerB: 'Speaker B',
  external: 'External input',
  globalMute: 'Global Mute',
  globalSolo: 'Global Solo',
};

const stripText = (s: Strip): string => (s.name === '' ? s.label : `${s.label} · ${s.name}`);

function formatDb(db: number): string {
  if (db === -Infinity) return 'off';
  const text = db.toFixed(1).replace('-', '−');
  return `${db > 0 ? '+' : ''}${text} dB`;
}

function outputValue(o: OutputRef): string | number {
  return o.role === 'main' ? 'main' : o.role === 'phones' ? `phones${String(o.n)}` : o.index;
}

function outputText(store: MixerStore, o: OutputRef): string {
  if (o.role === 'main') {
    const s = mainOutput(store);
    return s ? `Main (${stripText(s)})` : 'Main';
  }
  if (o.role === 'phones') {
    const s = phonesOutput(store, o.n);
    return s ? `Phones ${String(o.n)} (${stripText(s)})` : `Phones ${String(o.n)}`;
  }
  const s = stripOf(store, 'output', o.index);
  return s ? stripText(s) : `Output ${String(o.index + 1)}`;
}

function channelField(store: MixerStore, bus: Bus, index: number | undefined): InspectorField {
  const list = strips(store, bus);
  const options: InspectorOption[] = [{ value: null, label: 'First channel' }];
  for (const s of list) options.push({ value: s.index, label: stripText(s) });
  if (index !== undefined && !list.some((s) => s.index === index)) {
    // Kept as set, though TotalMix does not show it (hidden, or not connected yet).
    options.push({ value: index, label: `${BUS_WORD[bus]} ${String(index + 1)} (not shown)` });
  }
  return {
    key: 'index',
    label: 'Channel',
    value: index ?? null,
    options,
    help:
      list.length === 0
        ? 'The list fills once TotalMix is connected.'
        : 'The channels TotalMix shows, by name.',
  };
}

function outputField(store: MixerStore, o: OutputRef): InspectorField {
  const options: InspectorOption[] = [
    { value: 'main', label: outputText(store, { role: 'main' }), group: 'Follows TotalMix' },
  ];
  for (const n of [1, 2, 3, 4] as const) {
    options.push({
      value: `phones${String(n)}`,
      label: outputText(store, { role: 'phones', n }),
      group: 'Follows TotalMix',
    });
  }
  const list = strips(store, 'output');
  for (const s of list) options.push({ value: s.index, label: stripText(s), group: 'Outputs' });
  if (o.role === 'output' && !list.some((s) => s.index === o.index)) {
    options.push({
      value: o.index,
      label: `Output ${String(o.index + 1)} (not shown)`,
      group: 'Outputs',
    });
  }
  return {
    key: 'output',
    label: 'Output',
    value: outputValue(o),
    options,
    help: 'Main and Phones follow the outputs TotalMix assigns to them.',
  };
}

const choice = (
  key: string,
  label: string,
  value: InspectorValue,
  options: readonly (readonly [InspectorValue, string])[],
  help?: string,
): InspectorField => ({
  key,
  label,
  value,
  options: options.map(([v, l]) => ({ value: v, label: l })),
  ...(help === undefined ? {} : { help }),
});

const numbers = (count: number, label: (n: number) => string): [number, string][] =>
  Array.from({ length: count }, (_, i) => [i + 1, label(i + 1)]);

function fieldsOf(input: InspectorInput): InspectorField[] {
  const { kind, settings, store } = input;
  const spec = specFromAction(kind, settings);
  switch (spec.type) {
    case 'channel':
      return [
        choice('bus', 'Row', spec.bus, [
          ['input', 'Inputs'],
          ['playback', 'Playback'],
        ]),
        channelField(store, spec.bus, spec.index),
        choice('tap', 'Tap', spec.tap ?? 'mute', [
          ['mute', 'Mute'],
          ['solo', 'Solo'],
          ['none', 'Nothing'],
        ]),
        choice('hold', 'Hold', spec.hold ?? 'detail', [
          ['detail', 'Channel Detail'],
          ['solo', 'Solo'],
          ['phantom', '48V'],
          ['none', 'Nothing'],
        ]),
        choice('style', 'Style', spec.style ?? 'full', [
          ['full', 'Full: value and meter'],
          ['meter', 'Meter: a tall meter'],
          ['minimal', 'Minimal: name only'],
        ]),
      ];
    case 'output':
      if (kind === 'phones') {
        return [
          choice(
            'n',
            'Phones',
            spec.output.role === 'phones' ? spec.output.n : 1,
            numbers(4, (n) => outputText(store, { role: 'phones', n: n as 1 | 2 | 3 | 4 })),
          ),
        ];
      }
      return [outputField(store, spec.output)];
    case 'snapshot':
      return [
        choice(
          'n',
          'Snapshot',
          spec.n,
          numbers(8, (n) => {
            const name = input.snapshotName(n);
            return name === undefined ? String(n) : `${String(n)} · ${name}`;
          }),
          'Names come from TotalMix (its state file), or from the Control Center.',
        ),
      ];
    case 'toggle':
      if (kind === 'global') {
        return [
          choice('function', 'Switch', spec.function === 'globalSolo' ? 'solo' : 'mute', [
            ['mute', 'Global Mute'],
            ['solo', 'Global Solo'],
          ]),
        ];
      }
      return [
        choice(
          'function',
          'Switch',
          spec.function,
          (['dim', 'mono', 'talkback', 'speakerB', 'external'] as const).map((f) => [
            f,
            TOGGLE_WORD[f],
          ]),
          spec.function === 'talkback' ? 'On while held; a double tap keeps it on.' : undefined,
        ),
      ];
    case 'step':
      return [
        outputField(store, spec.output),
        choice('direction', 'Direction', spec.direction, [
          ['up', 'Up'],
          ['down', 'Down'],
        ]),
      ];
    case 'preset':
      return [
        outputField(store, spec.output),
        choice(
          'n',
          'Preset',
          spec.n,
          numbers(8, (n) => {
            const db = input.global.levels[presetKey({ ...spec, n })];
            return `${String(n)} · ${db === undefined ? 'nothing saved' : formatDb(db)}`;
          }),
          'Presets with the same output and number are shared by every key.',
        ),
      ];
    default:
      return [];
  }
}

const DETAIL_WORD: Partial<Record<DetailControl, string>> = {
  back: 'Back',
  header: 'the channel’s name',
  meter: 'its meter',
  prev: 'the previous channel',
  next: 'the next channel',
  clearClip: 'Clear Clip',
};

/** What a key spec does, in a few words. */
export function describeSpec(spec: KeySpec, input: InspectorInput): string {
  const { store } = input;
  switch (spec.type) {
    case 'empty':
      return 'Nothing: an empty key.';
    case 'channel': {
      if (spec.index === undefined) {
        const first = strips(store, spec.bus)[0];
        return first
          ? `${BUS_WORD[spec.bus]} ${stripText(first)}, the first channel of the row.`
          : `The first ${BUS_WORD[spec.bus].toLowerCase()} channel.`;
      }
      const s = stripOf(store, spec.bus, spec.index);
      return s
        ? `${BUS_WORD[spec.bus]} ${stripText(s)}.`
        : `${BUS_WORD[spec.bus]} ${String(spec.index + 1)}, which TotalMix does not show now.`;
    }
    case 'output':
      return `${outputText(store, spec.output)}: volume and meter.`;
    case 'step':
      return `${outputText(store, spec.output)}, volume ${spec.direction}.`;
    case 'snapshot': {
      const name = input.snapshotName(spec.n);
      return `Loads snapshot ${String(spec.n)}${name === undefined ? '' : ` (${name})`}.`;
    }
    case 'toggle':
      return `${TOGGLE_WORD[spec.function]}.`;
    case 'status':
      return 'The connection to TotalMix. A tap opens the Control Center, a hold reads the mixer again.';
    case 'preset': {
      const db = input.global.levels[presetKey(spec)];
      return `${outputText(store, spec.output)}, preset ${String(spec.n)}: ${
        db === undefined
          ? 'nothing saved yet, hold the key to save the current level'
          : formatDb(db)
      }.`;
    }
    case 'strip':
      return 'A channel of the page’s bank.';
    case 'bank':
      return `Moves the page’s bank ${spec.direction === 'prev' ? 'back' : 'on'}; a hold switches its row.`;
    case 'page':
      return 'Goes to the next page; a hold back to the Console.';
    case 'console':
      return 'Opens the Console profile on this device.';
    case 'exit':
      return 'Leaves the Console for the profile shown before.';
    case 'detail': {
      const word = DETAIL_WORD[spec.control];
      return word === undefined
        ? 'A control of the Channel Detail overlay.'
        : `Channel Detail: ${word}.`;
    }
  }
}

function summaryOf(input: InspectorInput): string {
  const { kind } = input;
  if (kind === 'slot')
    return `Now: ${input.slot ? describeSpec(input.slot, input) : 'nothing yet.'}`;
  if (kind === 'test-image') return 'Shows the renderer’s test images (a development aid).';
  return describeSpec(specFromAction(kind, input.settings), input);
}

function statusOf(store: MixerStore, listenPort: number): InspectorView['status'] {
  const device = deviceModel(store);
  switch (store.connection) {
    case 'live':
      return { state: 'ok', text: `Connected to ${device ?? 'TotalMix'}` };
    case 'syncing':
      return { state: 'busy', text: 'Reading the mixer' };
    case 'probing':
      return { state: 'fail', text: `No reply from TotalMix on port ${String(listenPort)}` };
    case 'stale':
      return { state: 'fail', text: 'TotalMix stopped answering' };
    case 'idle':
      return { state: 'off', text: 'Not connected' };
  }
}

const SECTION: Partial<Record<ActionKind, string>> = {
  slot: 'layout',
  channel: 'channels',
  output: 'channels',
  phones: 'channels',
  snapshot: 'channels',
  preset: 'channels',
  step: 'channels',
};

const SLOT_NOTE =
  'A key of the Console layout: what it shows follows the page, the bank and the Channel Detail overlay. The layout is set up in the Control Center.';

export function inspectorView(input: InspectorInput): InspectorView {
  return {
    title: ACTIONS.find((a) => a.kind === input.kind)?.name ?? input.kind,
    summary: summaryOf(input),
    ...(input.kind === 'slot' ? { note: SLOT_NOTE } : {}),
    fields: fieldsOf(input),
    status: statusOf(input.store, input.global.connection.listenPort),
    section: SECTION[input.kind] ?? 'connection',
  };
}

// --- changes --------------------------------------------------------------------------------

/** The settings each action's inspector may change. */
const KEYS: Readonly<Record<ActionKind, readonly string[]>> = {
  slot: [],
  channel: ['bus', 'index', 'tap', 'hold', 'style'],
  output: ['output'],
  phones: ['n'],
  snapshot: ['n'],
  monitor: ['function'],
  global: ['function'],
  status: [],
  step: ['output', 'direction'],
  console: [],
  preset: ['output', 'n'],
  exit: [],
  'test-image': [],
};

/**
 * The action's settings after one change from its inspector, or undefined when it may not
 * make it. Null removes the setting, so its default applies.
 */
export function changeSetting(
  kind: ActionKind,
  settings: JsonObject,
  key: string,
  value: InspectorValue,
): JsonObject | undefined {
  if (!KEYS[kind].includes(key)) return undefined;
  // A new row clears the channel: it was one of the old row's.
  const cleared =
    kind === 'channel' && key === 'bus' && value !== settings.bus ? ['index', key] : [key];
  const next = Object.fromEntries(
    Object.entries(settings).filter(([k]) => !cleared.includes(k)),
  ) as Record<string, JsonValue>;
  if (value !== null) next[key] = value;
  return next;
}

// --- sessions -------------------------------------------------------------------------------

/** What the inspectors need from the deck runtime and the host. */
export interface InspectorHost {
  /** The view of a key's inspector, or undefined when the key is gone. */
  view(id: string): InspectorView | undefined;
  /** Applies one change to a key's settings and stores them; false when it was refused. */
  change(id: string, key: string, value: InspectorValue): boolean;
  /** Sends a message to the inspector of a key. */
  send(id: string, update: InspectorUpdate): void;
  openControlCenter?(section: string): void;
}

/** How often an open inspector looks for changes (a channel renamed, a link coming up). */
export const INSPECTOR_REFRESH_MS = 500;

/**
 * The open inspectors (the Stream Deck app shows one at a time). Each gets its view when it
 * says hello and again whenever the view changes, so the channel list and the status line
 * stay live.
 */
export class Inspectors {
  private readonly host: InspectorHost;
  private readonly clock: Clock;
  private readonly open = new Map<string, string | undefined>();
  private timer: TimerHandle | undefined;

  constructor(host: InspectorHost, clock: Clock) {
    this.host = host;
    this.clock = clock;
  }

  /** The inspector of a key became visible. */
  appear(id: string): void {
    this.open.set(id, undefined);
    this.refresh(id);
    this.schedule();
  }

  disappear(id: string): void {
    this.open.delete(id);
    if (this.open.size === 0) {
      this.clock.clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  /** A message from a key's inspector page. */
  message(id: string, payload: JsonValue): void {
    const request = readInspectorRequest(payload);
    if (!request) return;
    switch (request.event) {
      case 'hello':
        if (!this.open.has(id)) this.appear(id);
        else this.refresh(id, true);
        return;
      case 'set':
        this.host.change(id, request.key, request.value);
        // Sent even when nothing changed, so the page shows the value in use again.
        this.refresh(id, true);
        return;
      case 'openControlCenter': {
        const view = this.host.view(id);
        this.host.openControlCenter?.(view?.section ?? 'connection');
        return;
      }
    }
  }

  dispose(): void {
    this.open.clear();
    this.clock.clearTimeout(this.timer);
    this.timer = undefined;
  }

  private refresh(id: string, always = false): void {
    const view = this.host.view(id);
    if (!view) return;
    const text = JSON.stringify(view);
    if (!always && this.open.get(id) === text) return;
    this.open.set(id, text);
    this.host.send(id, { event: 'view', view });
  }

  private schedule(): void {
    if (this.timer !== undefined) return;
    this.timer = this.clock.setTimeout(() => {
      this.timer = undefined;
      for (const id of this.open.keys()) this.refresh(id);
      if (this.open.size > 0) this.schedule();
    }, INSPECTOR_REFRESH_MS);
  }
}
