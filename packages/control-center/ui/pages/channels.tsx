// Device & Channels (docs/design/03-ux.md §5.2): the interface, the snapshot names, every
// channel TotalMix shows with its name and colour on the keys and whether the Console's banks
// show it, and the levels of the Level Preset keys. Empty boxes use what TotalMix has.

import { Fragment, type JSX } from 'preact';
import type { Bus } from '@faderlight/model';
import type { GlobalSettings } from '@faderlight/deck';
import type { MixerSummary, StripInfo } from '../../src/summary.ts';
import type { PageProps } from '../app.tsx';
import {
  Button,
  Card,
  Check,
  ColorChoice,
  Meter,
  NumberInput,
  Page,
  Swatch,
  TextInput,
  type Choice,
} from '../components.tsx';
import { channelKey, parsePreset, withChannel, withEntry } from '../edits.ts';
import { useLive, useTopic } from '../live.ts';

const BUS_TITLE: Readonly<Record<Bus, string>> = {
  input: 'Inputs',
  playback: 'Playback',
  output: 'Outputs',
};

const LINK_WORD: Readonly<Record<string, string>> = {
  live: 'Live',
  syncing: 'Reading the mixer',
  probing: 'Looking for TotalMix',
  stale: 'TotalMix stopped answering',
  idle: 'Not connected',
};

export function ChannelsPage(props: PageProps): JSX.Element {
  const state = useLive(props.settings.state);
  const mixer = useTopic(props.rpc, 'mixer');
  const meters = useTopic(props.rpc, 'meters');
  if (!state) return <></>;
  const draft = state.draft;
  const edit = (change: (d: GlobalSettings) => GlobalSettings): void => {
    props.settings.edit(change);
  };
  /** The key colour for a TotalMix colour number, as the theme and the Appearance page set it. */
  const colorOf = (n: number | undefined): string | undefined =>
    n === undefined ? undefined : (draft.colors[String(n)] ?? state.palette[String(n)]);
  return (
    <Page
      title="Device & Channels"
      intro="What the keys call each channel and snapshot, and which channels the Console's banks leave out. Empty boxes use the names in TotalMix."
    >
      <div class="grid">
        <DeviceCard mixer={mixer} />
        <SnapshotNames mixer={mixer} draft={draft} edit={edit} />
      </div>
      {(['input', 'playback', 'output'] as const).map((bus) => (
        <Card key={bus} title={BUS_TITLE[bus]} id={`channels-${bus}`} wide>
          <ChannelTable
            strips={mixer?.strips[bus] ?? []}
            draft={draft}
            edit={edit}
            colorOf={colorOf}
            meters={meters ?? {}}
          />
        </Card>
      ))}
      <LevelPresets mixer={mixer} draft={draft} edit={edit} />
    </Page>
  );
}

interface EditProps {
  readonly draft: GlobalSettings;
  readonly edit: (change: (d: GlobalSettings) => GlobalSettings) => void;
}

function DeviceCard(props: { readonly mixer: MixerSummary | undefined }): JSX.Element {
  const m = props.mixer;
  const output = (index: number | undefined): string => {
    const s = m?.strips.output.find((x) => x.index === index);
    return s ? `${s.label} · ${s.name}` : 'none';
  };
  return (
    <Card title="Interface" id="device">
      {m === undefined ? (
        <p class="muted">Connecting…</p>
      ) : (
        <dl class="facts first">
          <dt>Interface</dt>
          <dd>{m.device ?? 'not reported yet'}</dd>
          <dt>TotalMix</dt>
          <dd>{LINK_WORD[m.link] ?? m.link}</dd>
          <dt>Channels shown</dt>
          <dd>
            {m.strips.input.length} inputs, {m.strips.playback.length} playback,{' '}
            {m.strips.output.length} outputs
          </dd>
          <dt>Main</dt>
          <dd>{output(m.main)}</dd>
          {m.phones.map((p, i) =>
            p === undefined ? null : (
              <Fragment key={i}>
                <dt>Phones {i + 1}</dt>
                <dd>{output(p)}</dd>
              </Fragment>
            ),
          )}
        </dl>
      )}
    </Card>
  );
}

function SnapshotNames(
  props: EditProps & { readonly mixer: MixerSummary | undefined },
): JSX.Element {
  const { draft, edit } = props;
  return (
    <Card title="Snapshot names" id="snapshots">
      <table class="table">
        <thead>
          <tr>
            <th>Snapshot</th>
            <th>In TotalMix</th>
            <th>On the keys</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 8 }, (_, i) => {
            const n = String(i + 1);
            const mixerName = props.mixer?.snapshots[i]?.mixerName;
            return (
              <tr key={n} data-snapshot={n}>
                <td>{n}</td>
                <td class="muted">{mixerName ?? '–'}</td>
                <td>
                  <TextInput
                    value={draft.snapshots[n] ?? ''}
                    placeholder={mixerName ?? `Snapshot ${n}`}
                    label={`Name of snapshot ${n}`}
                    onChange={(name) => {
                      edit((d) => ({
                        ...d,
                        snapshots: withEntry(d.snapshots, n, name.trim() === '' ? undefined : name),
                      }));
                    }}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p class="muted note">
        TotalMix does not send snapshot names; the plugin reads them from TotalMix's state file when
        TotalMix runs on this computer. Names set here win.
      </p>
    </Card>
  );
}

function ChannelTable(
  props: EditProps & {
    readonly strips: readonly StripInfo[];
    readonly colorOf: (n: number | undefined) => string | undefined;
    readonly meters: Readonly<Record<string, readonly [number, number, 0 | 1]>>;
  },
): JSX.Element {
  const { draft, edit } = props;
  if (props.strips.length === 0) {
    return <p class="muted">None shown in TotalMix (or not read yet).</p>;
  }
  return (
    <table class="table channels">
      <thead>
        <tr>
          <th>Level</th>
          <th>Channel</th>
          <th>In TotalMix</th>
          <th>Name on the keys</th>
          <th>Colour</th>
          <th>Console</th>
        </tr>
      </thead>
      <tbody>
        {props.strips.map((s) => {
          const key = channelKey(s.bus, s.index);
          const own = draft.channels[key];
          const mixerColor = props.colorOf(s.color);
          return (
            <tr key={key} data-channel={key}>
              <td>
                <Meter
                  levels={
                    s.right === undefined
                      ? [props.meters[key]]
                      : [props.meters[key], props.meters[channelKey(s.bus, s.right)]]
                  }
                />
              </td>
              <td class="mono">{s.label}</td>
              <td>
                <Swatch color={mixerColor} />
                {s.name}
              </td>
              <td>
                <TextInput
                  value={own?.name ?? ''}
                  placeholder={s.name}
                  label={`Name of ${s.label}`}
                  onChange={(name) => {
                    edit((d) => withChannel(d, key, { name }));
                  }}
                />
              </td>
              <td>
                <ColorChoice
                  label={`Colour of ${s.label}`}
                  own={own?.color}
                  fallback={mixerColor}
                  fallbackText="from TotalMix"
                  resetTitle="Use the colour from TotalMix again"
                  onChange={(color) => {
                    edit((d) => withChannel(d, key, { color }));
                  }}
                />
              </td>
              <td>
                <Check
                  checked={own?.hidden !== true}
                  onChange={(on) => {
                    edit((d) => withChannel(d, key, { hidden: !on }));
                  }}
                >
                  Show
                </Check>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function LevelPresets(
  props: EditProps & { readonly mixer: MixerSummary | undefined },
): JSX.Element {
  const { draft, edit } = props;
  const outputName = (o: string | number): string => {
    if (o === 'main') return 'Main';
    if (typeof o === 'string') return `Phones ${o.slice(-1)}`;
    const s = props.mixer?.strips.output.find((x) => x.index === o);
    return s ? `${s.label} · ${s.name}` : `Output ${String(o + 1)}`;
  };
  const presets = Object.entries(draft.levels)
    .flatMap(([key, db]) => {
      const p = parsePreset(key);
      return p ? [{ key, db, p }] : [];
    })
    .sort((a, b) => a.key.localeCompare(b.key, 'en', { numeric: true }));
  const outputs: Choice<string>[] = [
    { value: 'main', label: 'Main' },
    ...[1, 2, 3, 4].map((n) => ({ value: `phones${String(n)}`, label: `Phones ${String(n)}` })),
    ...(props.mixer?.strips.output ?? []).map((s) => ({
      value: String(s.index),
      label: `${s.label} · ${s.name}`,
    })),
  ];
  const free = (output: string): number | undefined => {
    for (let n = 1; n <= 8; n++) if (draft.levels[`${output}/${String(n)}`] === undefined) return n;
    return undefined;
  };
  return (
    <Card title="Level presets" id="presets" wide>
      <p class="muted note first">
        A Level Preset key sets its output to the level saved here; a long press on the key saves
        the level the output has. Keys with the same output and number share one level.
      </p>
      {presets.length === 0 ? (
        <p class="muted">No levels saved yet.</p>
      ) : (
        <table class="table">
          <thead>
            <tr>
              <th>Output</th>
              <th>Preset</th>
              <th>Level</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {presets.map(({ key, db, p }) => (
              <tr key={key} data-preset={key}>
                <td>{outputName(p.output)}</td>
                <td>{p.n}</td>
                <td>
                  <NumberInput
                    value={db}
                    min={-65}
                    max={6}
                    step={0.5}
                    unit="dB"
                    label={`Level of ${outputName(p.output)} preset ${String(p.n)}`}
                    onChange={(level) => {
                      edit((d) => ({ ...d, levels: withEntry(d.levels, key, level) }));
                    }}
                  />
                </td>
                <td>
                  <Button
                    kind="quiet"
                    onClick={() => {
                      edit((d) => ({ ...d, levels: withEntry(d.levels, key, undefined) }));
                    }}
                  >
                    Remove
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <AddPreset
        outputs={outputs.filter((o) => free(o.value) !== undefined)}
        onAdd={(output) => {
          const n = free(output);
          if (n === undefined) return;
          edit((d) => ({ ...d, levels: withEntry(d.levels, `${output}/${String(n)}`, -20) }));
        }}
      />
    </Card>
  );
}

/** Picking an output adds its first free preset at -20 dB; the list goes back to its prompt. */
function AddPreset(props: {
  readonly outputs: readonly Choice<string>[];
  readonly onAdd: (output: string) => void;
}): JSX.Element {
  return (
    <div class="toolbar add">
      <select
        aria-label="Add a preset for"
        value=""
        onChange={(e) => {
          const el = e.currentTarget;
          if (el.value !== '') props.onAdd(el.value);
          el.value = '';
        }}
      >
        <option value="">Add a preset for…</option>
        {props.outputs.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
