# 01 — Capability analysis: Fireface UFX III, Stream Deck XL, TotalMix FX control protocols

Status: research draft, 2026-11-09. Alexey runs the latest TotalMix FX (2.10 at the time of writing, Global OSC available). Items marked **[VERIFY]** must be confirmed against the official RME OSC table (`osc_table_totalmix_new.zip`, RME downloads page) or by capturing real TotalMix traffic (see `05-agentic-plan.md`, task M0.3).

---

## 1. RME Fireface UFX III (target device #1)

| Area | Detail | Relevance to plugin |
|---|---|---|
| Analog in | 12: AN 1–8 line (TRS, rear), Mic/Inst 9–12 (combo XLR/TRS, front) | Input channel keys. Gain + 48V + Inst + AutoSet only on 9–12 |
| Preamp gain | Mic 9–12: 0 dB, then +8…+75 dB in 1 dB steps; Inst max +50 dB. Line 1–8: 0…+12 dB (per Companion profile) **[VERIFY]** | Gain display / step size per channel |
| Phantom | 48V on XLR of 9–12 only | 48V badge only shown where supported |
| AutoSet | Channels 9–12, keeps 6 dB headroom | Long-press option on mic channels |
| Analog out | AN 1–8 (1/2 on XLR, 3–8 TRS), ref levels +24 (XLR only)/+19/+13/+2 dBV | Output keys, Main (typically AN 1/2) |
| Phones | 2 stereo outs = TotalMix outputs **PH 9/10** and **PH 11/12**, High/Lo level | Dedicated Phones actions |
| Digital | AES 1 stereo (XLR); 2× ADAT (16 ch @48k, also optical SPDIF); MADI 64 ch (SC optical + BNC coax) | Large channel count → paging/bank model is mandatory |
| Channel count | 94 in / 94 out at ≤48 kHz, 54/54 at 96k, 34/34 at 192k | Channel list is **sample-rate dependent** → profile must react to status |
| TotalMix rows | Inputs: AN1–8, Mic 9–12, AES L/R, ADAT 1–16, MADI 1–64. Playback + Outputs: AN1–8, PH 9–12, AES, ADAT 1–16, MADI 1–64 | Channel index tables (0-based in Global OSC) |
| DSP | TotalMix FX: per-channel low-cut, 3-band PEQ, dynamics (comp/exp), AutoLevel; Reverb + Echo; Room EQ on outputs | "Detail" page actions; v2 features |
| DURec | Standalone multitrack record to USB stick (front USB-A) | DURec transport/status key |
| Front panel | Colour display, encoders; can be locked | Not controllable via OSC (only via TotalMix state) |
| MIDI | 2× 5-pin DIN pairs (front + rear), MIDI over MADI | MIDI remote of TotalMix also possible via any MIDI port |
| Remote | ARC USB optional | Parallel controller; plugin must tolerate external changes |
| Host | USB 3 (driver) or class-compliant USB 2/3 | TotalMix FX **must be running** on the host for OSC control |

Snapshots: TotalMix has **8 snapshots** per workspace (named). Groups: 4 mute, 4 solo (PFL), 4 fader groups. Layout presets 1–6 (Global OSC only). Quick Workspaces 1–30 (load only, no names returned).

Monitoring ("Control Room") features available in TotalMix: Main Out volume, Dim, Recall, Mono, Speaker B (+ link A/B), External In, Talkback, Mute FX, Phones 1–4 assignment, Cue, Trim.
**There is no dedicated "Main mute"** in the classic OSC surface; on Global OSC an output-channel mute exists **[VERIFY: `/output/N/mute`]**. Fallback: Dim set to −∞ in TotalMix settings.

## 2. Elgato Stream Deck XL (target surface #1)

| Property | Value | Consequence |
|---|---|---|
| Keys | 32 LCD keys, 8 columns × 4 rows | Default layout = 8-wide strips (matches TotalMix 8-fader banks) |
| Key resolution | 96 × 96 px physical; SDK accepts 144 × 144 images (downscaled) | Design at 144×144 SVG; test legibility at 96×96 |
| Inputs | Press / release only. No dials, no touch strip, no pressure | Long-press, double-tap, press-and-hold-repeat must be built in software from keyDown/keyUp timing |
| Image updates | `setImage` with SVG or PNG data-URI over local WebSocket to the Stream Deck app | Practical budget ≈10–15 fps per key; whole deck ≤ ~150–200 images/s. Need a global frame scheduler |
| Profiles | Pages + folders managed by user in the Stream Deck app; plugins can **bundle** profiles and call `switchToProfile` | Use a bundled "XL Console" profile of generic *Slot* actions → plugin owns paging/layout |
| Property Inspector (PI) | Small HTML webview inside the Stream Deck app (~350 px wide), per action, only visible while a key is selected | Too cramped for real configuration → companion browser UI (see 03-ux.md) |
| Other decks | SD+ (dials/touch strip), MK.2 (15 keys), Neo (8 keys + infobar), Mini (6 keys), mobile | Renderer must scale; dials are a later enhancement |

### Stream Deck SDK (as of 2026-11)

- `@elgato/streamdeck` **v3.0.4** (released 2026-09-22 → 3.0.4 on 2026-10-29). Requires **Node.js 24+** and **Stream Deck app 7.1+** (`Software.MinimumVersion: "7.1"`).
- Actions are TypeScript classes (`SingletonAction`, decorators), `@elgato/cli` 1.10.x for `create`, `link`, `restart`, `pack`, `validate`.
- v3 changes: settings events fire only on PI-originated changes; `Action` union (`KeyAction | DialAction | NeoInfobarAction`); v2 removed runtime manifest access and browser import of the SDK in PI.
- PI UI: `sdpi-components` v4 web components; plugin ↔ PI via `sendToPlugin` / `streamDeck.ui.sendToPropertyInspector`.
- `streamDeck.system.openUrl(url)` is available → we can open a local configuration web app in the user's browser.
- Plugin runs as a Node process managed by the Stream Deck app on **macOS and Windows** (no Linux app). Native Node addons are possible but complicate packaging (per-arch prebuilds) → avoid in v1.

## 3. TotalMix FX remote protocols

TotalMix FX offers OSC (4 independent "Remote Controller" slots, each with its own in/out ports and remote IP) and MIDI (incl. Mackie Control emulation). Since **TotalMix FX 2.1**, each OSC slot has a **Compatibility (Mode)** selector: *1.96 / classic* or **Global OSC**.

### 3.1 Global OSC (TotalMix FX 2.1+) — **primary target**

Absolute addressing, native units, state request commands. This removes the classic surface's biggest problems (bank-relative addressing, toggles without set-state, no queries).

Required TotalMix settings (Options → Settings → OSC → Remote Controller n): *In Use*, ports (e.g. in 7002 / out 9002), Remote Controller Address = `127.0.0.1` (do **not** leave blank — Windows Global OSC does not send feedback without it), Mode = Global OSC, Details: **Send changes** ✓, **Send status** ✓, **Re-send received** ✓ (we never echo, so no loop), optionally **Send faders in linear scale**, bandwidth limit ~500 kB/s; **Send Level Data / Peak Level** ✓ for meters; global *Options → Enable OSC Control* ✓.

Address space (compiled from the Bitfocus Companion RME module source and TotalControl spec; exact arg types **[VERIFY]**):

| Address | Meaning | Notes |
|---|---|---|
| `/{input\|playback\|output}/{n}/name` | Channel name (string), read + **write** | n is 0-based |
| `/{bus}/{n}/color` | Channel colour (int) | |
| `/{input\|playback}/{n}/mute`, `/pfl` | Mute / Solo-PFL state (0/1) | explicit on/off, not toggle |
| `/{bus}/{n}/stereo`, `/phase`, `/phaseright`, `/width`, `/msproc` | Strip switches | |
| `/input/{n}/gain`, `/gainright`, `/48v`, `/inst`, `/pad`, `/autoset`, `/reflevel` | Preamp | 48v/inst/autoset only where hardware supports |
| `/input/{n}/fxsend`, `/output/{n}/fxreturn` | Reverb/Echo send/return | |
| `/output/{n}/volume` (dB) · `/faderlin` (0–1) · `/balpan` (−1…+1) | Output fader / balance | |
| `/output/{n}/mute`, `/loopback`, `/talkbacksel`, `/notrim`, `/pfl` (cue) | Output switches | `/output/n/mute` **[VERIFY]** |
| `/mix/{in\|pb}/{src}/{out}/fader` (dB) · `/faderlin` · `/balpan` · `/solo` · `/groupflags` | Matrix send src → submix out | Full routing matrix |
| `/{bus}/{n}/lowcut/{enable,freq,slope}`, `/eq/{enable,band1type,band1gain,band1freq,band1q,…band3*}`, `/dynamics/{enable,gain,attack,release,compthres,compratio,expthres,expratio}`, `/autolevel/{enable,maxgain,headroom,risetime}` | Channel DSP | |
| `/output/{n}/roomeq/...` | Room EQ | |
| `/controlroom/{dim,speakerb,linkab,mutefx,mainmono,externalin,talkback,recall}` | Monitoring section | |
| `/globalmute`, `/globalsolo` | Global mute/solo | |
| `/snapshot/load/{1..8}` (feedback value ≥2 = active), `/snapshot/save/{1..8}` | Snapshots | snapshot names **[VERIFY]** |
| `/layout/load/{1..6}` | Layout presets | |
| `/reverb/*`, `/echo/*` | Global FX | |
| `/durec/{time,state}` + transport commands (`stop` uses value 11) | DURec | |
| `/level/{in\|pb\|out}/{n}` | Meter level, **dB float** | per channel; stereo = two channels; peak/RMS variants **[VERIFY]** |
| `/status/{device,connection,dsp}` | Device name, connection state, DSP load; also heartbeat | Use as liveness signal |
| `/sendall`, `/sendstate`, `/sendsettings`, `/sendchan/{bus}/{n}`, `/sendmix`, `/sendsubmix/{out}` | **State requests** | `/sendall 2` → ~2000 messages on a small interface; expect much more on UFX III (94 ch) → throttle |
| `/showwindow` | Show/hide TotalMix window | |
| `/loadQuickWorkspace` | Quick Workspace 1–30 | |

Feedback can arrive in OSC **bundles**; never assume 1 message per datagram or ordering.

### 3.2 Classic OSC (TotalMix FX 1.96 table, `OscTableTotalMix_240722`) — fallback only

Pages: `/1` mixer bank, `/2` selected channel, `/3` FX/snapshots/groups, `/4` Room EQ; navigation `/setSubmix`, `/setBankStart`, `/setOffsetInBank`, `/1/bank±`, `/1/track±`.
Key traits: **bank-relative** (`/1/volumeN`, `/1/mute/1/N`, `/1/levelNLeft`, `/1/tracknameN`, N within bank of 8–48 faders); **toggles** (send 1.0 to flip, 0.0 ignored); state only pushed on change or page switch, no query; snapshots `/3/snapshots/{9-k}/1` (reversed index), groups `/3/muteGroups/{5-g}/1`; monitoring `/1/mainDim`, `/1/mainMono`, `/1/mainSpeakerB`, `/1/mainTalkback`, `/1/mainRecall`, `/1/mastervolume`.
Fader curve (0–1 ↔ dB), needed in both dialects when using `faderlin`:

```
f = p*1023; db = f>=649 ? f*0.0320855615 - 26.8235294118 : -(f*f)/11033 + f*0.1497326203 - 65
p = db>=-6 ? ((db+26.8235294118)/0.0320855615)/1023 : (826 - sqrt(-34869 - 11033*db))/1023
```

Decision: **v1 supports Global OSC only.** The UFX III runs current TotalMix FX; classic support adds a bank-tracking state machine for little benefit. Keep the transport/adaptor seam so a classic adaptor can be added later.

### 3.3 MIDI

TotalMix accepts MIDI on any MIDI input port: **Mackie Control** emulation (banks of 8, faders as pitch-bend, V-Pots, buttons as notes, LED feedback; meters via channel-pressure) and a small set of fixed Control Change mappings for monitoring functions **[VERIFY against TotalMix manual, chapter "MIDI Remote Control"]**.
Assessment: MIDI is strictly weaker than Global OSC (bank-relative, 7-bit resolution, needs a virtual MIDI port such as macOS IAC / loopMIDI on Windows, native Node addon). **Not planned for v1**; possible later for "TotalMix not reachable over network" edge cases.

## 4. Existing solutions (competitive landscape) — read before building

| Project | Platform | Notes |
|---|---|---|
| **TotalMix FX Control** (shells-dw, `de.shells.totalmixgen2`) | SD plugin, Win + macOS, Elgato Marketplace, free | Mature. Global OSC + classic actions, meters, SD+ dials, TotalMix look. Generic per-action configuration. |
| RME "TotalMix FX 1" Stream Deck proof of concept (`de.rme-gmbh.totalmixfx1`, v0.1.5, from the TotalMix FX 2.1 alpha thread) | SD plugin, alpha | RME's own Global OSC demo: channel, settings, snapshot/layout, FX preset, EQ/dynamics/Room EQ, SD+ encoders. Protocol reference only (proprietary; never copy code or artwork). |
| Bitfocus Companion `rme-totalmix` module | Companion | Excellent protocol reference (TypeScript). Source used for this research. |
| TotalControl (jspx-projects) | Rust app | Reverse-engineered UCX protocol + OSC spec. |
| totaldim, TMVolume, TotalMixMenuBar | Small utilities | Dim/volume only. |

**Our differentiation** (so this project is worth doing):
1. **Dense, information-rich channel key** designed for XL (name + value + stereo meter + 5 status badges on one key).
2. **Plugin-managed console layout**: one bundled XL profile; banks, drill-down "channel detail" overlay and pages handled by the plugin, not by fiddly Stream Deck folders.
3. **Real settings app** (local web UI with live device data, layout builder, gesture mapping) instead of cramming everything into the PI.
4. Open source TypeScript, device-profile driven, with an OSC simulator so it can be developed and tested without hardware.

## Sources

- Sound On Sound review, Fireface UFX III: https://www.soundonsound.com/reviews/rme-fireface-ufx-iii
- TotalControl OSC spec: https://github.com/jspx-projects/TotalControl (docs/spec/TOTALCONTROL-OSC-SPEC.md), Global OSC PR #40
- Bitfocus Companion RME module: https://github.com/bitfocus/companion-module-rme-totalmix (HELP.md, src/protocol/controller.ts, src/model/profiles/fireface-ufx-iii.ts)
- shells-dw plugin: https://github.com/shells-dw/streamdeck-totalmix, docs https://shells-dw.github.io/streamdeck-totalmix/
- RME forum, OSC levels / banks: https://forum.rme-audio.de/viewtopic.php?id=30695
- Elgato SDK: https://docs.elgato.com/streamdeck/sdk/ (upgrading v2, v3), npm `@elgato/streamdeck` 3.0.4
