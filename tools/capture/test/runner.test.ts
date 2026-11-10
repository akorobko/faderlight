import { afterEach, describe, expect, it } from 'vitest';
import { baseline } from '../scripts/baseline.ts';
import { scripts } from '../scripts/index.ts';
import { ScriptedIo } from '../src/io.ts';
import { Recorder } from '../src/recorder.ts';
import { MemorySink, type CaptureRecord, type StepRecord, type TxRecord } from '../src/records.ts';
import { NoReply, QuitRequested, Runner, sameValue, type RunnerOptions } from '../src/runner.ts';
import { DEFAULT_VARS, f, listen, manual, msg, toggle, write, type Script } from '../src/steps.ts';
import { FakeTotalMix, type FakeOptions } from './fake-totalmix.ts';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

const OPTS: RunnerOptions = {
  vars: DEFAULT_VARS,
  timeScale: 0.05,
  writes: true,
  manual: true,
  yes: true,
};

async function setup(
  fakeOptions: Partial<FakeOptions> | null = {},
  io = new ScriptedIo([], false),
  opts: Partial<RunnerOptions> = {},
): Promise<{
  rec: Recorder;
  sink: MemorySink;
  runner: Runner;
  fake: FakeTotalMix | undefined;
  io: ScriptedIo;
}> {
  let fake: FakeTotalMix | undefined;
  if (fakeOptions) {
    fake = new FakeTotalMix({ feedbackPort: 9, levelMs: 20, heartbeatMs: 200, ...fakeOptions });
    await fake.start();
  }
  const sink = new MemorySink();
  const rec = new Recorder({
    host: '127.0.0.1',
    sendPort: fake?.port ?? 9, // 9 = discard: nothing answers
    listenPort: 0,
    meters: 'thin',
    meterPattern: /^\/level\//,
    maxBytes: Infinity,
    tickMs: 1000,
    sink,
  });
  await rec.start();
  if (fake) fake.feedbackPort = rec.port;
  const runner = new Runner(rec, io, { ...OPTS, ...opts });
  cleanups.push(async () => {
    runner.dispose();
    await rec.stop();
    await fake?.stop();
  });
  return { rec, sink, runner, fake, io };
}

const steps = (records: CaptureRecord[], phase: 'begin' | 'end'): StepRecord[] =>
  records.filter((r): r is StepRecord => r.k === 'step' && r.phase === phase);
const sent = (records: CaptureRecord[]): string[] =>
  records.filter((r): r is TxRecord => r.k === 'tx').flatMap((r) => r.msgs.map((m) => m.a));

describe('baseline script', () => {
  it('has unique step ids and a question for every step', () => {
    const ids = baseline.steps.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of baseline.steps) expect(s.why, s.id).toBeTruthy();
    expect(scripts.baseline).toBe(baseline);
  });

  it('runs end to end without prompts and leaves TotalMix as it was', async () => {
    const { rec, sink, runner, fake } = await setup();
    const before = new Map(fake?.state);
    const { device } = await runner.preflight();
    expect(device).toBe('Fake UFX');
    await runner.run(baseline);

    const ends = steps(sink.records, 'end');
    expect(ends.map((s) => s.id)).toEqual(['preflight', ...baseline.steps.map((s) => s.id)]);
    const result = (id: string): string | undefined => ends.find((s) => s.id === id)?.result;
    expect(result('sendall-2')).toBe('replied');
    expect(result('sendmix')).toBe('no reply');
    expect(result('ui-mute')).toBe('skipped: manual steps off');
    expect(result('write-mute-float')).toBe('changed; restored');
    expect(result('write-mute-same')).toBe('same value echoed; restored');
    expect(result('write-send-fader')).toBe('changed; restored');
    expect(result('write-name')).toBe('changed; restored');
    expect(result('write-dim')).toBe('echoed; restored');
    expect(runner.unconfirmedRestores).toEqual([]);

    expect(sent(sink.records)).toContain('/sendall');
    expect(sent(sink.records)).toContain('/sendchan/input/8');
    expect(fake?.state).toEqual(before);
    expect(rec.values.get('/input/8/name')?.args).toEqual([['s', 'Mic 9']]);
  }, 30_000);

  it('reports a write that TotalMix ignores, and still restores', async () => {
    const { sink, runner } = await setup({ floatOnly: true });
    await runner.preflight();
    const script: Script = {
      id: 't',
      title: 't',
      intro: [],
      steps: [
        baseline.steps.find((s) => s.id === 'sendchan-input') ??
          listen({ id: 'x', title: 'x', ms: 1 }),
        write({
          id: 'w',
          title: 'int mute',
          address: '/input/{in}/mute',
          change: toggle('i'),
          verify: msg('/sendchan/input/{in}', f(1)),
        }),
      ],
    };
    await runner.run(script);
    expect(steps(sink.records, 'end').at(-1)?.result).toBe(
      'not changed (TotalMix reports f:0); restored',
    );
  }, 10_000);
});

describe('Runner', () => {
  it('records what TotalMix sends while the person works through a manual step', async () => {
    const io = new ScriptedIo(['']);
    const { sink, runner, fake } = await setup({}, io);
    io.beforeAnswer = async () => {
      fake?.gui('/input/8/mute', [['f', 1]]); // a click in the TotalMix window
      await new Promise((r) => setTimeout(r, 50));
    };
    await runner.preflight();
    await runner.run({
      id: 't',
      title: 't',
      intro: [],
      steps: [manual({ id: 'm', title: 'Mute {inName}', text: ['Click mute on {inName}.'] })],
    });
    expect(io.output).toContain('  Click mute on input channel 9.');
    expect(io.output).toContain('    <- /input/8/mute f:1');
    expect(steps(sink.records, 'end').at(-1)).toMatchObject({ id: 'm', result: 'done' });
  });

  it('stops on "q" in a manual step', async () => {
    const io = new ScriptedIo(['q']);
    const { runner } = await setup({}, io);
    await expect(
      runner.run({
        id: 't',
        title: 't',
        intro: [],
        steps: [manual({ id: 'm', title: 'M', text: ['x'] })],
      }),
    ).rejects.toBeInstanceOf(QuitRequested);
  });

  it('asks once before the first write step and skips writes when declined', async () => {
    const io = new ScriptedIo(['n']);
    const { sink, runner } = await setup({}, io, { yes: false });
    await runner.preflight();
    const w = (id: string): Script['steps'][number] =>
      write({ id, title: id, address: '/controlroom/dim', change: toggle('f') });
    await runner.run({ id: 't', title: 't', intro: [], steps: [w('a'), w('b')] });
    expect(io.output.filter((l) => l.startsWith('? '))).toHaveLength(1);
    expect(steps(sink.records, 'end').map((s) => s.result)).toEqual([
      'ok',
      'skipped: writes off',
      'skipped: writes off',
    ]);
    expect(sent(sink.records)).not.toContain('/controlroom/dim');
  });

  it('puts a changed value back when interrupted mid-write', async () => {
    const { runner, fake } = await setup({}, new ScriptedIo([], false), { timeScale: 1 });
    await runner.preflight();
    const run = runner.run({
      id: 't',
      title: 't',
      intro: [],
      steps: [
        write({
          id: 'w',
          title: 'dim',
          address: '/controlroom/dim',
          change: toggle('f'),
          holdMs: 5000,
        }),
      ],
    });
    await new Promise((r) => setTimeout(r, 300));
    expect(fake?.state.get('/controlroom/dim')).toEqual([['f', 1]]);
    await runner.abort('test');
    await run;
    await new Promise((r) => setTimeout(r, 100));
    expect(fake?.state.get('/controlroom/dim')).toEqual([['f', 0]]);
    expect(runner.unconfirmedRestores[0]).toMatch(
      /\/controlroom\/dim: restore to f:0 sent after interruption/,
    );
  }, 10_000);

  it('gives up with NoReply when nothing answers and nobody can fix the settings', async () => {
    const { runner } = await setup(null);
    await expect(runner.preflight()).rejects.toBeInstanceOf(NoReply);
  });
});

describe('sameValue', () => {
  it('compares numbers loosely, strings exactly and T/F as 1/0', () => {
    expect(sameValue([['f', -12.004]], [['f', -12]])).toBe(true);
    expect(sameValue([['f', -11]], [['f', -12]])).toBe(false);
    expect(sameValue([['T']], [['f', 1]])).toBe(true);
    expect(sameValue([['s', 'A']], [['s', 'a']])).toBe(false);
    expect(sameValue([], [])).toBe(true);
  });
});
