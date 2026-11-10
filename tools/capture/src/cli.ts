// Command-line entry point: node tools/capture/src/cli.ts <command> [options]
// Runs straight from source on Node 24 (built-in type stripping); no install or build needed.

import { mkdirSync, renameSync } from 'node:fs';
import { release } from 'node:os';
import { join, relative } from 'node:path';
import { parseArgs, type ParseArgsOptionsConfig } from 'node:util';
import { scripts } from '../scripts/index.ts';
import { ConsoleIo, type Io } from './io.ts';
import { formatMessage, parseMessage, type OscMessage } from './osc.ts';
import { capturesDir, fixtureName, localDate, uniquePath } from './paths.ts';
import { Recorder } from './recorder.ts';
import {
  FileSink,
  FORMAT_VERSION,
  NullSink,
  type EndRecord,
  type MeterMode,
  type RecordSink,
} from './records.ts';
import { NoReply, QuitRequested, Runner } from './runner.ts';
import { setupChecklist } from './setup.ts';
import { DEFAULT_VARS, listen, request, type Script, type Vars } from './steps.ts';
import { formatSummary, summariseFile, summaryToJson } from './summary.ts';

const TOOL = '@faderlight/capture';
const TOOL_VERSION = '0.1.0';

const HELP = `Faderlight capture tool: records TotalMix FX Global OSC traffic to JSON Lines.

Usage: node tools/capture/src/cli.ts <command> [options]

Commands:
  check            Check that TotalMix sends OSC to this computer (writes nothing).
  run              Guided capture (script "baseline", about 5 minutes) into fixtures/captures/.
  listen           Record without a script until Ctrl+C or --duration.
  summary <file>   Summarise a capture file (--json for machine-readable output).
  scripts          List the capture scripts and their steps.

Connection (must match TotalMix Options > Settings > OSC):
  --host <ip>          computer running TotalMix (default 127.0.0.1)
  --send-port <n>      TotalMix "Port incoming" (default 7002)
  --listen-port <n>    TotalMix "Port outgoing" (default 9002)

run:
  --script <id>        capture script (default baseline)
  --input <n>          test input, 0-based (default 8 = Mic 9 on a UFX III)
  --output <n>         test output, 0-based (default 0 = AN 1/2)
  --playback <n>       test playback channel, 0-based (default 0)
  --phones <n>         phones output, 0-based (default 8 = PH 9/10 on a UFX III)
  --tmfx <version>     TotalMix FX version for the file name (asked if omitted)
  --skip-writes        never change anything in TotalMix
  --skip-manual        skip the steps where you click in TotalMix
  --yes                run the write steps without asking
  --no-prompts         never ask (implies --skip-manual; writes only with --yes)

run and listen:
  --out <file>         output file (default fixtures/captures/<device>-<version>-<date>.jsonl)
  --meters <mode>      thin (default): count meter datagrams and keep one value per meter per
                       second, full: keep every meter datagram, off: count only
  --max-mb <n>         stop writing meter datagrams once the file is this big (default 45)
  --time-scale <x>     multiply every wait (default 1)

listen:
  --duration <s>       stop after this many seconds (default: Ctrl+C)
  --send "<message>"   send first, e.g. --send "/sendchan/input/8 f:1" (repeatable;
                       f: float, i: int, s: string, T/F; a bare number is a float)

summary:
  --json               print the summary as JSON
`;

const options = {
  host: { type: 'string', default: '127.0.0.1' },
  'send-port': { type: 'string', default: '7002' },
  'listen-port': { type: 'string', default: '9002' },
  script: { type: 'string', default: 'baseline' },
  input: { type: 'string', default: String(DEFAULT_VARS.in) },
  output: { type: 'string', default: String(DEFAULT_VARS.out) },
  playback: { type: 'string', default: String(DEFAULT_VARS.pb) },
  phones: { type: 'string', default: String(DEFAULT_VARS.ph) },
  tmfx: { type: 'string' },
  'skip-writes': { type: 'boolean', default: false },
  'skip-manual': { type: 'boolean', default: false },
  yes: { type: 'boolean', short: 'y', default: false },
  'no-prompts': { type: 'boolean', default: false },
  out: { type: 'string' },
  meters: { type: 'string', default: 'thin' },
  'max-mb': { type: 'string', default: '45' },
  'time-scale': { type: 'string', default: '1' },
  duration: { type: 'string' },
  send: { type: 'string', multiple: true, default: [] as string[] },
  json: { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false },
} satisfies ParseArgsOptionsConfig;

type Values = ReturnType<
  typeof parseArgs<{ options: typeof options; allowPositionals: true }>
>['values'];

class UsageError extends Error {}

function int(values: Values, name: keyof Values, min: number, max: number): number {
  const raw = values[name];
  const n = Number(raw);
  if (typeof raw !== 'string' || !Number.isInteger(n) || n < min || n > max) {
    throw new UsageError(`--${name} must be an integer from ${String(min)} to ${String(max)}`);
  }
  return n;
}

function num(values: Values, name: keyof Values, min: number): number {
  const raw = values[name];
  const n = Number(raw);
  if (typeof raw !== 'string' || !Number.isFinite(n) || n < min) {
    throw new UsageError(`--${name} must be a number >= ${String(min)}`);
  }
  return n;
}

interface Connection {
  readonly host: string;
  readonly sendPort: number;
  readonly listenPort: number;
}

function connection(values: Values): Connection {
  return {
    host: values.host,
    sendPort: int(values, 'send-port', 1, 65535),
    listenPort: int(values, 'listen-port', 0, 65535),
  };
}

function meterMode(values: Values): MeterMode {
  const m = values.meters;
  if (m !== 'thin' && m !== 'full' && m !== 'off')
    throw new UsageError('--meters must be thin, full or off');
  return m;
}

function vars(values: Values): Vars {
  return {
    in: int(values, 'input', 0, 1023),
    out: int(values, 'output', 0, 1023),
    pb: int(values, 'playback', 0, 1023),
    ph: int(values, 'phones', 0, 1023),
  };
}

const show = (path: string): string => {
  const r = relative(process.cwd(), path);
  return r.startsWith('..') ? path : r;
};

// --- check ----------------------------------------------------------------------------

async function check(values: Values, io: Io): Promise<number> {
  const conn = connection(values);
  const rec = new Recorder({
    ...conn,
    meters: 'thin',
    meterPattern: /^\/level\//,
    maxBytes: Infinity,
    tickMs: 1000,
    sink: new NullSink(),
  });
  await rec.start();
  io.print(
    `Listening on ${rec.bindAddress}:${String(rec.port)}, sending to ${conn.host}:${String(conn.sendPort)}.`,
  );
  const sources = new Set<string>();
  const unsolicited = new Set<string>();
  const replies = new Set<string>();
  let sent = false;
  let meters = 0;
  rec.onRx((e) => {
    sources.add(e.from);
    if (e.meterOnly) meters++;
    for (const m of e.messages) {
      if (m.address.startsWith('/level/')) continue;
      (sent ? replies : unsolicited).add(m.address);
    }
  });

  await new Promise((r) => setTimeout(r, 2000));
  sent = true;
  await rec.send({ address: '/sendstate', args: [['f', 1]] });
  await new Promise((r) => setTimeout(r, 3000));
  await rec.stop();

  const got = rec.stats.datagrams;
  if (got === 0) {
    io.warn('Nothing arrived.');
    for (const line of setupChecklist(conn)) io.print('  ' + line);
    return 1;
  }
  io.ok(
    `Received ${String(got)} datagrams (${String(rec.stats.messages)} messages) from ${[...sources].join(', ')}.`,
  );
  const device = rec.values.get('/status/device')?.args[0];
  io.print(`  device: ${device?.[0] === 's' ? device[1] : 'not reported (yet)'}`);
  io.print(
    `  unprompted in the first 2 s: ${[...unsolicited].slice(0, 8).join(', ') || 'nothing'}${unsolicited.size > 8 ? ', ...' : ''}`,
  );
  io.print(
    `  meter datagrams: ${String(meters)}${meters === 0 ? ' (turn on "Send Level Data" to record meters)' : ''}`,
  );
  io.print(`  reply to /sendstate: ${String(replies.size)} addresses`);
  const classic = [...rec.values.keys()].find((a) => /^\/\d+\//.test(a));
  if (classic !== undefined) {
    io.warn(
      `TotalMix is in classic OSC mode (${classic}). Set Compatibility (Mode) to Global OSC.`,
    );
    return 1;
  }
  io.ok('Ready: run the capture with `node tools/capture/src/cli.ts run`.');
  return 0;
}

// --- run / listen -----------------------------------------------------------------------

interface Session {
  readonly command: 'run' | 'listen';
  readonly script: Script;
  readonly tmfx: string;
  readonly settingsOk: boolean | null;
  readonly userNote: string;
}

async function record(values: Values, io: Io, session: Session): Promise<number> {
  const conn = connection(values);
  const meters = meterMode(values);
  const maxBytes = num(values, 'max-mb', 1) * 1e6;
  const timeScale = num(values, 'time-scale', 0.001);
  const v = vars(values);
  const fixedOut = values.out;
  mkdirSync(capturesDir, { recursive: true });
  const workPath = fixedOut ?? join(capturesDir, `.capture-${String(Date.now())}.partial.jsonl`);
  let sink: RecordSink;
  try {
    sink = new FileSink(workPath);
  } catch (err) {
    io.warn(`Cannot write ${workPath}: ${String(err)}`);
    return 1;
  }
  const rec = new Recorder({
    ...conn,
    meters,
    meterPattern: /^\/level\//,
    maxBytes,
    tickMs: 1000,
    sink,
  });
  rec.write({
    k: 'meta',
    t: 0,
    format: FORMAT_VERSION,
    tool: TOOL,
    toolVersion: TOOL_VERSION,
    command: session.command,
    ...(session.command === 'run' ? { script: session.script.id } : {}),
    startedAt: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    osRelease: release(),
    host: conn.host,
    sendPort: conn.sendPort,
    listenPort: conn.listenPort,
    bindAddress: rec.bindAddress,
    meters,
    maxBytes,
    vars: { ...v },
    tmfxVersion: session.tmfx,
    settingsAsDocumented: session.settingsOk,
    userNote: session.userNote,
  });
  try {
    await rec.start();
  } catch (err) {
    io.warn(err instanceof Error ? err.message : String(err));
    await rec.closeSink();
    return 1;
  }
  io.print(
    `Recording: listening on ${rec.bindAddress}:${String(rec.port)}, sending to ${conn.host}:${String(conn.sendPort)}.`,
  );
  io.dim('Ctrl+C stops the capture; anything a write step changed is put back first.');

  const runner = new Runner(rec, io, {
    vars: v,
    timeScale,
    writes: !values['skip-writes'],
    manual: !values['skip-manual'],
    yes: values.yes,
  });

  let finishing: Promise<number> | undefined;
  const finish = (reason: EndRecord['reason'], stoppedByUser = false): Promise<number> => {
    finishing ??= (async () => {
      if (reason !== 'done') await runner.abort(reason === 'error' ? 'error' : 'stopped');
      else if (stoppedByUser) await runner.abort('stopped with Ctrl+C');
      runner.dispose();
      await rec.stop();
      const deviceArg = rec.values.get('/status/device')?.args[0];
      const device =
        deviceArg?.[0] === 's' && deviceArg[1].trim() !== '' ? deviceArg[1] : undefined;
      rec.write({
        k: 'end',
        t: rec.now(),
        reason,
        totals: {
          rxDatagrams: rec.stats.datagrams,
          rxMessages: rec.stats.messages,
          rxBytes: rec.stats.bytes,
          txMessages: rec.stats.tx,
          meterThinned: rec.stats.thinned,
          meterDroppedOverCap: rec.stats.droppedOverCap,
          bytesWritten: sink.bytes,
        },
        ...(device === undefined ? {} : { device }),
        ...(runner.unconfirmedRestores.length > 0
          ? { unconfirmedRestores: runner.unconfirmedRestores }
          : {}),
      });
      await rec.closeSink();
      let finalPath = workPath;
      if (fixedOut === undefined) {
        const suffix =
          (session.command === 'listen' ? '-listen' : '') + (reason === 'done' ? '' : `-${reason}`);
        finalPath = uniquePath(
          capturesDir,
          fixtureName(device ?? 'unknown-device', session.tmfx, localDate(new Date()), suffix),
        );
        renameSync(workPath, finalPath);
      }
      const summary = await summariseFile(finalPath);
      const lines = formatSummary(summary, show(finalPath));
      const cut = lines.indexOf('');
      const stepsEnd = lines.indexOf('', cut + 1);
      io.heading('Summary');
      for (const l of lines.slice(0, stepsEnd === -1 ? undefined : stepsEnd)) io.print(l);
      if (runner.unconfirmedRestores.length > 0) {
        io.warn(
          '\nPlease check these values in TotalMix, the capture could not confirm they were put back:',
        );
        for (const u of runner.unconfirmedRestores) io.warn(`  ${u}`);
      }
      io.heading(`Saved ${show(finalPath)}`);
      io.print(`Full summary: node tools/capture/src/cli.ts summary ${show(finalPath)}`);
      io.print(
        'To hand it over, commit the file on a branch and push it (tools/capture/README.md, "Hand it over").',
      );
      return reason === 'done' ? 0 : reason === 'interrupted' ? 130 : 1;
    })();
    return finishing;
  };

  let interrupts = 0;
  const interrupted = new Promise<'interrupted'>((resolve) => {
    io.onInterrupt(() => {
      interrupts++;
      if (interrupts > 1) process.exit(130);
      io.warn('\nStopping (Ctrl+C again to quit immediately)...');
      resolve('interrupted');
    });
  });

  const work = (async (): Promise<EndRecord['reason']> => {
    try {
      if (session.command === 'run') {
        const { device } = await runner.preflight();
        io.ok(`TotalMix is talking${device === undefined ? '' : ` (${device})`}.`);
        for (const line of session.script.intro) io.print(runner.expand(line));
      }
      await runner.run(session.script);
      return 'done';
    } catch (err) {
      if (err instanceof QuitRequested) return 'interrupted';
      if (err instanceof NoReply) return 'error';
      io.warn(`Error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
      rec.note('warn', `error: ${String(err)}`);
      return 'error';
    }
  })();

  const reason = await Promise.race([work, interrupted]);
  const listenStoppedByUser = session.command === 'listen' && reason === 'interrupted';
  return finish(listenStoppedByUser ? 'done' : reason, listenStoppedByUser);
}

async function run(values: Values, io: Io): Promise<number> {
  const script = scripts[values.script];
  if (!script)
    throw new UsageError(
      `unknown script "${values.script}" (try: ${Object.keys(scripts).join(', ')})`,
    );
  const conn = connection(values);
  io.heading(`Faderlight capture: ${script.title}`);
  io.print('Before you start, set up a TotalMix OSC remote like this:');
  for (const line of setupChecklist(conn)) io.print('  ' + line);
  io.print();
  const tmfx =
    values.tmfx ?? (await io.ask('TotalMix FX version (Help > About), e.g. 2.10:', 'unknown'));
  let settingsOk: boolean | null = null;
  let userNote = '';
  if (io.interactive) {
    settingsOk = await io.confirm('Is TotalMix set up as listed above?', true);
    if (!settingsOk)
      userNote = await io.ask('What is different? (one line, recorded in the file)', '');
  }
  return record(values, io, { command: 'run', script, tmfx, settingsOk, userNote });
}

async function listenCommand(values: Values, io: Io): Promise<number> {
  let sends: OscMessage[];
  try {
    sends = values.send.map(parseMessage);
  } catch (err) {
    throw new UsageError(err instanceof Error ? err.message : String(err));
  }
  const seconds = values.duration === undefined ? 24 * 3600 : num(values, 'duration', 0.1);
  const steps = [
    listen({ id: 'idle', title: 'Listen before sending', ms: 1000, background: true }),
    ...(sends.length > 0
      ? [request({ id: 'send', title: `Send ${sends.map(formatMessage).join(', ')}`, send: sends })]
      : []),
    listen({
      id: 'listen',
      title:
        values.duration === undefined ? 'Listen until Ctrl+C' : `Listen for ${String(seconds)} s`,
      ms: seconds * 1000,
    }),
  ];
  const script: Script = { id: 'listen', title: 'Listen', intro: [], steps };
  return record(values, io, {
    command: 'listen',
    script,
    tmfx: values.tmfx ?? 'unknown',
    settingsOk: null,
    userNote: '',
  });
}

async function summaryCommand(
  values: Values,
  positionals: readonly string[],
  io: Io,
): Promise<number> {
  const file = positionals[1];
  if (file === undefined) throw new UsageError('summary needs a capture file');
  const s = await summariseFile(file);
  if (values.json) io.print(JSON.stringify(summaryToJson(s), null, 2));
  else for (const line of formatSummary(s, show(file))) io.print(line);
  return 0;
}

function listScripts(io: Io): number {
  for (const script of Object.values(scripts)) {
    io.heading(`${script.id}: ${script.title}`);
    for (const step of script.steps) {
      io.print(`  ${step.id.padEnd(22)} ${step.kind.padEnd(8)} ${step.title}`);
      if (step.why !== undefined) io.dim(`  ${''.padEnd(31)} ${step.why}`);
    }
  }
  return 0;
}

export async function main(argv: readonly string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({ args: [...argv], options, allowPositionals: true, strict: true });
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n\n${HELP}`);
    return 2;
  }
  const { values, positionals } = parsed;
  const command = positionals[0];
  if (values.help || command === undefined || command === 'help') {
    process.stdout.write(HELP);
    return command === undefined && !values.help ? 2 : 0;
  }
  const io = new ConsoleIo({ prompts: !values['no-prompts'] });
  try {
    switch (command) {
      case 'check':
        return await check(values, io);
      case 'run':
        if (values['no-prompts']) values['skip-manual'] = true;
        return await run(values, io);
      case 'listen':
        return await listenCommand(values, io);
      case 'summary':
        return await summaryCommand(values, positionals, io);
      case 'scripts':
        return listScripts(io);
      default:
        throw new UsageError(`unknown command "${command}"`);
    }
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`${err.message}\n\nRun with --help for usage.\n`);
      return 2;
    }
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  } finally {
    io.close();
  }
}

if (process.argv[1] !== undefined && import.meta.filename === process.argv[1]) {
  void main(process.argv.slice(2)).then((code) => {
    // Let Node exit on its own so buffered stdout reaches a pipe in full (pipe writes are
    // asynchronous on macOS; process.exit() would cut `summary --json | ...` at 64 KiB).
    // The unref'd timer only fires if some handle is still holding the process open.
    process.exitCode = code;
    setTimeout(() => process.exit(code), 3000).unref();
  });
}
