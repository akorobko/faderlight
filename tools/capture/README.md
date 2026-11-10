# Capture tool (`@faderlight/capture`)

Records the OSC traffic between this tool and TotalMix FX (Global OSC) into a JSON Lines file
under `fixtures/captures/`. Those files are the ground truth for the protocol spec
(`docs/protocol/global-osc.md`), the decoder tests and the simulator (see
`docs/design/05-agentic-plan.md`, task M0.3).

It runs straight from the TypeScript source on Node 24. No `npm install`, no build, no
dependencies.

## Run it (about 10 minutes)

### 1. Before you start

- Node 24 or newer: `node -v`. If it is missing or older, install the current LTS from
  <https://nodejs.org> (or `brew install node`).
- TotalMix FX 2.1 or newer. Global OSC is new in 2.1: if **Compatibility (Mode)** (step 2
  below) lists only "TotalMix 1.90" and "TotalMix 1.96", your TotalMix is older. At the time
  of writing 2.1 is a beta, posted in RME's forum thread "TotalMix FX 2.1"
  (<https://forum.rme-audio.de/viewtopic.php?id=43485>); the RME downloads page still offers
  2.0. Save your workspace (File → Save Workspace As) before you update.
- The latest main of this repository: `git switch main && git pull`. Run every command below
  from the repository root.
- Do not run the capture while recording or performing. A few steps change a value for about a
  second (you are asked first, and everything is put back).

### 2. TotalMix settings

In TotalMix FX:

1. Menu **Options**: tick **Enable OSC Control**.
2. **Options → Settings → OSC** tab. Pick a free **Remote Controller** slot (for example 2,
   if slot 1 is used by another controller) and set:
   - **In Use**: ticked
   - **Port incoming**: `7002`, **Port outgoing**: `9002`
   - **Remote Controller Address** (IP or Host Name): `127.0.0.1`. Do not leave it empty,
     and do not use `localhost`, which can resolve to the IPv6 address the tool does not
     listen on. Leave the **Found Remote Services** list alone.
   - **Compatibility (Mode)**: **Global OSC**
   - Click **Details** and tick **Send changes**, **Send status** and **Re-send received**. Leave
     **Send all data on start**, **Re-send if different**, **Send faders in linear scale** and
     **Receive to hidden channels** unticked. Keep the bandwidth limit as it is.
   - Tick **Send Level Data** (and **Send Peak Level**, if your version has it).
3. Quit anything else that listens on UDP port 9002 (Bitfocus Companion, another Stream Deck
   OSC plugin, an earlier capture).

If your TotalMix shows the options under slightly different names, use the closest match and
type what differs when the tool asks "Is TotalMix set up as listed above?". It is recorded
in the file.

### 3. Check the connection (5 seconds)

```sh
node tools/capture/src/cli.ts check
```

You should see something like `Received 42 datagrams ... device: Fireface UFX III` and
`Ready`. If it says `Nothing arrived`, go through the list it prints.

### 4. Run the guided capture (about 5 minutes)

```sh
node tools/capture/src/cli.ts run
```

The tool asks for your TotalMix FX version (Help → About), then works through the steps of
the `baseline` script (`node tools/capture/src/cli.ts scripts` lists them):

- **Automatic steps**: it listens, requests state (`/sendstate`, `/sendchan/...`,
  `/sendall`, ...) and records the replies.
- **Your steps**: it asks you to do small things in the TotalMix window (mute and unmute Mic
  9, move a fader and put it back, Dim on and off, ...). Do it, then press Enter. Type `s` and
  Enter to skip a step, `q` and Enter to stop. While you work you see what TotalMix sends.
  Two steps are marked optional and say when to skip them (48V, loading a snapshot).
- **Write steps**: it changes one value for about a second and puts it back: mute of Mic 9,
  a playback route to Main lowered by 1 dB, the Main output lowered by 1 dB, Dim, and the Mic 9
  channel name. It lists them and asks once before the first one. It never touches 48V, never
  raises a level and never loads a snapshot by itself. If it cannot confirm a value was put
  back, it says which one so you can fix it in TotalMix.
- **Ctrl+C** stops at any time. A value that is changed at that moment is put back first,
  and what was recorded so far is kept (the file name ends in `-interrupted`).

At the end it prints a summary and the file name, for example
`fixtures/captures/fireface-ufx-iii-2.10-2026-11-10.jsonl`.

Before saving, it replaces identifying text with the same number of `X`: the interface's
serial number (TotalMix reports it in the device name, for example `Fireface UFX III
(12345678)`), and this computer's host name, user name and home folder. It does this in the
decoded messages and in the raw bytes, and prints what it replaced. Pass `--mask "<text>"`
(repeatable) for anything else that should not be shared.

Test channels are 0-based indices. The defaults suit a UFX III: input 8 (Mic 9), output 0
(AN 1/2, usually Main), phones 8 (PH 9/10), playback 0. On another interface pass
`--input`, `--output`, `--phones` and `--playback`. Other ports: `--send-port` (TotalMix
"Port incoming") and `--listen-port` (TotalMix "Port outgoing"). TotalMix on another computer:
`--host <its IP>`, and set its Remote Controller Address to this computer's IP.

### 5. Hand it over

Anything pushed to GitHub stays in its history, even on a branch that is deleted later. A
file recorded before the tool removed serial numbers (its name contains the serial, for example
`fireface-ufx-iii-12345678-...`) must be redacted first:

```sh
node tools/capture/src/cli.ts redact fixtures/captures/<file>.jsonl
```

It rewrites the file in place, drops the serial from its name and checks that nothing is left.
Then commit the file on a new branch and push it:

```sh
git switch -c capture/baseline-$(date +%F)
git add fixtures/captures/
git commit -m "Add baseline capture"
git push -u origin HEAD
```

The file contains your channel names, snapshot names and the levels on your inputs during the
capture. Nothing else from your computer is recorded except the OS and Node versions; the
serial number and the computer's names are replaced as described above.

## Other commands

```sh
node tools/capture/src/cli.ts listen --duration 30          # record without a script
node tools/capture/src/cli.ts listen --send "/sendchan/input/8 f:1" --duration 10
node tools/capture/src/cli.ts summary fixtures/captures/<file>.jsonl          # per step and per address
node tools/capture/src/cli.ts summary fixtures/captures/<file>.jsonl --json   # machine-readable
node tools/capture/src/cli.ts redact fixtures/captures/<file>.jsonl --mask "Studio B"   # remove text
node tools/capture/src/cli.ts scripts                       # list scripts and steps
node tools/capture/src/cli.ts --help                        # all options
```

`--send` takes `f:` (float32), `i:` (int32), `s:` (string), `T`, `F`; a bare number is a float.
TotalMix is documented to expect float32 for numeric commands.

## Capture file format (version 1)

One JSON object per line, in time order. `t` is milliseconds since the tool started
(monotonic clock). OSC arguments are `[tag]` or `[tag, value]` tuples: `["f", -12.5]`,
`["i", 1]`, `["s", "Mic 9"]`, `["T"]`. Floats are written as the shortest decimal that reads
back as the same float32; non-finite values as `"NaN"`, `"Infinity"`, `"-Infinity"`; blobs
as base64; int64 and timetags as strings. A run of `X` in a string is redacted text (see
"Run it", step 4); it is masked identically in `raw`, so lengths and padding are as received.

| `k`    | Record                                 | Fields                                                                                                                                                                                                                                                                                                          |
| ------ | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `meta` | First line                             | tool and format version, command, script, start time, Node, OS, host and ports, meter mode, test channels (`vars`), TotalMix version, whether the settings matched this README, the person's note                                                                                                               |
| `step` | Step boundary                          | `id`, `phase` (`begin`/`end`); begin: `kind`, `title`, `why` (the question the step answers), `sends`; end: `result`, `stats` (datagrams, messages, meter messages, distinct addresses, first/last reply in ms after the step began), `detail` (write steps: value before, written, echoed, verified, restored) |
| `tx`   | Sent datagram                          | `to`, `raw` (base64), `msgs` (decoded), `step`                                                                                                                                                                                                                                                                  |
| `rx`   | Received datagram                      | `from`, `size`, `raw` (base64, exactly as received), `msgs` (bundles flattened in order), `tt` (bundle timetag), `nested`, `meter` (meter-only datagram kept in full), or `error` when it could not be decoded                                                                                                  |
| `tick` | Once per second and at step boundaries | `ms`, `rx` and `meter` counts for the interval, `thinned` (meter datagrams not written), `levels` (latest value per meter address while meters are thinned)                                                                                                                                                     |
| `note` | Event                                  | `level` (`info`/`warn`), `text`, `detail`                                                                                                                                                                                                                                                                       |
| `end`  | Last line                              | `reason` (`done`/`interrupted`/`error`), totals, detected device, unconfirmed restores                                                                                                                                                                                                                          |

Meters: by default (`--meters thin`) a datagram whose messages all match `^/level/` is counted
but not written; each tick keeps the last value per meter address instead. Steps marked
`meters: 'full'` (and `--meters full`) keep every meter datagram. Unprompted addresses that
arrive faster than 5 per second during the `idle` step are treated like meters too. Once the
file reaches `--max-mb` (45 MB) meter datagrams are no longer written at all. Everything else
is always written in full.

## Adding a step (agents)

A hardware question that only a real TotalMix can answer becomes a step in
`scripts/baseline.ts` (or a new script registered in `scripts/index.ts`), plus the question in
the PR. Steps are data built with the helpers in `src/steps.ts`:

- `listen({ id, title, why, ms })`: record for a while.
- `request({ id, title, why, send: [msg('/sendchan/input/{in}', f(1))] })`: send, then
  record until the replies stop (`settleMs`, `maxMs`).
- `manual({ id, title, why, text: [...] })`: the person does something in TotalMix.
- `write({ id, title, why, address, change, verify })`: change a value, observe, put it back.
  Only for changes that are harmless for a second and can be restored from the value TotalMix
  reported: mute, Dim, a name, a 1 dB cut. Never phantom power, never louder, never snapshots.

Placeholders in titles, text and addresses: `{in} {out} {pb} {ph}` and `{inName} {outName}
{pbName} {phName}`. Every step needs a unique `id` and a `why`; a test checks both.

Try a script without hardware against the fake TotalMix in `test/fake-totalmix.ts` (its
replies are guesses that only exercise the tool, not protocol facts):

```sh
node tools/capture/test/fake-totalmix.ts &
node tools/capture/src/cli.ts run --time-scale 0.1 --out /tmp/dry-run.jsonl
```
