# Simulator

A fake TotalMix FX that speaks Global OSC over UDP, so the plugin, the virtual deck and tests run
without an interface. It answers like the TotalMix in our captures (`docs/protocol/global-osc.md`),
and a conformance test checks that against every capture in `fixtures/captures/`.

## Run it

```sh
npm run sim                                   # UFX III, studio layout, ports 7002/9002
npm run sim -- --layout full --meters clip    # every channel visible, clipping drums
npm run sim -- --state fixtures/captures/<file>.jsonl   # the mixer state of a capture
npm run sim -- --drop-out 0.1 --latency 30    # a lossy, slow network
node packages/simulator/src/cli.ts --help     # every option
```

Point a client at it as at TotalMix: send to "Port incoming" (`--port-in`, default 7002) and
listen on "Port outgoing" (`--port-out`, default 9002) on `--host` (default 127.0.0.1). Feedback
comes from a separate port that changes on every restart, like TotalMix's. The capture tool works
against it too: `node tools/capture/src/cli.ts check`.

While it runs, type commands and press Enter (`help` lists them):

| Command                         | Does                                                                   |
| ------------------------------- | ---------------------------------------------------------------------- |
| `set /input/8/mute 1`           | a change in TotalMix's window: applied and sent as feedback            |
| `get /output/0/volume`          | shows a value as TotalMix would report it                              |
| `snapshot 2`                    | loads snapshot 2                                                       |
| `quit`, `start`, `restart 2000` | quits TotalMix (silence, ports freed), starts it, or both              |
| `levels off`                    | TotalMix's "Send Level Data" option                                    |
| `signal in/8 noise -12`         | a meter signal: `silence`, `tone`, `noise`, `clip` or `sweep`          |
| `faults dropOut=0.2 latency=50` | changes faults (`dropIn`, `dropOut`, `latency`, `jitter`, `bandwidth`) |
| `speed double`                  | sample-rate range: ADAT and MADI channels shrink                       |
| `status`, `exit`                |                                                                        |

`replay <capture.jsonl>` plays a capture's received datagrams back byte for byte with their
original timing (`--speed`, `--no-meters`, `--steps ui-mute,ui-dim`). Each TotalMix sender port
in the capture gets a port of its own, so a recorded restart shows up as a new source port.

## Use it from tests

```ts
import { Simulator, studioMixer } from '@faderlight/simulator';

const sim = new Simulator({ portIn: 0, feedbackPort: 'sender', meters: false });
await sim.start(); // requests to sim.port; feedback goes to whoever sent last
sim.change('/input/8/mute', true); // as if clicked in TotalMix
await sim.quit(); // TotalMix closed: no answers
await sim.start(); // back, from a new source port
await sim.stop();
```

`packages/simulator/test/client.test.ts` runs the TotalMix client (`connectTotalMix`) against
it: sync, writes and their confirmation, rollback, Dim, quit and restart, meters, packet loss.
The parts work without sockets too: `SimMixer.handle(message)` returns what TotalMix would send
back, `MeterEngine.frame(now)` the next meter frame, and `pack()` the datagrams.

## What it does

As seen in the captures:

- Only visible strips exist on the wire; requests for hidden channels get no reply. A stereo strip
  is addressed by its left index; per-side settings (gain, phase, …) also by the right one.
- `/sendstate`, `/sendsettings`, `/sendchan/{bus}/{n}`, `/sendsubmix/{out}`, `/sendmix` and
  `/sendall 1|2` give the same messages in the same order as TotalMix, packed the same way:
  bundles with timetag 0, at most 16 messages and 480 bytes, snapshot states in a datagram of
  their own. A request's argument is ignored, except `/sendall` (2: only routes that are on).
- Writes set the value and are not echoed, except names. A change marks the active snapshot as
  modified (`/snapshot/load/n f:3`), once. Dim sends the dimmed Main volume (by the dim
  reduction, `/controlroom/mainout` decides which output is Main).
- No heartbeat. On start: `/durec/state`, then one complete meter frame.
- Changes made with `change()` are sent at once (a solo with its route's group flags, Dim with
  the Main volume, then the snapshot becoming modified).
- Meters every 40 ms, only those that changed: floor −100 dB, falling 0.6 dB per frame; an over
  shows as +6 dB, held 2 s, then falls 0.8 dB per frame.

Inferred, because no capture step tested it yet (see the spec's open questions):

- Writes to hidden channels are ignored (the capture ran with "Receive to hidden channels" off).
- Gain writes snap to the preamp's range and steps (Mic 0 or 8-75 dB, Inst 8-50, line 0-12 in
  0.5 dB); the confirming reply corrects the client.
- A Main volume write while dimmed sets the dimmed value.
- `/snapshot/load/{k} f:1` loads the snapshot. Snapshots restore channel and route values, not
  names or the stereo setting; a slot never saved restores nothing.
- Route writes behave like the other numeric writes (no echo). A `stereo` write pairs or splits
  two channels and sends nothing.
- A sample-rate change sends nothing; channels above the new count just disappear.
- Output meters follow the mix: routed sources (fader above off, not muted) add up as powers,
  plus the route fader and the output's volume. Pan is ignored.

Not modelled: replies to requests that arrive together sharing datagrams (TotalMix did that in the
capture's 24-request burst; the simulator packs each reply on its own), meters sharing datagrams
with replies, Room EQ and FX processing, DURec, and the TotalMix settings dialog.

## Layouts and meters

| `--layout` | Strips                                                                                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `studio`   | In: Synth (AN 1/2), Vocal (Mic 9, 48V), Guitar (Mic 10, Inst), Room (Mic 11/12). Playback: DAW, Browser. Out: Main (AN 1/2), Phones 1, Phones 2. Snapshot 2 mutes Synth and Browser. |
| `full`     | Every channel visible, in stereo pairs, with default names. `/sendall 1` is about 25 000 messages.                                                                                   |

`--meters`: `studio` (inputs take turns with voice, drums with an over every 8th hit, a level
sweep and room noise; music on the first playback strip), `quiet`, `noise`, `clip`, `sweep`, or
`off`.

## Conformance test

`test/conformance.test.ts` takes each capture in `fixtures/captures/` that has a `/sendall`
reply. For every step that sent something, it builds the mixer state the capture shows at that
moment (the layout of the largest `/sendall` reply, then every message received and every write
sent before the step) and sends the step's datagrams to the simulator. The replies must match
the recorded ones message by message; where a single request got a reply without meters mixed
in, datagram sizes must match too. It also replays the baseline capture's changes made in
TotalMix's window (mute, solo, gain, 48V, Dim, a snapshot load) and compares the feedback.
