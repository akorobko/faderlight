// Command line: run the simulator, or replay a capture.
//
//   node packages/simulator/src/cli.ts [run] [options]
//   node packages/simulator/src/cli.ts replay <capture.jsonl> [options]
//
// While it runs, commands typed on stdin change the mixer as if in TotalMix's window, quit and
// restart it, or change faults; `help` lists them.

import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { readCapture } from './capture.ts';
import type { FaultOptions } from './faults.ts';
import { CaptureReplayer } from './replay.ts';
import {
  LAYOUTS,
  layoutMixer,
  METER_SETS,
  meterSignals,
  type LayoutName,
  type MeterSetName,
} from './scenarios.ts';
import { mixerFromCapture } from './seed.ts';
import { Simulator } from './server.ts';

export const USAGE = `Fake TotalMix FX on Global OSC (UDP).

Usage:
  node packages/simulator/src/cli.ts [run] [options]
  node packages/simulator/src/cli.ts replay <capture.jsonl> [options]

Options for run:
  --port-in <n>       TotalMix "Port incoming": where requests arrive (default 7002)
  --port-out <n>      TotalMix "Port outgoing": where feedback goes (default 9002)
  --host <address>    "Remote Controller Address": who gets feedback (default 127.0.0.1)
  --bind <address>    local address to listen on (default 127.0.0.1)
  --profile <id>      interface: ufx3 (default, the only one so far)
  --layout <name>     visible strips: ${LAYOUTS.join(', ')} (default studio)
  --state <file>      take layout and values from a capture file instead
  --meters <set>      meter signals: ${METER_SETS.join(', ')}, or off (default studio)
  --reply-delay <ms>  delay before each reply (default 8)
  --drop-in <0-1>     share of received datagrams to lose
  --drop-out <0-1>    share of sent datagrams to lose
  --latency <ms>      extra delay for every sent datagram
  --jitter <ms>       random extra delay of up to this much per datagram
  --bandwidth <B/s>   outgoing bandwidth limit, bytes per second (0 = none)
  --seed <n>          seed meters and faults, for repeatable runs

Options for replay:
  --port-out, --host  as above
  --speed <x>         playback speed (default 1)
  --no-meters         leave out meter datagrams
  --steps <a,b,...>   only the datagrams of these capture steps

  -h, --help          show this text
`;

export const COMMANDS = `Commands:
  set <address> <value>   change a value as if in TotalMix (feedback is sent), e.g. set /input/8/mute 1
  get <address>           show a value
  snapshot <k>            load snapshot k (1-8)
  quit | start | restart [ms]
                          quit TotalMix, start it, or both (with a pause in between)
  levels on|off           "Send Level Data"
  signal <in|pb|out/n> <silence|tone|noise|clip|sweep> [dB]
  faults [key=value ...]  show or change faults: dropIn, dropOut, latency, jitter, bandwidth
  speed single|double|quad
                          sample-rate range (ADAT and MADI channels change)
  status                  ports, state, traffic
  help | exit
`;

export interface RunOptions {
  readonly portIn: number;
  readonly portOut: number;
  readonly host: string;
  readonly bind: string;
  readonly profile: 'ufx3';
  readonly layout: LayoutName;
  readonly state: string | undefined;
  readonly meters: MeterSetName | 'off';
  readonly replyDelayMs: number;
  readonly faults: Partial<FaultOptions>;
  readonly seed: number | undefined;
}

export interface ReplayCliOptions {
  readonly file: string;
  readonly portOut: number;
  readonly host: string;
  readonly speed: number;
  readonly meters: boolean;
  readonly steps: readonly string[] | undefined;
}

export type Parsed =
  | { readonly command: 'help' }
  | { readonly command: 'run'; readonly options: RunOptions }
  | { readonly command: 'replay'; readonly options: ReplayCliOptions };

function number(
  name: string,
  text: string | undefined,
  fallback: number,
  min = 0,
  max = Infinity,
): number {
  if (text === undefined) return fallback;
  const n = Number(text);
  if (text.trim() === '' || !Number.isFinite(n) || n < min || n > max) {
    throw new Error(
      `--${name} must be a number from ${String(min)} to ${String(max)}, got "${text}"`,
    );
  }
  return n;
}

function port(name: string, text: string | undefined, fallback: number): number {
  const n = number(name, text, fallback, 0, 65535);
  if (!Number.isInteger(n)) throw new Error(`--${name} must be a whole number`);
  return n;
}

function oneOf<T extends string>(
  name: string,
  text: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  if (text === undefined) return fallback;
  if (!(allowed as readonly string[]).includes(text)) {
    throw new Error(`--${name} must be one of ${allowed.join(', ')}, got "${text}"`);
  }
  return text as T;
}

/** Parses the command line (without `node cli.ts`). Throws with a message on bad input. */
export function parseCommandLine(argv: readonly string[]): Parsed {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      'port-in': { type: 'string' },
      'port-out': { type: 'string' },
      host: { type: 'string' },
      bind: { type: 'string' },
      profile: { type: 'string' },
      layout: { type: 'string' },
      state: { type: 'string' },
      meters: { type: 'string' },
      'no-meters': { type: 'boolean' },
      'reply-delay': { type: 'string' },
      'drop-in': { type: 'string' },
      'drop-out': { type: 'string' },
      latency: { type: 'string' },
      jitter: { type: 'string' },
      bandwidth: { type: 'string' },
      seed: { type: 'string' },
      speed: { type: 'string' },
      steps: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help === true) return { command: 'help' };
  const [command = 'run', ...rest] = positionals;
  if (command === 'replay') {
    const [file, ...extra] = rest;
    if (file === undefined) throw new Error('replay needs a capture file');
    if (extra.length > 0) throw new Error(`unexpected arguments: ${extra.join(' ')}`);
    return {
      command: 'replay',
      options: {
        file,
        portOut: port('port-out', values['port-out'], 9002),
        host: values.host ?? '127.0.0.1',
        speed: number('speed', values.speed, 1, 0.01, 1000),
        meters: values['no-meters'] !== true,
        steps: values.steps
          ?.split(',')
          .map((s) => s.trim())
          .filter((s) => s !== ''),
      },
    };
  }
  if (command !== 'run') throw new Error(`unknown command "${command}"`);
  if (rest.length > 0) throw new Error(`unexpected arguments: ${rest.join(' ')}`);
  const seed =
    values.seed === undefined ? undefined : number('seed', values.seed, 0, 0, 2 ** 32 - 1);
  return {
    command: 'run',
    options: {
      portIn: port('port-in', values['port-in'], 7002),
      portOut: port('port-out', values['port-out'], 9002),
      host: values.host ?? '127.0.0.1',
      bind: values.bind ?? '127.0.0.1',
      profile: oneOf('profile', values.profile, ['ufx3'], 'ufx3'),
      layout: oneOf('layout', values.layout, LAYOUTS, 'studio'),
      state: values.state,
      meters:
        values['no-meters'] === true
          ? 'off'
          : oneOf('meters', values.meters, [...METER_SETS, 'off'], 'studio'),
      replyDelayMs: number('reply-delay', values['reply-delay'], 8),
      faults: {
        dropIncoming: number('drop-in', values['drop-in'], 0, 0, 1),
        dropOutgoing: number('drop-out', values['drop-out'], 0, 0, 1),
        latencyMs: number('latency', values.latency, 0),
        jitterMs: number('jitter', values.jitter, 0),
        bandwidthBytesPerSec: number('bandwidth', values.bandwidth, 0),
      },
      seed,
    },
  };
}

/** A small seeded random generator (mulberry32), for repeatable meters and faults. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createSimulator(o: RunOptions): Simulator {
  const random = o.seed === undefined ? Math.random : seededRandom(o.seed);
  const mixer =
    o.state === undefined ? layoutMixer(o.layout) : mixerFromCapture(readCapture(o.state));
  return new Simulator({
    portIn: o.portIn,
    bindAddress: o.bind,
    feedbackHost: o.host,
    feedbackPort: o.portOut,
    mixer,
    meters: o.meters === 'off' ? false : { signals: meterSignals(o.meters, mixer) },
    replyDelayMs: o.replyDelayMs,
    faults: o.faults,
    random,
  });
}

const FAULT_KEYS: Readonly<Record<string, keyof FaultOptions>> = {
  dropIn: 'dropIncoming',
  dropOut: 'dropOutgoing',
  latency: 'latencyMs',
  jitter: 'jitterMs',
  bandwidth: 'bandwidthBytesPerSec',
};

function parseValue(text: string): number | string {
  const n = Number(text);
  return text.trim() !== '' && Number.isFinite(n) ? n : text.replace(/^"(.*)"$/, '$1');
}

/** Runs one interactive command and returns what to print. */
export async function runCommand(sim: Simulator, line: string): Promise<string> {
  const [command, ...args] = line.trim().split(/\s+/);
  switch (command) {
    case undefined:
    case '':
      return '';
    case 'help':
      return COMMANDS;
    case 'set': {
      const [address, ...value] = args;
      if (address === undefined || value.length === 0) return 'usage: set <address> <value>';
      if (sim.mixer.get(address) === undefined) return `no such address: ${address}`;
      return sim.change(address, parseValue(value.join(' '))) ? 'sent' : 'unchanged';
    }
    case 'get': {
      const [address] = args;
      const v = address === undefined ? undefined : sim.mixer.get(address);
      return v === undefined
        ? `no such address: ${String(address)}`
        : `${String(address)} ${JSON.stringify(v)}`;
    }
    case 'snapshot': {
      const k = Number(args[0]);
      if (!Number.isInteger(k) || k < 1 || k > 8) return 'usage: snapshot <1-8>';
      sim.loadSnapshot(k);
      return `loaded snapshot ${String(k)}`;
    }
    case 'quit':
      await sim.quit();
      return 'quit (no traffic until start)';
    case 'start':
      await sim.start();
      return `started, feedback from port ${String(sim.sourcePort)}`;
    case 'restart':
      await sim.restart(Number(args[0] ?? 0) || 0);
      return `restarted, feedback from port ${String(sim.sourcePort)}`;
    case 'levels':
      if (args[0] !== 'on' && args[0] !== 'off') return 'usage: levels on|off';
      sim.setSendLevels(args[0] === 'on');
      return `levels ${args[0]}`;
    case 'signal': {
      const [key, type, db] = args;
      const level = db === undefined ? -18 : Number(db);
      if (key === undefined || !/^(in|pb|out)\/\d+$/.test(key) || !Number.isFinite(level)) {
        return 'usage: signal <in|pb|out/n> <silence|tone|noise|clip|sweep> [dB]';
      }
      switch (type) {
        case 'silence':
          sim.meters.setSignal(key, { type: 'silence' });
          break;
        case 'tone':
          sim.meters.setSignal(key, { type: 'tone', db: level });
          break;
        case 'noise':
          sim.meters.setSignal(key, { type: 'noise', db: level });
          break;
        case 'clip':
          sim.meters.setSignal(key, { type: 'drums', bpm: 120, peakDb: level, clipEvery: 4 });
          break;
        case 'sweep':
          sim.meters.setSignal(key, { type: 'sweep', fromDb: -60, toDb: level, periodMs: 8000 });
          break;
        default:
          return 'usage: signal <in|pb|out/n> <silence|tone|noise|clip|sweep> [dB]';
      }
      return `${key}: ${type}`;
    }
    case 'faults': {
      const update: Record<string, number> = {};
      for (const pair of args) {
        const [key = '', text] = pair.split('=');
        const name = FAULT_KEYS[key];
        const n = Number(text);
        if (name === undefined || text === undefined || !Number.isFinite(n)) {
          return `usage: faults [${Object.keys(FAULT_KEYS).join('|')}=<number> ...]`;
        }
        update[name] = n;
      }
      try {
        sim.faults.update(update);
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
      return `faults ${JSON.stringify(sim.faults.options)}; dropped ${JSON.stringify(sim.faults.stats)}`;
    }
    case 'speed': {
      const [speed] = args;
      if (speed !== 'single' && speed !== 'double' && speed !== 'quad') {
        return 'usage: speed single|double|quad';
      }
      sim.mixer.setSpeed(speed);
      return `speed ${speed}: ${String(sim.mixer.channelCount('input'))} channels per bus`;
    }
    case 'status': {
      const to = sim.feedbackTarget;
      return [
        `${sim.state}, requests on port ${String(sim.port)}`,
        `feedback from port ${String(sim.sourcePort ?? '-')} to ${to ? `${to.address}:${String(to.port)}` : '(nobody yet)'}`,
        `received ${String(sim.stats.rxMessages)} messages, sent ${String(sim.stats.txDatagrams)} datagrams (${String(sim.stats.txBytes)} bytes)`,
      ].join('\n');
    }
    default:
      return `unknown command "${command}"; type help`;
  }
}

async function main(argv: readonly string[]): Promise<number> {
  let parsed: Parsed;
  try {
    parsed = parseCommandLine(argv);
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n\n${USAGE}`);
    return 2;
  }
  if (parsed.command === 'help') {
    process.stdout.write(USAGE);
    return 0;
  }
  if (parsed.command === 'replay') {
    const o = parsed.options;
    const replay = new CaptureReplayer(readCapture(o.file), {
      host: o.host,
      port: o.portOut,
      speed: o.speed,
      meters: o.meters,
      ...(o.steps ? { steps: o.steps } : {}),
    });
    await replay.start();
    process.stdout.write(
      `replaying ${String(replay.length)} datagrams to ${o.host}:${String(o.portOut)}\n`,
    );
    await replay.done;
    await replay.stop();
    return 0;
  }

  const sim = createSimulator(parsed.options);
  try {
    await sim.start();
  } catch (e) {
    const busy = e instanceof Error && 'code' in e && e.code === 'EADDRINUSE';
    process.stderr.write(
      busy
        ? `Port ${String(parsed.options.portIn)} is in use (is TotalMix or another simulator running?)\n`
        : `${e instanceof Error ? e.message : String(e)}\n`,
    );
    return 1;
  }
  const to = sim.feedbackTarget;
  process.stdout.write(
    `Simulating ${sim.mixer.device.profile.model}: requests on ${parsed.options.bind}:${String(sim.port)}, ` +
      `feedback to ${to ? `${to.address}:${String(to.port)}` : '-'}. Type help for commands.\n`,
  );
  const rl = createInterface({ input: process.stdin, terminal: false });
  const done = new Promise<void>((resolve) => {
    const close = (): void => {
      resolve();
    };
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
    rl.on('line', (line) => {
      if (line.trim() === 'exit') {
        close();
        return;
      }
      void runCommand(sim, line).then((out) => {
        if (out !== '') process.stdout.write(`${out}\n`);
      });
    });
  });
  await done;
  rl.close();
  await sim.stop();
  return 0;
}

if (import.meta.main) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
  }
}
