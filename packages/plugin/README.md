# Plugin

The Stream Deck plugin: the only code that talks to the Stream Deck SDK (`@elgato/streamdeck`
v3). It reads the global settings, keeps the connection to TotalMix FX, and passes key events
to the deck runtime (`packages/deck`) and key images back to the Stream Deck app.

| Path                                     | Contents                                                       |
| ---------------------------------------- | -------------------------------------------------------------- |
| `com.ratio32.faderlight.mixer.sdPlugin/` | The folder the Stream Deck app loads: `manifest.json`, `imgs/` |
| `src/plugin.ts`                          | Entry point, SDK wiring                                        |
| `src/ids.ts`                             | Plugin and action UUIDs                                        |
| `src/mixer.ts`                           | The TotalMix connection, restarted when its settings change    |
| `scripts/build.ts`                       | Builds `bin/`, `fonts/`, `profiles/` and `debug/`              |
| `scripts/profile.ts`                     | Writes the bundled profiles (`scripts/zip.ts` packs them)      |
| `src/debug.ts`                           | The pages of the Test Images debug action                      |
| `scripts/icons.ts`                       | Draws the icons in `imgs/` (our own artwork)                   |
| `test/fake-app.ts`                       | A fake Stream Deck app for tests                               |

The manifest targets SDK 3, Stream Deck 7.1 or later and Node.js 24, on macOS 13+ and Windows
10+. Its actions come from the registry in `packages/deck/src/actions.ts`; a test keeps the two
in step. The plugin UUID is `com.ratio32.faderlight.mixer`.

The plugin itself holds no key logic: it passes each key that appears, each key down and up
and each settings change to the `DeckRuntime` of `packages/deck` (its README lists what each
action does) and sends the images the runtime draws back to the app. It stores the global
settings when a Level Preset is saved, and gives the runtime the snapshot names from TotalMix's
state file on this computer.

## Build and try it

```sh
npm run plugin:build                                                        # bundles into the .sdPlugin folder
npx streamdeck link packages/plugin/com.ratio32.faderlight.mixer.sdPlugin   # once: the app loads it from here
npx streamdeck restart com.ratio32.faderlight.mixer                         # after each build
```

The build bundles `src/plugin.ts` and everything it imports into `bin/plugin.js` with Rollup
(TypeScript is transpiled file by file, without type checking: `npm run check` does that),
copies the renderer's fonts into `fonts/`, writes the bundled profiles into `profiles/` and the
Test Images PNGs into `debug/`. All four are gitignored.

The plugin writes its log to the plugin folder's `logs/` (gitignored). `Nodejs.Debug` is
`enabled` in the manifest, so a debugger can attach to the running plugin.

## The Console profile

`profiles/Console.streamDeckProfile` is one Stream Deck XL page with a Console Slot on each of
its 32 keys; the deck runtime decides what each slot shows (`packages/deck`, "The Console
layout"). The Console launcher action and Back in the Channel Detail overlay switch to it and
back. The profile format is not documented: `scripts/profile.ts` writes what the app's own
version 2.0 bundles hold, page folders named by their encoded ID included (the app rejects plain
UUID folder names as "content corrupted"). Stream Deck 7.6 installs it.

A plugin linked with `streamdeck link` is not installed from a package, so the app does not
offer its profiles on its own: press the Console launcher (or any key that opens the Console)
and the app asks to install them. If the app's log
(`~/Library/Logs/ElgatoStreamDeck/StreamDeck.log` on macOS) says an import failed, compare the
file with a profile exported from the app.

## Test Images (debug)

For reviewing the renderer on a real XL (plan M3.4): the **Faderlight Render Test** profile has
the Test Images action on every key and shows the pages of `renders/contact-sheet.png` key by
key: the Console, Inputs and Channel Detail pages, then all golden cases, 32 to a page in the
order of the sheet. Tap any key for the next page; hold one to switch between the SVG the
plugin sends (drawn by the Stream Deck app) and the PNG the goldens renderer draws from the
same SVG (drawn by resvg at build time, in `debug/`), to compare the two renderers. The log
names the page shown.

## Settings

Global settings (`packages/deck/src/settings.ts`) hold the connection, gesture timings, frame
budget, overlay timeout and theme. They carry a version number: the plugin reads any earlier
version through the migrations there, fills in missing fields, clamps bad values and writes
the result back. Settings written by a newer build are used but never written back.

Until the Property Inspector and the Control Center exist (M5), the defaults are what you get:
TotalMix on `127.0.0.1`, sending to port 7002 and listening on 9002.

## Tests

`test/boot.test.ts` builds the plugin into a temporary folder, runs `streamdeck validate` on it
and starts it against `test/fake-app.ts` (a WebSocket server that launches the plugin the way
the Stream Deck app does) and the simulator: it must register, complete its settings, connect
and draw keys.
