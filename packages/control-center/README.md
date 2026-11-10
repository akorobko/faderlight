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

| Method           | Does                                                                  |
| ---------------- | --------------------------------------------------------------------- |
| `hello`          | the plugin version, the global settings and their defaults            |
| `settings.save`  | checks, applies and stores global settings; returns them and problems |
| `subscribe`      | follows topics (below); the first notification of each has it all     |
| `unsubscribe`    | stops following topics                                                |
| `mixer.resync`   | reads the whole mixer again                                           |
| `packets.clear`  | empties the packet log                                                |
| `packets.meters` | keeps meter messages in the packet log too (off by default)           |

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
TotalMix sends in `/status/device`.

## Tests

`test/server.test.ts` runs the server with a test host and talks to it like a browser (links,
cookies, `Host` and `Origin` headers, the WebSocket); `test/diagnostics.test.ts` runs the
diagnostics against the simulator.
