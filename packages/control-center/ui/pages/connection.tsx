// Connection (docs/design/03-ux.md §5.2): where TotalMix is, the Setup Assistant that checks
// TotalMix's OSC settings against what arrives, the packet log, and the mixer state as the
// plugin holds it.

import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ConnectionSettings } from '@faderlight/deck';
import type { PacketEntry } from '../../src/diagnostics.ts';
import { decodeNumber, type Notifications, type StoreEntryJson } from '../../src/protocol.ts';
import type { SetupCheck } from '../../src/setup.ts';
import type { PageProps } from '../app.tsx';
import {
  Button,
  Card,
  Check,
  Dot,
  Field,
  NumberInput,
  Page,
  TextInput,
  type DotState,
} from '../components.tsx';
import { clockTime, formatAgo, formatValue } from '../format.ts';
import { useLive, useTopic } from '../live.ts';
import type { Rpc } from '../rpc.ts';

export function ConnectionPage(props: PageProps): JSX.Element {
  const state = useLive(props.settings.state);
  const connection = useTopic(props.rpc, 'connection');
  if (!state) return <></>;
  const c = state.draft.connection;
  const edit = (change: Partial<ConnectionSettings>): void => {
    props.settings.edit((d) => ({ ...d, connection: { ...d.connection, ...change } }));
  };
  const report = connection?.report;
  return (
    <Page
      title="Connection"
      intro="Where TotalMix FX runs, and whether it talks to the plugin. The Setup Assistant checks TotalMix's OSC settings by what actually arrives."
    >
      <div class="grid">
        <Card
          title="TotalMix FX"
          actions={
            <Button
              onClick={() => void props.rpc.call('mixer.resync')}
              disabled={report?.link !== 'live'}
              title="Ask TotalMix for everything again"
            >
              Read the mixer again
            </Button>
          }
        >
          <div class="form">
            <Field
              label="Computer running TotalMix"
              help="127.0.0.1 when TotalMix runs on this computer."
            >
              <TextInput
                value={c.host}
                label="Computer running TotalMix"
                mono
                onChange={(host) => {
                  edit({ host });
                }}
              />
            </Field>
            <Field label="Port incoming" help="TotalMix's Port incoming: the plugin sends here.">
              <NumberInput
                value={c.sendPort}
                min={1}
                max={65535}
                label="Port incoming"
                onChange={(sendPort) => {
                  edit({ sendPort });
                }}
              />
            </Field>
            <Field label="Port outgoing" help="TotalMix's Port outgoing: the plugin listens here.">
              <NumberInput
                value={c.listenPort}
                min={0}
                max={65535}
                label="Port outgoing"
                onChange={(listenPort) => {
                  edit({ listenPort });
                }}
              />
            </Field>
          </div>
          {report && (
            <dl class="facts">
              <dt>Sends to</dt>
              <dd class="mono">
                {report.host}:{report.sendPort}
              </dd>
              <dt>Listens on</dt>
              <dd class="mono">{report.localPort ?? report.listenPort}</dd>
              <dt>TotalMix sends from</dt>
              <dd class="mono">{report.source ?? '–'}</dd>
              <dt>Received</dt>
              <dd>
                {report.rx.datagrams} datagrams, {report.rx.messages} messages
                {report.rx.lastAgoMs !== undefined && `, last ${formatAgo(report.rx.lastAgoMs)}`}
              </dd>
              <dt>Sent</dt>
              <dd>{report.tx.datagrams} datagrams</dd>
              <dt>Mixer values</dt>
              <dd>{report.values}</dd>
              {report.unknown + report.decodeErrors + report.dropped > 0 && (
                <>
                  <dt>Not understood</dt>
                  <dd>
                    {report.unknown} unknown, {report.decodeErrors} not OSC, {report.dropped} from
                    another computer
                  </dd>
                </>
              )}
            </dl>
          )}
        </Card>
        <SetupAssistant checks={connection?.checks} />
      </div>
      <PacketLog rpc={props.rpc} />
      <MixerState rpc={props.rpc} />
    </Page>
  );
}

/** An entry's arguments, with the serial number only when asked for. */
const argsText = (e: PacketEntry, serials: boolean): string =>
  serials ? (e.unmasked ?? e.args) : e.args;

const CHECK_DOT: Readonly<Record<SetupCheck['state'], DotState>> = {
  ok: 'ok',
  fail: 'fail',
  wait: 'busy',
  info: 'info',
};

function SetupAssistant(props: {
  readonly checks: readonly SetupCheck[] | undefined;
}): JSX.Element {
  return (
    <Card title="Setup Assistant" id="setup">
      {props.checks === undefined ? (
        <p class="muted">Checking…</p>
      ) : (
        <ol class="checks">
          {props.checks.map((check) => (
            <li key={check.id} class={`check-${check.state}`} data-check={check.id}>
              <Dot state={CHECK_DOT[check.state]} label={check.state} />
              <div>
                <div class="check-title">{check.title}</div>
                <div class="check-detail">{check.detail}</div>
                {check.hint && check.state !== 'ok' && (
                  <ul class="hint">
                    {check.hint.map((h) => (
                      <li key={h}>{h}</li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

const MAX_ROWS = 500;

function PacketLog(props: { readonly rpc: Rpc }): JSX.Element {
  const [entries, setEntries] = useState<readonly PacketEntry[]>([]);
  const [meters, setMeters] = useState(false);
  const [filter, setFilter] = useState('');
  const [showIn, setShowIn] = useState(true);
  const [showOut, setShowOut] = useState(true);
  // Off on every visit and never saved, so screenshots of the log stay without serial numbers.
  const [serials, setSerials] = useState(false);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(
    () =>
      props.rpc.on('packets', (p: Notifications['packets']) => {
        setMeters(p.meters);
        if (pausedRef.current && !p.reset) return;
        setEntries((old) => (p.reset ? p.entries : [...old, ...p.entries].slice(-MAX_ROWS)));
      }),
    [props.rpc],
  );

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return entries.filter(
      (e) =>
        (e.dir === 'in' ? showIn : showOut) &&
        (f === '' || `${e.address} ${argsText(e, serials)}`.toLowerCase().includes(f)),
    );
  }, [entries, filter, showIn, showOut, serials]);

  // Follow the newest message unless the reader scrolled up.
  useEffect(() => {
    const el = scroller.current;
    if (el && !paused && el.scrollHeight - el.scrollTop - el.clientHeight < 80) {
      el.scrollTop = el.scrollHeight;
    }
  }, [shown, paused]);

  return (
    <Card
      title="Packet log"
      id="packets"
      wide
      actions={
        <>
          <Button
            onClick={() => {
              setPaused(!paused);
            }}
          >
            {paused ? 'Resume' : 'Pause'}
          </Button>
          <Button onClick={() => void props.rpc.call('packets.clear')}>Clear</Button>
        </>
      }
    >
      <div class="toolbar">
        <TextInput
          value={filter}
          onChange={setFilter}
          placeholder="Filter, e.g. /input/8"
          label="Filter"
        />
        <Check checked={showIn} onChange={setShowIn}>
          From TotalMix
        </Check>
        <Check checked={showOut} onChange={setShowOut}>
          To TotalMix
        </Check>
        <Check
          checked={meters}
          onChange={(on) => {
            setMeters(on);
            void props.rpc.call('packets.meters', { on });
          }}
        >
          Meters
        </Check>
        <Check
          checked={serials}
          onChange={setSerials}
          title="Show the interface's serial number, which tells two of the same model apart. Off again on the next visit."
        >
          Serial numbers
        </Check>
        <span class="muted count">
          {shown.length} of the last {entries.length} messages
        </span>
      </div>
      <div class="log" ref={scroller} role="log" aria-live="off">
        <table>
          <tbody>
            {shown.map((e) => (
              <tr key={e.n} class={e.dir}>
                <td class="time">{clockTime(e.at)}</td>
                <td class="dir" title={e.dir === 'in' ? 'from TotalMix' : 'to TotalMix'}>
                  {e.dir === 'in' ? '←' : '→'}
                </td>
                <td class="address">{e.address}</td>
                <td class="args">{argsText(e, serials)}</td>
                <td class="note">{e.note ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <p class="muted empty">No messages yet.</p>}
      </div>
    </Card>
  );
}

function MixerState(props: { readonly rpc: Rpc }): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <Card
      title="Mixer state"
      id="state"
      wide
      actions={
        <Button
          onClick={() => {
            setOpen(!open);
          }}
        >
          {open ? 'Hide' : 'Show'}
        </Button>
      }
    >
      {open ? (
        <StoreTable rpc={props.rpc} />
      ) : (
        <p class="muted">Every value the plugin holds, as TotalMix reported it, live.</p>
      )}
    </Card>
  );
}

function StoreTable(props: { readonly rpc: Rpc }): JSX.Element {
  const [entries, setEntries] = useState<ReadonlyMap<string, StoreEntryJson>>(new Map());
  const [filter, setFilter] = useState('');
  useEffect(
    () =>
      props.rpc.on('store', (p: Notifications['store']) => {
        setEntries((old) => {
          const next = new Map(p.reset ? [] : old);
          for (const e of p.set) next.set(e.key, e);
          for (const k of p.removed) next.delete(k);
          return next;
        });
      }),
    [props.rpc],
  );
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return [...entries.values()]
      .filter((e) => f === '' || e.key.toLowerCase().includes(f))
      .sort((a, b) => a.key.localeCompare(b.key, 'en', { numeric: true }));
  }, [entries, filter]);
  return (
    <>
      <div class="toolbar">
        <TextInput
          value={filter}
          onChange={setFilter}
          placeholder="Filter, e.g. channel/input/8"
          label="Filter"
        />
        <span class="muted count">
          {shown.length} of {entries.size} values
        </span>
      </div>
      <div class="log tall">
        <table>
          <tbody>
            {shown.map((e) => (
              <tr key={e.key} class={e.state}>
                <td class="address">{e.key}</td>
                <td class="args">{formatValue(decodeNumber(e.value))}</td>
                <td class="note">{e.state === 'pending' ? 'pending' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
