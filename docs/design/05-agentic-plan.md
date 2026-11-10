# 05 — Agentic development plan

Goal: a coding agent (in a cloud sandbox, no hardware) can implement and verify ~90 % of the work. Hardware-dependent truth enters through **captured traces** and short **human verification checkpoints** on the maintainer's Mac (UFX III + XL).

## 1. Principles for agent-driven work

1. **Hardware-free by default.** Every feature must be testable against the simulator and fixtures. Agents never need the real device to get CI green.
2. **Ground truth = recorded traffic.** Protocol behaviour is learned from the RME OSC table + JSONL captures of real TotalMix sessions, kept in gitignored `docs/vendor/` (RME files) and committed `fixtures/` (our own captures). The simulator is validated against those captures.
3. **Pure core, thin shell.** Codec, adaptor, store, renderers and gesture recogniser are pure/TS-only and unit-tested; the Stream Deck SDK layer is thin.
4. **Visible output.** Renderers produce PNG goldens; the virtual deck and Control Center get Playwright screenshots attached to PRs, so the human reviews pictures, not code.
5. **Small PRs**, one task each, with acceptance criteria below. Each PR updates docs if behaviour changes.
6. **No vendor material in git.** RME documents, tables and plugins live in gitignored `docs/vendor/`; only our own derived spec and our own captures are committed.

## 2. Testing without hardware

| Layer | Tool | What it proves |
|---|---|---|
| OSC codec | Vitest, property tests (round-trip), byte fixtures | spec-correct encoding incl. bundles |
| Adaptor decode/encode | Vitest table tests from captured JSONL | we interpret TotalMix exactly as recorded |
| Store + controllers | Vitest with fake clock | gestures, optimistic updates, rollback, banking |
| Renderers | resvg → PNG golden images @96 and @144 px; pixel-diff threshold | visual regressions; legibility review |
| End-to-end (no SD app) | **Simulator** + plugin core in-process + **virtual deck** in Playwright | press key → OSC command → simulator state → feedback → new key image |
| SD integration | `streamdeck validate`, manifest schema; small fake SD WebSocket server for the SDK connection | plugin boots, registers actions, handles events |
| Real hardware | Human checkpoint script (10 min) on macOS | final truth |

### 2.1 Simulator ("fake TotalMix")

`packages/simulator` — a Node process speaking **Global OSC** on UDP, behaving as the captures show (`docs/protocol/global-osc.md`); see `packages/simulator/README.md`:
- Loads a device profile (UFX III first) → full channel model (names, colours, gain ranges, 48V…), with only the strips of the chosen layout visible.
- Answers `/sendstate`, `/sendsettings`, `/sendchan/...`, `/sendsubmix/...`, `/sendmix` and `/sendall` the way TotalMix does (same order, same bundle packing), applies writes without echoing them (names excepted), and has **no heartbeat**, like TotalMix.
- **Meter generator**: per channel signal scenarios (silence, noise around −18 dBFS, drum hits with clips, level sweep) → `/level/...` every 40 ms with TotalMix's ballistics; output meters follow the mix.
- **Fault injection**: packet loss %, latency, TotalMix "quit" (silence), restart, sample-rate change (channel count changes), bandwidth limit.
- **Replay mode**: play back a captured JSONL trace with original timing.
- CLI (`npm run sim -- --profile ufx3 --port-in 7002 --port-out 9002 --layout studio`) and a tiny web panel showing simulated TotalMix state (for screenshots/debugging; M2.4, not built yet).
- Conformance test: every request and write in every capture is sent to the simulator, starting from the state the capture shows at that moment; the replies must match message by message.

### 2.2 Capture tool (run once by the human)

`tools/capture`: listens on the feedback port, optionally sends a scripted sequence (`/sendall`, toggle 48V on MIC 9, load snapshot 2, …), writes `fixtures/captures/<device>-<tmfx-version>-<date>.jsonl` with timestamps. The maintainer runs it on the Mac (or a coding agent on that Mac does) at M0 and whenever a protocol question arises.

## 3. Milestones and tasks

Legend: 🤖 agent-only · 👤 needs the maintainer (≤15 min) · deps in brackets.

### M0 — Foundations (week 1)
- **M0.1 🤖 Repo scaffold** ✅: npm workspaces, TS strict, ESLint/Prettier, Vitest, GitHub Actions matrix (ubuntu/macos/windows), `AGENTS.md`, issue/PR templates. *AC: `npm test` green on all OSes.*
- **M0.2 🤖 Vendor docs** ✅ partly done: agent downloads RME files (rme-audio.de is allowed in the cloud environment) into the **gitignored** `docs/vendor/` (`scripts/fetch-vendor.sh`). RME material is copyrighted and is never committed; we commit our own spec derived from it. Fetched so far: classic OSC table `OscTableTotalMix_240722`, UFX III manual, RME's own Stream Deck proof-of-concept plugin (Global OSC, alpha). Still missing: the official **Global OSC protocol table** for TotalMix FX 2.10 (the alpha-era `globalosc_protocol_alpha8.zip` link is gone) → get the current file from RME / forum, else derive from captures.
- **M0.3 🤖+👤 Capture tool** [M0.1] → the maintainer runs a 5-minute scripted capture with UFX III. *AC: JSONL fixture committed.*
- **M0.4 🤖 Protocol spec**: `docs/protocol/global-osc.md` — authoritative address table reconciled from vendor table + captures; resolve all **[VERIFY]** items from 01. [M0.2, M0.3]

### M1 — Protocol core (week 1–2)
- **M1.1 🤖 OSC codec** (messages, bundles, types, padding). *AC: round-trip property tests; decodes captured datagrams.*
- **M1.2 🤖 UDP transport** with liveness detection + backoff.
- **M1.3 🤖 Global OSC adaptor**: decode/encode tables, fader curve, typed updates/commands. *AC: every address in protocol spec has a test.*
- **M1.4 🤖 MixerStore + device profiles** (UFX III, generic). Meter ring buffer with peak/clip.
- **M1.5 🤖 Connection state machine + paced sync + optimistic commands with rollback.**

### M2 — Simulator (week 2, parallel with M1.3+)
- **M2.1 🤖 Simulator core** ✅ (state, command handling, sendall; no heartbeat, as TotalMix has none).
- **M2.2 🤖 Meter scenarios + fault injection.** ✅
- **M2.3 🤖 Replay + conformance test vs captures.** ✅
- **M2.4 🤖 Simulator web panel** (optional).

### M3 — Rendering (week 2–3, parallel)
- **M3.1 🤖 Theme tokens + SVG primitives** ✅ (text fitting at 96 px, meters, badges, chips; text drawn as outlines with a bundled open font).
- **M3.2 🤖 Channel key renderer** — Full / Meter / Minimal; states: normal, muted, solo, pending, offline. *AC: PNG goldens; contact sheet `renders/contact-sheet.png` attached to PR.*
- **M3.3 🤖 Monitor, Phones, Snapshot, Status, Bank, Step, DURec renderers.**
- **M3.4 👤 Visual review** of contact sheet on a real XL (load test images via a debug action). Feedback → tweaks.

### M4 — Stream Deck plugin (week 3–4)
- **M4.1 🤖 Plugin skeleton**: manifest (SDK v3, MinimumVersion 7.1, macOS+Windows), action registry, logging, global settings schema + migrations.
- **M4.2 🤖 Gesture recogniser** (tap/long/double/repeat) with fake-clock tests.
- **M4.3 🤖 FrameScheduler** (budget, priorities, hash skip). *AC: synthetic load test 32 keys @15 fps stays within budget.*
- **M4.4 🤖 Specific actions**: Channel, Main/Output, Phones, Snapshot, Monitor toggle (Dim/Mono/TB/SpkB), Global Mute/Solo, Status, Volume step.
- **M4.5 🤖 LayoutEngine + Slot action + bundled XL "Console" profile**, banks, pages.
- **M4.6 🤖 Channel Detail overlay.**
- **M4.7 🤖 Virtual deck** (`tools/virtual-deck`): renders the whole XL from the real pipeline against the simulator; clickable keys; Playwright E2E tests + screenshots.
- **M4.8 👤 Hardware checkpoint #1**: install dev build (`streamdeck link`), run the 10-minute checklist (§5).

### M5 — Settings (week 4–5)
- **M5.1 🤖 Property Inspectors** (sdpi-components; live target picker; Open Control Center).
- **M5.2 🤖 Control Center server** (HTTP+WS, token, JSON-RPC, live store stream).
- **M5.3 🤖 Control Center UI**: Connection + Setup Assistant + packet log.
- **M5.4 🤖 Device & Channels, Behaviour, Appearance sections.**
- **M5.5 🤖 Layout builder** (drag & drop, live key previews, templates, export/import).
- **M5.6 👤 Hardware checkpoint #2** + UX feedback round.

### M6 — Release (week 6)
- **M6.1 🤖 Packaging** (`streamdeck pack`), icons (original artwork), release workflow, README, setup guide with TotalMix screenshots (👤 screenshots).
- **M6.2 🤖 Docs site** (GitHub Pages).
- **M6.3 👤 Marketplace submission** (optional).

### Later
SD+ dials (gain/fader on encoders, touch strip meters), Neo infobar, multiple TotalMix hosts, classic OSC adaptor, MIDI, EQ/dynamics editors on detail page, Room EQ, matrix routing page.

## 4. `AGENTS.md`

Agent rules live in [`/AGENTS.md`](../../AGENTS.md) (harness-neutral; read natively by current coding agents, no tool-specific pointer files). Keep rules there, not here.

## 5. Hardware checkpoint script (10 min, maintainer)

1. TotalMix FX: Remote Controller 2 = Global OSC, ports 7002/9002, IP 127.0.0.1, Send changes/status/levels on.
2. `streamdeck link` dev build, open Console profile on XL.
3. Status key shows "Fireface UFX III", sample rate, green link.
4. Speak into MIC 9 → meter moves; clip it → red cap latches.
5. Tap MIC 9 → mutes in TotalMix within a blink; change mute in TotalMix → key follows.
6. Long-press MIC 9 → detail overlay; 48V, gain ±, sends to PH1 work.
7. Snapshot 2 load; Dim; Main ±; Phones ±.
8. Quit TotalMix → keys go offline; restart → recover < 3 s.
9. Report issues in the PR thread (photos of the deck welcome).

## 6. Risks

| Risk | Mitigation |
|---|---|
| Global OSC details differ from research | M0.2–M0.4 before protocol code; captures as tests |
| Meter traffic too heavy on UFX III (94 ch) | Only subscribe/render visible channels; level data rate setting; scheduler budget |
| Stream Deck image throughput on XL | FrameScheduler, hash skip, 12 fps default |
| Official Global OSC table not published for 2.10 | RME's alpha PoC plugin + Companion module + our captures; ask RME forum |
| Overlap with existing free plugin | Differentiation list (01 §4); reassess after M4.8 |
