// Appearance (docs/design/03-ux.md §5.2): the theme, the key colour for each TotalMix colour
// number, and how often key images are drawn.

import type { JSX } from 'preact';
import type { FrameSettings, ThemeName } from '@faderlight/deck';
import type { StripInfo } from '../../src/summary.ts';
import type { PageProps } from '../app.tsx';
import {
  Button,
  Card,
  ColorChoice,
  Field,
  NumberInput,
  Page,
  Select,
  type Choice,
} from '../components.tsx';
import { withEntry } from '../edits.ts';
import { useLive, useTopic } from '../live.ts';

const THEMES: readonly Choice<ThemeName>[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'high-contrast', label: 'High contrast' },
];

/**
 * What TotalMix calls its colour numbers (docs/protocol/global-osc.md §6): 1, 3, 5 and 6 were
 * seen on hardware; 2, 4, 7 and 8 follow the order of TotalMix's colour menu.
 */
const TOTALMIX_COLOR: Readonly<Record<number, string>> = {
  1: 'White (no colour)',
  2: 'Grey',
  3: 'Orange',
  4: 'Red',
  5: 'Blue',
  6: 'Green',
  7: 'Yellow',
  8: 'Pink',
};

export function AppearancePage(props: PageProps): JSX.Element {
  const state = useLive(props.settings.state);
  const mixer = useTopic(props.rpc, 'mixer');
  if (!state) return <></>;
  const { draft, defaults, palette } = state;
  const frames = (change: Partial<FrameSettings>): void => {
    props.settings.edit((s) => ({ ...s, frames: { ...s.frames, ...change } }));
  };
  const strips: StripInfo[] = mixer
    ? [...mixer.strips.input, ...mixer.strips.playback, ...mixer.strips.output]
    : [];
  // 1-8, and any other number a channel reports or the settings have.
  const numbers = [
    ...new Set([
      ...Array.from({ length: 8 }, (_, i) => i + 1),
      ...strips.flatMap((s) => (s.color === undefined ? [] : [s.color])),
      ...Object.keys(draft.colors).map(Number),
    ]),
  ].sort((a, b) => a - b);
  const sameFrames = JSON.stringify(draft.frames) === JSON.stringify(defaults.frames);
  return (
    <Page title="Appearance" intro="How the keys look, and how often they are drawn.">
      <div class="grid">
        <Card title="Theme" id="theme">
          <div class="form">
            <Field
              label="Theme"
              help="High contrast: black keys, white text and stronger accents, for bright rooms."
            >
              <Select
                value={draft.theme}
                choices={THEMES}
                label="Theme"
                onChange={(theme) => {
                  props.settings.edit((s) => ({ ...s, theme }));
                }}
              />
            </Field>
          </div>
        </Card>
        <Card
          title="Drawing"
          id="frames"
          actions={
            <Button
              kind="quiet"
              disabled={sameFrames}
              onClick={() => {
                frames(defaults.frames);
              }}
            >
              Use the defaults
            </Button>
          }
        >
          <div class="form">
            <Field
              label="Meters"
              help={`Images per second for a key with a level meter; 0 stops the meters. Default ${String(defaults.frames.meterFps)}.`}
            >
              <NumberInput
                value={draft.frames.meterFps}
                min={0}
                max={30}
                unit="per second"
                label="Meters"
                onChange={(meterFps) => {
                  frames({ meterFps });
                }}
              />
            </Field>
            <Field label="One key at most" help={`Default ${String(defaults.frames.maxKeyFps)}.`}>
              <NumberInput
                value={draft.frames.maxKeyFps}
                min={1}
                max={30}
                unit="per second"
                label="One key at most"
                onChange={(maxKeyFps) => {
                  frames({ maxKeyFps });
                }}
              />
            </Field>
            <Field
              label="All keys at most"
              help={`What the Stream Deck app is sent in all. Lower it if the app lags. Default ${String(defaults.frames.budgetPerSecond)}.`}
            >
              <NumberInput
                value={draft.frames.budgetPerSecond}
                min={10}
                max={500}
                step={10}
                unit="per second"
                label="All keys at most"
                onChange={(budgetPerSecond) => {
                  frames({ budgetPerSecond });
                }}
              />
            </Field>
          </div>
        </Card>
      </div>
      <Card title="Channel colours" id="colors" wide>
        <p class="muted note first">
          TotalMix gives each channel a colour number, in the order of its colour menu. Here each
          number gets its key colour; a channel can still have a colour of its own on the Device &
          Channels page.
        </p>
        <table class="table" data-testid="colors">
          <thead>
            <tr>
              <th>Number</th>
              <th>In TotalMix</th>
              <th>On the keys</th>
              <th>Channels</th>
            </tr>
          </thead>
          <tbody>
            {numbers.map((n) => {
              const key = String(n);
              const used = strips.filter((s) => s.color === n).map((s) => s.name);
              return (
                <tr key={key} data-color={key}>
                  <td class="mono">{key}</td>
                  <td class={TOTALMIX_COLOR[n] === undefined ? 'muted' : undefined}>
                    {TOTALMIX_COLOR[n] ?? 'not known yet'}
                  </td>
                  <td>
                    <ColorChoice
                      label={`Key colour for TotalMix colour ${key}`}
                      own={draft.colors[key]}
                      fallback={palette[key]}
                      fallbackText="theme"
                      resetTitle="Use the theme's colour again"
                      onChange={(color) => {
                        props.settings.edit((s) => ({
                          ...s,
                          colors: withEntry(s.colors, key, color),
                        }));
                      }}
                    />
                  </td>
                  <td class="muted">{used.length === 0 ? '–' : used.join(', ')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </Page>
  );
}
