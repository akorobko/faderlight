// Plugin entry point, run by the Stream Deck app (bin/plugin.js after the build). It is the only
// code that talks to the Stream Deck SDK: it reads the global settings, keeps the TotalMix
// connection, and passes key events to the deck runtime and key images back to the app.

import streamDeck from '@elgato/streamdeck';
import { readGlobalSettings, toJson, type JsonObject, type Logger } from '@faderlight/deck';
import { deviceModel } from '@faderlight/model';
import { renderKey, svgDataUrl } from '@faderlight/render';
import { kindOfAction } from './ids.ts';
import { MixerConnection } from './mixer.ts';

const log: Logger = streamDeck.logger;
streamDeck.logger.setLevel('info');

const mixer = new MixerConnection(log);

function applySettings(stored: unknown): void {
  const read = readGlobalSettings(stored);
  for (const problem of read.problems) log.warn(`settings: ${problem}`);
  if (read.newer) log.warn('settings were written by a newer version; not saving over them');
  if (read.changed) void streamDeck.settings.setGlobalSettings(toJson(read.settings));
  mixer.configure(read.settings.connection);
}

// --- keys --------------------------------------------------------------------------------

/** Our keys on screen: context id -> action kind. */
const keys = new Map<string, string>();

function draw(id: string): void {
  const view = {
    kind: 'status',
    link: mixer.store.connection,
    device: deviceModel(mixer.store),
  } as const;
  const action = streamDeck.actions.getActionById(id);
  if (action?.isKey()) void action.setImage(svgDataUrl(renderKey(view)));
}

mixer.store.subscribe((change) => {
  if (change.connection) for (const id of keys.keys()) draw(id);
});

streamDeck.actions.onWillAppear((ev) => {
  const kind = kindOfAction(ev.action.manifestId);
  if (!kind) return;
  keys.set(ev.action.id, kind);
  draw(ev.action.id);
});

streamDeck.actions.onWillDisappear((ev) => {
  keys.delete(ev.action.id);
});

streamDeck.settings.onDidReceiveGlobalSettings<JsonObject>((ev) => {
  applySettings(ev.settings);
});

await streamDeck.connect();
log.info(`Faderlight ${streamDeck.info.plugin.version} started`);
applySettings(await streamDeck.settings.getGlobalSettings<JsonObject>());
