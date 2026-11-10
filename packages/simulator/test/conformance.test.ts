// Conformance with real TotalMix traffic (M2.3): for every capture step that sent something,
// the simulator starts from the mixer state the capture shows at that moment, receives the same
// datagrams, and must answer with the same messages, in the same order, with the same values.
// Where the recorded reply had no meter messages mixed in and came from a single request, the
// datagram sizes must match too (TotalMix shares datagrams between meters and replies, and
// between replies to requests that arrive together, which the simulator does not copy).
//
// Every capture in fixtures/captures with a /sendall reply takes part. When a new capture
// disagrees, the simulator is wrong (or the capture shows something new): fix packages/simulator
// and docs/protocol/global-osc.md, not this test.
import { readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { decodePacket, formatMessage, messagesOf, type OscMessage } from '@faderlight/osc';
import { describe, expect, it } from 'vitest';
import {
  dumpOf,
  findStep,
  isMeter,
  MAX_DATAGRAM_BYTES,
  MAX_DATAGRAM_MESSAGES,
  mixerFromCapture,
  pack,
  readCapture,
  type Capture,
  type CaptureStep,
  type Emission,
} from '../src/index.ts';
import { BASELINE, texts } from './helpers.ts';

const capturesDir = dirname(BASELINE);
const captures = readdirSync(capturesDir)
  .filter((name) => name.endsWith('.jsonl'))
  .map((name) => ({ name, capture: readCapture(join(capturesDir, name)) }))
  .filter(({ capture }) => dumpOf(capture) !== undefined);

function simulate(capture: Capture, step: CaptureStep): { messages: string[]; sizes: number[] } {
  const mixer = mixerFromCapture(capture, step.t);
  const datagrams = step.sent
    .flatMap((d) => d.messages)
    .flatMap((m) => mixer.handle(m))
    .flatMap((e) => pack(e));
  return {
    messages: datagrams.flatMap((d) => messagesOf(decodePacket(d))).map(formatMessage),
    sizes: datagrams.map((d) => d.byteLength),
  };
}

const recorded = (step: CaptureStep): string[] =>
  step.received
    .flatMap((d) => d.messages)
    .filter((m) => !isMeter(m))
    .map(formatMessage);

it('finds the baseline capture among the captures to compare with', () => {
  expect(captures.map((c) => c.name)).toContain(basename(BASELINE));
});

describe.each(captures)('conformance with $name', ({ capture }) => {
  const requestSteps = capture.steps.filter((s) => s.sent.length > 0);

  it.each(requestSteps.map((s) => [s.id, s] as const))(
    '%s: same messages, same order, same values',
    (_id, step) => {
      expect(simulate(capture, step).messages).toEqual(recorded(step));
    },
  );

  const packable = requestSteps.filter(
    (s) =>
      s.sent.flatMap((d) => d.messages).length === 1 &&
      s.received.length > 0 &&
      s.received.every((d) => !d.messages.some(isMeter)),
  );

  it.each(packable.map((s) => [s.id, s] as const))('%s: same datagram sizes', (_id, step) => {
    expect(simulate(capture, step).sizes).toEqual(step.received.map((d) => d.raw.byteLength));
  });

  it('keeps every datagram within 16 messages and 480 bytes', () => {
    for (const step of requestSteps) {
      const mixer = mixerFromCapture(capture, step.t);
      for (const d of step.sent.flatMap((x) => x.messages).flatMap((m) => mixer.handle(m))) {
        for (const datagram of pack(d)) {
          expect(datagram.byteLength).toBeLessThanOrEqual(MAX_DATAGRAM_BYTES);
          expect(messagesOf(decodePacket(datagram)).length).toBeLessThanOrEqual(
            MAX_DATAGRAM_MESSAGES,
          );
        }
      }
    }
  });
});

describe('the baseline capture', () => {
  const capture = readCapture(BASELINE);
  const requestSteps = capture.steps.filter((s) => s.sent.length > 0);

  it('has the request and write steps the simulator is checked on', () => {
    expect(requestSteps.map((s) => s.id)).toEqual([
      'preflight',
      'sendstate',
      'sendsettings',
      'sendchan-input',
      'sendchan-playback',
      'sendchan-output',
      'sendchan-phones',
      'sendsubmix',
      'sendmix',
      'argtype-int',
      'argtype-none',
      'unknown-address',
      'burst',
      'sendall-2',
      'sendall-1',
      'write-mute-float',
      'write-mute-int',
      'write-mute-bool',
      'write-mute-same',
      'write-output-volume',
      'write-dim',
      'write-name',
      'after-restart',
    ]);
  });

  it('compares datagram sizes on enough steps to trust the packer', () => {
    const packable = requestSteps.filter(
      (s) =>
        s.sent.flatMap((d) => d.messages).length === 1 &&
        s.received.length > 0 &&
        s.received.every((d) => !d.messages.some(isMeter)),
    );
    expect(packable.length).toBeGreaterThanOrEqual(8);
  });
});

// Changes made in TotalMix's window during the capture's UI steps. The simulator makes the same
// change on the state of that moment; its feedback must match the recorded datagrams.
describe('conformance of changes made in TotalMix (baseline capture)', () => {
  const capture = readCapture(BASELINE);

  /** Non-meter messages of the step's datagrams, one list per datagram that has any. */
  function recordedFeedback(step: CaptureStep, count: number): string[][] {
    return step.received
      .map((d) => d.messages.filter((m) => !isMeter(m)).map(formatMessage))
      .filter((list) => list.length > 0)
      .slice(0, count);
  }

  function changeAt(stepId: string, address: string, value: number): Emission[] {
    const step = findStep(capture, stepId);
    const first = step?.received.find((d) => d.messages.some((m) => !isMeter(m)));
    if (!step || !first) throw new Error(`no feedback in ${stepId}`);
    return mixerFromCapture(capture, first.t).change(address, value);
  }

  it.each([
    ['ui-mute', '/input/8/mute', 1],
    ['ui-solo', '/mix/in/8/2/solo', 1],
    ['ui-gain', '/input/8/gain', 51],
    ['ui-48v', '/input/8/48v', 0],
    ['ui-dim', '/controlroom/dim', 1],
  ] as const)('%s: %s', (stepId, address, value) => {
    const emissions = changeAt(stepId, address, value);
    const step = findStep(capture, stepId);
    if (!step) throw new Error(stepId);
    expect(texts(emissions)).toEqual(recordedFeedback(step, emissions.length));
  });

  it('ui-snapshot: changed values in channel order, then the snapshot states', () => {
    const step = findStep(capture, 'ui-snapshot');
    const first = step?.received.find((d) => d.messages.some((m) => !isMeter(m)));
    if (!step || !first) throw new Error('no snapshot load in the capture');
    // The capture does not say what snapshot 1 holds; give it the values the load reported.
    const mixer = mixerFromCapture(capture, first.t);
    const values: OscMessage[] = first.messages.filter((m) => !isMeter(m));
    const before = values.map((m) => [m.address, mixer.get(m.address)] as const);
    for (const m of values)
      mixer.setValue(m.address, m.args[0]?.type === 'f' ? m.args[0].value : 0);
    mixer.saveSnapshot(1);
    for (const [address, v] of before) if (v !== undefined) mixer.setValue(address, v);
    mixer.setValue('/snapshot/load/1', 0);
    mixer.setValue('/snapshot/load/3', 3);
    expect(texts(mixer.loadSnapshot(1))).toEqual(recordedFeedback(step, 2));
  });
});
