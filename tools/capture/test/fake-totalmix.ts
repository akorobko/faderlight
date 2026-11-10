// A tiny stand-in for TotalMix FX on Global OSC, for testing the capture tool without
// hardware. It is NOT the simulator (packages/simulator, M2): the addresses and replies
// here are guesses from public references and only exercise the tool's code paths.
//
// Standalone: node tools/capture/test/fake-totalmix.ts [--port-in 7002] [--port-out 9002]

import { createSocket, type Socket } from 'node:dgram';
import { parseArgs } from 'node:util';
import {
  argNumber,
  decodePacket,
  encodeBundle,
  encodeMessage,
  flatten,
  IMMEDIATE,
  type OscArg,
  type OscMessage,
} from '../src/osc.ts';

export interface FakeOptions {
  /** Port we receive commands on (TotalMix "Port incoming"); 0 = any free port. */
  readonly portIn?: number;
  readonly feedbackHost?: string;
  /** Port we send feedback to (TotalMix "Port outgoing"). */
  readonly feedbackPort: number;
  readonly heartbeatMs?: number;
  /** Interval of level bundles; 0 disables meters. */
  readonly levelMs?: number;
  /** Ignore int32 arguments in writes (to exercise "not changed" results). */
  readonly floatOnly?: boolean;
  readonly channels?: number;
}

const BUNDLE_SIZE = 32;

export class FakeTotalMix {
  readonly received: OscMessage[] = [];
  readonly state = new Map<string, OscArg[]>();
  /** Where feedback goes; may be changed after start (tests bind the recorder second). */
  feedbackPort: number;
  private readonly options: FakeOptions;
  private socket: Socket | undefined;
  private timers: NodeJS.Timeout[] = [];
  private boundPort = 0;
  private stopped = false;

  constructor(options: FakeOptions) {
    this.options = options;
    this.feedbackPort = options.feedbackPort;
    const n = options.channels ?? 24;
    const set = (a: string, ...args: OscArg[]): void => {
      this.state.set(a, args);
    };
    set('/status/device', ['s', 'Fake UFX']);
    set('/status/connection', ['f', 1]);
    set('/status/dsp', ['f', 12]);
    for (let c = 0; c < n; c++) {
      const inName =
        c < 8 ? `AN ${String(c + 1)}` : c < 12 ? `Mic ${String(c + 1)}` : `ADAT ${String(c - 11)}`;
      set(`/input/${String(c)}/name`, ['s', inName]);
      set(`/input/${String(c)}/mute`, ['f', 0]);
      set(`/input/${String(c)}/pfl`, ['f', 0]);
      set(`/input/${String(c)}/stereo`, ['f', 0]);
      if (c >= 8 && c < 12) {
        set(`/input/${String(c)}/gain`, ['f', 30]);
        set(`/input/${String(c)}/48v`, ['f', 0]);
      }
      set(`/playback/${String(c)}/name`, ['s', `Play ${String(c + 1)}`]);
      set(`/playback/${String(c)}/mute`, ['f', 0]);
      set(`/output/${String(c)}/name`, [
        's',
        c < 8 ? `AN ${String(c + 1)}` : `PH ${String(c + 1)}`,
      ]);
      set(`/output/${String(c)}/volume`, ['f', c === 0 ? -12 : 0]);
      set(`/output/${String(c)}/mute`, ['f', 0]);
      for (let o = 0; o < 4; o++) {
        set(`/mix/in/${String(c)}/${String(o)}/fader`, ['f', -65]);
        set(`/mix/pb/${String(c)}/${String(o)}/fader`, ['f', c === o ? 0 : -65]);
      }
    }
    set('/controlroom/dim', ['f', 0]);
    set('/controlroom/mainmono', ['f', 0]);
    for (let k = 1; k <= 8; k++) set(`/snapshot/load/${String(k)}`, ['f', k === 1 ? 2 : 0]);
  }

  get port(): number {
    return this.boundPort;
  }

  async start(): Promise<void> {
    const socket = createSocket('udp4');
    this.socket = socket;
    socket.on('message', (buf) => {
      this.onCommand(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
    });
    await new Promise<void>((resolve) => {
      socket.bind(this.options.portIn ?? 0, '127.0.0.1', resolve);
    });
    this.boundPort = socket.address().port;
    const hb = this.options.heartbeatMs ?? 500;
    if (hb > 0) {
      this.timers.push(
        setInterval(() => {
          this.sendBundle([{ address: '/status/connection', args: [['f', 1]] }]);
        }, hb),
      );
    }
    const lv = this.options.levelMs ?? 50;
    if (lv > 0) {
      let frame = 0;
      this.timers.push(
        setInterval(() => {
          frame++;
          const n = this.options.channels ?? 24;
          const msgs: OscMessage[] = [];
          for (let c = 0; c < n; c++) {
            msgs.push({
              address: `/level/in/${String(c)}`,
              args: [['f', c === 8 ? -20 - (frame % 10) : -90]],
            });
          }
          this.sendBundle(msgs);
        }, lv),
      );
    }
    for (const t of this.timers) t.unref();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    const socket = this.socket;
    this.socket = undefined;
    if (socket) {
      await new Promise<void>((resolve) => {
        socket.close(() => {
          resolve();
        });
      });
    }
  }

  /** A change made in the TotalMix window: update the state and send it ("Send changes"). */
  gui(address: string, args: OscArg[]): void {
    this.state.set(address, args);
    this.sendBundle([{ address, args }]);
  }

  private send(bytes: Uint8Array): void {
    if (this.stopped || !this.socket) return;
    this.socket.send(bytes, this.feedbackPort, this.options.feedbackHost ?? '127.0.0.1');
  }

  private sendBundle(msgs: readonly OscMessage[]): void {
    this.send(encodeBundle(IMMEDIATE, msgs.map(encodeMessage)));
  }

  private sendState(filter: (address: string) => boolean): void {
    const msgs = [...this.state]
      .filter(([a]) => filter(a))
      .map(([address, args]) => ({ address, args }));
    for (let k = 0; k < msgs.length; k += BUNDLE_SIZE)
      this.sendBundle(msgs.slice(k, k + BUNDLE_SIZE));
  }

  private onCommand(bytes: Uint8Array): void {
    let messages: OscMessage[];
    try {
      messages = flatten(decodePacket(bytes)).map((m) => m.message);
    } catch {
      return;
    }
    for (const m of messages) {
      this.received.push(m);
      this.handle(m);
    }
  }

  private handle(m: OscMessage): void {
    const a = m.address;
    if (a === '/sendstate') {
      this.sendState(
        (x) =>
          x.startsWith('/status/') || x.startsWith('/controlroom/') || x.startsWith('/snapshot/'),
      );
      return;
    }
    if (a === '/sendsettings') {
      this.sendState((x) => x.startsWith('/controlroom/'));
      return;
    }
    if (a === '/sendall') {
      const all = [...this.state];
      // Paced like a bandwidth-limited TotalMix: a bundle every 2 ms.
      let k = 0;
      const next = (): void => {
        if (k >= all.length || this.stopped) return;
        this.sendBundle(
          all.slice(k, k + BUNDLE_SIZE).map(([address, args]) => ({ address, args })),
        );
        k += BUNDLE_SIZE;
        setTimeout(next, 2);
      };
      next();
      return;
    }
    const chan = /^\/sendchan\/(input|playback|output)\/(\d+)$/.exec(a);
    if (chan) {
      const prefix = `/${chan[1] ?? ''}/${chan[2] ?? ''}/`;
      this.sendState((x) => x.startsWith(prefix));
      return;
    }
    const sub = /^\/sendsubmix\/(\d+)$/.exec(a);
    if (sub) {
      const out = sub[1] ?? '';
      this.sendState((x) => new RegExp(`^/mix/(in|pb)/\\d+/${out}/`).test(x));
      return;
    }
    const current = this.state.get(a);
    if (current === undefined || a.startsWith('/status/')) return;
    const arg = m.args[0];
    if (arg === undefined) return;
    // Re-send received: echo exactly what arrived.
    this.sendBundle([m]);
    if (this.options.floatOnly === true && arg[0] === 'i') return;
    let next: OscArg[];
    if (current[0]?.[0] === 's') {
      if (arg[0] !== 's') return;
      next = [arg];
    } else {
      const v = argNumber(arg);
      if (v === undefined) return;
      next = [['f', v]];
    }
    this.state.set(a, next);
    // Send changes.
    this.sendBundle([{ address: a, args: next }]);
  }
}

if (process.argv[1] !== undefined && import.meta.filename === process.argv[1]) {
  const { values } = parseArgs({
    options: {
      'port-in': { type: 'string', default: '7002' },
      'port-out': { type: 'string', default: '9002' },
    },
  });
  const fake = new FakeTotalMix({
    portIn: Number(values['port-in']),
    feedbackPort: Number(values['port-out']),
  });
  await fake.start();
  process.stdout.write(
    `Fake TotalMix: commands on 127.0.0.1:${String(fake.port)}, feedback to 127.0.0.1:${values['port-out']}. Ctrl+C to stop.\n`,
  );
  process.on('SIGINT', () => {
    void fake.stop().then(() => process.exit(0));
  });
}
