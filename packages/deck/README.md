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

## Tests

`test/loopback.ts` runs the TotalMix client against the simulator's mixer through a fake link
on a fake clock, so runtime tests control every reply and timer. The runtime takes a `render`
function: tests pass one that returns the view as JSON, and read back what each key shows.
