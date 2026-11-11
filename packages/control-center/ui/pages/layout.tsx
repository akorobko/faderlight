// Layout (docs/design/03-ux.md §5.2): the Console's pages as an 8 x 4 grid of live key images.
// Keys are dragged from the list on the right onto the grid, or picked there for the selected
// key; a key dragged onto another swaps with it. Below: the selected key's settings, the page's
// name and banks, and templates. Everything is a draft until Save, like the other sections.

import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type {
  BankSource,
  JsonObject,
  KeySpec,
  Layout,
  LayoutTemplate,
  OutputRef,
} from '@faderlight/deck';
import type { Bus } from '@faderlight/model';
import type { MixerSummary } from '../../src/summary.ts';
import type { PageProps } from '../app.tsx';
import { Button, Card, Field, Page, Select, TextInput, type Choice } from '../components.tsx';
import {
  addPage,
  EMPTY_KEY,
  movePage,
  omit,
  removePage,
  renamePage,
  setBankSource,
  setKey,
  swapKeys,
  tidyLayout,
  withLayout,
} from '../edits.ts';
import { download, readJsonFile } from '../files.ts';
import { useLive, useTopic } from '../live.ts';
import type { Rpc } from '../rpc.ts';

const DRAG_KEY = 'application/x-faderlight-key';
const DRAG_CELL = 'application/x-faderlight-cell';
/** How often the key images are drawn again (meters, names). */
const PREVIEW_MS = 1000;

export function LayoutPage(props: PageProps): JSX.Element {
  const state = useLive(props.settings.state);
  const mixer = useTopic(props.rpc, 'mixer');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<number | undefined>(0);
  const [note, setNote] = useState<string | undefined>(undefined);
  const images = usePreviews(props.rpc, state?.draft, page);
  if (!state) return <></>;
  const layout = state.draft.layout ?? state.defaultLayout;
  const current = layout.pages[Math.min(page, layout.pages.length - 1)];
  if (!current) return <></>;
  const shown = layout.pages.indexOf(current);
  const change = (next: Layout): void => {
    props.settings.edit((d) => withLayout(d, next, state.defaultLayout));
  };
  const place = (index: number, spec: KeySpec): void => {
    change(setKey(layout, shown, index, spec));
  };
  const names = { mixer, pages: layout.pages.map((p) => p.name) };
  const spec = selected === undefined ? undefined : current.keys[selected];

  const importLayout = async (): Promise<void> => {
    const file = await readJsonFile();
    if (file === undefined) return;
    const imported = layoutOf(file);
    if (!imported) {
      setNote('That file has no layout in it.');
      return;
    }
    const checked = await props.settings.check({
      ...(state.draft as unknown as JsonObject),
      layout: imported as unknown as JsonObject,
    });
    if (!checked.settings.layout) {
      setNote(`That layout could not be read: ${checked.problems.join('; ')}`);
      return;
    }
    change(checked.settings.layout);
    setPage(0);
    setNote(
      checked.problems.length === 0
        ? 'Layout imported. Save to put it on the deck.'
        : `Layout imported, with keys left empty: ${checked.problems.join('; ')}`,
    );
  };

  return (
    <Page
      title="Layout"
      intro="The Console's pages, key by key, as the deck shows them now. Drag a key from the list onto the grid, or select a key and pick one. Drag a key onto another to swap them."
    >
      <div class="toolbar layout-bar">
        <div class="tabs" role="tablist" aria-label="Pages">
          {layout.pages.map((p, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === shown}
              class={i === shown ? 'tab on' : 'tab'}
              onClick={() => {
                setPage(i);
              }}
            >
              {p.name}
            </button>
          ))}
          <Button
            kind="quiet"
            disabled={layout.pages.length >= 16}
            onClick={() => {
              change(addPage(layout, `Page ${String(layout.pages.length + 1)}`));
              setPage(layout.pages.length);
              setSelected(0);
            }}
          >
            Add page
          </Button>
        </div>
        <div class="card-actions">
          <Button
            onClick={() => {
              download('faderlight-layout.json', {
                faderlight: 'layout',
                version: 1,
                layout: tidyLayout(layout),
              });
            }}
          >
            Export layout
          </Button>
          <Button onClick={() => void importLayout()}>Import layout</Button>
        </div>
      </div>
      {note !== undefined && (
        <p class="banner info" role="status">
          {note}
        </p>
      )}
      <div class="builder">
        <section class="card deck-card" aria-label={`Page ${current.name}`}>
          <div
            class="deck-grid"
            style={{ gridTemplateColumns: `repeat(${String(layout.columns)}, 1fr)` }}
          >
            {current.keys.map((k, i) => (
              <KeyCell
                key={i}
                index={i}
                spec={k}
                image={images[i]}
                label={keyLabel(k, names)}
                at={`${String(Math.floor(i / layout.columns) + 1)}.${String((i % layout.columns) + 1)}`}
                selected={i === selected}
                onSelect={() => {
                  setSelected(i);
                }}
                onClear={() => {
                  place(i, EMPTY_KEY);
                }}
                onDropKey={(dropped) => {
                  place(i, dropped);
                  setSelected(i);
                }}
                onDropCell={(from) => {
                  change(swapKeys(layout, shown, from, i));
                  setSelected(i);
                }}
              />
            ))}
          </div>
        </section>
        <Palette
          mixer={mixer}
          banks={current.banks?.length ?? 0}
          pages={names.pages}
          onPick={(picked) => {
            if (selected !== undefined) place(selected, picked);
          }}
        />
      </div>
      <div class="grid">
        <Card
          title={spec === undefined ? 'Key' : `Key ${keyAt(selected ?? 0, layout.columns)}`}
          id="key"
          actions={
            spec !== undefined &&
            spec.type !== 'empty' && (
              <Button
                kind="quiet"
                onClick={() => {
                  if (selected !== undefined) place(selected, EMPTY_KEY);
                }}
              >
                Clear key
              </Button>
            )
          }
        >
          {spec === undefined || selected === undefined ? (
            <p class="muted">Select a key on the grid.</p>
          ) : (
            <KeySettings
              spec={spec}
              names={names}
              banks={current.banks?.length ?? 0}
              onChange={(next) => {
                place(selected, next);
              }}
            />
          )}
        </Card>
        <Card
          title="Page"
          id="page"
          actions={
            <>
              <Button
                kind="quiet"
                disabled={shown === 0}
                onClick={() => {
                  change(movePage(layout, shown, shown - 1));
                  setPage(shown - 1);
                }}
              >
                Move left
              </Button>
              <Button
                kind="quiet"
                disabled={shown === layout.pages.length - 1}
                onClick={() => {
                  change(movePage(layout, shown, shown + 1));
                  setPage(shown + 1);
                }}
              >
                Move right
              </Button>
              <Button
                kind="danger"
                disabled={layout.pages.length <= 1}
                onClick={() => {
                  change(removePage(layout, shown));
                  setPage(Math.max(0, shown - 1));
                }}
              >
                Delete page
              </Button>
            </>
          }
        >
          <div class="form">
            <Field label="Name" help="On the page keys that go here.">
              <TextInput
                value={current.name}
                label="Page name"
                onChange={(name) => {
                  change(renamePage(layout, shown, name.slice(0, 24)));
                }}
              />
            </Field>
            {(current.banks ?? []).map((b, i) => (
              <Field
                key={i}
                label={`Bank ${String(i + 1)}`}
                help={`${String(b.size)} channel ${b.size === 1 ? 'key' : 'keys'}; a long press on its Bank key switches to the next source.`}
              >
                <Select
                  value={b.source}
                  choices={SOURCES}
                  label={`Bank ${String(i + 1)} starts on`}
                  onChange={(source) => {
                    change(setBankSource(layout, shown, i, source));
                  }}
                />
              </Field>
            ))}
            {(current.banks ?? []).length === 0 && (
              <p class="muted note">
                This page has no banks. Channel keys from the list ("Next channel of bank 1") make
                one.
              </p>
            )}
          </div>
        </Card>
      </div>
      <Templates
        templates={state.templates}
        isDefault={state.draft.layout === undefined}
        onUse={(t) => {
          change(t.layout);
          setPage(0);
          setSelected(0);
          setNote(`${t.name} is in the draft. Save to put it on the deck, or Discard.`);
        }}
      />
    </Page>
  );
}

/** The key images of a page, drawn by the plugin with the draft, again every second. */
function usePreviews(rpc: Rpc, draft: unknown, page: number): readonly string[] {
  const [images, setImages] = useState<readonly string[]>([]);
  const text = JSON.stringify(draft);
  useEffect(() => {
    if (draft === undefined) return undefined;
    let stopped = false;
    let busy = false;
    const load = async (): Promise<void> => {
      if (busy) return;
      busy = true;
      try {
        const r = await rpc.call('layout.preview', { settings: draft as JsonObject, page });
        if (!stopped) setImages(r.images);
      } catch {
        // Not connected: keep the last images; the page says so at the top.
      } finally {
        busy = false;
      }
    };
    void load();
    const timer = setInterval(() => void load(), PREVIEW_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [rpc, text, page]);
  return images;
}

const keyAt = (i: number, columns: number): string =>
  `${String(Math.floor(i / columns) + 1)}.${String((i % columns) + 1)}`;

function KeyCell(props: {
  readonly index: number;
  readonly spec: KeySpec;
  readonly image: string | undefined;
  readonly label: string;
  readonly at: string;
  readonly selected: boolean;
  readonly onSelect: () => void;
  readonly onClear: () => void;
  readonly onDropKey: (spec: KeySpec) => void;
  readonly onDropCell: (from: number) => void;
}): JSX.Element {
  const [over, setOver] = useState(false);
  const empty = props.spec.type === 'empty';
  return (
    <button
      type="button"
      class={`cell${props.selected ? ' selected' : ''}${over ? ' over' : ''}${empty ? ' empty' : ''}`}
      data-key={props.index}
      aria-label={`Key ${props.at}: ${props.label}`}
      aria-pressed={props.selected}
      draggable={!empty}
      onClick={props.onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Delete' || e.key === 'Backspace') props.onClear();
      }}
      onDragStart={(e) => {
        e.dataTransfer?.setData(DRAG_CELL, String(props.index));
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => {
        setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const cell = e.dataTransfer?.getData(DRAG_CELL) ?? '';
        if (cell !== '') {
          props.onDropCell(Number(cell));
          return;
        }
        const spec = parseSpec(e.dataTransfer?.getData(DRAG_KEY));
        if (spec) props.onDropKey(spec);
      }}
    >
      <span class="cell-key">
        {empty ? (
          <span class="cell-plus" aria-hidden="true">
            +
          </span>
        ) : props.image !== undefined ? (
          <img src={props.image} alt="" draggable={false} />
        ) : null}
      </span>
      <span class="cell-label">{empty ? ' ' : props.label}</span>
    </button>
  );
}

function parseSpec(text: string | undefined): KeySpec | undefined {
  if (text === undefined || text === '') return undefined;
  try {
    const v = JSON.parse(text) as { type?: unknown };
    return typeof v.type === 'string' ? (v as KeySpec) : undefined;
  } catch {
    return undefined;
  }
}

// --- what a key is ------------------------------------------------------------------------

interface Names {
  readonly mixer: MixerSummary | undefined;
  readonly pages: readonly string[];
}

const TOGGLES: readonly Choice<Extract<KeySpec, { type: 'toggle' }>['function']>[] = [
  { value: 'dim', label: 'Dim' },
  { value: 'mono', label: 'Mono' },
  { value: 'talkback', label: 'Talkback' },
  { value: 'speakerB', label: 'Speaker B' },
  { value: 'external', label: 'External input' },
  { value: 'globalMute', label: 'Global Mute' },
  { value: 'globalSolo', label: 'Global Solo' },
];

const SOURCES: readonly Choice<BankSource>[] = [
  { value: 'input', label: 'Inputs' },
  { value: 'playback', label: 'Playback' },
  { value: 'output', label: 'Outputs' },
  { value: 'playback+output', label: 'Playback, then outputs' },
];

const STYLES: readonly Choice<'' | 'full' | 'meter' | 'minimal'>[] = [
  { value: '', label: 'Full' },
  { value: 'meter', label: 'Big meter' },
  { value: 'minimal', label: 'Name only' },
];

const BUS_WORD: Readonly<Record<Bus, string>> = {
  input: 'input',
  playback: 'playback channel',
  output: 'output',
};

function outputText(o: OutputRef, mixer: MixerSummary | undefined): string {
  if (o.role === 'main') return 'Main';
  if (o.role === 'phones') return `Phones ${String(o.n)}`;
  const s = mixer?.strips.output.find((x) => x.index === o.index);
  return s ? `${s.label} · ${s.name}` : `Output ${String(o.index + 1)}`;
}

/** What a key is, in a few words: under its image and in the key settings. */
export function keyLabel(spec: KeySpec, names: Names): string {
  switch (spec.type) {
    case 'empty':
      return 'Empty';
    case 'strip':
      return `Bank ${String((spec.bank ?? 0) + 1)} · ${String(spec.n + 1)}`;
    case 'channel': {
      const s = names.mixer?.strips[spec.bus].find((x) => x.index === spec.index);
      if (s) return s.name;
      return spec.index === undefined
        ? `First ${BUS_WORD[spec.bus]}`
        : `${BUS_WORD[spec.bus]} ${String(spec.index + 1)}`;
    }
    case 'output':
      return outputText(spec.output, names.mixer);
    case 'step':
      return `${outputText(spec.output, names.mixer)} ${spec.direction === 'up' ? 'up' : 'down'}`;
    case 'preset':
      return `${outputText(spec.output, names.mixer)} preset ${String(spec.n)}`;
    case 'snapshot':
      return `Snapshot ${String(spec.n)}`;
    case 'toggle':
      return TOGGLES.find((t) => t.value === spec.function)?.label ?? spec.function;
    case 'status':
      return 'Status';
    case 'bank':
      return `Bank ${String((spec.bank ?? 0) + 1)} ${spec.direction === 'prev' ? 'back' : 'on'}`;
    case 'page':
      if (spec.to !== undefined)
        return `To ${names.pages[spec.to] ?? `page ${String(spec.to + 1)}`}`;
      return spec.direction === 'prev' ? 'Previous page' : 'Next page';
    case 'console':
      return 'Open Console';
    case 'exit':
      return 'Exit Console';
    case 'detail':
      return 'Channel Detail';
  }
}

// --- the list of keys to add --------------------------------------------------------------

interface PaletteItem {
  readonly label: string;
  readonly spec: KeySpec;
}

function paletteGroups(
  mixer: MixerSummary | undefined,
  banks: number,
  pages: readonly string[],
): readonly { readonly title: string; readonly items: readonly PaletteItem[] }[] {
  const outputs: OutputRef[] = [
    { role: 'main' },
    ...([1, 2, 3, 4] as const).map((n) => ({ role: 'phones', n }) as const),
  ];
  const strips = (bus: Bus): PaletteItem[] =>
    (mixer?.strips[bus] ?? []).map((s) => ({
      label: `${s.label} · ${s.name}`,
      spec: { type: 'channel', bus, index: s.index },
    }));
  const bankCount = Math.max(1, banks + 1);
  return [
    {
      title: 'Bank channels',
      items: Array.from({ length: bankCount }, (_, b) => ({
        label: b < banks ? `Next channel of bank ${String(b + 1)}` : `Channel of a new bank`,
        spec: { type: 'strip', n: 0, bank: b },
      })),
    },
    {
      title: 'Outputs',
      items: outputs.flatMap((output) => [
        { label: outputText(output, mixer), spec: { type: 'output', output } },
      ]),
    },
    {
      title: 'Volume',
      items: outputs.slice(0, 3).flatMap((output): PaletteItem[] => [
        {
          label: `${outputText(output, mixer)} down`,
          spec: { type: 'step', output, direction: 'down' },
        },
        {
          label: `${outputText(output, mixer)} up`,
          spec: { type: 'step', output, direction: 'up' },
        },
        { label: `${outputText(output, mixer)} preset 1`, spec: { type: 'preset', output, n: 1 } },
      ]),
    },
    {
      title: 'Snapshots',
      items: Array.from({ length: 8 }, (_, i) => ({
        label: `Snapshot ${String(i + 1)}`,
        spec: { type: 'snapshot', n: i + 1 },
      })),
    },
    {
      title: 'Monitor',
      items: TOGGLES.map((t) => ({ label: t.label, spec: { type: 'toggle', function: t.value } })),
    },
    {
      title: 'Navigation',
      items: [
        ...Array.from({ length: Math.max(1, banks) }, (_, b): PaletteItem[] => [
          { label: `Bank ${String(b + 1)} on`, spec: { type: 'bank', direction: 'next', bank: b } },
          {
            label: `Bank ${String(b + 1)} back`,
            spec: { type: 'bank', direction: 'prev', bank: b },
          },
        ]).flat(),
        { label: 'Next page', spec: { type: 'page', direction: 'next' } },
        { label: 'Previous page', spec: { type: 'page', direction: 'prev' } },
        ...pages.map((name, to): PaletteItem => ({
          label: `To ${name}`,
          spec: { type: 'page', to },
        })),
        { label: 'Status', spec: { type: 'status' } },
        { label: 'Exit Console', spec: { type: 'exit' } },
        { label: 'Empty', spec: EMPTY_KEY },
      ],
    },
    { title: 'Inputs', items: strips('input') },
    { title: 'Playback', items: strips('playback') },
    { title: 'Output channels', items: strips('output') },
  ];
}

function Palette(props: {
  readonly mixer: MixerSummary | undefined;
  readonly banks: number;
  readonly pages: readonly string[];
  readonly onPick: (spec: KeySpec) => void;
}): JSX.Element {
  const [filter, setFilter] = useState('');
  const f = filter.trim().toLowerCase();
  return (
    <aside class="card palette" aria-label="Keys to add">
      <TextInput value={filter} label="Find a key" placeholder="Find a key…" onChange={setFilter} />
      <div class="palette-list">
        {paletteGroups(props.mixer, props.banks, props.pages).map((g) => {
          const items = g.items.filter((i) => f === '' || i.label.toLowerCase().includes(f));
          if (items.length === 0) return null;
          return (
            <section key={g.title} class="palette-group">
              <h3>{g.title}</h3>
              {items.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  class="chip"
                  draggable
                  title="Drag onto a key, or click to put it on the selected key"
                  onDragStart={(e) => {
                    e.dataTransfer?.setData(DRAG_KEY, JSON.stringify(item.spec));
                    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={() => {
                    props.onPick(item.spec);
                  }}
                >
                  {item.label}
                </button>
              ))}
            </section>
          );
        })}
      </div>
    </aside>
  );
}

// --- the selected key's settings ----------------------------------------------------------

const outputValue = (o: OutputRef): string =>
  o.role === 'main' ? 'main' : o.role === 'phones' ? `phones${String(o.n)}` : String(o.index);

function outputRef(v: string): OutputRef {
  if (v === 'main') return { role: 'main' };
  const phones = /^phones([1-4])$/.exec(v);
  if (phones) return { role: 'phones', n: Number(phones[1]) as 1 | 2 | 3 | 4 };
  return { role: 'output', index: Number(v) };
}

function outputChoices(mixer: MixerSummary | undefined): Choice<string>[] {
  return [
    { value: 'main', label: 'Main' },
    ...[1, 2, 3, 4].map((n) => ({ value: `phones${String(n)}`, label: `Phones ${String(n)}` })),
    ...(mixer?.strips.output ?? []).map((s) => ({
      value: String(s.index),
      label: `${s.label} · ${s.name}`,
    })),
  ];
}

const numbers = (count: number, word: string): Choice<string>[] =>
  Array.from({ length: count }, (_, i) => ({
    value: String(i),
    label: `${word} ${String(i + 1)}`,
  }));

function KeySettings(props: {
  readonly spec: KeySpec;
  readonly names: Names;
  readonly banks: number;
  readonly onChange: (spec: KeySpec) => void;
}): JSX.Element {
  const { spec, names, onChange } = props;
  const mixer = names.mixer;
  const title = <p class="key-what">{keyLabel(spec, names)}</p>;
  const bankChoices = numbers(Math.max(1, props.banks) + 1, 'Bank').map((c, i) =>
    i >= props.banks ? { ...c, label: `${c.label} (new)` } : c,
  );
  switch (spec.type) {
    case 'strip':
      return (
        <div class="form">
          {title}
          <Field label="Bank" help="The keys of a bank move together, by its Bank keys.">
            <Select
              value={String(spec.bank ?? 0)}
              choices={bankChoices}
              label="Bank"
              onChange={(b) => {
                onChange({ ...spec, bank: Number(b) });
              }}
            />
          </Field>
          <StyleField spec={spec} onChange={onChange} />
        </div>
      );
    case 'channel': {
      const strips = mixer?.strips[spec.bus] ?? [];
      return (
        <div class="form">
          {title}
          <Field label="Row">
            <Select
              value={spec.bus}
              choices={[
                { value: 'input', label: 'Inputs' },
                { value: 'playback', label: 'Playback' },
                { value: 'output', label: 'Outputs' },
              ]}
              label="Row"
              onChange={(bus) => {
                onChange({
                  type: 'channel',
                  bus: bus,
                  ...(spec.style ? { style: spec.style } : {}),
                });
              }}
            />
          </Field>
          <Field label="Channel" help="Always this channel, wherever the banks are.">
            <Select
              value={spec.index === undefined ? '' : String(spec.index)}
              choices={[
                { value: '', label: 'First channel' },
                ...strips.map((s) => ({ value: String(s.index), label: `${s.label} · ${s.name}` })),
              ]}
              label="Channel"
              onChange={(v) => {
                const rest = omit(spec, 'index');
                onChange(v === '' ? rest : { ...rest, index: Number(v) });
              }}
            />
          </Field>
          <StyleField spec={spec} onChange={onChange} />
        </div>
      );
    }
    case 'output':
    case 'step':
    case 'preset':
      return (
        <div class="form">
          {title}
          <Field label="Output">
            <Select
              value={outputValue(spec.output)}
              choices={outputChoices(mixer)}
              label="Output"
              onChange={(v) => {
                onChange({ ...spec, output: outputRef(v) });
              }}
            />
          </Field>
          {spec.type === 'step' && (
            <Field label="Direction" help="0.5 dB a tap; held, it repeats and speeds up.">
              <Select
                value={spec.direction}
                choices={[
                  { value: 'up', label: 'Up' },
                  { value: 'down', label: 'Down' },
                ]}
                label="Direction"
                onChange={(direction) => {
                  onChange({ ...spec, direction });
                }}
              />
            </Field>
          )}
          {spec.type === 'preset' && (
            <Field label="Preset" help="Its level is set on the Device & Channels page.">
              <Select
                value={String(spec.n - 1)}
                choices={numbers(8, 'Preset')}
                label="Preset"
                onChange={(n) => {
                  onChange({ ...spec, n: Number(n) + 1 });
                }}
              />
            </Field>
          )}
        </div>
      );
    case 'snapshot':
      return (
        <div class="form">
          {title}
          <Field label="Snapshot">
            <Select
              value={String(spec.n - 1)}
              choices={numbers(8, 'Snapshot')}
              label="Snapshot"
              onChange={(n) => {
                onChange({ ...spec, n: Number(n) + 1 });
              }}
            />
          </Field>
        </div>
      );
    case 'toggle':
      return (
        <div class="form">
          {title}
          <Field label="Switch">
            <Select
              value={spec.function}
              choices={TOGGLES}
              label="Switch"
              onChange={(fn) => {
                onChange({ ...spec, function: fn });
              }}
            />
          </Field>
        </div>
      );
    case 'bank':
      return (
        <div class="form">
          {title}
          <Field label="Bank">
            <Select
              value={String(spec.bank ?? 0)}
              choices={numbers(Math.max(1, props.banks), 'Bank')}
              label="Bank"
              onChange={(b) => {
                onChange({ ...spec, bank: Number(b) });
              }}
            />
          </Field>
          <Field label="Direction" help="A long press switches the bank to its next source.">
            <Select
              value={spec.direction}
              choices={[
                { value: 'next', label: 'On' },
                { value: 'prev', label: 'Back' },
              ]}
              label="Direction"
              onChange={(direction) => {
                onChange({ ...spec, direction });
              }}
            />
          </Field>
        </div>
      );
    case 'page':
      return (
        <div class="form">
          {title}
          <Field label="Goes to" help="A long press goes to the first page.">
            <Select
              value={spec.to === undefined ? (spec.direction ?? 'next') : String(spec.to)}
              choices={[
                { value: 'next', label: 'The next page' },
                { value: 'prev', label: 'The previous page' },
                ...names.pages.map((name, i) => ({ value: String(i), label: name })),
              ]}
              label="Goes to"
              onChange={(v) => {
                onChange(
                  v === 'next' || v === 'prev'
                    ? { type: 'page', direction: v }
                    : { type: 'page', to: Number(v) },
                );
              }}
            />
          </Field>
        </div>
      );
    default:
      return (
        <div class="form">
          {title}
          <p class="muted">{KEY_HELP[spec.type] ?? 'Nothing to set.'}</p>
        </div>
      );
  }
}

const KEY_HELP: Readonly<Partial<Record<KeySpec['type'], string>>> = {
  empty: 'Drag a key here from the list, or pick one there.',
  status:
    'The connection to TotalMix. A tap opens the Control Center, a hold reads the mixer again.',
  exit: 'Goes back to the profile the deck showed before the Console.',
  console: 'Opens the Console profile.',
};

function StyleField(props: {
  readonly spec: Extract<KeySpec, { type: 'strip' | 'channel' }>;
  readonly onChange: (spec: KeySpec) => void;
}): JSX.Element {
  const { spec } = props;
  return (
    <Field label="Style">
      <Select
        value={spec.style === undefined || spec.style === 'full' ? '' : spec.style}
        choices={STYLES}
        label="Style"
        onChange={(style) => {
          // Omit loses which kind of key it is: it is still the same kind.
          props.onChange((style === '' ? omit(spec, 'style') : { ...spec, style }) as KeySpec);
        }}
      />
    </Field>
  );
}

// --- templates ----------------------------------------------------------------------------

function Templates(props: {
  readonly templates: readonly LayoutTemplate[];
  readonly isDefault: boolean;
  readonly onUse: (t: LayoutTemplate) => void;
}): JSX.Element {
  return (
    <Card title="Templates" id="templates" wide>
      <p class="muted note first">
        A template replaces the whole layout in the draft; Discard brings yours back. Studio Console
        is the layout the Console starts with.
      </p>
      <ul class="templates">
        {props.templates.map((t) => (
          <li key={t.id} data-template={t.id}>
            <div>
              <strong>{t.name}</strong>
              <span class="muted">
                {' '}
                · {t.layout.pages.length} {t.layout.pages.length === 1 ? 'page' : 'pages'}
              </span>
              <p class="muted">{t.description}</p>
            </div>
            <Button
              onClick={() => {
                props.onUse(t);
              }}
              disabled={t.id === 'console' && props.isDefault}
            >
              Use {t.name}
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** The layout in an imported file: a layout export, a bare layout, or a settings backup. */
function layoutOf(file: unknown): unknown {
  if (typeof file !== 'object' || file === null) return undefined;
  const o = file as Record<string, unknown>;
  if (Array.isArray(o.pages)) return o;
  if (typeof o.layout === 'object' && o.layout !== null) return o.layout;
  return undefined;
}
