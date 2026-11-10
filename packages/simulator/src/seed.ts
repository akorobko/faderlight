// Builds a SimMixer from recorded state: the layout (which strips are visible and stereo) and
// every value TotalMix reported, e.g. in a capture's /sendall reply. This lets the simulator
// stand in for a particular real setup, and the conformance test compare it with TotalMix.

import { type OscMessage, argNumber, argString } from '@faderlight/osc';
import { isMeter, type Capture } from './capture.ts';
import { parseAddress, SimMixer, type SimMixerOptions } from './mixer.ts';

/**
 * A mixer laid out and filled from state messages (meters are skipped). The layout comes from
 * `layout` (default: the same messages): a strip is visible when its name was reported, and
 * everything else stays hidden. Then every message is applied in order, so later ones win.
 */
export function mixerFromMessages(
  messages: readonly OscMessage[],
  options: Omit<SimMixerOptions, 'hidden'> = {},
  layout: readonly OscMessage[] = messages,
): SimMixer {
  const mixer = new SimMixer({ ...options, hidden: true });
  for (const m of layout) {
    const a = parseAddress(m.address);
    if (a?.kind !== 'channel') continue;
    if (a.field === 'stereo') mixer.setStereo(a.bus, a.index, argNumber(m.args[0]) === 1);
    if (a.field === 'name') mixer.setVisible(a.bus, a.index, true);
  }
  const state = messages.filter((m) => !isMeter(m));
  // Settings first: the Main volume is reported dimmed while Dim is on, and stored undimmed.
  const settingsFirst = [
    ...state.filter((m) => parseAddress(m.address)?.kind === 'setting'),
    ...state.filter((m) => parseAddress(m.address)?.kind !== 'setting'),
  ];
  for (const m of settingsFirst) {
    const arg = m.args[0];
    const value = argString(arg) ?? argNumber(arg);
    if (value !== undefined) mixer.setValue(m.address, value);
  }
  return mixer;
}

/**
 * The state of a capture's mixer at time `t` (default: the end): the layout of its most complete
 * /sendall reply, then every state message received and every write sent before `t`, in order.
 * Writes count because TotalMix does not echo them.
 */
export function mixerFromCapture(
  capture: Capture,
  t = Infinity,
  options: Omit<SimMixerOptions, 'hidden'> = {},
): SimMixer {
  const dump = dumpOf(capture);
  if (!dump) throw new Error('the capture has no /sendall reply to take the layout from');
  const before = [...capture.received, ...capture.sent]
    .filter((d) => d.t < t)
    .sort((a, b) => a.t - b.t)
    .flatMap((d) => d.messages);
  return mixerFromMessages([...dump, ...before], options, dump);
}

/** The state messages of the capture's largest /sendall reply, or undefined if it has none. */
export function dumpOf(capture: Capture): OscMessage[] | undefined {
  let best: OscMessage[] | undefined;
  for (const step of capture.steps) {
    if (!step.sent.some((d) => d.messages.some((m) => m.address === '/sendall'))) continue;
    const messages = step.received.flatMap((d) => d.messages).filter((m) => !isMeter(m));
    if (!best || messages.length > best.length) best = messages;
  }
  return best;
}
