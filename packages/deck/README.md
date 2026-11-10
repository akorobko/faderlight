# Deck

The deck runtime without the Stream Deck SDK: what each key is, what it shows and what a press
does (docs/design/02-architecture.md). `packages/plugin` connects it to the Stream Deck app;
the virtual deck (`tools/virtual-deck`) connects it to a browser.

| File                    | Contents                                                                |
| ----------------------- | ----------------------------------------------------------------------- |
| `src/settings.ts`       | Global settings: schema, defaults, migrations, clamping                 |
| `src/actions.ts`        | The action registry the plugin manifest is checked against              |
| `src/specs.ts`          | Key specs (what a key is) and the spec of a specific action's settings  |
| `src/controllers.ts`    | One controller per spec type: mixer state to view, gestures to commands |
| `src/gestures.ts`       | Tap, long press, double tap and auto-repeat from key down and up        |
| `src/scheduler.ts`      | FrameScheduler: image budget, per-key rate, static before meter frames  |
| `src/detail.ts`         | The Channel Detail overlay: its keys, views and gestures                |
| `src/keys.ts`           | The controller for each spec type                                       |
| `src/layout.ts`         | The Console layout: pages, banks, what each Console Slot is             |
| `src/runtime.ts`        | DeckRuntime: keys appear, get pressed and are drawn through a DeckHost  |
| `src/snapshot-names.ts` | Snapshot names from TotalMix's own state file                           |
| `src/inspector.ts`      | What a key's Property Inspector shows, and the changes it may make      |

## Specific actions

Each action dropped onto any page of any profile reads its own settings; missing or unusable
values fall back to the defaults below, so a freshly dropped action does something.

| Action             | Settings (default)                                                           | Tap              | Hold                             |
| ------------------ | ---------------------------------------------------------------------------- | ---------------- | -------------------------------- |
| Channel            | `bus` (input), `index` (first strip), `style`, `tap` (mute), `hold` (detail) | mute (or solo)   | Channel Detail (or solo, 48V)    |
| Main / Output      | `output`: `main`, `phones1`-`phones4` or an output index (main)              | mute             |                                  |
| Phones             | `n` 1-4 (1)                                                                  | mute             |                                  |
| Snapshot           | `n` 1-8 (1)                                                                  | load             |                                  |
| Monitor Switch     | `function`: dim, mono, talkback, speakerB, external (dim)                    | toggle           |                                  |
| Global Mute / Solo | `function`: mute or solo (mute)                                              | toggle           |                                  |
| Status             |                                                                              | Control Center   | read the mixer again             |
| Volume Step        | `output` (main), `direction` up or down (up)                                 | 0.5 dB, repeats  | 1 dB after 1.5 s, 3 dB after 3 s |
| Level Preset       | `output` (main), `n` 1-8 (1)                                                 | set saved level  | save the current level           |
| Exit Console       |                                                                              | previous profile |                                  |

Talkback is on while the key is held; a double tap latches it until the next press. A Channel
key's solo is the solo of its route into Main. Snapshots are only loaded: no capture has shown
a Global OSC address for saving one.

A tap on Status asks the host to open the Control Center on its Connection page
(`DeckHost.openControlCenter`); a host without one (a test) gets the alert.

A Level Preset keeps its level in the global settings (`levels`, by output and number, e.g.
`main/1`), so the same preset is shared by every key that names it, on any profile. It is lit
while the output is at that level.

Global OSC does not send snapshot names. `TotalMixSnapshotNames` reads them from the state file
TotalMix writes when it quits (macOS: `~/Library/Application Support/RME TotalMix FX/last.*.xml`,
the newest one), so a renamed snapshot shows after TotalMix has quit once. The file name holds
the interface's serial number: it is read, never logged or copied. Where TotalMix keeps the
file on Windows is not known yet; there the keys show the snapshot number. A name set in the
Control Center (`snapshots`, by number) wins over the state file's.

The Control Center can also give a channel a name and a colour of its own, and hide it from
the Console's banks (`channels`, by bus and left index, e.g. `input/8`); its own name and
colour win over TotalMix's on every key that shows the channel. `colors` gives a TotalMix
colour number (`/{bus}/{n}/color`) a key colour of its own, for the numbers the theme does not
know yet. A hidden channel only leaves the banks: a Channel key that names it still shows it.

## Property Inspector

The inspector page in the Stream Deck app (`packages/plugin/pi`) draws what this package builds
(`inspectorView`, docs/design/03-ux.md §5.1): the action's name, what the key is now, a list to
pick from for each of its settings, and the connection to TotalMix. The lists come from the
mixer while the inspector is open: a Channel key offers the channels TotalMix shows, by name
(`Mic 9 · Vocal`); an output offers Main and Phones 1-4 by the outputs TotalMix assigns to them,
then every output; Snapshot and Level Preset keys show the snapshot names and saved levels. A
setting TotalMix cannot show now (a hidden channel) stays in the list, marked "not shown". A
Console Slot has nothing to set: its inspector says what it shows now.

`DeckRuntime.inspect(id)` builds the view of a key and `changeSetting(id, key, value)` applies
one choice (null takes a setting out, so its default applies; a new row clears the channel).
`Inspectors` holds the open inspectors: each gets its view on `hello`, after each change, and
whenever the view changes (it looks twice a second), and its button opens the Control Center
on the section for the key.

## The Console layout

The bundled Console profile puts a Console Slot on each key of an XL; each slot shows what the
layout has at its coordinates on the page its device shows now. Page and bank keys change
that instantly, without switching profiles; each device keeps its own page and banks.

| Page    | Keys                                                                                                                                 |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Console | Snapshots 1-6, Status, Page; 7 inputs, Bank; 7 playback and output strips, Bank; Main, Phones 1-2, Main preset, Dim, Mono, Exit (§4) |
| Inputs  | 29 input strips in meter style, Console (top right), Bank, Page to Outputs                                                           |
| Outputs | 23 output strips, Console (top right), Dim, Mono, Speaker B, External, Bank, Page to Inputs                                          |

A page can have several banks, one per channel row; its strip and bank keys name theirs. A bank
moves by its size and wraps around at the end; a long press on its key switches it to the next
source: inputs, playback, outputs, then playback and outputs together. While a bank's own source
fits on its row, its key is blank. A Phones key for a role TotalMix shows no output for is blank
too. The last source is what
the Console's third row starts on: the playback strips, then the outputs that are not Main or a
Phones output, since those have keys of their own. A page key goes to its page (`to`) or the
next one; a long press goes back to the Console. The layout is built in (`CONSOLE_LAYOUT`)
until the Control Center can edit it (M5).

## The Channel Detail overlay

A long press on a channel key (the default hold) turns the whole Console into that channel's
control surface (docs/design/03-ux.md §3.1): gain ±, 48V, phase, Inst, Autoset, mute, solo,
fader ±, a tall meter, low cut, EQ and dynamics, five sends and the FX send (tap one to choose
what the send ± and pan keys change), previous and next channel, Clear Clip and Back. Keys for
something the channel does not have are blank. From a key on another profile the deck switches
to the Console profile first, and Back switches back. The overlay closes after
`detail.timeoutSec` (20 s) without a press; 0 keeps it open.

The fader keys set the channel's route into Main, the send keys its route into the chosen
submix. Gain steps follow the device profile's preamp range, including the jump from 0 to
8 dB on the mic inputs.

## Tests

`test/loopback.ts` runs the TotalMix client against the simulator's mixer through a fake link
on a fake clock, so runtime tests control every reply and timer. The runtime takes a `render`
function: tests pass one that returns the view as JSON, and read back what each key shows.
