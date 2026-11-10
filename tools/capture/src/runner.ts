// Executes a capture script against a Recorder: one recorded step per script step.

import { setTimeout } from 'node:timers/promises';
import type { Io } from './io.ts';
import { argNumber, formatMessage, type OscArg, type OscMessage } from './osc.ts';
import type { Recorder, RxEvent } from './recorder.ts';
import { troubleshooting } from './setup.ts';
import type {
  ListenStep,
  ManualStep,
  RequestStep,
  Script,
  Step,
  Vars,
  WriteStep,
} from './steps.ts';

export interface RunnerOptions {
  readonly vars: Vars;
  /** Multiplies every wait (tests and dry runs use < 1). */
  readonly timeScale: number;
  /** Allow write steps at all (--skip-writes turns this off). */
  readonly writes: boolean;
  /** Run manual steps (--skip-manual turns this off). */
  readonly manual: boolean;
  /** Approve write steps without asking. */
  readonly yes: boolean;
}

export class QuitRequested extends Error {
  constructor() {
    super('quit requested');
    this.name = 'QuitRequested';
  }
}

export class NoReply extends Error {
  constructor() {
    super('TotalMix did not send anything');
    this.name = 'NoReply';
  }
}

interface StepOutcome {
  readonly result: string;
  readonly detail?: Record<string, unknown>;
}

interface PendingRestore {
  readonly address: string;
  readonly args: readonly OscArg[];
}

const BUS = { in: 'input', out: 'output', pb: 'playback', ph: 'output' } as const;
const MAX_LIVE_LINES = 12;
/** Unprompted addresses arriving faster than this (per second) are treated as meters. */
const HIGH_RATE_HZ = 5;

const delay = (ms: number, signal?: AbortSignal): Promise<void> =>
  setTimeout(ms, undefined, signal ? { signal } : {}).then(
    () => undefined,
    () => undefined, // aborted
  );

/** Same value as far as a capture is concerned: equal strings, or numbers within 0.01. */
export function sameValue(a: readonly OscArg[], b: readonly OscArg[]): boolean {
  const x = a[0];
  const y = b[0];
  if (x === undefined || y === undefined) return x === y;
  if ((x[0] === 's' || x[0] === 'S') && (y[0] === 's' || y[0] === 'S')) return x[1] === y[1];
  const nx = argNumber(x);
  const ny = argNumber(y);
  if (nx === undefined || ny === undefined) return false;
  if (nx === ny) return true;
  return Math.abs(nx - ny) <= Math.max(0.01, Math.abs(ny) * 1e-4);
}

const showArgs = (args: readonly OscArg[] | undefined): string =>
  args === undefined ? 'nothing' : formatMessage({ address: '', args }).trim() || '(no args)';

export class Runner {
  readonly unconfirmedRestores: string[] = [];

  private readonly rec: Recorder;
  private readonly io: Io;
  private readonly opts: RunnerOptions;
  private readonly background = new Set<string>();
  /** Per-address message counts while collecting background traffic. */
  private backgroundCounts = new Map<string, number>();
  private collectingBackground = false;
  private lastInteresting = -Infinity;
  private pending: PendingRestore[] = [];
  private writesApproved: boolean | undefined;
  private live: { seen: Set<string>; more: number } | undefined;
  private script: Script | undefined;
  private aborted = false;
  private readonly abortController = new AbortController();
  private readonly unsubscribe: () => void;

  constructor(rec: Recorder, io: Io, opts: RunnerOptions) {
    this.rec = rec;
    this.io = io;
    this.opts = opts;
    this.unsubscribe = rec.onRx((e) => {
      this.onRx(e);
    });
  }

  dispose(): void {
    this.unsubscribe();
  }

  /** Replaces {in}, {outName}, ... in step text and addresses. */
  expand(text: string): string {
    return text.replace(/\{(in|out|pb|ph)(Name)?\}/g, (_m, key: keyof Vars, name?: string) => {
      const n = this.opts.vars[key];
      if (name === undefined) return String(n);
      const value = this.rec.values.get(`/${BUS[key]}/${String(n)}/name`)?.args[0];
      if (value?.[0] === 's' && value[1].trim() !== '') return value[1];
      return `${BUS[key]} channel ${String(n + 1)}`;
    });
  }

  expandMessage(m: OscMessage): OscMessage {
    return { address: this.expand(m.address), args: m.args };
  }

  /** Waits until TotalMix sends something; asks to fix the settings and retry if it does not. */
  async preflight(): Promise<{ device: string | undefined }> {
    for (let attempt = 1; ; attempt++) {
      const id = attempt === 1 ? 'preflight' : `preflight-${String(attempt)}`;
      this.rec.beginStep(id, 'preflight', 'Wait for TotalMix', {
        why: 'Does TotalMix send anything on its own, and does it answer /sendstate?',
        sends: ['/sendstate f:1'],
      });
      const before = this.rec.stats.datagrams;
      const unprompted = await this.waitFor(() => this.rec.stats.datagrams > before, 2500);
      // Keep listening briefly: addresses seen before /sendstate is sent are not replies to it.
      if (unprompted) await this.sleep(1000);
      const seen = new Set(this.rec.values.keys());
      for (const a of seen) this.background.add(a);
      const sentAt = this.rec.now();
      await this.rec.send({ address: '/sendstate', args: [['f', 1]] });
      const answered = await this.waitFor(
        () => [...this.rec.values].some(([a, v]) => v.t >= sentAt && !seen.has(a)),
        4000,
      );
      if (answered) await this.waitQuiet(sentAt, 600, 4000);
      const anything = unprompted || this.rec.stats.datagrams > before;
      if (answered) {
        this.rec.endStep('ok');
        break;
      }
      if (anything) {
        this.rec.endStep('no answer to /sendstate');
        this.io.warn(
          'TotalMix sends to this computer but did not answer /sendstate. Check that TotalMix ' +
            `"Port incoming" is ${String(this.rec.options.sendPort)} (--send-port) and the mode is Global OSC.`,
        );
        if (!(await this.io.confirm('Continue anyway?', false))) throw new QuitRequested();
        break;
      }
      this.rec.endStep('no reply');
      for (const line of troubleshooting) this.io.warn(line);
      if (!this.io.interactive) throw new NoReply();
      if (!(await this.io.confirm('Fix the settings, then try again?', true)))
        throw new QuitRequested();
    }
    const classic = [...this.rec.values.keys()].find((a) => /^\/\d+\//.test(a));
    if (classic !== undefined) {
      this.io.warn(
        `TotalMix answers in classic OSC (for example ${classic}). Set Compatibility (Mode) to Global OSC.`,
      );
      this.rec.note('warn', 'classic OSC addresses received', { example: classic });
      if (!(await this.io.confirm('Continue anyway?', false))) throw new QuitRequested();
    }
    const device = this.rec.values.get('/status/device')?.args[0];
    return { device: device?.[0] === 's' ? device[1] : undefined };
  }

  async run(script: Script): Promise<void> {
    this.script = script;
    const total = script.steps.length;
    for (const [n, step] of script.steps.entries()) {
      if (this.aborted) return;
      const optional = step.kind === 'manual' && step.optional === true ? ' (optional)' : '';
      this.io.heading(`[${String(n + 1)}/${String(total)}] ${this.expand(step.title)}${optional}`);
      await this.runStep(step);
    }
  }

  /** Restores every value a write step changed and closes the current step (Ctrl+C, errors). */
  async abort(reason: string): Promise<void> {
    if (this.aborted) return;
    this.aborted = true;
    this.abortController.abort();
    this.live = undefined;
    for (const p of [...this.pending].reverse()) {
      try {
        await this.rec.send({ address: p.address, args: p.args });
        this.unconfirmedRestores.push(
          `${p.address}: restore to ${showArgs(p.args)} sent after interruption, not verified`,
        );
        this.io.warn(`Restored ${p.address} to ${showArgs(p.args)} (please check it in TotalMix).`);
      } catch (err) {
        this.unconfirmedRestores.push(`${p.address}: restore to ${showArgs(p.args)} FAILED`);
        this.io.warn(`Could not restore ${p.address}: ${String(err)}`);
      }
    }
    this.pending = [];
    if (this.rec.currentStep !== undefined) this.rec.endStep(`interrupted: ${reason}`);
  }

  private async runStep(step: Step): Promise<void> {
    const sends =
      step.kind === 'request'
        ? step.send.map((m) => formatMessage(this.expandMessage(m)))
        : step.kind === 'write'
          ? [this.expand(step.address)]
          : [];
    this.rec.beginStep(step.id, step.kind, this.expand(step.title), {
      ...(step.why === undefined ? {} : { why: step.why }),
      sends,
    });
    if (step.meters === 'full') this.rec.setFullMeters(true);
    let outcome: StepOutcome;
    try {
      switch (step.kind) {
        case 'listen':
          outcome = await this.runListen(step);
          break;
        case 'request':
          outcome = await this.runRequest(step);
          break;
        case 'manual':
          outcome = await this.runManual(step);
          break;
        case 'write':
          outcome = await this.runWrite(step);
          break;
      }
    } finally {
      this.rec.setFullMeters(false);
    }
    if (this.aborted) return;
    const stats = this.rec.endStep(outcome.result, outcome.detail);
    const messages = stats.rxMessages - stats.meterMessages;
    const reply =
      messages === 0
        ? 'no messages apart from meters'
        : `${String(messages)} messages, ${String(stats.addresses)} addresses` +
          (stats.firstRxMs === null
            ? ''
            : `, first after ${String(Math.round(stats.firstRxMs))} ms`);
    this.io.dim(`  ${outcome.result} (${reply}, ${(stats.ms / 1000).toFixed(1)} s)`);
  }

  private async runListen(step: ListenStep): Promise<StepOutcome> {
    if (step.background !== true) {
      await this.sleep(step.ms);
      return { result: 'done' };
    }
    this.collectingBackground = true;
    this.backgroundCounts = new Map();
    const start = this.rec.now();
    try {
      await this.sleep(step.ms);
    } finally {
      this.collectingBackground = false;
    }
    // Unprompted traffic faster than HIGH_RATE_HZ is treated like meters, so a meter address
    // that does not match the meter pattern cannot flood the capture file.
    const seconds = Math.max(0.001, (this.rec.now() - start) / 1000);
    const highRate = [...this.backgroundCounts]
      .filter(([, n]) => n / seconds > HIGH_RATE_HZ)
      .map(([a]) => a)
      .sort();
    if (highRate.length > 0) {
      this.rec.addMeterAddresses(highRate);
      this.rec.note('info', 'high-rate addresses are recorded like meters from now on', {
        addresses: highRate,
      });
    }
    return {
      result: 'done',
      detail: { background: [...this.background].sort(), highRate },
    };
  }

  private async runRequest(step: RequestStep): Promise<StepOutcome> {
    const start = this.rec.now();
    for (const [n, m] of step.send.entries()) {
      if (n > 0 && (step.spacingMs ?? 0) > 0) await this.sleep(step.spacingMs ?? 0);
      await this.rec.send(this.expandMessage(m));
    }
    const replied = await this.waitQuiet(start, step.settleMs ?? 1200, step.maxMs ?? 8000);
    return { result: replied ? 'replied' : 'no reply' };
  }

  private async runManual(step: ManualStep): Promise<StepOutcome> {
    if (!this.opts.manual || !this.io.interactive) {
      return { result: 'skipped: manual steps off' };
    }
    for (const line of step.text) this.io.print('  ' + this.expand(line));
    this.live = { seen: new Set(), more: 0 };
    const answer = await this.io.waitForEnter(
      step.optional === true
        ? 'Press Enter when done, s to skip, q to quit:'
        : 'Press Enter when done (s to skip, q to quit):',
    );
    if (answer === 'done') await this.sleep(400);
    const seen = this.live.seen.size + this.live.more;
    this.live = undefined;
    if (answer === 'quit') throw new QuitRequested();
    if (answer === 'done' && seen === 0) {
      this.io.warn('  TotalMix sent nothing new during this step (heartbeats and meters aside).');
    }
    return { result: answer === 'done' ? 'done' : 'skipped by user' };
  }

  private async approveWrites(): Promise<boolean> {
    if (this.writesApproved !== undefined) return this.writesApproved;
    if (!this.opts.writes) {
      this.writesApproved = false;
    } else if (this.opts.yes) {
      this.writesApproved = true;
    } else if (!this.io.interactive) {
      this.writesApproved = false;
      this.rec.note('info', 'write steps skipped: no prompts and no --yes');
    } else {
      const writes = (this.script?.steps ?? []).filter((s): s is WriteStep => s.kind === 'write');
      this.io.print('  The next steps change a value for about a second, then put it back:');
      for (const w of writes) this.io.print(`    - ${this.expand(w.title)}`);
      this.io.print('  Do not run them while recording or performing.');
      this.writesApproved = await this.io.confirm('  Run the write tests?', true);
    }
    this.rec.note('info', `write steps ${this.writesApproved ? 'approved' : 'not approved'}`);
    return this.writesApproved;
  }

  private async runWrite(step: WriteStep): Promise<StepOutcome> {
    if (!(await this.approveWrites())) return { result: 'skipped: writes off' };
    const address = this.expand(step.address);
    const verify = step.verify ? this.expandMessage(step.verify) : undefined;
    if (!this.rec.values.has(address) && verify) await this.sendAndWait(verify);
    const current = this.rec.values.get(address)?.args;
    const change = step.change(current);
    if (typeof change === 'string') return { result: `skipped: ${change}`, detail: { address } };
    if (current === undefined) {
      return { result: 'skipped: no current value to restore', detail: { address } };
    }

    this.pending.push({ address, args: current });
    const tWrite = this.rec.now();
    await this.rec.send({ address, args: change });
    await this.sleep(step.holdMs ?? 800);
    const echo = this.valueSince(address, tWrite);
    let afterWrite: readonly OscArg[] | undefined;
    if (verify) afterWrite = await this.sendAndWait(verify, address);
    if (this.aborted) return { result: 'interrupted' };

    const tRestore = this.rec.now();
    await this.rec.send({ address, args: current });
    await this.waitQuiet(tRestore, 600, 3000);
    let afterRestore = this.valueSince(address, tRestore);
    if (verify) afterRestore = (await this.sendAndWait(verify, address)) ?? afterRestore;
    this.pending.pop();

    const evidence = afterWrite ?? echo;
    const noOp = sameValue(change, current);
    const changed =
      evidence === undefined
        ? 'no reply for the address'
        : !sameValue(evidence, change)
          ? `not changed (TotalMix reports ${showArgs(evidence)})`
          : noOp
            ? `same value ${echo ? 'echoed' : 'not echoed'}`
            : afterWrite
              ? 'changed'
              : 'echoed';
    const restored = afterRestore !== undefined && sameValue(afterRestore, current);
    if (!restored) {
      const msg =
        `${address}: should be ${showArgs(current)}, ` +
        (afterRestore === undefined
          ? 'no confirmation received'
          : `TotalMix reports ${showArgs(afterRestore)}`);
      this.unconfirmedRestores.push(msg);
      this.io.warn(`  Restore not confirmed: ${msg}. Please check it in TotalMix.`);
    }
    return {
      result: `${changed}; ${restored ? 'restored' : 'restore NOT confirmed'}`,
      detail: {
        address,
        from: showArgs(current),
        to: showArgs(change),
        echo: echo === undefined ? null : showArgs(echo),
        afterWrite: afterWrite === undefined ? null : showArgs(afterWrite),
        afterRestore: afterRestore === undefined ? null : showArgs(afterRestore),
      },
    };
  }

  /** Sends a request, waits for the replies, returns the value of `address` if it was reported. */
  private async sendAndWait(
    m: OscMessage,
    address?: string,
  ): Promise<readonly OscArg[] | undefined> {
    const t = this.rec.now();
    await this.rec.send(m);
    await this.waitQuiet(t, 500, 4000);
    return address === undefined ? undefined : this.valueSince(address, t);
  }

  private valueSince(address: string, t: number): readonly OscArg[] | undefined {
    const v = this.rec.values.get(address);
    return v !== undefined && v.t >= t ? v.args : undefined;
  }

  private onRx(e: RxEvent): void {
    if (e.meterOnly) return;
    if (this.collectingBackground) {
      for (const m of e.messages) {
        this.background.add(m.address);
        this.backgroundCounts.set(m.address, (this.backgroundCounts.get(m.address) ?? 0) + 1);
      }
      return;
    }
    if (e.messages.some((m) => !this.background.has(m.address))) this.lastInteresting = e.t;
    const live = this.live;
    if (live) {
      for (const m of e.messages) {
        if (this.background.has(m.address) || live.seen.has(m.address)) continue;
        if (live.seen.size < MAX_LIVE_LINES) {
          live.seen.add(m.address);
          this.io.dim(`    <- ${formatMessage(m)}`);
        } else {
          live.more++;
        }
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return delay(ms * this.opts.timeScale, this.abortController.signal);
  }

  private async waitFor(condition: () => boolean, maxMs: number): Promise<boolean> {
    const end = this.rec.now() + maxMs * this.opts.timeScale;
    while (!condition()) {
      if (this.aborted || this.rec.now() >= end) return false;
      await delay(20);
    }
    return true;
  }

  /**
   * Waits until no new (non-background, non-meter) traffic arrived for `settleMs`, at most
   * `maxMs`. Returns whether anything new arrived after `start`.
   */
  private async waitQuiet(start: number, settleMs: number, maxMs: number): Promise<boolean> {
    const k = this.opts.timeScale;
    const minMs = 200 * k;
    for (;;) {
      const now = this.rec.now();
      const replied = this.lastInteresting >= start;
      if (this.aborted || now - start >= maxMs * k) return replied;
      const since = Math.max(start, this.lastInteresting);
      if (now - start >= minMs && now - since >= settleMs * k) return replied;
      await delay(20);
    }
  }
}
