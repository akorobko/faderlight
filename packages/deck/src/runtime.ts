// DeckRuntime: the keys on the deck, without the Stream Deck SDK. The plugin (or the virtual
// deck) tells it which keys appeared where and when they are pressed; it answers with images
// through a DeckHost. In between: each key's spec (what it is), its controller (what it shows
// and does), a gesture recogniser per key, and one frame scheduler for all images
// (docs/design/02-architecture.md). Console Slots get their spec from the layout, by their
// coordinates and the page and banks their device shows now.

import {
  mainOutput,
  phonesOutput,
  strips,
  type Bus,
  type SourceBus,
  type Strip,
} from '@faderlight/model';
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
import type { Clock, TimerHandle } from '@faderlight/totalmix';
import type { ActionKind } from './actions.ts';
import type {
  BankState,
  DetailState,
  KeyContext,
  MixerControl,
  Navigator,
  SendTarget,
} from './controllers.ts';
import { DETAIL_KEYS, neighbour } from './detail.ts';
import { GestureRecogniser, type Gesture } from './gestures.ts';
import {
  changeSetting,
  inspectorView,
  type InspectorValue,
  type InspectorView,
} from './inspector.ts';
import { controllerFor } from './keys.ts';
import {
  clampBank,
  CONSOLE_LAYOUT,
  keyAt,
  moveBank,
  nextBankSource,
  type BankPosition,
  type BankSource,
  type Layout,
} from './layout.ts';
import { SILENT, type Logger } from './log.ts';
import { FrameScheduler, type FrameStats } from './scheduler.ts';
import {
  channelSettings,
  DEFAULT_SETTINGS,
  toJson,
  type GlobalSettings,
  type JsonObject,
} from './settings.ts';
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
  /** Stores new global settings (a Level Preset was saved). */
  saveSettings(settings: JsonObject): void;
  /**
   * Opens the Control Center in the browser, on one of its sections (connection, channels,
   * layout, behaviour, appearance, backup); undefined: the host has none.
   */
  openControlCenter?(section?: string): void;
}

/** Snapshot names from somewhere other than the mixer, which does not send them. */
export interface SnapshotNames {
  /** The name of snapshot n (1-8), if known. */
  name(n: number): string | undefined;
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
  /** What the Console Slots show when the settings have no layout (default CONSOLE_LAYOUT). */
  readonly layout?: Layout | undefined;
  /** The plugin's Console profile, for switchToProfile; undefined: there is none. */
  readonly consoleProfile?: string | undefined;
  /** Images for the Test Images debug action; undefined: its keys stay blank. */
  readonly debugImages?: DebugImages | undefined;
  /** Where snapshot names come from (TotalMix's own files); undefined: none known. */
  readonly snapshotNames?: SnapshotNames | undefined;
}

export type DebugMode = 'svg' | 'png';

/**
 * Test Images (a debug action): pages of ready-made key images, one per key position. A tap
 * shows the next page on every Test Images key of the device, a long press switches between
 * the SVG and the PNG of the same images.
 */
export interface DebugImages {
  readonly pages: number;
  title(page: number): string;
  /** The image at a key position (row by row, from 0); undefined: blank. */
  image(page: number, position: number, mode: DebugMode): string | undefined;
}

/** Draws a view as an image; `id` is the key it is for. */
export type KeyRenderer = (view: KeyView, theme: Theme, size: number, id: string) => string;

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
  readonly clock: Clock;
  bankOf(page: number, n: number, banks: ReadonlyMap<string, BankPosition>): BankState | undefined;
  /** Draws the device's keys again. */
  redraw(): void;
  openConsole(): boolean;
  /** The device shows Console Slots now. */
  showsConsole(): boolean;
  /** Back to the profile the device showed before the Console. */
  switchBack(): void;
  neighbour(bus: SourceBus, index: number, direction: Direction): number | undefined;
  /** Closes the overlay after this long without a press; 0: never. */
  detailTimeoutMs(): number;
  /** The names of the layout's pages. */
  pages(): readonly string[];
}

/**
 * Navigation state of one device: the Console page it shows, where its banks are, and the
 * Channel Detail overlay when it is open.
 */
class DeckDevice implements Navigator {
  readonly id: string;
  page = 0;
  /** Bank positions, by page and bank ("0/1": the second bank of the first page). */
  readonly banks = new Map<string, BankPosition>();
  private readonly host: DeviceHost;
  private overlay: DetailState | undefined;
  /** Test Images: the page and kind of image shown. */
  debugPage = 0;
  debugMode: DebugMode = 'svg';
  /** The overlay was opened from another profile: closing it goes back there. */
  private returnBack = false;
  private timer: TimerHandle | undefined;

  constructor(id: string, host: DeviceHost) {
    this.id = id;
    this.host = host;
  }

  get pages(): readonly string[] {
    return this.host.pages();
  }

  /** The layout changed: stay on the page if it is still there, banks back to their start. */
  relayout(): void {
    this.page = Math.min(this.page, Math.max(0, this.pages.length - 1));
    this.banks.clear();
  }

  detail(): DetailState | undefined {
    return this.overlay;
  }

  openDetail(bus: Bus, index: number): boolean {
    if (bus !== 'input' && bus !== 'playback') return false;
    const onConsole = this.host.showsConsole();
    if (!onConsole && !this.host.openConsole()) return false;
    if (!this.overlay) this.returnBack = !onConsole;
    this.overlay = { bus, index };
    this.touch();
    this.host.redraw();
    return true;
  }

  closeDetail(): void {
    if (!this.overlay) return;
    this.overlay = undefined;
    this.host.clock.clearTimeout(this.timer);
    this.timer = undefined;
    this.host.redraw();
    if (this.returnBack) {
      this.returnBack = false;
      this.host.switchBack();
    }
  }

  moveDetail(direction: Direction): void {
    const at = this.overlay;
    const to = at && this.host.neighbour(at.bus, at.index, direction);
    if (!at || to === undefined || to === at.index) return;
    this.overlay = { ...at, index: to };
    this.host.redraw();
  }

  selectSend(send: SendTarget): void {
    if (!this.overlay) return;
    this.overlay = { ...this.overlay, send };
    this.host.redraw();
  }

  /** A key of the device was pressed: the overlay stays open a while longer. */
  touch(): void {
    this.host.clock.clearTimeout(this.timer);
    this.timer = undefined;
    const ms = this.host.detailTimeoutMs();
    if (!this.overlay || ms <= 0) return;
    this.timer = this.host.clock.setTimeout(() => {
      this.timer = undefined;
      this.closeDetail();
    }, ms);
  }

  dispose(): void {
    this.host.clock.clearTimeout(this.timer);
    this.timer = undefined;
  }

  bank(n = 0): BankState | undefined {
    return this.host.bankOf(this.page, n, this.banks);
  }

  moveBank(n: number, direction: Direction): void {
    const b = this.bank(n);
    if (b) this.setBank(n, moveBank(b, b.size, b.total, direction));
  }

  nextBankSource(n: number): void {
    const b = this.bank(n);
    if (b) this.setBank(n, nextBankSource(b));
  }

  goToPage(index: number): void {
    if (index === this.page || index < 0 || index >= this.pages.length) return;
    this.page = index;
    this.host.redraw();
  }

  openConsole(): boolean {
    return this.host.openConsole();
  }

  exitConsole(): void {
    if (this.overlay) {
      this.returnBack = false;
      this.closeDetail();
    }
    this.host.switchBack();
  }

  private setBank(n: number, to: BankPosition): void {
    this.banks.set(`${String(this.page)}/${String(n)}`, { source: to.source, offset: to.offset });
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
  /** The layout without one in the settings. */
  private readonly defaultLayout: Layout;
  private readonly consoleProfile: string | undefined;
  private readonly debugImages: DebugImages | undefined;
  private readonly snapshotNames: SnapshotNames | undefined;
  private settings: GlobalSettings;
  private scheduler: FrameScheduler;
  private readonly keys = new Map<string, DeckKey>();
  private readonly devices = new Map<string, DeckDevice>();
  /** Strips per bank source, until the store changes. */
  private readonly stripCache = new Map<BankSource, Strip[]>();
  private readonly unsubscribe: () => void;

  constructor(options: DeckRuntimeOptions) {
    this.mixer = options.mixer;
    this.host = options.host;
    this.clock = options.clock;
    this.log = options.log ?? SILENT;
    this.imageSize = options.imageSize ?? 144;
    this.render = options.render ?? renderSvg;
    this.blank = blankImage(this.imageSize);
    this.defaultLayout = options.layout ?? CONSOLE_LAYOUT;
    this.consoleProfile = options.consoleProfile;
    this.debugImages = options.debugImages;
    this.snapshotNames = options.snapshotNames;
    this.settings = options.settings ?? DEFAULT_SETTINGS;
    this.scheduler = this.makeScheduler();
    // Any change may show on any key (a name, Main moving to another output): draw them all
    // again. The scheduler coalesces this per key, and images that did not change are not sent.
    this.unsubscribe = this.mixer.store.subscribe(() => {
      this.stripCache.clear();
      this.scheduler.invalidateAll();
    });
  }

  /** What the Console Slots show: the settings' layout, else the default. */
  get layout(): Layout {
    return this.settings.layout ?? this.defaultLayout;
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

  /** What the key's Property Inspector shows now, or undefined for a key that is not here. */
  inspect(id: string): InspectorView | undefined {
    const key = this.keys.get(id);
    if (!key) return undefined;
    const { kind, settings } = key.placement;
    return inspectorView({
      kind,
      settings,
      store: this.mixer.store,
      global: this.settings,
      slot: kind === 'slot' ? this.slotSpec(key) : undefined,
      snapshotName: (n) => this.snapshotName(n),
    });
  }

  /**
   * One change from the key's Property Inspector: the key follows at once. Returns the
   * action's new settings for the host to store, or undefined when the change was refused.
   */
  changeSetting(id: string, name: string, value: InspectorValue): JsonObject | undefined {
    const key = this.keys.get(id);
    if (!key) return undefined;
    const next = changeSetting(key.placement.kind, key.placement.settings, name, value);
    if (next) this.settingsChanged(id, next);
    return next;
  }

  down(id: string): void {
    const key = this.keys.get(id);
    if (!key) return;
    if (key.placement.kind === 'test-image' && key.gestures.idle) {
      key.gestures.configure({ longPressMs: this.settings.gestures.longPressMs });
    } else if (key.gestures.idle) {
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

  /** New global settings: timings apply from the next press, everything else now. */
  configure(settings: GlobalSettings): void {
    const frames = JSON.stringify(settings.frames) !== JSON.stringify(this.settings.frames);
    const layout = JSON.stringify(settings.layout) !== JSON.stringify(this.settings.layout);
    this.settings = settings;
    if (layout) for (const d of this.devices.values()) d.relayout();
    // Hidden channels change what the banks hold.
    this.stripCache.clear();
    if (frames) {
      this.scheduler.dispose();
      this.scheduler = this.makeScheduler();
      for (const key of this.keys.values()) this.addFrames(key);
    } else {
      this.scheduler.invalidateAll();
    }
  }

  dispose(): void {
    for (const d of this.devices.values()) d.dispose();
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
      d = new DeckDevice(id, {
        clock: this.clock,
        bankOf: (page, n, banks) => this.bankOf(page, n, banks),
        redraw: () => {
          this.redraw(id);
        },
        openConsole: () => {
          if (this.consoleProfile === undefined) return false;
          this.host.switchToProfile(id, this.consoleProfile);
          return true;
        },
        showsConsole: () => {
          for (const key of this.keys.values()) {
            if (key.placement.device === id && key.placement.kind === 'slot') return true;
          }
          return false;
        },
        switchBack: () => {
          this.host.switchToProfile(id);
        },
        neighbour: (bus, index, direction) =>
          neighbour(this.mixer.store, bus, index, direction)?.index,
        detailTimeoutMs: () => this.settings.detail.timeoutSec * 1000,
        pages: () => this.layout.pages.map((p) => p.name),
      });
      this.devices.set(id, d);
    }
    return d;
  }

  private stripsOf(source: BankSource): Strip[] {
    let list = this.stripCache.get(source);
    if (!list) {
      list = this.listStrips(source);
      this.stripCache.set(source, list);
    }
    return list;
  }

  /** The strips of a bus the Console shows: those not hidden in the Control Center. */
  private shown(bus: Bus, settings: GlobalSettings): Strip[] {
    return strips(this.mixer.store, bus).filter(
      (s) => channelSettings(settings, s.bus, s.index)?.hidden !== true,
    );
  }

  private listStrips(source: BankSource, settings = this.settings): Strip[] {
    const store = this.mixer.store;
    if (source !== 'playback+output') return this.shown(source, settings);
    // Main and the Phones outputs have keys of their own on the Console page.
    const own = new Set(
      [mainOutput(store), ...([1, 2, 3, 4] as const).map((n) => phonesOutput(store, n))]
        .filter((s) => s !== undefined)
        .map((s) => s.index),
    );
    return [
      ...this.shown('playback', settings),
      ...this.shown('output', settings).filter((s) => !own.has(s.index)),
    ];
  }

  private bankOf(
    page: number,
    n: number,
    banks: ReadonlyMap<string, BankPosition>,
  ): BankState | undefined {
    const spec = this.layout.pages[page]?.banks?.[n];
    if (!spec) return undefined;
    const at = banks.get(`${String(page)}/${String(n)}`) ?? { source: spec.source, offset: 0 };
    const total = this.stripsOf(at.source).length;
    return { ...clampBank(at, spec.size, total), size: spec.size, total, home: spec.source };
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
    const at = key.placement.coordinates;
    if (d.detail()) {
      return at && at.column < 8 && at.row < 4
        ? (DETAIL_KEYS[at.row * 8 + at.column] ?? EMPTY)
        : EMPTY;
    }
    const spec = keyAt(this.layout, d.page, at);
    if (spec.type !== 'strip') return spec;
    const bank = this.bankOf(d.page, spec.bank ?? 0, d.banks);
    const strip = bank && this.stripsOf(bank.source)[bank.offset + spec.n];
    if (!bank || !strip) return EMPTY;
    return { type: 'channel', bus: strip.bus, index: strip.index, style: spec.style };
  }

  // --- previews ---------------------------------------------------------------------------

  /**
   * Every key of a layout page as the deck would draw it now, with its banks at their start
   * and no overlay: the Control Center's layout builder shows these. `settings` may be a draft
   * that is not saved yet. The images are SVG data URLs, whatever the deck draws with.
   */
  preview(settings: GlobalSettings, page: number): string[] {
    const theme = THEMES[settings.theme] ?? DARK;
    return this.previewViews(settings, page).map((view) =>
      view === undefined ? this.blank : renderSvg(view, theme, this.imageSize, ''),
    );
  }

  /** The views of preview(): undefined for a blank key. */
  previewViews(settings: GlobalSettings, page: number): (KeyView | undefined)[] {
    const layout = settings.layout ?? this.defaultLayout;
    const p = layout.pages[page];
    if (!p) return [];
    const lists = new Map<BankSource, Strip[]>();
    const stripsOf = (source: BankSource): Strip[] => {
      let list = lists.get(source);
      if (!list) {
        list = this.listStrips(source, settings);
        lists.set(source, list);
      }
      return list;
    };
    const bank = (n = 0): BankState | undefined => {
      const spec = p.banks?.[n];
      if (!spec) return undefined;
      const total = stripsOf(spec.source).length;
      return { source: spec.source, offset: 0, size: spec.size, total, home: spec.source };
    };
    const nothing = (): void => undefined;
    const nav: Navigator = {
      page,
      pages: layout.pages.map((x) => x.name),
      bank,
      openDetail: () => false,
      moveBank: nothing,
      nextBankSource: nothing,
      goToPage: nothing,
      openConsole: () => false,
      exitConsole: nothing,
      detail: () => undefined,
      closeDetail: nothing,
      moveDetail: nothing,
      selectSend: nothing,
    };
    const ctx: KeyContext = {
      mixer: this.mixer,
      now: this.clock.now(),
      settings,
      held: false,
      memo: {},
      nav,
      alert: nothing,
      ok: nothing,
      savePreset: nothing,
      snapshotName: (n) => settings.snapshots[String(n)] ?? this.snapshotNames?.name(n),
      openControlCenter: () => false,
    };
    return Array.from({ length: layout.columns * layout.rows }, (_, i) => {
      let spec = p.keys[i] ?? EMPTY;
      if (spec.type === 'strip') {
        const b = bank(spec.bank ?? 0);
        const strip = b && stripsOf(b.source)[spec.n];
        spec = strip
          ? { type: 'channel', bus: strip.bus, index: strip.index, style: spec.style }
          : EMPTY;
      }
      try {
        return controllerFor(spec).view(spec, ctx);
      } catch (error) {
        this.log.error(`preview of key ${String(i)} failed:`, error);
        return undefined;
      }
    });
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
      savePreset: (preset, db) => {
        this.savePreset(preset, db);
      },
      snapshotName: (n) => this.snapshotName(n),
      openControlCenter: (section) => {
        if (!this.host.openControlCenter) return false;
        this.host.openControlCenter(section);
        return true;
      },
    };
  }

  /** A snapshot's name: the Control Center's, else TotalMix's (from its state file). */
  private snapshotName(n: number): string | undefined {
    return this.settings.snapshots[String(n)] ?? this.snapshotNames?.name(n);
  }

  /** Keeps a preset's level, draws the keys again and hands the settings to the app. */
  private savePreset(preset: string, db: number): void {
    const settings = { ...this.settings, levels: { ...this.settings.levels, [preset]: db } };
    this.configure(settings);
    this.host.saveSettings(toJson(settings));
  }

  private draw(key: DeckKey): string {
    const id = key.placement.id;
    if (key.placement.kind === 'test-image') return this.debugImage(key);
    let view: KeyView | undefined;
    let animated = false;
    try {
      const spec = this.specOf(key);
      const controller = controllerFor(spec);
      view = controller.view(spec, this.context(key));
      animated = controller.animated?.(spec) === true;
    } catch (error) {
      this.log.error(`drawing key ${id} failed:`, error);
      view = undefined;
    }
    this.scheduler.setRate(
      id,
      view !== undefined && (animated || hasMeter(view)) ? this.settings.frames.meterFps : 0,
    );
    if (view === undefined) return this.blank;
    const text = this.settings.theme + viewKey(view);
    if (text === key.lastView && key.lastImage !== undefined) return key.lastImage;
    const image = this.render(view, THEMES[this.settings.theme] ?? DARK, this.imageSize, id);
    key.lastView = text;
    key.lastImage = image;
    return image;
  }

  private debugImage(key: DeckKey): string {
    const d = this.device(key.placement.device);
    const at = key.placement.coordinates;
    const position = at ? at.row * 8 + at.column : 0;
    return this.debugImages?.image(d.debugPage, position, d.debugMode) ?? this.blank;
  }

  /** Test Images: a tap shows the next page, a long press the other kind of image. */
  private onDebugGesture(key: DeckKey, gesture: Gesture): void {
    const images = this.debugImages;
    if (!images || (gesture.type !== 'tap' && gesture.type !== 'longPress')) return;
    const device = key.placement.device;
    const d = this.device(device);
    if (gesture.type === 'tap') {
      d.debugPage = (d.debugPage + 1) % Math.max(1, images.pages);
    } else {
      d.debugMode = d.debugMode === 'svg' ? 'png' : 'svg';
      this.host.showOk(key.placement.id);
    }
    this.log.info(
      `test images: page ${String(d.debugPage + 1)}/${String(images.pages)} (${images.title(d.debugPage)}), ${d.debugMode}`,
    );
    for (const k of this.keys.values()) {
      if (k.placement.device === device && k.placement.kind === 'test-image') {
        this.scheduler.invalidate(k.placement.id);
      }
    }
  }

  private onGesture(key: DeckKey, gesture: Gesture): void {
    if (key.placement.kind === 'test-image') {
      this.onDebugGesture(key, gesture);
      return;
    }
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
    if (gesture.type === 'press') this.device(key.placement.device).touch();
  }
}
