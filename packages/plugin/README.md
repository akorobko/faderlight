# Plugin

The Stream Deck plugin: the only code that talks to the Stream Deck SDK (`@elgato/streamdeck`
v3). It reads the global settings, keeps the connection to TotalMix FX, and passes key events
to the deck runtime (`packages/deck`) and key images back to the Stream Deck app.

| Path                             | Contents                                                       |
| -------------------------------- | -------------------------------------------------------------- |
| `dev.faderlight.mixer.sdPlugin/` | The folder the Stream Deck app loads: `manifest.json`, `imgs/` |
| `src/plugin.ts`                  | Entry point, SDK wiring                                        |
| `src/ids.ts`                     | Plugin and action UUIDs                                        |
| `src/mixer.ts`                   | The TotalMix connection, restarted when its settings change    |
| `scripts/build.ts`               | Builds `bin/`, `fonts/` and `profiles/` into the plugin folder |
| `scripts/profile.ts`             | Writes the bundled Console profile (`scripts/zip.ts` packs it) |
| `scripts/icons.ts`               | Draws the icons in `imgs/` (our own artwork)                   |
| `test/fake-app.ts`               | A fake Stream Deck app for tests                               |

The manifest targets SDK 3, Stream Deck 7.1 or later and Node.js 24, on macOS 13+ and Windows
10+. Its actions come from the registry in `packages/deck/src/actions.ts`; a test keeps the two
in step. The plugin UUID is `dev.faderlight.mixer`.

The plugin itself holds no key logic: it passes each key that appears, each key down and up
and each settings change to the `DeckRuntime` of `packages/deck` (its README lists what each
action does) and sends the images the runtime draws back to the app.

## Build and try it

```sh
npm run plugin:build                                        # bundles into the .sdPlugin folder
npx streamdeck link packages/plugin/dev.faderlight.mixer.sdPlugin   # once: the app loads it from here
npx streamdeck restart dev.faderlight.mixer                 # after each build
```

The build bundles `src/plugin.ts` and everything it imports into `bin/plugin.js` with Rollup
(TypeScript is transpiled file by file, without type checking: `npm run check` does that),
copies the renderer's fonts into `fonts/` and writes the Console profile into `profiles/`. All
three are gitignored.

## The Console profile

`profiles/Console.streamDeckProfile` is one Stream Deck XL page with a Console Slot on each of
its 32 keys; the deck runtime decides what each slot shows (`packages/deck`, "The Console
layout"). The Console launcher action and Back in the Channel Detail overlay switch to it and
back. The profile format is not documented: `scripts/profile.ts` follows exported profiles. If
the app does not install it, build the same profile by hand (a new XL profile with a Console
Slot on every key), export it from the app as `Console.streamDeckProfile` and put it in
`profiles/` of the plugin folder.

The plugin writes its log to the plugin folder's `logs/` (gitignored). `Nodejs.Debug` is
`enabled` in the manifest, so a debugger can attach to the running plugin.

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
