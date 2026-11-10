// DeckRuntime: the keys on the deck, without the Stream Deck SDK. The plugin (or the virtual
// deck) tells it which keys appeared where and when they are pressed; it answers with images
// through a DeckHost. In between: each key's spec (what it is), its controller (what it shows
// and does), a gesture recogniser per key, and one frame scheduler for all images
// (docs/design/02-architecture.md). Console Slots get their spec from the layout, by their
// coordinates and the page and banks their device shows now.

import { strips, type Bus, type Strip } from '@faderlight/model';
import {
  DARK,
  document,
  rect,
  renderKey,
  svgDataUrl,
  THEMES,
  type KeyView,
  type Theme,
} from '@faderlight/render';
import type { Clock } from '@faderlight/totalmix';
import type { ActionKind } from './actions.ts';
import {
  controllerFor,
  type BankState,
  type KeyContext,
  type MixerControl,
  type Navigator,
} from './controllers.ts';
import { GestureRecogniser, type Gesture } from './gestures.ts';
import {
  clampBank,
  CONSOLE_LAYOUT,
  keyAt,
  moveBank,
  nextBankBus,
  type BankPosition,
  type Layout,
} from './layout.ts';
import { SILENT, type Logger } from './log.ts';
import { FrameScheduler, type FrameStats } from './scheduler.ts';
import { DEFAULT_SETTINGS, type GlobalSettings, type JsonObject } from './settings.ts';
import { EMPTY, specFromAction, type Direction, type KeySpec } from './specs.ts';

/** What the runtime needs from the app that shows the keys. */
export interface DeckHost {
  /** Shows an image (a data URL) on a key. */
  setImage(id: string, image: string): void;
  /** Shows the app's "did not work" mark on a key. */
  showAlert(id: string): void;
  /** Shows the app's "done" mark on a key. */
  showOk(id: string): void;
  /** Switches a device to one of the plugin's profiles; undefined: back to the previous one. */
  switchToProfile(device: string, profile?: string): void;
}

export interface Coordinates {
  readonly column: number;
  readonly row: number;
}

/** A key that appeared on a deck. */
export interface KeyPlacement {
  /** The app's id for this instance of the action. */
  readonly id: string;
  /** The device it is on. */
  readonly device: string;
  readonly kind: ActionKind;
  /** Where it is; undefined inside a multi action. */
  readonly coordinates?: Coordinates | undefined;
  /** The action's own settings. */
  readonly settings: JsonObject;
}

export interface DeckRuntimeOptions {
  readonly mixer: MixerControl;
  readonly host: DeckHost;
  /** The clock the mixer's meters are stamped with. */
  readonly clock: Clock;
  readonly settings?: GlobalSettings;
  readonly log?: Logger;
  /** Image size in pixels (default 144: the XL's high-resolution keys). */
  readonly imageSize?: number;
  /** Turns a view into an image (default: renderKey as an SVG data URL). */
  readonly render?: KeyRenderer;
  /** What the Console Slots show (default CONSOLE_LAYOUT). */
  readonly layout?: Layout;
  /** The plugin's Console profile, for switchToProfile; undefined: there is none. */
  readonly consoleProfile?: string | undefined;
}

export type KeyRenderer = (view: KeyView, theme: Theme, size: number) => string;

const renderSvg: KeyRenderer = (view, theme, size) => svgDataUrl(renderKey(view, theme, size));

interface DeckKey {
  placement: KeyPlacement;
  readonly gestures: GestureRecogniser;
  /** Controller state kept across gestures (e.g. the Talkback latch). */
  readonly memo: Record<string, unknown>;
  /** The spec of the press in progress (or the last one): gestures go to the key that was
   * pressed, even if the layout changed under the finger. */
  pressed: KeySpec | undefined;
  /** View and image last drawn, to skip rendering a view that did not change. */
  lastView: string | undefined;
  lastImage: string | undefined;
}

/** What a device's navigation needs from the runtime. */
interface DeviceHost {
  bankOf(page: number, banks: ReadonlyMap<number, BankPosition>): BankState | undefined;
  /** Draws the device's keys again. */
  redraw(): void;
  openConsole(): boolean;
}

/** Navigation state of one device: the Console page it shows and where its banks are. */
class DeckDevice implements Navigator {
  readonly id: string;
  readonly pages: readonly string[];
  page = 0;
  /** Bank position per page. */
  readonly banks = new Map<number, BankPosition>();
  private readonly host: DeviceHost;

  constructor(id: string, pages: readonly string[], host: DeviceHost) {
    this.id = id;
    this.pages = pages;
    this.host = host;
  }

  openDetail(): boolean {
    return false;
  }

  bank(): BankState | undefined {
    return this.host.bankOf(this.page, this.banks);
  }

  moveBank(direction: Direction): void {
    const b = this.bank();
    if (b) this.setBank(moveBank(b, b.size, b.total, direction));
  }

  nextBankBus(): void {
    const b = this.bank();
    if (b) this.setBank(nextBankBus(b));
  }

  goToPage(index: number): void {
    if (index === this.page || index < 0 || index >= this.pages.length) return;
    this.page = index;
    this.host.redraw();
  }

  openConsole(): boolean {
    return this.host.openConsole();
  }

  private setBank(to: BankPosition): void {
    this.banks.set(this.page, to);
    this.host.redraw();
  }
}

/** A black key. */
export function blankImage(size = 144): string {
  return svgDataUrl(document(rect({ x: 0, y: 0, w: 144, h: 144 }, { fill: '#000000' }), size));
}

const hasMeter = (view: KeyView): boolean => 'meter' in view && view.meter !== undefined;

/** A view as text, for comparing: -Infinity (an off fader) is not the same as no value. */
const viewKey = (view: KeyView): string =>
  JSON.stringify(view, (_k, v: unknown) =>
    typeof v === 'number' && !Number.isFinite(v) ? String(v) : v,
  );

export class DeckRuntime {
  private readonly mixer: MixerControl;
  private readonly host: DeckHost;
  private readonly clock: Clock;
  private readonly log: Logger;
  private readonly imageSize: number;
  private readonly render: KeyRenderer;
  private readonly blank: string;
  private readonly layout: Layout;
  private readonly pageNames: readonly string[];
  private readonly consoleProfile: string | undefined;
  private settings: GlobalSettings;
  private scheduler: FrameScheduler;
  private readonly keys = new Map<string, DeckKey>();
  private readonly devices = new Map<string, DeckDevice>();
  /** Strips per bus, until the store changes. */
  private readonly stripCache = new Map<Bus, Strip[]>();
  private readonly unsubscribe: () => void;

  constructor(options: DeckRuntimeOptions) {
    this.mixer = options.mixer;
    this.host = options.host;
    this.clock = options.clock;
    this.log = options.log ?? SILENT;
    this.imageSize = options.imageSize ?? 144;
    this.render = options.render ?? renderSvg;
    this.blank = blankImage(this.imageSize);
    this.layout = options.layout ?? CONSOLE_LAYOUT;
    this.pageNames = this.layout.pages.map((p) => p.name);
    this.consoleProfile = options.consoleProfile;
    this.settings = options.settings ?? DEFAULT_SETTINGS;
    this.scheduler = this.makeScheduler();
    // Any change may show on any key (a name, Main moving to another output): draw them all
    // again. The scheduler coalesces this per key, and images that did not change are not sent.
    this.unsubscribe = this.mixer.store.subscribe(() => {
      this.stripCache.clear();
      this.scheduler.invalidateAll();
    });
  }

  /** Counters of the frame scheduler since the last configure(). */
  get frames(): FrameStats {
    return this.scheduler.stats;
  }

  // --- keys ---------------------------------------------------------------------------------

  appear(placement: KeyPlacement): void {
    this.disappear(placement.id);
    const key: DeckKey = {
      placement,
      gestures: new GestureRecogniser((g) => {
        this.onGesture(key, g);
      }, this.clock),
      memo: {},
      pressed: undefined,
      lastView: undefined,
      lastImage: undefined,
    };
    this.keys.set(placement.id, key);
    this.addFrames(key);
  }

  disappear(id: string): void {
    const key = this.keys.get(id);
    if (!key) return;
    key.gestures.cancel();
    this.keys.delete(id);
    this.scheduler.remove(id);
  }

  /** The action's own settings changed (from its Property Inspector). */
  settingsChanged(id: string, settings: JsonObject): void {
    const key = this.keys.get(id);
    if (!key) return;
    key.placement = { ...key.placement, settings };
    this.scheduler.invalidate(id);
  }

  down(id: string): void {
    const key = this.keys.get(id);
    if (!key) return;
    if (key.gestures.idle) {
      // A new gesture: it belongs to what the key is now.
      const spec = this.specOf(key);
      key.pressed = spec;
      key.gestures.configure(controllerFor(spec).options(spec, this.context(key)));
    }
    key.gestures.down();
  }

  up(id: string): void {
    this.keys.get(id)?.gestures.up();
  }

  /** New global settings: timings apply from the next press, the theme and budget now. */
  configure(settings: GlobalSettings): void {
    const frames = JSON.stringify(settings.frames) !== JSON.stringify(this.settings.frames);
    this.settings = settings;
    if (frames) {
      this.scheduler.dispose();
      this.scheduler = this.makeScheduler();
      for (const key of this.keys.values()) this.addFrames(key);
    } else {
      this.scheduler.invalidateAll();
    }
  }

  dispose(): void {
    this.unsubscribe();
    this.scheduler.dispose();
    for (const key of this.keys.values()) key.gestures.cancel();
    this.keys.clear();
  }

  /** The Console page a device shows, from 0. */
  pageOf(device: string): number {
    return this.devices.get(device)?.page ?? 0;
  }

  // --- navigation -------------------------------------------------------------------------

  private device(id: string): DeckDevice {
    let d = this.devices.get(id);
    if (!d) {
      d = new DeckDevice(id, this.pageNames, {
        bankOf: (page, banks) => this.bankOf(page, banks),
        redraw: () => {
          this.redraw(id);
        },
        openConsole: () => {
          if (this.consoleProfile === undefined) return false;
          this.host.switchToProfile(id, this.consoleProfile);
          return true;
        },
      });
      this.devices.set(id, d);
    }
    return d;
  }

  private stripsOf(bus: Bus): Strip[] {
    let list = this.stripCache.get(bus);
    if (!list) {
      list = strips(this.mixer.store, bus);
      this.stripCache.set(bus, list);
    }
    return list;
  }

  private bankOf(page: number, banks: ReadonlyMap<number, BankPosition>): BankState | undefined {
    const spec = this.layout.pages[page]?.bank;
    if (!spec) return undefined;
    const at = banks.get(page) ?? { bus: spec.bus, offset: 0 };
    const total = this.stripsOf(at.bus).length;
    return { ...clampBank(at, spec.size, total), size: spec.size, total };
  }

  /** Draws every key of a device again (its page or a bank moved). */
  private redraw(device: string): void {
    for (const key of this.keys.values()) {
      if (key.placement.device === device) this.scheduler.invalidate(key.placement.id);
    }
  }

  /** What a Console Slot is now. */
  private slotSpec(key: DeckKey): KeySpec {
    const d = this.device(key.placement.device);
    const spec = keyAt(this.layout, d.page, key.placement.coordinates);
    if (spec.type !== 'strip') return spec;
    const bank = this.bankOf(d.page, d.banks);
    const strip = bank && this.stripsOf(bank.bus)[bank.offset + spec.n];
    if (!bank || !strip) return EMPTY;
    return { type: 'channel', bus: bank.bus, index: strip.index, style: spec.style };
  }

  // --- internals --------------------------------------------------------------------------

  private makeScheduler(): FrameScheduler {
    const f = this.settings.frames;
    return new FrameScheduler(
      (id, image) => {
        this.host.setImage(id, image);
      },
      this.clock,
      {
        budgetPerSecond: f.budgetPerSecond,
        maxKeyFps: f.maxKeyFps,
        // A whole XL page at once, so a page change is not drawn in pieces.
        burst: Math.max(32, Math.round(f.budgetPerSecond / 10)),
      },
    );
  }

  private addFrames(key: DeckKey): void {
    key.lastView = undefined;
    key.lastImage = undefined;
    this.scheduler.add(key.placement.id, () => this.draw(key));
  }

  /** What the key is now. */
  private specOf(key: DeckKey): KeySpec {
    const { kind, settings } = key.placement;
    switch (kind) {
      case 'slot':
        return this.slotSpec(key);
      case 'test-image':
        return EMPTY;
      default:
        return specFromAction(kind, settings);
    }
  }

  private context(key: DeckKey): KeyContext {
    const id = key.placement.id;
    return {
      mixer: this.mixer,
      now: this.clock.now(),
      settings: this.settings,
      held: key.gestures.held,
      memo: key.memo,
      nav: this.device(key.placement.device),
      alert: () => {
        this.host.showAlert(id);
      },
      ok: () => {
        this.host.showOk(id);
      },
    };
  }

  private draw(key: DeckKey): string {
    const id = key.placement.id;
    let view: KeyView | undefined;
    try {
      const spec = this.specOf(key);
      view = controllerFor(spec).view(spec, this.context(key));
    } catch (error) {
      this.log.error(`drawing key ${id} failed:`, error);
      view = undefined;
    }
    this.scheduler.setRate(
      id,
      view !== undefined && hasMeter(view) ? this.settings.frames.meterFps : 0,
    );
    if (view === undefined) return this.blank;
    const text = this.settings.theme + viewKey(view);
    if (text === key.lastView && key.lastImage !== undefined) return key.lastImage;
    const image = this.render(view, THEMES[this.settings.theme] ?? DARK, this.imageSize);
    key.lastView = text;
    key.lastImage = image;
    return image;
  }

  private onGesture(key: DeckKey, gesture: Gesture): void {
    const spec = key.pressed ?? this.specOf(key);
    try {
      controllerFor(spec).gesture(spec, gesture, this.context(key));
    } catch (error) {
      this.log.error(`key ${key.placement.id}: ${gesture.type} failed:`, error);
      this.host.showAlert(key.placement.id);
    }
    // Keys that look different while held (the ± keys) draw again.
    if (gesture.type === 'press' || gesture.type === 'release') {
      this.scheduler.invalidate(key.placement.id);
    }
  }
}
