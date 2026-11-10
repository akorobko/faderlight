// Plugin entry point, run by the Stream Deck app (bin/plugin.js after the build). It is the only
// code that talks to the Stream Deck SDK: it reads the global settings, keeps the TotalMix
// connection, passes key events to the deck runtime and key images back to the app, and
// answers the Property Inspector (pi/).

import { join } from 'node:path';
import streamDeck from '@elgato/streamdeck';
import type { ControlCenterHost } from '@faderlight/control-center';
import {
  DeckRuntime,
  DEFAULT_SETTINGS,
  Inspectors,
  readGlobalSettings,
  toJson,
  totalMixFolder,
  TotalMixSnapshotNames,
  type DeckHost,
  type GlobalSettings,
  type JsonObject,
  type JsonValue,
  type Logger,
  type ReadSettings,
} from '@faderlight/deck';
import { systemClock } from '@faderlight/totalmix';
import { ControlCenter } from './control-center.ts';
import { debugImages } from './debug.ts';
import { CONSOLE_PROFILE, kindOfAction } from './ids.ts';
import { MixerConnection } from './mixer.ts';

const log: Logger = streamDeck.logger;
streamDeck.logger.setLevel('info');

const mixer = new MixerConnection(log);
// TotalMix's state file has the snapshot names, when TotalMix runs on this computer.
const snapshotNames = new TotalMixSnapshotNames(totalMixFolder());
/** The global settings in use. */
let current: GlobalSettings = DEFAULT_SETTINGS;

/** Reports a request to the app that failed (the key went away meanwhile, usually). */
const report =
  (what: string) =>
  (error: unknown): void => {
    log.debug(`${what} failed:`, error);
  };

const host: DeckHost = {
  setImage: (id, image) => {
    const action = streamDeck.actions.getActionById(id);
    if (action?.isKey()) action.setImage(image).catch(report('setImage'));
  },
  showAlert: (id) => {
    const action = streamDeck.actions.getActionById(id);
    if (action?.isKey()) action.showAlert().catch(report('showAlert'));
  },
  showOk: (id) => {
    const action = streamDeck.actions.getActionById(id);
    if (action?.isKey()) action.showOk().catch(report('showOk'));
  },
  switchToProfile: (device, profile) => {
    streamDeck.profiles.switchToProfile(device, profile).catch(report('switchToProfile'));
  },
  saveSettings: (settings) => {
    current = readGlobalSettings(settings).settings;
    controlCenter.settingsChanged();
    streamDeck.settings.setGlobalSettings(settings).catch(report('setGlobalSettings'));
  },
  openControlCenter: (section) => {
    void controlCenter.open(section);
  },
};

const controlCenterHost: ControlCenterHost = {
  get version() {
    return streamDeck.info.plugin.version;
  },
  store: mixer.store,
  diagnostics: mixer.diagnostics,
  now: () => systemClock.now(),
  settings: () => current,
  saveSettings: (stored): ReadSettings => {
    const read = readGlobalSettings(stored);
    for (const problem of read.problems) log.warn(`settings from the Control Center: ${problem}`);
    apply(read.settings);
    streamDeck.settings.setGlobalSettings(toJson(read.settings)).catch(report('setGlobalSettings'));
    return read;
  },
  resync: () => {
    mixer.resync();
  },
  snapshotNames: () => snapshotNames.read(),
};

const controlCenter = new ControlCenter(controlCenterHost, log, (url) =>
  streamDeck.system.openUrl(url),
);

// The client stamps meters with the system clock: the runtime reads them on the same one.
const deck = new DeckRuntime({
  mixer,
  host,
  clock: systemClock,
  log,
  consoleProfile: CONSOLE_PROFILE,
  // The app starts the plugin in its folder; the build put the Test Images PNGs in debug/.
  debugImages: debugImages(join(process.cwd(), 'debug')),
  snapshotNames,
});

// The Property Inspector of the selected key: the deck builds what it shows and applies what
// it changes; the app stores the action's settings.
const inspectors = new Inspectors(
  {
    view: (id) => deck.inspect(id),
    change: (id, key, value) => {
      const settings = deck.changeSetting(id, key, value);
      if (!settings) return false;
      streamDeck.actions.getActionById(id)?.setSettings(settings).catch(report('setSettings'));
      return true;
    },
    send: (id, update) => {
      // The app shows one inspector at a time, and the SDK sends to that one.
      if (streamDeck.ui.action?.id !== id) return;
      streamDeck.ui
        .sendToPropertyInspector(update as unknown as JsonObject)
        .catch(report('sendToPropertyInspector'));
    },
    openControlCenter: (section) => {
      void controlCenter.open(section);
    },
  },
  systemClock,
);

/** Settings in use from now on: the connection, the keys and the Control Center follow. */
function apply(settings: GlobalSettings): void {
  current = settings;
  mixer.configure(settings.connection);
  deck.configure(settings);
  controlCenter.settingsChanged();
}

/** Global settings from the Stream Deck app (at start, or changed there). */
function applySettings(stored: unknown): void {
  const read = readGlobalSettings(stored);
  for (const problem of read.problems) log.warn(`settings: ${problem}`);
  if (read.newer) log.warn('settings were written by a newer version; not saving over them');
  if (read.changed) void streamDeck.settings.setGlobalSettings(toJson(read.settings));
  apply(read.settings);
}

// --- keys --------------------------------------------------------------------------------

streamDeck.actions.onWillAppear<JsonObject>((ev) => {
  const kind = kindOfAction(ev.action.manifestId);
  if (!kind || !ev.action.isKey()) return;
  deck.appear({
    id: ev.action.id,
    device: ev.action.device.id,
    kind,
    coordinates: ev.action.coordinates,
    settings: ev.payload.settings,
  });
});

streamDeck.actions.onWillDisappear((ev) => {
  deck.disappear(ev.action.id);
});

streamDeck.actions.onKeyDown((ev) => {
  deck.down(ev.action.id);
});

streamDeck.actions.onKeyUp((ev) => {
  deck.up(ev.action.id);
});

streamDeck.ui.onDidAppear((ev) => {
  inspectors.appear(ev.action.id);
});

streamDeck.ui.onDidDisappear((ev) => {
  inspectors.disappear(ev.action.id);
});

streamDeck.ui.onSendToPlugin<JsonValue>((ev) => {
  inspectors.message(ev.action.id, ev.payload);
});

streamDeck.settings.onDidReceiveSettings<JsonObject>((ev) => {
  deck.settingsChanged(ev.action.id, ev.payload.settings);
});

streamDeck.settings.onDidReceiveGlobalSettings<JsonObject>((ev) => {
  applySettings(ev.settings);
});

await streamDeck.connect();
log.info(`Faderlight ${streamDeck.info.plugin.version} started`);
applySettings(await streamDeck.settings.getGlobalSettings<JsonObject>());
