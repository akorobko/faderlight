# Control Center

The plugin's settings page (docs/design/03-ux.md §5.2): a local web page in the browser, served
by a small HTTP + WebSocket server inside the plugin. Like the deck runtime, it knows nothing
of the Stream Deck SDK: the plugin (and the virtual deck) start the server with a
`ControlCenterHost` that gives it the mixer store, the settings and the diagnostics.

| File                 | Contents                                                                    |
| -------------------- | --------------------------------------------------------------------------- |
| `src/server.ts`      | `ControlCenterServer`: one-time links, session cookie, page files, JSON-RPC |
| `src/protocol.ts`    | The JSON-RPC methods and the notifications of each live topic               |
| `src/diagnostics.ts` | Packet log and connection report (`Diagnostics`, attached to a connection)  |
| `src/setup.ts`       | The Setup Assistant's checks, from the connection report                    |
| `src/summary.ts`     | What the pages show about the mixer, and the meter frames                   |
| `ui/`                | The page: Preact components, the JSON-RPC client, styles                    |
| `scripts/`           | `bundle.ts` (Rollup for browser code), `build-ui.ts` (the page's files)     |

## The page

A single-page app in Preact (`ui/`), bundled by Rollup into `app.js`, `app.css` and
`index.html`: `npm run plugin:build` writes them into the plugin folder, and the virtual deck
builds them in memory when it starts. `node packages/control-center/scripts/build-ui.ts --out
<folder>` writes them anywhere. The page has no other files and loads nothing from elsewhere
(the server's `Content-Security-Policy` allows only its own origin).

| Section           | Shows                                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Connection        | where TotalMix is (host, ports), the Setup Assistant, the packet log, the mixer's state                                                          |
| Device & Channels | the interface, snapshot names, every channel with its meter, its name and colour on the keys and whether the Console shows it, the Level Presets |
| Behaviour         | long press, double tap, how held step keys repeat, when Channel Detail closes by itself                                                          |
| Appearance        | the theme, the key colour of each TotalMix colour number, how often key images are drawn                                                         |

The section is the address's fragment (`#connection`, `#channels`, `#behaviour`,
`#appearance`), so the plugin can open one directly. An empty box uses what TotalMix has: a
name, colour or snapshot name emptied again takes the entry out of the settings
(`ui/edits.ts`).
Edits go into a draft: a bar at the bottom saves or discards them, and the page asks before it
is closed with unsaved edits. When the plugin stops (or the Stream Deck app restarts) the page
says so; a new link from the Stream Deck opens it again.

The Setup Assistant checks TotalMix's OSC settings by what arrives, not by what the plugin
sends: the port is free, TotalMix answers, the mixer has been read, meters arrive, and changes
made in TotalMix arrive (Send changes and Send status in TotalMix's OSC settings). Each check
that fails says what to change in TotalMix.

## Access

The server listens on `127.0.0.1`, on a port the system picks, and only hands the page to a
browser that came through a link from the plugin:

1. `server.link(section)` makes a one-time token, valid for two minutes:
   `http://127.0.0.1:52123/?t=…#layout`.
2. Opening it swaps the token for a session cookie (`HttpOnly`, `SameSite=Strict`) and
   redirects to `/`, so the token leaves the address bar. Every other request needs the
   cookie; a used or expired link says to open the Control Center from the Stream Deck again.
3. Every request must name the server in its `Host` header (`127.0.0.1:<port>` or
   `localhost:<port>`), against DNS rebinding, and the WebSocket (`/rpc`) must come from the
   page itself (`Origin`), so other web pages in the same browser cannot use it.

## Protocol

JSON-RPC 2.0 over the WebSocket at `/rpc` (`src/protocol.ts` has the types):

| Method           | Does                                                                                                                              |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `hello`          | the plugin version, the global settings and their defaults                                                                        |
| `settings.save`  | checks, applies and stores global settings; returns them and problems                                                             |
| `subscribe`      | follows topics (below); the first notification of each has it all, also for a topic followed already (a new listener on the page) |
| `unsubscribe`    | stops following topics                                                                                                            |
| `mixer.resync`   | reads the whole mixer again                                                                                                       |
| `packets.clear`  | empties the packet log                                                                                                            |
| `packets.meters` | keeps meter messages in the packet log too (off by default)                                                                       |

| Topic        | Notifications                                                                |
| ------------ | ---------------------------------------------------------------------------- |
| `settings`   | the global settings, whenever they change                                    |
| `mixer`      | device, strips per bus, Main and Phones, snapshots (at most 5 a second)      |
| `meters`     | level, peak and clip of every visible channel, 10 times a second             |
| `connection` | the connection report and the Setup Assistant checks, once a second          |
| `packets`    | new packet log entries (the last 500 messages in both directions)            |
| `store`      | the store itself: every entry first, then what changed (the live store view) |

JSON has no `-Infinity` (an output that is off), so numbers that are not finite travel as the
strings `"-Infinity"`, `"Infinity"` and `"NaN"`.

## Diagnostics

`Diagnostics.attach(connection, settings)` follows one TotalMix connection: every message in
and out goes to the packet log (meter messages only when asked, there are dozens every 40 ms),
and the report counts datagrams, meters and changes made in TotalMix. A change made in
TotalMix is a state message that is no reply to a request of ours: more than 300 ms after the
last request (TotalMix answers in 6-20 ms). The log masks the interface's serial number, which
TotalMix sends in `/status/device`; such an entry keeps it apart in `unmasked`. The page's
_Serial numbers_ switch shows it (to tell two interfaces of the same model apart). The switch is
off on every visit and never saved, so a screenshot of the log has no serial number by accident.

## Tests

`test/server.test.ts` runs the server with a test host and talks to it like a browser (links,
cookies, `Host` and `Origin` headers, the WebSocket); `test/diagnostics.test.ts` runs the
diagnostics against the simulator. The page itself is tested in Chromium through the virtual
deck (`tools/virtual-deck/e2e/control-center.spec.ts`, `npm run e2e`), which saves screenshots
to `renders/control-center/`.
