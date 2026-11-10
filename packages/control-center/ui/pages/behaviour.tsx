// Behaviour (docs/design/03-ux.md §5.2): how long a press is long, how quickly a second tap
// follows, how held step keys repeat, and when the Channel Detail overlay closes by itself.

import type { JSX } from 'preact';
import type { DetailSettings, GestureSettings } from '@faderlight/deck';
import type { PageProps } from '../app.tsx';
import { Button, Card, Field, NumberInput, Page } from '../components.tsx';
import { useLive } from '../live.ts';

export function BehaviourPage(props: PageProps): JSX.Element {
  const state = useLive(props.settings.state);
  if (!state) return <></>;
  const g = state.draft.gestures;
  const d = state.draft.detail;
  const defaults = state.defaults;
  const gestures = (change: Partial<GestureSettings>): void => {
    props.settings.edit((s) => ({ ...s, gestures: { ...s.gestures, ...change } }));
  };
  const detail = (change: Partial<DetailSettings>): void => {
    props.settings.edit((s) => ({ ...s, detail: { ...s.detail, ...change } }));
  };
  const same = (a: object, b: object): boolean => JSON.stringify(a) === JSON.stringify(b);
  return (
    <Page
      title="Behaviour"
      intro="How the keys tell a tap from a long press, and how long things stay open."
    >
      <div class="grid">
        <Card
          title="Presses"
          id="gestures"
          actions={
            <Button
              kind="quiet"
              disabled={same(g, defaults.gestures)}
              onClick={() => {
                gestures(defaults.gestures);
              }}
            >
              Use the defaults
            </Button>
          }
        >
          <div class="form">
            <Field
              label="Long press"
              help={`Held this long, a key does what it does on hold: Channel Detail, saving a Level Preset, reading the mixer again. Default ${String(defaults.gestures.longPressMs)} ms.`}
            >
              <NumberInput
                value={g.longPressMs}
                min={200}
                max={2000}
                step={10}
                unit="ms"
                label="Long press"
                onChange={(longPressMs) => {
                  gestures({ longPressMs });
                }}
              />
            </Field>
            <Field
              label="Double tap"
              help={`A second tap within this time latches Talkback. Default ${String(defaults.gestures.doubleTapMs)} ms.`}
            >
              <NumberInput
                value={g.doubleTapMs}
                min={100}
                max={600}
                step={10}
                unit="ms"
                label="Double tap"
                onChange={(doubleTapMs) => {
                  gestures({ doubleTapMs });
                }}
              />
            </Field>
            <Field
              label="Repeat after"
              help={`A held Volume Step key, or a volume key of Channel Detail, starts repeating after this. Default ${String(defaults.gestures.repeatDelayMs)} ms.`}
            >
              <NumberInput
                value={g.repeatDelayMs}
                min={150}
                max={1500}
                step={10}
                unit="ms"
                label="Repeat after"
                onChange={(repeatDelayMs) => {
                  gestures({ repeatDelayMs });
                }}
              />
            </Field>
            <Field
              label="Repeat every"
              help={`Then steps again this often. Default ${String(defaults.gestures.repeatIntervalMs)} ms.`}
            >
              <NumberInput
                value={g.repeatIntervalMs}
                min={30}
                max={500}
                step={10}
                unit="ms"
                label="Repeat every"
                onChange={(repeatIntervalMs) => {
                  gestures({ repeatIntervalMs });
                }}
              />
            </Field>
          </div>
        </Card>
        <Card title="Channel Detail" id="detail">
          <div class="form">
            <Field
              label="Close after"
              help={`The overlay closes by itself when no key was pressed for this long; 0 keeps it open until Back. Default ${String(defaults.detail.timeoutSec)} s.`}
            >
              <NumberInput
                value={d.timeoutSec}
                min={0}
                max={600}
                unit="s"
                label="Close after"
                onChange={(timeoutSec) => {
                  detail({ timeoutSec });
                }}
              />
            </Field>
          </div>
        </Card>
      </div>
    </Page>
  );
}
