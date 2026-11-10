# TotalMix FX Global OSC: protocol spec

Status: first version (M0.4), 2026-11-10. Every statement below comes from a capture of real
traffic, not from third-party references:
`fixtures/captures/fireface-ufx-iii-unknown-2026-11-09.jsonl`, recorded with the `baseline`
capture script (`tools/capture`). It covers a Fireface UFX III with TotalMix FX 2.1 (a beta) on
macOS. The script's prompt for the exact TotalMix version was left empty, so the file says
"unknown". The run lasted 5.4 minutes, with 4277 datagrams and 14346 messages received and
65 sent.

RME's own Global OSC table for 2.1 is not available to this project yet (see
`docs/design/05-agentic-plan.md`, M0.2). When it is, compare it with this file. The capture
wins where they disagree, because it shows what TotalMix actually does.

Markers used below:

- **seen**: in the capture.
- **inferred**: follows from what was seen, but no step tested it directly.
- **open**: not answered yet. The list in [Open questions](#open-questions) says which
  capture step will answer it.

## 1. Transport

| Topic          | What TotalMix does                                                                                                                                                               | Status |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Ports          | Receives on "Port incoming" (7002 here) and sends to "Remote Controller Address" : "Port outgoing" (127.0.0.1:9002 here).                                                        | seen   |
| Source port    | Feedback comes from an ephemeral port that **changes when TotalMix restarts** (52391 before, 61410 after). Accept feedback from any source port of the TotalMix host.            | seen   |
| Packet form    | **Every** datagram is an OSC bundle, timetag `0x0000000000000000` (not the usual "immediately" value 1). No nested bundles, and none of the recorded datagrams failed to decode. | seen   |
| Bundle size    | 1 to 16 messages, at most 480 bytes per datagram. State replies are split into many datagrams.                                                                                   | seen   |
| Mixing         | Meter messages and state messages normally travel in separate datagrams, but can share one (seen twice, during `/sendall`). Decode every message in every bundle.                | seen   |
| Argument types | Every numeric value is **float32**, including switches, enums and indices. Names and status texts are strings. No other types were received.                                     | seen   |
| Ordering       | In one reply, messages arrive in a stable order per channel (strip settings, then EQ, then dynamics). Do not depend on it.                                                       | seen   |

Packing (seen): a datagram is filled in order until the next message would not fit in 16
messages or 480 bytes. The snapshot states always start a datagram of their own, at the end
of a `/sendsettings` or `/sendall` reply. Replies to requests that arrive together (the
24-request burst) can share datagrams, so a client must not expect one reply per datagram.

## 2. Channel model

Indices are 0-based and count physical channels, not strips. On a UFX III: inputs AN 1-8 are
0-7, Mic 9-12 are 8-11. Outputs AN 1-8 are 0-7, PH 9-12 are 8-11. AES, ADAT and MADI follow,
as in `docs/design/01-capabilities.md`.

- **Only visible channels exist on the wire.** Channels hidden in TotalMix are not sent by
  `/sendall`, `/sendmix` or `/sendsubmix`. A `/sendchan` request for one gets no reply (in the
  capture, all requests for input indices 0, 1, 6, 7, 12, 13 and 16-23 went unanswered). This
  ran with "Receive to hidden channels" off. A client must build its channel list from what
  TotalMix sends, not from the interface's channel count. (seen)
- **A stereo strip is addressed by its left index.** Strip-level addresses (`name`, `mute`,
  `stereo`, EQ, dynamics, sends and routes) exist only for the left channel, for example `/input/8/...`
  for Mic 9/10. (seen)
- **Per-side settings also exist at the right index**: `/input/{n}/gain`, `/phase`,
  `/playchan`, and `/output/{n}/gain`, `/phase`, `/playchan`, `/delay`, `/roomeq/*`. For
  example `/input/9/gain` is the gain of Mic 10. `/sendchan/input/9` returns only these.
  (seen)
- Two adjacent mono channels are two strips (`/input/4/...` and `/input/5/...`). (seen)
- `/input/{n}/stereo` reports whether the strip is stereo (1) or mono (0). (seen)
- Hardware-specific settings appear only where the hardware has them: `48v`, `instrument` and
  `autoset` on the mic inputs (8, 10, 11 here). `reflevel` appears on the analog line inputs
  (2, 4, 5) and the analog outputs (0, 2, 8). The digital input (ADAT, 14/15) has no `gain` at
  all; every output has one. (seen)
- A `/sendchan` reply lists a channel's settings in a fixed order per bus, the same for every
  channel, with the settings it lacks left out. `packages/simulator/src/fields.ts` holds that
  order. (seen)

## 3. Requests

A request's argument is ignored. `f:1`, `i:1` and no argument all gave the same reply. Replies
arrive 6-20 ms after the request, in bursts of datagrams less than 1 ms apart.

| Request                                   | Reply                                                                                                                                                   | Size (this layout)                              | Status |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------ |
| `/sendstate`                              | `/status/device`, `/status/connection`, `/status/dsp`, `/durec/state`                                                                                   | 4 messages, 1 datagram (160 bytes), within 8 ms | seen   |
| `/sendsettings`                           | `/globalmute`, `/globalsolo`, `/mutegroup/1-4`, `/sologroup/1-4`, `/fadergroup/1-4`, all `/controlroom/*`, `/reverb/*`, `/echo/*`, `/snapshot/load/1-8` | 62 messages                                     | seen   |
| `/sendchan/{input\|playback\|output}/{n}` | Every strip setting of that channel. Only per-side settings for the right index of a stereo pair. Nothing for a hidden channel                          | input 41, playback 8, output 75 messages        | seen   |
| `/sendsubmix/{out}`                       | `/mix/{in\|pb}/{src}/{out}/{fader,balpan,groupflags,solo}` for every visible source, including routes that are off                                      | 40 messages for output 0                        | seen   |
| `/sendmix`                                | The same for **every visible output**                                                                                                                   | 240 messages                                    | seen   |
| `/sendall 1`                              | All of the above: state, settings, every visible channel, every route                                                                                   | 1269 messages, 106 datagrams, done in 98 ms     | seen   |
| `/sendall 2`                              | The same, but only **routes that are on**. Routes at −300 dB and also at −65 dB were left out                                                           | 1085 messages, 92 datagrams, done in 88 ms      | seen   |
| unknown address                           | Nothing, silently ignored                                                                                                                               | -                                               | seen   |

Requests were not dropped in this test: 24 `/sendchan/input/0..23` requests sent within 4 ms were all
answered (the visible ones fully, the hidden ones not at all), in 23 datagrams, within 23 ms.

With every channel visible on a UFX III (94 inputs, 94 playback channels, 94 outputs),
`/sendall 1` grows roughly with the number of visible strips times the number of visible
outputs. Expect tens of thousands of messages. Prefer `/sendall 2`, or `/sendsettings` plus
`/sendchan` and `/sendsubmix` for what is on screen. (inferred)

## 4. Writes

| Topic                     | Behaviour                                                                                                                                                                                                                                 | Status   |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Argument types            | `/input/8/mute` accepted `f:1`, `i:1` and `T`, each one switching mute on.                                                                                                                                                                | seen     |
| Set, not toggle           | `/input/{n}/mute` and `/controlroom/dim` set the value they are given. Writing 0 to a mute that is 0 leaves it at 0.                                                                                                                      | seen     |
| No echo of numeric writes | After `/input/8/mute f:1`, `/output/0/volume f:-1` or `/controlroom/dim f:1`, TotalMix sent **no message for that address**, even with "Re-send received" and "Send changes" on. The new value was visible in the next `/sendchan` reply. | seen     |
| Side effects are sent     | A write does produce feedback for what it changes elsewhere: the active snapshot becomes "modified" (`/snapshot/load/n f:3`), and Dim sends the dimmed Main volume (`/output/2/volume f:-40`, back to `-20` when Dim goes off).           | seen     |
| Names                     | `/input/{n}/name s:"..."` renames the channel. Unlike numeric writes, the new name **is** echoed, 18 ms later.                                                                                                                            | seen     |
| Output volume             | `/output/{n}/volume` in dB is applied exactly (`-1` was read back as `-1`).                                                                                                                                                               | seen     |
| Matrix faders             | Not written yet: the test route was off (−300 dB), so the step skipped itself.                                                                                                                                                            | open     |
| Other settings            | The adaptor writes every setting to the address TotalMix reports it on, with the same types as above (float32; switches 0/1; −300 for off; strings for names). Only the rows marked seen were tested; the rest follow from them.          | inferred |
| Snapshot load             | The adaptor sends `/snapshot/load/{k} f:1`. Not captured yet.                                                                                                                                                                             | open     |

## 5. Unsolicited feedback

| Topic                    | Behaviour                                                                                                                                                                                                                                                                                                                                                          | Status |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| Heartbeat                | **None.** In 6 s without requests, TotalMix sent only meter messages. `/status/*` was only ever sent in reply to a request. 10 of the 354 seconds had no traffic at all, 7 of them while TotalMix was closed.                                                                                                                                                      | seen   |
| Changes made in TotalMix | Sent at once in small bundles, usually one message (44-48 bytes). A fader drag sends about every 20 ms. Example: mute → `/input/8/mute`. Solo → `/mix/in/8/2/solo` plus `/groupflags` for the submix shown. Gain → `/input/8/gain` in 1 dB steps. 48V → `/input/8/48v`. Output fader → `/output/{n}/volume`. Dim → `/controlroom/dim` plus the dimmed Main volume. | seen   |
| Solo                     | The input solo button reports per route, `/mix/in/{n}/{out}/solo`, for the submix currently shown in TotalMix (out 2 here). There is no `/input/{n}/pfl` in the capture.                                                                                                                                                                                           | seen   |
| Snapshot load            | Sends only the values that **changed** (a few messages, not a full state), in channel order, then `/snapshot/load/n` for the old and new snapshot in a datagram of their own, in snapshot order. Once (in `meters-signal`) the old snapshot was first reported as modified (`f:3`) just before.                                                                    | seen   |
| Quit                     | Traffic stops; no goodbye message.                                                                                                                                                                                                                                                                                                                                 | seen   |
| Start                    | When TotalMix started again (7 s later here), the first datagram came from the new source port (`/durec/state`), followed by one complete meter frame (every visible channel, including silent ones at −100), then normal traffic. No state push (with "Send all data on start" off).                                                                              | seen   |

### Meters

- Addresses `/level/in/{n}`, `/level/pb/{n}`, `/level/out/{n}`, one float32 per physical
  channel. A stereo strip has two meters (`/level/in/8` and `/level/in/9`). No peak or RMS
  variants were seen. (seen)
- Values are **display levels in dBFS** with TotalMix's own ballistics. The floor is −100. They
  fall by 0.6-0.8 dB per frame. An over is reported as **+6**, held for about 2 s ("Peak Hold"
  was on), then falls by 0.8 dB per frame. Treat +6 as the clip indicator. (seen; clip meaning
  inferred)
- Frames come about every 40 ms (25 per second). Each frame holds **only the meters that
  changed**: a silent channel sends nothing after the start frame. One frame is one bundle of
  1-11 messages. (seen)
- Playback meters only appeared in the start frame; no playback channel carried signal during
  the capture. (seen)
- Traffic peaked at 3108 messages/s and 116 kB/s, the `/sendall` replies being the largest bursts. (seen)

## 6. Values

| Value                                                                                     | Meaning                                                                                                                                      | Status   |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `-300` on a fader or send in dB                                                           | Off (−∞). `/mix/.../fader`, `/input/{n}/fxsend` and `/playback/{n}/fxsend` use it.                                                           | seen     |
| `-65` on a fader                                                                          | The lowest fader position above off. `/sendall 2` left the one route at −65 out, like the 45 routes at −300.                                 | inferred |
| Fader steps                                                                               | Mouse drags move in steps of 3/28 dB (0.1071434 dB) near 0 dB. Values are float32 dB, for example `-4.5`, `-3.535715`.                       | seen     |
| Switches                                                                                  | `0` off, `1` on (mute, solo, 48v, instrument, stereo, dim, loopback, ...).                                                                   | seen     |
| `/snapshot/load/{1-8}`                                                                    | `0` not active, `2` active, `3` active but **changed since it was loaded**.                                                                  | seen     |
| `/controlroom/mainout`, `mainoutb`, `phones1-4`, `cuechan`, `extinchannel`, `talkchannel` | An output or input channel index, `-1` = none. Main was output 2 here (not output 0). Phones 1 was 8, Phones 2 was 10.                       | seen     |
| `/controlroom/dimreduction`                                                               | dB (`-20`). Dim on lowers the reported Main volume by this amount.                                                                           | seen     |
| `/controlroom/recallvolume`, `extingain`                                                  | dB.                                                                                                                                          | seen     |
| `/input/{n}/gain`                                                                         | dB. Mic inputs moved in 1 dB steps (50-54, 67 seen). Line inputs showed 0, 6.5 and 8.                                                        | seen     |
| `/{bus}/{n}/color`                                                                        | Small integer as float (1, 3, 5, 6 seen); palette unknown.                                                                                   | open     |
| `/status/connection`                                                                      | `1` while connected.                                                                                                                         | seen     |
| `/status/dsp`                                                                             | `0` throughout; meaning not tested (DSP load?).                                                                                              | open     |
| `/status/device`                                                                          | `"<model> (<serial>)"`, for example `"Fireface UFX III (12345678)"`. The capture tool masks the serial; a client should show the model only. | seen     |
| `/durec/state`                                                                            | Text, `"Not ready"` here (no storage medium).                                                                                                | seen     |
| `/globalmute`, `/globalsolo`                                                              | `1` here; meaning (the master button armed?) not tested.                                                                                     | open     |
| EQ and filter `type`, `slope`, reverb `type`                                              | Small integers as float; the enum values are not mapped yet.                                                                                 | open     |

## 7. Address table

`{n}` is a 0-based channel index, `{out}` an output index, `{k}` a 1-based number. "W" means a
write was tested and worked.

### Status and global

| Address                                                     | Type | Notes                 | Status |
| ----------------------------------------------------------- | ---- | --------------------- | ------ |
| `/status/device`                                            | s    | model and serial      | seen   |
| `/status/connection`                                        | f    | 1                     | seen   |
| `/status/dsp`                                               | f    | 0                     | seen   |
| `/durec/state`                                              | s    | text                  | seen   |
| `/globalmute`, `/globalsolo`                                | f    |                       | seen   |
| `/mutegroup/{k}`, `/sologroup/{k}`, `/fadergroup/{k}` (1-4) | f    | 0 here                | seen   |
| `/snapshot/load/{k}` (1-8)                                  | f    | 0 / 2 / 3, see values | seen   |

### Control room

All float: `/controlroom/dim` (W), `dimreduction`, `speakerb`, `linkab`, `mainmono`, `mutefx`,
`talkback`, `talkchannel`, `externalin`, `extinchannel`, `extingain`, `cuechan`, `mainout`,
`mainoutb`, `phones1`, `phones2`, `phones3`, `phones4`, `recallvolume`. (seen)

### Input strips: `/input/{n}/...`

| Settings                                                                                                                      | Notes                             | Status |
| ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------ |
| `name` (s, W, echoed), `mute` (W), `stereo`, `width`, `msproc`, `color`, `record`, `fxsend` (dB)                              | strip level, left index           | seen   |
| `gain` (dB), `phase`, `playchan`                                                                                              | per side, also at the right index | seen   |
| `48v`, `instrument`, `autoset`                                                                                                | mic inputs only                   | seen   |
| `reflevel`                                                                                                                    | analog line inputs only           | seen   |
| `lowcut/{enable,freq,slope}`                                                                                                  |                                   | seen   |
| `eq/{enable, band1type, band1freq, band1gain, band1q, band2freq, band2gain, band2q, band3type, band3freq, band3gain, band3q}` | band 2 has no type                | seen   |
| `dynamics/{enable, gain, attack, release, compthres, compratio, expthres, expratio}`                                          |                                   | seen   |
| `autolevel/{enable, maxgain, headroom, risetime}`                                                                             |                                   | seen   |

### Playback strips: `/playback/{n}/...`

`name` (s), `mute`, `stereo`, `width`, `msproc`, `color`, `fxsend` (dB), and `phase` per side.
(seen)

### Output strips: `/output/{n}/...`

| Settings                                                                                                                                                  | Notes                  | Status |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ------ |
| `name` (s), `volume` (dB, W), `mute`, `balpan` (−1…1), `stereo`, `color`, `record`, `loopback`, `talkbacksel`, `crossfeed`, `fxreturn` (dB), `groupflags` | strip level            | seen   |
| `gain`, `phase`, `playchan`, `delay`                                                                                                                      | per side               | seen   |
| `reflevel`                                                                                                                                                | analog outputs only    | seen   |
| `lowcut/*`, `eq/*`, `dynamics/*`, `autolevel/*`                                                                                                           | as on inputs           | seen   |
| `roomeq/enable`; `roomeq/band{1-9}{freq,gain,q}`; `roomeq/band1type`, `band8type`, `band9type`                                                            | per side for the bands | seen   |

`/output/{n}/mute` exists and is a plain on/off. A Main mute is therefore
`/output/{mainout}/mute`. (seen; writing it is open)

### Matrix: `/mix/{in|pb}/{src}/{out}/...`

`fader` (dB, −300 = off), `balpan` (−1…1), `solo`, `groupflags`. `{src}` is the left index of
a visible input or playback strip, and `{out}` the left index of a visible output. (seen)

### Effects

`/reverb/{enable, type, predelay, lowcut, highcut, attack, hold, release, roomscale, time,
highdamp, smooth, volume, width}` and `/echo/{enable, type, delay, feedback, highcut, volume,
width}`, all float. (seen)

### Not seen in this capture

These are names from earlier research (`docs/design/01-capabilities.md` §3.1) that did not
appear: `/input/{n}/pfl`, `/input/{n}/pad`, `/input/{n}/gainright`, `/input/{n}/inst` (it is
`instrument`), `/output/{n}/faderlin` and `/mix/.../faderlin` ("Send faders in linear scale"
was off), `/output/{n}/notrim`, `/output/{n}/pfl`, `/controlroom/recall` (only
`recallvolume`), `/durec/time`, snapshot names, `/layout/*`, `/snapshot/save/*`,
`/showwindow`, `/loadQuickWorkspace`. The last few are commands and would not show up in
state. They stay unverified until a capture step sends them.

## 8. What this means for the adaptor (M1)

These contradict `docs/design/02-architecture.md` (connection state machine, command queue)
and should replace it there:

1. **Liveness needs polling.** There is no heartbeat, and meters stop when nothing changes. Send
   `/sendstate` about once a second (one 160-byte reply within ~10 ms). Call the connection
   stale after about 3 missed replies.
2. **A write is not confirmed by an echo.** Either accept writes optimistically and correct
   them with a targeted request (`/sendchan/...` or `/sendsettings`) about 50-100 ms later, or
   wait for that reply before showing the new state. Do not roll back for a missing echo. It
   never comes.
3. **The channel list comes from TotalMix**, not the device profile: build it from the strips
   that `/sendall` reports. Stereo strips use the left index, per-side settings use both.
4. **Main is `/controlroom/mainout`**, not a fixed output.
5. **Sync**: `/sendall 2` for a full sync (fast at this layout: about 90 ms). Re-sync after a
   restart, which shows up as a new source port and a burst of meters.
6. **Decode everything as bundles** with timetag 0; float32 for every number.

`packages/totalmix` implements these (M1). The details are in `docs/design/02-architecture.md`
(TotalMixAdaptor). A full sync is treated as complete after 150 ms without state messages
(the longest gap inside a `/sendall` reply in the capture was 21 ms) plus a reply to a
`/sendstate` sent behind it.

`packages/simulator` (M2) behaves as this spec says, for hardware-free tests. Its conformance
test replays every request and write of every capture against it and compares the replies
message by message, so a new capture that disagrees with the simulator fails CI.

## 9. Resolved research questions

From the **[VERIFY]** markers in `docs/design/01-capabilities.md`:

| Question                | Answer                                                                                               |
| ----------------------- | ---------------------------------------------------------------------------------------------------- |
| Exact argument types    | Float32 for every number, strings for names and texts (seen). Writes also accept int32 and T/F.      |
| `/output/N/mute` exists | Yes.                                                                                                 |
| Snapshot names          | Not sent by any request in the capture. Still open.                                                  |
| Meter peak/RMS variants | None; one display level per channel, with peak hold.                                                 |
| Preamp gain steps       | Mic inputs: 1 dB steps (seen 50-54 and 67). Line inputs: 6.5 seen, so finer steps; range not tested. |

## Open questions

Each one becomes a step in `tools/capture/scripts/baseline.ts` for the next capture:

1. Does `/controlroom/dim` write work as set (it did lower Main by 20 dB) and what does
   `/sendsettings` read back? (The Dim step needs a verify request.)
2. Matrix fader write on a route that is on: units, echo, and whether `-65` and `-300` both
   mean off.
3. `/output/{mainout}/mute` write (a Main mute). The `write-output-mute` step tests an output
   mute, and `write-gain` tests a gain write.
4. Snapshot names: is there a request or address for them?
5. `/globalmute` and `/globalsolo` meaning; groups.
6. Enum values: EQ band types, low-cut slope, reverb and echo types, colours.
7. Does "Re-send received" echo anything at all, and does "Send faders in linear scale" add
   `faderlin` addresses? (A screenshot of the Details dialog in 2.1 helps here.)
8. Behaviour with hidden channels shown, and on Windows.
9. The exact TotalMix FX version and build.
10. Snapshot load: does `/snapshot/load/{k} f:1` load snapshot k, and what does TotalMix send
    back? (Needs a step that the person confirms, since a load discards unsaved changes.)
11. Is the sample rate reported anywhere? Channel labels above AES depend on it (ADAT and MADI
    have half the channels at 96 kHz), and `/status/*` does not include it.
