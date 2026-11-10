# 02 — Tech stack and architecture

## Decision summary

| Concern | Choice | Why |
|---|---|---|
| Language | **TypeScript** (strict), ESM | Official SDK language; same code for plugin, PI, settings app, simulator |
| Runtime | **Node.js 24** (embedded by Stream Deck app) | Required by SDK v3 |
| Stream Deck SDK | **`@elgato/streamdeck` ^3.0**, `@elgato/cli` ^1.10, manifest `SDKVersion 3`, `Software.MinimumVersion "7.1"` | Current; cross-platform macOS + Windows |
| Control protocol | **TotalMix FX Global OSC over UDP** (TotalMix FX ≥ 2.1) | Absolute addressing, native units, state queries, meters, status |
| OSC library | **Own minimal codec** (~250 LOC: messages, bundles, types `i f s b T F`) on `node:dgram` | Zero native deps, fully unit-testable, tiny; existing libs are old/unmaintained |
| MIDI | Not in v1 | See 01 §3.3 |
| Key rendering | **Pure functions → SVG string** → `data:image/svg+xml` via `setImage` | No canvas/native deps; deterministic; snapshot-testable |
| Test rendering | `@resvg/resvg-wasm` (dev only) to rasterise SVG → PNG at 96/144 px | Golden images that agents can *look at*; the WebAssembly build draws the same pixels on every platform |
| PI (in Stream Deck) | Plain HTML + a tiny TS bundle (`packages/plugin/pi`) that draws a form model the plugin builds (`packages/deck/src/inspector.ts`); no `sdpi-components` | Native look in a few lines of CSS, no outside code, lists stay live |
| Settings app ("Control Center") | Local HTTP + WebSocket server inside the plugin (`127.0.0.1`, random port), UI = **Preact** SPA bundled with Rollup (one script, one stylesheet), opened with `streamDeck.system.openUrl` | Rich UI without PI limits; no Electron |
| Build | npm workspaces, **Rollup** for the plugin and its pages (`packages/control-center/scripts/bundle.ts`) | Standard; one bundler, no dev server needed |
| Tests | **Vitest** (unit/integration), Playwright (settings app + virtual deck screenshots) | Fast, agent-friendly |
| Lint/format | ESLint (typescript-eslint) + Prettier, `tsc --noEmit` | CI gate |
| CI | GitHub Actions: PR gate (`npm run check`) on a self-hosted Mac runner; Windows tests on a GitHub-hosted runner after each merge to main | Free PR checks on the primary platform; Windows still covered |
| Packaging | `streamdeck pack` → `.streamDeckPlugin`, GitHub Releases; Marketplace later | |

## Repository layout (npm workspaces)

```
/
├─ AGENTS.md                     # agent rules, harness-neutral
├─ docs/design/                  # these documents
├─ docs/vendor/                  # RME OSC table (user-supplied), captured traces
├─ packages/
│  ├─ osc/                       # codec + UDP transport (no TotalMix knowledge)
│  ├─ totalmix/                  # Global OSC adaptor: address map, encode/decode, fader curve,
│  │                             #   connection state machine, state request scheduler
│  ├─ model/                     # protocol-agnostic mixer model: Store, entities, device profiles
│  ├─ render/                    # key renderers (pure: (viewModel, theme, size) -> svg)
│  ├─ simulator/                 # fake TotalMix (Global OSC server) + CLI + web panel
│  ├─ deck/                      # deck runtime without the SDK: settings, gestures, frame
│  │                             #   scheduler, layout engine, key controllers
│  ├─ control-center/            # Control Center: server in the plugin (HTTP+WS, JSON-RPC)
│  │                             #   and the settings page it serves
│  └─ plugin/                    # SDK wiring, build, bundled profiles, PI html
│     └─ com.ratio32.faderlight.mixer.sdPlugin/   # manifest, icons; bin/ and fonts/ are built
└─ tools/
   ├─ capture/                   # records real TotalMix OSC traffic to JSONL fixtures
   └─ virtual-deck/              # browser page rendering a full XL from plugin pipeline
```

## Runtime architecture

```
 TotalMix FX (host) ◄─UDP 7002── OscTransport ──► Codec ──► TotalMixAdaptor ──► MixerStore (single source of truth)
                     ──UDP 9002─►                                   ▲                 │ change events (coalesced)
                                                                    │ commands        ▼
                                              ActionControllers / LayoutEngine ──► FrameScheduler ──► setImage()
                                                       ▲                                     ▲
                       Stream Deck app ── key events ──┘     Control Center (HTTP/WS) ◄──────┘ (same store, live)
```

### Components

**OscTransport** (`packages/osc`, `UdpTransport`) — binds the feedback port, sends to TotalMix host:port, decodes every datagram. A failed bind or socket error is retried with exponential backoff (250 ms doubling to 10 s, ±20 % jitter). Accepts feedback from any source port of the TotalMix host and reports each change of source port (a TotalMix restart). It does not judge liveness: silence means nothing without a heartbeat, so the adaptor polls (below). Several transports possible (multi-device later).

**TotalMixAdaptor** (`packages/totalmix`) — maps addresses ⇄ typed model updates (`{target: {scope: 'channel', bus: 'input', index: 8, field: 'phantom'}, value: true}`). Owns:
- *Address map* (`protocol.ts`, pure): `decodeMessage(msg) → update | meter | unknown`, `encodeCommand(cmd) → OscMessage`, `encodeRequest(req)`, `confirmRequestFor(target)`; the fader law in `fader.ts`.
- *Connection state machine* (`client.ts`): `idle → probing (/sendstate once a second until a reply) → syncing (/sendall 2) → live (/sendstate once a second) → stale (3 polls unanswered; values kept, meters cleared; keeps polling) → syncing on the next reply`. A sync is complete after 150 ms without state messages *and* the reply to a `/sendstate` sent behind the dump; only then does the store drop what the dump left out. A new source port while live (a TotalMix restart) starts a new sync, and so does a strip turning stereo or mono while live (250 ms after the last such change), since that changes which strips exist. TotalMix sends no heartbeat and meters stop when levels do not change (`docs/protocol/global-osc.md` §5, §8).
- *Optimistic commands*: a write goes out at once and shows as `pending` in the store; 75 ms after the last write that the same request answers, a targeted request (`/sendchan/...`, `/sendsubmix/...` or `/sendsettings`) asks for the value, because TotalMix does not echo numeric writes (only names). Its reply confirms or corrects the value. No reply within 1 s of that request: roll back to the last device value and emit `commandFailed`. Losing the connection rolls back everything in flight.
- *Paced requests*: one at a time, 10 ms apart, 100 ms after `/sendall` or `/sendmix`; a request already waiting is not queued twice; polls and confirmations go first.
- `connectTotalMix()` wires the client to a `UdpTransport` and a `MixerStore`.

**MixerStore** (`packages/model`) — normalized state keyed by *target* (channel field, route, control room, global, group, snapshot, reverb/echo, status, DURec; see `targets.ts`), with typed selectors for strips, Main, phones and the loaded snapshot. Each entry is `{value, state: confirmed|pending}`; a missing entry is unknown. A full sync (`beginSync`/`endSync`) removes what the dump did not report: hidden channels and routes that are off. Change events are synchronous, one per batch. `meters` is a separate high-frequency channel (ring buffer per channel with peak hold and clip hold, so renderers get `{level, peak, clip}`; TotalMix's +6 dB marks an over) that raises no events.

**Device profiles** (`model/src/profiles.ts`) — what the protocol does not say: channel labels per row (`AN 1/2`, `Mic 9`, `PH 9/10`, `ADAT 3`), sample-rate-dependent channel counts, preamp gain ranges. Auto-detect from `/status/device`; unknown device → generic profile with numbered labels. The channel list and which channels have 48V, Inst, AutoSet or a reference level come from TotalMix, which only sends visible channels and only the settings the hardware has.

**LayoutEngine** — the key differentiator. The bundled "XL Console" profile places a generic **Slot** action on every key (with its coordinates). The plugin keeps a *Layout* (JSON in global settings) = list of *Pages*, each an 8×4 grid of *KeySpecs* (`{type:'channel', target:'input:8'}`, `{type:'snapshot', n:3}` …). Slots ask the engine what they are. Banking, drill-down overlays and page switches are instant (no profile switching). Users can also drop *specific* actions (Channel, Snapshot, Monitor…) onto any normal profile — both paths share controllers/renderers.

**ActionControllers** — per KeySpec type: turns gestures into commands and store state into a view model. Gesture recogniser per key: tap, long-press (default 450 ms), double-tap (opt-in, 250 ms window), press-and-hold auto-repeat with acceleration (for ± keys).

**FrameScheduler** — global budget for `setImage` (default 120 img/s, max 15 fps per key). Static changes (mute, name) jump the queue; meter-only frames are coalesced and dropped first. Skips sends when SVG hash is unchanged. Meter ballistics computed at render time (decay 20 dB/s, peak hold 1.5 s, clip hold 3 s — configurable).

**Control Center** (`packages/control-center`) — HTTP+WS server started lazily when the user clicks "Open Control Center" in a PI (or taps the Status key). Serves SPA, exposes JSON-RPC over WS: read store snapshot + live diff stream, edit layout/global settings, run diagnostics (packet log, Setup Assistant). Binds `127.0.0.1` only, random port, one-time token in URL that the first request swaps for a `SameSite=Strict` session cookie; requests must carry the server's own `Host` and the WebSocket the page's own `Origin`.

### Settings storage

- **Global settings** (`setGlobalSettings`): connection(s), layout, theme, gesture timings, aliases.
- **Action settings** (per key): only for *specific* actions dropped manually (target, behaviour overrides).
- Export/import JSON from Control Center (backup, sharing layouts).

## Cross-platform notes

- UDP + HTTP via Node built-ins → identical on macOS/Windows. No native modules.
- Windows: firewall prompt on first bind; doc in setup guide. TotalMix on Windows needs explicit remote IP (see 01 §3.1).
- Paths: use `streamDeck` provided paths; logs in plugin `logs/`.
- Linux: Stream Deck app does not exist; coding agents work in Linux sandboxes, so all non-packaging checks must keep passing on Linux. (Community hosts like OpenDeck can load SD plugins — nice-to-have.)

## Performance targets

- Key press → TotalMix command sent: < 10 ms. Visual confirmation < 50 ms (optimistic).
- Meters: 12 fps default on up to 32 keys with CPU < 5 % on Apple Silicon.
- Cold start to live state: < 2 s on UFX III.
