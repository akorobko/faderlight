// Plugin entry point, run by the Stream Deck app (bin/plugin.js after the build). It is the only
// code that talks to the Stream Deck SDK: it reads the global settings, keeps the TotalMix
// connection, and passes key events to the deck runtime and key images back to the app.

import streamDeck from '@elgato/streamdeck';
import {
  DeckRuntime,
  readGlobalSettings,
  toJson,
  type DeckHost,
  type JsonObject,
  type Logger,
} from '@faderlight/deck';
import { systemClock } from '@faderlight/totalmix';
import { CONSOLE_PROFILE, kindOfAction } from './ids.ts';
import { MixerConnection } from './mixer.ts';

const log: Logger = streamDeck.logger;
streamDeck.logger.setLevel('info');

const mixer = new MixerConnection(log);

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
};

// The client stamps meters with the system clock: the runtime reads them on the same one.
const deck = new DeckRuntime({
  mixer,
  host,
  clock: systemClock,
  log,
  consoleProfile: CONSOLE_PROFILE,
});

function applySettings(stored: unknown): void {
  const read = readGlobalSettings(stored);
  for (const problem of read.problems) log.warn(`settings: ${problem}`);
  if (read.newer) log.warn('settings were written by a newer version; not saving over them');
  if (read.changed) void streamDeck.settings.setGlobalSettings(toJson(read.settings));
  mixer.configure(read.settings.connection);
  deck.configure(read.settings);
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

streamDeck.settings.onDidReceiveSettings<JsonObject>((ev) => {
  deck.settingsChanged(ev.action.id, ev.payload.settings);
});

streamDeck.settings.onDidReceiveGlobalSettings<JsonObject>((ev) => {
  applySettings(ev.settings);
});

await streamDeck.connect();
log.info(`Faderlight ${streamDeck.info.plugin.version} started`);
applySettings(await streamDeck.settings.getGlobalSettings<JsonObject>());
