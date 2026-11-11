# Plugin

The Stream Deck plugin: the only code that talks to the Stream Deck SDK (`@elgato/streamdeck`
v3). It reads the global settings, keeps the connection to TotalMix FX, and passes key events
to the deck runtime (`packages/deck`) and key images back to the Stream Deck app.

| Path                                     | Contents                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------------ |
| `com.ratio32.faderlight.mixer.sdPlugin/` | The folder the Stream Deck app loads: `manifest.json`, `imgs/`           |
| `src/plugin.ts`                          | Entry point, SDK wiring                                                  |
| `src/ids.ts`                             | Plugin and action UUIDs                                                  |
| `src/mixer.ts`                           | The TotalMix connection, restarted when its settings change              |
| `pi/`                                    | The Property Inspector page (`scripts/build-pi.ts` builds it)            |
| `scripts/build.ts`                       | Builds `bin/`, `control-center/`, `pi/`, `fonts/`, `profiles/`, `debug/` |
| `scripts/pack.ts`                        | Packs the release `.streamDeckPlugin` file into `dist/`                  |
| `scripts/release.ts`                     | What a release leaves out, its version and its release notes             |
| `scripts/notices.ts`                     | The licences of the bundled packages, for `THIRD-PARTY-NOTICES.txt`      |
| `scripts/profile.ts`                     | Writes the bundled profiles (`scripts/zip.ts` packs them)                |
| `src/debug.ts`                           | The pages of the Test Images debug action                                |
| `scripts/icons.ts`                       | Draws the icons in `imgs/` (our own artwork)                             |
| `test/fake-app.ts`                       | A fake Stream Deck app for tests                                         |

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
Test Images PNGs into `debug/`. Next to the manifest it puts the repository's `LICENSE` and
`THIRD-PARTY-NOTICES.txt`: the licence of each package the bundles hold (the SDK, ws, Preact
and a few more, all MIT), which their licences ask every copy to keep. All of these are
gitignored.

The plugin writes its log to the plugin folder's `logs/` (gitignored). `Nodejs.Debug` is
`enabled` in the manifest, so a debugger can attach to the running plugin.

## Release package

```sh
npm run plugin:pack    # dist/Faderlight-<version>.streamDeckPlugin
```

The one file users download, for macOS and Windows: a double-click hands it to the Stream Deck
app, which installs the plugin and its Console profile. `scripts/pack.ts` builds a release
copy of the plugin folder into `dist/release/` and packs it with `streamdeck pack`, which
validates it first. The release copy leaves out the debug aids of the development build
(`scripts/release.ts`): the Test Images action, the Render Test profile, the PNGs in `debug/`
and the debugger port (`Nodejs.Debug`), which would let any program on the computer run code
inside the plugin. It carries the version of this package's `package.json`; a test keeps the
committed manifest's `Version` in step with it.

## Releasing

1. Set the new version in `package.json` here and in the manifest's `Version` (with a fourth
   `.0`: `0.2.0` is `0.2.0.0`), and add a `## 0.2.0` section to `CHANGELOG.md` at the
   repository root. Merge that to main.
2. Tag the merge and push the tag: `git tag v0.2.0 && git push origin v0.2.0`.
3. The Release workflow (`.github/workflows/release.yml`) runs `npm run check` and
   `npm run plugin:pack -- --expect v0.2.0` on the Mac runner. It stops if the tag, the
   package version and the changelog disagree, and otherwise opens a draft GitHub release with
   the `.streamDeckPlugin` file and the changelog section as its notes.
4. Read the draft, install its file once on a real deck, and publish it.

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
budget, overlay timeout, theme, Level Preset levels, snapshot names, the key colour of each
TotalMix colour number, each channel's own name, colour and whether the Console shows it, and
the Console's layout when the user built one (version 3). They carry a version number: the plugin reads any earlier version through the
migrations there, fills in missing fields, clamps bad values and writes the result back.
Settings written by a newer build are used but never written back.

The defaults: TotalMix on `127.0.0.1`, sending to port 7002 and listening on 9002, and
everything else as TotalMix has it. The Control Center changes them.

## Property Inspector

Every action has the same inspector page (`PropertyInspectorPath` in the manifest, built into
`pi/`): it draws what the deck runtime builds for the selected key (`packages/deck`,
"Property Inspector") and sends each choice back with `sendToPlugin`. The plugin applies it,
stores the action's settings with `setSettings` and answers with the new view; the page keeps
no settings itself, so the plugin is the only writer. The page loads no files from elsewhere:
the Stream Deck app loads it from the plugin folder, as a classic script.

The design (docs/design/02-architecture.md) planned Elgato's sdpi-components for this page. It
is not used: the inspector needs only lists, a status line and a button, which match the app's
look in a few lines of CSS, and the page then has no outside code.

## Control Center

A tap on the Status key opens the Control Center (`packages/control-center`) in the browser,
on its Connection page: where TotalMix is, the Setup Assistant and the packet log. The plugin
starts its server the first time it is opened and keeps it running until the plugin stops;
each opening hands the browser a new one-time link (`src/control-center.ts`). The build writes
the page into the plugin folder (`control-center/`), next to `bin/`. Settings saved there are
checked, applied at once and stored in the global settings, like the plugin's own.

## Tests

`test/boot.test.ts` builds the plugin into a temporary folder, runs `streamdeck validate` on it
and starts it against `test/fake-app.ts` (a WebSocket server that launches the plugin the way
the Stream Deck app does) and the simulator: it must register, complete its settings, connect
and draw keys.
