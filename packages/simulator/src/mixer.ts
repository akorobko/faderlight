// SimMixer: the simulated TotalMix mixer state and what TotalMix does with each message it
// receives. Pure: no sockets and no timers. `handle()` returns the messages TotalMix would send
// back, grouped into emissions (each emission is packed into its own datagrams); the server
// (server.ts) puts them on the wire.
//
// Behaviour follows docs/protocol/global-osc.md. Seen in the capture:
// - only visible channels exist on the wire; a request for a hidden channel gets no reply;
// - a stereo strip is addressed by its left index, per-side settings also by the right one;
// - requests ignore their argument, except /sendall (2: only routes that are on);
// - writes set the value and are not echoed, except names;
// - a write marks the active snapshot as modified (`/snapshot/load/n f:3`), once;
// - Dim lowers the reported Main volume by the dim reduction and sends that volume.
// Inferred (no capture step tested it): writes to hidden channels are ignored, as with
// "Receive to hidden channels" off; gain writes snap to the preamp's range and steps; a write
// to the Main volume while dimmed sets the dimmed value; snapshot loads restore channel and
// route values (not names or stereo) and send what changed, then the snapshot states.

import { BUSES, type Bus, type SpeedMode } from '@faderlight/model';
import {
  argNumber,
  argString,
  FALSE,
  float,
  message,
  str,
  TRUE,
  type OscArg,
  type OscMessage,
} from '@faderlight/osc';
import { firefaceUfxIII, snapGain, type SimDevice } from './device.ts';
import {
  CHANNEL_FIELD_INDEX,
  CHANNEL_FIELDS,
  FADER_MIN_DB,
  normalise,
  NOT_IN_SNAPSHOT,
  OFF_DB,
  ROUTE_FIELD_INDEX,
  ROUTE_FIELDS,
  SETTINGS,
  SETTINGS_INDEX,
  SNAPSHOT_ACTIVE,
  SNAPSHOT_COUNT,
  SNAPSHOT_INACTIVE,
  SNAPSHOT_MODIFIED,
  type FieldDef,
} from './fields.ts';

export type WireValue = number | string;

/** Messages TotalMix sends in one go; each emission starts a new datagram. */
export type Emission = readonly OscMessage[];

export type RouteSource = 'in' | 'pb';

const ROUTE_BUS: Readonly<Record<RouteSource, Bus>> = { in: 'input', pb: 'playback' };
const MAX_INDEX = 1023;

interface ChannelRecord {
  hidden: boolean;
  /** Stored values of the fields this channel has. */
  readonly values: Map<string, WireValue>;
}

interface SavedState {
  /** `${bus}/${n}/${field}` → stored value. */
  readonly channels: ReadonlyMap<string, WireValue>;
  /** Route key → stored values in ROUTE_FIELDS order. */
  readonly routes: ReadonlyMap<string, readonly number[]>;
}

export type Address =
  | { readonly kind: 'channel'; readonly bus: Bus; readonly index: number; readonly field: string }
  | {
      readonly kind: 'route';
      readonly source: RouteSource;
      readonly index: number;
      readonly output: number;
      readonly field: string;
    }
  | { readonly kind: 'setting'; readonly address: string }
  | { readonly kind: 'snapshot'; readonly n: number }
  | { readonly kind: 'status'; readonly field: 'device' | 'connection' | 'dsp' | 'durec' };

function parseIndex(text: string | undefined): number | undefined {
  if (text === undefined || !/^\d{1,4}$/.test(text)) return undefined;
  const n = Number(text);
  return n <= MAX_INDEX ? n : undefined;
}

const isBus = (s: string | undefined): s is Bus =>
  s === 'input' || s === 'playback' || s === 'output';

/** Classifies a state address (not a request). Undefined for addresses TotalMix does not have. */
export function parseAddress(address: string): Address | undefined {
  if (SETTINGS_INDEX.has(address)) return { kind: 'setting', address };
  const parts = address.split('/').slice(1);
  const [head, a, b, c, ...rest] = parts;
  if (isBus(head)) {
    const index = parseIndex(a);
    const field = [b, c, ...rest].filter((p) => p !== undefined).join('/');
    if (index === undefined || !CHANNEL_FIELD_INDEX[head].has(field)) return undefined;
    return { kind: 'channel', bus: head, index, field };
  }
  if (head === 'mix' && (a === 'in' || a === 'pb') && rest.length === 1) {
    const index = parseIndex(b);
    const output = parseIndex(c);
    const field = rest[0] ?? '';
    if (index === undefined || output === undefined || !ROUTE_FIELD_INDEX.has(field)) {
      return undefined;
    }
    return { kind: 'route', source: a, index, output, field };
  }
  if (head === 'snapshot' && a === 'load' && c === undefined) {
    const n = parseIndex(b);
    return n !== undefined && n >= 1 && n <= SNAPSHOT_COUNT ? { kind: 'snapshot', n } : undefined;
  }
  if (head === 'status' && b === undefined) {
    if (a === 'device' || a === 'connection' || a === 'dsp') return { kind: 'status', field: a };
  }
  if (address === '/durec/state') return { kind: 'status', field: 'durec' };
  return undefined;
}

const wire = (address: string, v: WireValue): OscMessage =>
  message(address, typeof v === 'string' ? str(v) : float(v));

/** OSC argument for a value given in code: booleans as 1/0, like TotalMix's float32 switches. */
export function toArg(value: WireValue | boolean): OscArg {
  if (typeof value === 'boolean') return value ? TRUE : FALSE;
  return typeof value === 'string' ? str(value) : float(value);
}

const routeKey = (source: RouteSource, index: number, output: number): string =>
  `${source}/${String(index)}/${String(output)}`;

export interface SimMixerOptions {
  readonly device?: SimDevice;
  readonly speed?: SpeedMode;
  /** Start with every channel hidden, for layouts that show a few (default: all visible). */
  readonly hidden?: boolean;
}

export class SimMixer {
  readonly device: SimDevice;
  private speedMode: SpeedMode;
  private readonly channels: Readonly<Record<Bus, ChannelRecord[]>>;
  private readonly routes = new Map<string, number[]>();
  private readonly settings = new Map<string, number>();
  private readonly status: { device: string; connection: number; dsp: number; durec: string };
  private readonly snapshotStates: number[];
  private readonly snapshotContents: (SavedState | undefined)[];

  constructor(options: SimMixerOptions = {}) {
    this.device = options.device ?? firefaceUfxIII();
    this.speedMode = options.speed ?? 'single';
    const hidden = options.hidden ?? false;
    const make = (bus: Bus): ChannelRecord[] => {
      // Sized for single speed, the most channels; higher rates use the first ones.
      const count = this.device.channelCount(bus, 'single');
      return Array.from({ length: count }, (_, n) => {
        const features = this.device.features(bus, n);
        const values = new Map<string, WireValue>();
        for (const def of CHANNEL_FIELDS[bus]) {
          if (def.feature !== undefined && !features.has(def.feature)) continue;
          values.set(
            def.name,
            def.initial === undefined
              ? this.device.profile.label(bus, n)
              : Math.fround(def.initial),
          );
        }
        return { hidden, values };
      });
    };
    this.channels = { input: make('input'), playback: make('playback'), output: make('output') };
    for (const def of SETTINGS) this.settings.set(def.name, Math.fround(def.initial ?? 0));
    this.status = { device: this.device.status, connection: 1, dsp: 0, durec: 'Not ready' };
    this.snapshotStates = Array.from({ length: SNAPSHOT_COUNT }, (_, i) =>
      i === 0 ? SNAPSHOT_ACTIVE : SNAPSHOT_INACTIVE,
    );
    this.snapshotContents = Array.from({ length: SNAPSHOT_COUNT }, () => undefined);
  }

  // --- layout -----------------------------------------------------------------------------

  get speed(): SpeedMode {
    return this.speedMode;
  }

  /**
   * Changes the sample-rate range: at double and quad speed ADAT and MADI have fewer channels,
   * and the ones above the new count disappear. TotalMix sends nothing for it that we know of
   * (no capture yet; the sample rate is not reported at all).
   */
  setSpeed(speed: SpeedMode): void {
    this.speedMode = speed;
  }

  channelCount(bus: Bus): number {
    return this.device.channelCount(bus, this.speedMode);
  }

  /** True for the right channel of a stereo strip. */
  isRight(bus: Bus, n: number): boolean {
    return n % 2 === 1 && this.channels[bus][n - 1]?.values.get('stereo') === 1;
  }

  /** True when channel n exists and belongs to a visible strip. */
  isVisible(bus: Bus, n: number): boolean {
    if (!Number.isInteger(n) || n < 0 || n >= this.channelCount(bus)) return false;
    const left = this.isRight(bus, n) ? n - 1 : n;
    return this.channels[bus][left]?.hidden === false;
  }

  /** Left indices of the visible strips of a bus, in order. */
  strips(bus: Bus): number[] {
    const out: number[] = [];
    for (let n = 0; n < this.channelCount(bus); n++) {
      if (!this.isRight(bus, n) && this.isVisible(bus, n)) out.push(n);
    }
    return out;
  }

  /** Visible physical channels of a bus (both sides of stereo strips), in order. */
  visibleChannels(bus: Bus): number[] {
    const out: number[] = [];
    for (let n = 0; n < this.channelCount(bus); n++) if (this.isVisible(bus, n)) out.push(n);
    return out;
  }

  /** Shows or hides a strip (give its left index), as in TotalMix's layout options. */
  setVisible(bus: Bus, n: number, visible: boolean): void {
    const rec = this.channels[bus][n];
    if (!rec) throw new RangeError(`no ${bus} channel ${String(n)}`);
    rec.hidden = !visible;
    if (n % 2 === 0 && this.isRight(bus, n + 1)) {
      const right = this.channels[bus][n + 1];
      if (right) right.hidden = !visible;
    }
  }

  /**
   * Pairs channel n (even) with n + 1 into a stereo strip, or splits the pair. A name still at
   * its default label follows ("AN 1" becomes "AN 1/2"). Returns false if nothing changed.
   */
  setStereo(bus: Bus, n: number, stereo: boolean): boolean {
    const left = this.channels[bus][n];
    const right = this.channels[bus][n + 1];
    if (n % 2 !== 0 || !left || !right) return false;
    if ((left.values.get('stereo') === 1) === stereo) return false;
    const profile = this.device.profile;
    const mono = profile.label(bus, n);
    const pair = profile.stripLabel(bus, n, true);
    left.values.set('stereo', stereo ? 1 : 0);
    right.values.set('stereo', 0);
    const name = left.values.get('name');
    if (stereo && name === mono) left.values.set('name', pair);
    if (!stereo && name === pair) left.values.set('name', mono);
    right.hidden = left.hidden;
    return true;
  }

  // --- values -----------------------------------------------------------------------------

  /** The value TotalMix would report for an address, or undefined if there is none. */
  get(address: string): WireValue | undefined {
    const a = parseAddress(address);
    switch (a?.kind) {
      case 'channel':
        return this.reported(a.bus, a.index, a.field);
      case 'route':
        return this.routeValue(a.source, a.index, a.output, a.field);
      case 'setting':
        return this.settings.get(a.address);
      case 'snapshot':
        return this.snapshotStates[a.n - 1];
      case 'status':
        return a.field === 'durec' ? this.status.durec : this.status[a.field];
      case undefined:
        return undefined;
    }
  }

  /** The reported value of a channel field (no address parsing; for meters). */
  channelValue(bus: Bus, n: number, field: string): WireValue | undefined {
    return this.reported(bus, n, field);
  }

  /** A route's stored value (no address parsing; for meters). */
  routeValue(
    source: RouteSource,
    index: number,
    output: number,
    field: string,
  ): number | undefined {
    const i = ROUTE_FIELDS.findIndex((d) => d.name === field);
    if (i < 0) return undefined;
    return (this.routes.get(routeKey(source, index, output)) ??
      defaultRoute(source, index, output))[i];
  }

  /**
   * Sets a value as TotalMix would report it, without side effects or feedback: for building
   * scenarios and loading recorded state. Works on hidden channels too. Returns false for an
   * address that does not exist (or a field this channel lacks).
   */
  setValue(address: string, value: WireValue | boolean): boolean {
    const a = parseAddress(address);
    const v = typeof value === 'boolean' ? (value ? 1 : 0) : value;
    switch (a?.kind) {
      case 'channel': {
        const rec = this.channels[a.bus][a.index];
        const def = CHANNEL_FIELD_INDEX[a.bus].get(a.field);
        if (!rec || !def || !rec.values.has(a.field) || !fits(def, v)) return false;
        if (a.field === 'stereo') {
          this.setStereo(a.bus, a.index, v === 1);
          return true;
        }
        this.store(a.bus, a.index, a.field, typeof v === 'number' ? normalise(def.type, v) : v);
        return true;
      }
      case 'route': {
        const def = ROUTE_FIELD_INDEX.get(a.field);
        if (!def || typeof v !== 'number') return false;
        this.storeRoute(a.source, a.index, a.output, a.field, normalise(def.type, v));
        return true;
      }
      case 'setting': {
        const def = SETTINGS_INDEX.get(a.address);
        if (!def || typeof v !== 'number') return false;
        this.settings.set(a.address, normalise(def.type, v));
        return true;
      }
      case 'snapshot':
        if (v !== SNAPSHOT_INACTIVE && v !== SNAPSHOT_ACTIVE && v !== SNAPSHOT_MODIFIED) {
          return false;
        }
        this.snapshotStates[a.n - 1] = v;
        return true;
      case 'status':
        if (a.field === 'device' || a.field === 'durec') {
          if (typeof v !== 'string') return false;
          if (a.field === 'device') this.status.device = v;
          else this.status.durec = v;
          return true;
        }
        if (typeof v !== 'number') return false;
        this.status[a.field] = Math.fround(v);
        return true;
      case undefined:
        return false;
    }
  }

  private mainOut(): number {
    return this.settings.get('/controlroom/mainout') ?? -1;
  }

  private dimmed(bus: Bus, n: number): boolean {
    return bus === 'output' && n === this.mainOut() && this.settings.get('/controlroom/dim') === 1;
  }

  private dimReduction(): number {
    return this.settings.get('/controlroom/dimreduction') ?? 0;
  }

  private reported(bus: Bus, n: number, field: string): WireValue | undefined {
    const v = this.channels[bus][n]?.values.get(field);
    if (field === 'volume' && typeof v === 'number' && v > OFF_DB && this.dimmed(bus, n)) {
      return Math.fround(Math.max(OFF_DB, v + this.dimReduction()));
    }
    return v;
  }

  /** Stores a value as reported: a dimmed Main volume is stored undimmed. */
  private store(bus: Bus, n: number, field: string, v: WireValue): void {
    const rec = this.channels[bus][n];
    if (!rec) return;
    if (field === 'volume' && typeof v === 'number' && v > OFF_DB && this.dimmed(bus, n)) {
      rec.values.set(field, Math.fround(v - this.dimReduction()));
    } else {
      rec.values.set(field, v);
    }
  }

  private storeRoute(
    source: RouteSource,
    index: number,
    output: number,
    field: string,
    v: number,
  ): void {
    const i = ROUTE_FIELDS.findIndex((d) => d.name === field);
    if (i < 0) return;
    const key = routeKey(source, index, output);
    const values = this.routes.get(key) ?? [...defaultRoute(source, index, output)];
    values[i] = v;
    this.routes.set(key, values);
  }

  // --- replies ----------------------------------------------------------------------------

  /** Reply to /sendstate. */
  stateReply(): OscMessage[] {
    return [
      message('/status/device', str(this.status.device)),
      message('/status/connection', float(this.status.connection)),
      message('/status/dsp', float(this.status.dsp)),
      this.durecMessage(),
    ];
  }

  /** `/durec/state`, also the first datagram TotalMix sends after it starts (seen). */
  durecMessage(): OscMessage {
    return message('/durec/state', str(this.status.durec));
  }

  /** Every global setting, in /sendsettings order (without the snapshot states). */
  settingsMessages(): OscMessage[] {
    return SETTINGS.map((def) => wire(def.name, this.settings.get(def.name) ?? 0));
  }

  /** The eight snapshot states; TotalMix always sends them in a datagram of their own. */
  snapshotMessages(): OscMessage[] {
    return this.snapshotStates.map((s, i) => wire(`/snapshot/load/${String(i + 1)}`, s));
  }

  /** Reply to /sendchan/{bus}/{n}: nothing for a hidden channel, per-side settings for a right one. */
  channelReply(bus: Bus, n: number): OscMessage[] {
    if (!this.isVisible(bus, n)) return [];
    const right = this.isRight(bus, n);
    const out: OscMessage[] = [];
    for (const def of CHANNEL_FIELDS[bus]) {
      if (right && !def.side) continue;
      const v = this.reported(bus, n, def.name);
      if (v !== undefined) out.push(wire(`/${bus}/${String(n)}/${def.name}`, v));
    }
    return out;
  }

  /** Reply to /sendsubmix/{out}: every route into a visible output strip, or only those that are on. */
  submixReply(output: number, onlyOn = false): OscMessage[] {
    if (this.isRight('output', output) || !this.isVisible('output', output)) return [];
    const out: OscMessage[] = [];
    for (const source of ['in', 'pb'] as const) {
      for (const index of this.strips(ROUTE_BUS[source])) {
        const values =
          this.routes.get(routeKey(source, index, output)) ?? defaultRoute(source, index, output);
        if (onlyOn && (values[0] ?? OFF_DB) <= FADER_MIN_DB) continue;
        const prefix = `/mix/${source}/${String(index)}/${String(output)}/`;
        ROUTE_FIELDS.forEach((def, i) => {
          out.push(wire(prefix + def.name, values[i] ?? 0));
        });
      }
    }
    return out;
  }

  /** Reply to /sendmix: the submix of every visible output. */
  mixReply(onlyOn = false): OscMessage[] {
    return this.strips('output').flatMap((o) => this.submixReply(o, onlyOn));
  }

  /** Reply to /sendall: state, every visible channel, settings and routes, then snapshots. */
  allReply(onlyOn: boolean): Emission[] {
    const channels = BUSES.flatMap((bus) =>
      this.visibleChannels(bus).flatMap((n) => this.channelReply(bus, n)),
    );
    return [
      [...this.stateReply(), ...channels, ...this.settingsMessages(), ...this.mixReply(onlyOn)],
      this.snapshotMessages(),
    ];
  }

  // --- received messages ------------------------------------------------------------------

  /** What TotalMix sends back for one received message. */
  handle(msg: OscMessage): Emission[] {
    const reply = this.request(msg);
    if (reply) return reply.filter((e) => e.length > 0);
    return this.apply(msg.address, msg.args[0], false);
  }

  /**
   * A change made in TotalMix's own window: applied and sent as feedback, like TotalMix does
   * with "Send changes" on. Returns nothing when the value did not change.
   */
  change(address: string, value: WireValue | boolean): Emission[] {
    return this.apply(address, toArg(value), true);
  }

  private request(msg: OscMessage): Emission[] | undefined {
    const parts = msg.address.split('/').slice(1);
    const [head, a, b, c] = parts;
    switch (head) {
      case 'sendstate':
        return a === undefined ? [this.stateReply()] : undefined;
      case 'sendsettings':
        return a === undefined ? [this.settingsMessages(), this.snapshotMessages()] : undefined;
      case 'sendchan': {
        const n = parseIndex(b);
        if (!isBus(a) || n === undefined || c !== undefined) return undefined;
        return [this.channelReply(a, n)];
      }
      case 'sendsubmix': {
        const n = parseIndex(a);
        if (n === undefined || b !== undefined) return undefined;
        return [this.submixReply(n)];
      }
      case 'sendmix':
        return a === undefined ? [this.mixReply()] : undefined;
      case 'sendall':
        // 2: only routes that are on. Any other argument (or none) is taken as 1 (inferred).
        return a === undefined ? this.allReply(argNumber(msg.args[0]) === 2) : undefined;
      default:
        return undefined;
    }
  }

  private apply(address: string, arg: OscArg | undefined, fromUi: boolean): Emission[] {
    const a = parseAddress(address);
    switch (a?.kind) {
      case 'channel':
        return this.writeChannel(a.bus, a.index, a.field, arg, fromUi);
      case 'route':
        return this.writeRoute(a.source, a.index, a.output, a.field, arg, fromUi);
      case 'setting':
        return this.writeSetting(a.address, arg, fromUi);
      case 'snapshot': {
        // Inferred, not captured yet: 1 loads the snapshot (docs/protocol/global-osc.md §4).
        const n = argNumber(arg);
        return n !== undefined && n >= 0.5 ? this.loadSnapshot(a.n) : [];
      }
      case 'status':
      case undefined:
        return []; // read-only or unknown: silently ignored
    }
  }

  private writeChannel(
    bus: Bus,
    n: number,
    field: string,
    arg: OscArg | undefined,
    fromUi: boolean,
  ): Emission[] {
    const rec = this.channels[bus][n];
    const def = CHANNEL_FIELD_INDEX[bus].get(field);
    if (!rec || !def || !rec.values.has(field) || !this.isVisible(bus, n)) return [];
    if (!def.side && this.isRight(bus, n)) return [];
    const value = argValue(def, arg);
    if (value === undefined) return [];
    const address = `/${bus}/${String(n)}/${field}`;

    if (field === 'stereo') {
      // Inferred: TotalMix re-lays out the strips; what it sends for that is not captured.
      const changed = this.setStereo(bus, n, value === 1);
      return changed && fromUi ? [[wire(address, value)]] : [];
    }

    let v = value;
    if (bus === 'input' && field === 'gain' && typeof v === 'number') {
      const left = this.isRight(bus, n) ? n - 1 : n;
      const instrument = this.channels.input[left]?.values.get('instrument') === 1;
      v = Math.fround(snapGain(this.device.inputGain(n, instrument), v));
    }
    const before = this.reported(bus, n, field);
    this.store(bus, n, field, v);
    const after = this.reported(bus, n, field);
    if (after === undefined || before === after) return [];

    const out: Emission[] = [];
    // Numeric writes are not echoed; names are (seen). Changes in the window are always sent.
    if (fromUi || def.type === 'text') out.push([wire(address, after)]);
    if (!NOT_IN_SNAPSHOT.has(field)) out.push(...this.markModified());
    return out;
  }

  private writeRoute(
    source: RouteSource,
    index: number,
    output: number,
    field: string,
    arg: OscArg | undefined,
    fromUi: boolean,
  ): Emission[] {
    const def = ROUTE_FIELD_INDEX.get(field);
    const bus = ROUTE_BUS[source];
    if (!def || this.isRight(bus, index) || !this.isVisible(bus, index)) return [];
    if (this.isRight('output', output) || !this.isVisible('output', output)) return [];
    const value = argValue(def, arg);
    if (typeof value !== 'number') return [];
    const v = field === 'fader' ? Math.fround(Math.min(6, Math.max(OFF_DB, value))) : value;
    const before = this.routeValue(source, index, output, field);
    this.storeRoute(source, index, output, field, v);
    if (before === v) return [];

    const out: Emission[] = [];
    if (fromUi) {
      // A solo click reports the route's group flags with it (seen).
      const prefix = `/mix/${source}/${String(index)}/${String(output)}/`;
      const fields = field === 'solo' ? ['groupflags', 'solo'] : [field];
      out.push(fields.map((f) => wire(prefix + f, this.routeValue(source, index, output, f) ?? 0)));
    }
    // Inferred: a route write is not echoed, like the other numeric writes.
    out.push(...this.markModified());
    return out;
  }

  private writeSetting(address: string, arg: OscArg | undefined, fromUi: boolean): Emission[] {
    const def = SETTINGS_INDEX.get(address);
    if (!def) return [];
    const value = argValue(def, arg);
    if (typeof value !== 'number') return [];
    const main = this.mainOut();
    const mainVolume = (): WireValue | undefined =>
      main >= 0 ? this.reported('output', main, 'volume') : undefined;
    const volumeBefore = mainVolume();
    const before = this.settings.get(address);
    this.settings.set(address, value);
    if (before === value) return [];

    const volumeAfter = mainVolume();
    const messages: OscMessage[] = [];
    // Dim sends the dimmed Main volume (seen), before the dim state itself when it was
    // switched in the window.
    if (
      volumeAfter !== undefined &&
      volumeAfter !== volumeBefore &&
      this.isVisible('output', main)
    ) {
      messages.push(wire(`/output/${String(main)}/volume`, volumeAfter));
    }
    if (fromUi) messages.push(wire(address, value));
    return messages.length > 0 ? [messages] : [];
  }

  /** After a change: the active snapshot becomes "modified", reported once (seen). */
  private markModified(): Emission[] {
    const i = this.snapshotStates.indexOf(SNAPSHOT_ACTIVE);
    if (i < 0) return [];
    this.snapshotStates[i] = SNAPSHOT_MODIFIED;
    return [[wire(`/snapshot/load/${String(i + 1)}`, SNAPSHOT_MODIFIED)]];
  }

  // --- snapshots --------------------------------------------------------------------------

  /** Stores the current channel and route values in snapshot k (1-8) and makes it active. */
  saveSnapshot(k: number): void {
    checkSnapshot(k);
    const channels = new Map<string, WireValue>();
    for (const bus of BUSES) {
      this.channels[bus].forEach((rec, n) => {
        for (const [field, v] of rec.values) {
          if (!NOT_IN_SNAPSHOT.has(field)) channels.set(`${bus}/${String(n)}/${field}`, v);
        }
      });
    }
    const routes = new Map([...this.routes].map(([key, values]) => [key, [...values]]));
    this.snapshotContents[k - 1] = { channels, routes };
    this.snapshotStates.fill(SNAPSHOT_INACTIVE);
    this.snapshotStates[k - 1] = SNAPSHOT_ACTIVE;
  }

  /**
   * Loads snapshot k (1-8): restores its values, sends the visible ones that changed, then the
   * snapshot states that changed, in a datagram of their own (seen for loads made in TotalMix).
   * A slot that was never saved holds nothing to restore; loading it only switches the states.
   */
  loadSnapshot(k: number): Emission[] {
    checkSnapshot(k);
    const saved = this.snapshotContents[k - 1];
    const changed: OscMessage[] = [];
    if (saved) {
      for (const bus of BUSES) {
        this.channels[bus].forEach((rec, n) => {
          const visible = this.isVisible(bus, n);
          for (const def of CHANNEL_FIELDS[bus]) {
            const v = saved.channels.get(`${bus}/${String(n)}/${def.name}`);
            if (v === undefined || rec.values.get(def.name) === v) continue;
            rec.values.set(def.name, v);
            if (visible && (def.side || !this.isRight(bus, n))) {
              const now = this.reported(bus, n, def.name);
              if (now !== undefined) changed.push(wire(`/${bus}/${String(n)}/${def.name}`, now));
            }
          }
        });
      }
      for (const key of new Set([...this.routes.keys(), ...saved.routes.keys()])) {
        const [source, index, output] = parseRouteKey(key);
        const current = this.routes.get(key) ?? defaultRoute(source, index, output);
        const target = saved.routes.get(key) ?? defaultRoute(source, index, output);
        this.routes.set(key, [...target]);
        const visible =
          !this.isRight(ROUTE_BUS[source], index) &&
          this.isVisible(ROUTE_BUS[source], index) &&
          !this.isRight('output', output) &&
          this.isVisible('output', output);
        ROUTE_FIELDS.forEach((def, i) => {
          if (visible && current[i] !== target[i]) {
            changed.push(wire(`/mix/${key}/${def.name}`, target[i] ?? 0));
          }
        });
      }
    }
    const states: OscMessage[] = [];
    this.snapshotStates.forEach((s, i) => {
      const next = i === k - 1 ? SNAPSHOT_ACTIVE : SNAPSHOT_INACTIVE;
      if (s === next) return;
      this.snapshotStates[i] = next;
      states.push(wire(`/snapshot/load/${String(i + 1)}`, next));
    });
    return [changed, states].filter((e) => e.length > 0);
  }
}

function defaultRoute(source: RouteSource, index: number, output: number): readonly number[] {
  // TotalMix's factory routing: playback n plays to output n at 0 dB, everything else is off.
  return [source === 'pb' && index === output ? 0 : OFF_DB, 0, 0, 0];
}

function parseRouteKey(key: string): [RouteSource, number, number] {
  const [source, index, output] = key.split('/');
  return [source === 'pb' ? 'pb' : 'in', Number(index), Number(output)];
}

function fits(def: FieldDef, v: WireValue): boolean {
  return def.type === 'text' ? typeof v === 'string' : typeof v === 'number' && !Number.isNaN(v);
}

/** A written argument as a value of the field, or undefined when the type does not fit. */
function argValue(def: FieldDef, arg: OscArg | undefined): WireValue | undefined {
  if (def.type === 'text') return argString(arg);
  const n = argNumber(arg);
  return n === undefined || Number.isNaN(n) ? undefined : normalise(def.type, n);
}

function checkSnapshot(k: number): void {
  if (!Number.isInteger(k) || k < 1 || k > SNAPSHOT_COUNT) {
    throw new RangeError(`no snapshot ${String(k)}`);
  }
}
