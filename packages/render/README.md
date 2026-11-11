# Render

Pure key renderers: a key's view model, a theme and a size in, an SVG string out. The plugin
sends the string to a key (`setImage` with `svgDataUrl(svg)`); tests rasterise it into golden
images.

```ts
import { DARK, renderKey, svgDataUrl } from '@faderlight/render';

const svg = renderKey(
  {
    kind: 'channel',
    label: 'MIC 9',
    name: 'Vocal',
    color: 1,
    value: { kind: 'gain', db: 42, caption: 'Gain' },
    meter: { left: { level: -16, peak: -9, clip: false } },
    badges: { phantom: true },
    muted: true,
  },
  DARK,
  96,
);
```

View models carry what a key shows, already decided: names, dB values, switch states,
`pending` and `offline` flags. Turning store state into a view model is the controllers' job
(M4); meter readings have the same shape as `MeterBank.read()` in `packages/model`.

## Keys

All keys are drawn on a 144 x 144 canvas inside a 14 px margin, and the whole 172 x 172 key is
scaled to `size` (96 on a Stream Deck XL). An XL's keycaps bend the edge of the display, so text
and icons stay on the canvas (a test checks every filled path), meters reach 1 px past it, and
the margin keeps the plain background. A state's colour (muted, soloed, lit) goes on the `PAD`:
the canvas and 3 px of the margin, with round corners. Every key can be `offline` (grey,
hatched, values shown as `––`) and most can be `pending` (dashed frame along the pad: sent, not
confirmed).

| `kind`     | Shows                                                                                 | States                                         |
| ---------- | ------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `channel`  | `style` full: name with a colour underline, gain or level, type icon, badges, meter   | muted, soloed, pending, offline                |
| `output`   | Main, Phones or an output, laid out like a channel; Main adds the monitor chips on    | muted, pending, offline, not assigned          |
| `toggle`   | Dim, Mono, Talkback, Speaker B, External input, Global Mute, Global Solo              | on, off, unknown, pending, offline             |
| `snapshot` | name big with the number above it, or the number big                                  | loaded, edited since loading, save armed       |
| `status`   | link state, device model, sample rate, clock, DSP load (each when known)              | idle, probing, syncing, live (beat), stale     |
| `bank`     | row, range "9–16", total                                                              | at the end                                     |
| `page`     | page number, the next page's name                                                     |                                                |
| `launcher` | the Faderlight mark and the interface's name, "Console" until the mixer answered      | offline                                        |
| `step`     | ▲ or ▼, target, current level                                                         | held (repeating), at the limit                 |
| `recorder` | the interface's recorder: transport state, elapsed time                               | not ready, stopped, recording, playing, armed  |
| `control`  | one parameter in the Channel Detail overlay: a switch, a ± or ◀ ▶ key, or a plain key | on, off, unknown, held, at the limit, selected |

The look follows `docs/design/03-ux.md`: mute cyan/teal, solo orange, 48V and record red, dim
amber; every state also has a shape (M and S chips, the pad, the dashed frame, filled and
outlined badges). `test/cases.ts` has an example of each. The `channel` style can also be
`meter` (a big meter, for monitoring walls) or `minimal` (the name and state only).

## Theme

`src/theme.ts` holds every token: colours per state, accents, meter scale and zones (−60 dBFS
floor, yellow from −18, orange from −6, red from −1), the type scale (15, 22, 36 and 52 px on
the canvas: the smallest is 10 px on an XL), the pending frame, and the channel colours by
TotalMix's colour number (1 is white, TotalMix's "no colour"; 3, 5 and 6 are orange, blue and
green as seen; 2, 4, 7 and 8 are grey, red, yellow and pink, inferred from the order of
TotalMix's colour menu). `DARK` is the default,
`HIGH_CONTRAST` the high-contrast theme from the design. A test keeps text and chip colours at
WCAG 4.5:1 or better.

## Text

Keys draw text as outlines, not `<text>`, so the deck shows exactly the pixels the goldens show
whatever fonts a computer has, and text can be measured: `fitText` picks the largest allowed
size, narrows the letters down to 80 % before going smaller, and only then cuts with `…`.

The font is Fira Sans Condensed SemiBold and Bold (`fonts/`, SIL Open Font License 1.1, see
`fonts/OFL.txt`), the unmodified TrueType files Google Fonts distributes (version 4.203). It
covers Latin, Greek and Cyrillic; other scripts draw as boxes. `src/font.ts` is a small
TrueType reader (character map, advances, outlines, GPOS pair kerning), so rendering has no
dependencies. In Node the files load on first use; elsewhere pass their bytes to `useFonts()`.

## SVG subset

Keys use `<svg>`, `<path>`, `<rect>`, `<circle>` and `<line>` with solid fills and strokes,
and path commands M, L, Q, C and Z only: no `<text>`, CSS, opacity, clip paths, masks,
gradients, filters, transforms or arcs, which some renderers (SVG Tiny) lack. Colours are mixed
in code instead. `test/svg-subset.test.ts` checks every case against this list.

## Goldens and the contact sheet

```sh
npm run render:goldens   # rewrites test/goldens/*.png and renders/contact-sheet.png
```

`test/goldens.test.ts` renders every case in `test/cases.ts` at 96 and 144 px with
[resvg](https://github.com/linebender/resvg) (its WebAssembly build, so every platform produces
the same pixels) and compares it with the golden: a pixel differs when a channel is more than 16
off, and at most 0.05 % of pixels may differ. A mismatch writes the new render to
`renders/failures/` (gitignored). The same test checks that `renders/contact-sheet.png` is
current: all cases at 144 px, then the default Console page and an Inputs page at XL size.

After any renderer change, run `npm run render:goldens`, look at the contact sheet, commit the
images, and attach the sheet to the PR.

A key renders in about 35 µs once the fonts are loaded (about 6 ms, once), and its SVG is about
5.5 kB.

## Open questions

- **Channel colours.** The mixer sends a small number per channel (`/input/n/color`). 2, 4, 7
  and 8 are inferred from the order of TotalMix's colour menu (`docs/protocol/global-osc.md`
  §6), not seen yet; the `ui-color` step of the baseline capture records the numbers.
- **The Stream Deck app's SVG renderer.** Dashed strokes, cubic curves and `rx` are expected to
  work but have not been seen on a device yet; the visual review on a real XL (M3.4) checks
  them.
- **Not reported by the mixer:** sample rate, clock lock, DSP load (`/status/dsp` is always 0
  so far) and snapshot names. The keys show them only when a view model has them; the deck
  reads snapshot names from TotalMix's own state file (`packages/deck`).
- **Recorder states.** Only `/durec/state` "Not ready" has been captured; how the other states
  are spelled decides the controller's mapping to `RecorderState`.
