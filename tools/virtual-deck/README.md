# Virtual deck

The Faderlight keys on a web page: the deck runtime of `packages/deck`, exactly as the plugin
runs it, against the simulator (or a real TotalMix), drawn as a Stream Deck XL you can click.
No Stream Deck app or hardware needed.

```sh
npm run deck                          # simulator with the studio session, http://127.0.0.1:8080/
npm run deck -- --layout full         # every channel of a UFX III visible
npm run deck -- --totalmix 127.0.0.1  # the real TotalMix on this computer (ports 7002 / 9002)
npm run deck -- --help
```

Two profiles, as tabs above the deck:

- **Console**: a Console Slot on every key, like the bundled profile: the Console, Inputs and
  Outputs pages, banks and the Channel Detail overlay.
- **My page**: a few specific actions, a Level Preset and the Console launcher on an otherwise
  empty page, as a user would build one (docs/design/03-ux.md §4a). A long press on a channel
  key there opens the overlay on the Console, and Back comes back; so does Exit on the Console.

Against the simulator the Snapshot keys show made-up names; with `--totalmix` they show the
names in TotalMix's state file on this computer (`packages/deck`, "Specific actions").

**Control Center** (the button above the deck, or a tap on the Status key) opens the
Control Center (`packages/control-center`) for these keys, as the plugin does: the browser
opens no window by itself after a key press, so the Status key offers a link instead. Settings
saved there apply to the keys at once and last until the virtual deck stops; it keeps the
TotalMix connection it was started with.

**Key settings** switches to choosing keys, as in the Stream Deck app: a click selects a key
instead of pressing it and shows the plugin's Property Inspector (`packages/plugin/pi`) beside
the deck. The page connects it the way the app does (`connectElgatoStreamDeckSocket`, over a
WebSocket to this server, which answers like the plugin). Settings changed there apply to the
key at once and last until the virtual deck stops.

Press keys with the mouse or a finger: key down and key up go to the runtime separately, so
long presses, double taps (Talkback) and held ± keys work as on the hardware.

| Path                         | Contents                                                        |
| ---------------------------- | --------------------------------------------------------------- |
| `src/server.ts`              | HTTP server, server-sent events, the two profiles               |
| `src/page.ts`                | The page (HTML, CSS and the script that draws the deck)         |
| `src/cli.ts`                 | Command line                                                    |
| `test/server.test.ts`        | The HTTP API against the simulator (Vitest, part of `npm test`) |
| `e2e/deck.spec.ts`           | Browser tests that press keys and save screenshots (Playwright) |
| `e2e/control-center.spec.ts` | Browser tests of the Control Center, with screenshots           |
| `e2e/inspector.spec.ts`      | Browser tests of the Property Inspector, with screenshots       |
| `e2e/settings.spec.ts`       | Browser tests of the Control Center's settings pages            |
| `e2e/layout.spec.ts`         | Browser tests of the layout builder and Backup                  |

## End-to-end tests

```sh
npx playwright install chromium   # once
npm run e2e
```

The tests start the virtual deck on port 4179, press keys in Chromium and check what the keys
show through `GET /api/views`. They save screenshots of each page to `renders/virtual-deck/`, of
the Control Center to `renders/control-center/` and of the Property Inspector to
`renders/property-inspector/`; attach those to PRs that change what they look like or do.
