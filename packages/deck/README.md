# Deck

The deck runtime without the Stream Deck SDK: what each key is, what it shows and what a press
does (docs/design/02-architecture.md). `packages/plugin` connects it to the Stream Deck app;
the virtual deck (`tools/virtual-deck`) connects it to a browser.

| File                 | Contents                                                                |
| -------------------- | ----------------------------------------------------------------------- |
| `src/settings.ts`    | Global settings: schema, defaults, migrations, clamping                 |
| `src/actions.ts`     | The action registry the plugin manifest is checked against              |
| `src/specs.ts`       | Key specs (what a key is) and the spec of a specific action's settings  |
| `src/controllers.ts` | One controller per spec type: mixer state to view, gestures to commands |
| `src/gestures.ts`    | Tap, long press, double tap and auto-repeat from key down and up        |
| `src/scheduler.ts`   | FrameScheduler: image budget, per-key rate, static before meter frames  |
| `src/detail.ts`      | The Channel Detail overlay: its keys, views and gestures                |
| `src/keys.ts`        | The controller for each spec type                                       |
| `src/layout.ts`      | The Console layout: pages, banks, what each Console Slot is             |
| `src/runtime.ts`     | DeckRuntime: keys appear, get pressed and are drawn through a DeckHost  |

## Specific actions

Each action dropped onto any page of any profile reads its own settings; missing or unusable
values fall back to the defaults below, so a freshly dropped action does something.

| Action             | Settings (default)                                                           | Tap             | Hold                             |
| ------------------ | ---------------------------------------------------------------------------- | --------------- | -------------------------------- |
| Channel            | `bus` (input), `index` (first strip), `style`, `tap` (mute), `hold` (detail) | mute (or solo)  | Channel Detail (or solo, 48V)    |
| Main / Output      | `output`: `main`, `phones1`-`phones4` or an output index (main)              | mute            |                                  |
| Phones             | `n` 1-4 (1)                                                                  | mute            |                                  |
| Snapshot           | `n` 1-8 (1)                                                                  | load            |                                  |
| Monitor Switch     | `function`: dim, mono, talkback, speakerB, external (dim)                    | toggle          |                                  |
| Global Mute / Solo | `function`: mute or solo (mute)                                              | toggle          |                                  |
| Status             |                                                                              |                 | read the mixer again             |
| Volume Step        | `output` (main), `direction` up or down (up)                                 | 0.5 dB, repeats | 1 dB after 1.5 s, 3 dB after 3 s |

Talkback is on while the key is held; a double tap latches it until the next press. A Channel
key's solo is the solo of its route into Main. Snapshots are only loaded: no capture has shown
a Global OSC address for saving one.

## The Console layout

The bundled Console profile puts a Console Slot on each key of an XL; each slot shows what the
layout has at its coordinates on the page its device shows now. Page and bank keys change
that instantly, without switching profiles; each device keeps its own page and banks.

| Page    | Keys                                                                                                                                                                                          |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Console | Snapshots 1-6, Status, Page; a bank of 8 input strips; Main, Phones 1-2, AN 3/4, Dim, Mono, Talkback, Bank; Main, Phones 1 and Phones 2 ±, Global Mute, Global Solo (docs/design/03-ux.md §4) |
| Inputs  | A bank of 30 strips in meter style, Bank, Page                                                                                                                                                |
| Outputs | A bank of 24 output strips; Main ±, Dim, Mono, Speaker B, External, Bank, Page                                                                                                                |

A bank key moves its bank by its size and wraps around at the end; a long press switches it to
the next bus (inputs, playback, outputs). A page key goes to the next page; a long press goes
back to the first. The layout is built in (`CONSOLE_LAYOUT`) until the Control Center can edit
it (M5).

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
