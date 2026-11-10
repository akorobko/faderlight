// Building blocks for capture scripts (tools/capture/scripts/*.ts).
//
// A script is a list of steps. Every step is recorded as a begin/end pair in the capture
// file, so each response can be attributed to the request or the manual action that
// caused it. Text and addresses may use these placeholders:
//   {in} {out} {pb} {ph}               channel indices (0-based, from --input/--output/...)
//   {inName} {outName} {pbName} {phName}  channel names as TotalMix reports them

import { argNumber, type OscArg, type OscMessage } from './osc.ts';

export interface Vars {
  /** Test input channel (0-based). Default 8 = "Mic 9" on a UFX III. */
  readonly in: number;
  /** Test output channel (0-based). Default 0 = "AN 1/2", usually Main. */
  readonly out: number;
  /** Test playback channel (0-based). */
  readonly pb: number;
  /** Phones output channel (0-based). Default 8 = "PH 9/10" on a UFX III. */
  readonly ph: number;
}

export const DEFAULT_VARS: Vars = { in: 8, out: 0, pb: 0, ph: 8 };

interface StepBase {
  /** Stable id, unique within the script (kebab-case). Tests and fixtures refer to it. */
  readonly id: string;
  readonly title: string;
  /** The protocol question this step answers (recorded in the capture file). */
  readonly why?: string;
  /** Record every meter datagram during this step instead of thinning them. */
  readonly meters?: 'full';
}

/** Records for a fixed time without sending anything. */
export interface ListenStep extends StepBase {
  readonly kind: 'listen';
  readonly ms: number;
  /** Addresses seen here count as background traffic (ignored when waiting for replies). */
  readonly background?: boolean;
}

/** Sends one or more messages, then records until the replies have stopped. */
export interface RequestStep extends StepBase {
  readonly kind: 'request';
  readonly send: readonly OscMessage[];
  /** Delay between the messages in `send` (default 0). */
  readonly spacingMs?: number;
  /** Replies are over after this much silence (default 1200 ms). */
  readonly settleMs?: number;
  /** Give up waiting after this long (default 8000 ms). */
  readonly maxMs?: number;
}

/** Asks the person at the computer to do something in TotalMix while recording. */
export interface ManualStep extends StepBase {
  readonly kind: 'manual';
  readonly text: readonly string[];
  /** Shown as "(optional)"; the instructions should say when to skip it. */
  readonly optional?: boolean;
}

/**
 * Changes one value, observes TotalMix's reaction, and restores the original value.
 * Only for changes that are harmless for a moment (mute, a 1 dB cut, Dim, a name).
 */
export interface WriteStep extends StepBase {
  readonly kind: 'write';
  readonly address: string;
  /** New value from the current one, or a reason (string) to skip the step. */
  readonly change: (current: readonly OscArg[] | undefined) => readonly OscArg[] | string;
  /** Request that makes TotalMix report the value (sent after the write and after the restore). */
  readonly verify?: OscMessage;
  /** How long the changed value is kept before restoring (default 800 ms). */
  readonly holdMs?: number;
}

export type Step = ListenStep | RequestStep | ManualStep | WriteStep;

export interface Script {
  readonly id: string;
  readonly title: string;
  /** One paragraph shown before the script starts. */
  readonly intro: readonly string[];
  readonly steps: readonly Step[];
}

// --- constructors -----------------------------------------------------------------

export const f = (value: number): OscArg => ['f', value];
export const i = (value: number): OscArg => ['i', value];
export const s = (value: string): OscArg => ['s', value];
export const T: OscArg = ['T'];
export const F: OscArg = ['F'];

export const msg = (address: string, ...args: OscArg[]): OscMessage => ({ address, args });

export const listen = (step: Omit<ListenStep, 'kind'>): ListenStep => ({ kind: 'listen', ...step });
export const request = (step: Omit<RequestStep, 'kind'>): RequestStep => ({
  kind: 'request',
  ...step,
});
export const manual = (step: Omit<ManualStep, 'kind'>): ManualStep => ({ kind: 'manual', ...step });
export const write = (step: Omit<WriteStep, 'kind'>): WriteStep => ({ kind: 'write', ...step });

// --- value changes for write steps ----------------------------------------------------

/** Flips a 0/1 value, sent with the given argument type. */
export function toggle(type: 'f' | 'i' | 'TF'): WriteStep['change'] {
  return (current) => {
    const v = argNumber(current?.[0]);
    if (v === undefined) return 'current value unknown';
    const next = v >= 0.5 ? 0 : 1;
    if (type === 'TF') return [next === 1 ? T : F];
    return [type === 'f' ? f(next) : i(next)];
  };
}

/** Moves a dB value by `delta` (use negative values: quieter is the safe direction). */
export function nudgeDb(delta: number, floorDb = -60): WriteStep['change'] {
  return (current) => {
    const v = argNumber(current?.[0]);
    if (v === undefined) return 'current value unknown';
    if (v <= floorDb) return `current value ${String(v)} dB is at or below ${String(floorDb)} dB`;
    return [f(Math.round((v + delta) * 100) / 100)];
  };
}

/** Writes the current value back unchanged (shows how TotalMix echoes a no-op write). */
export const same: WriteStep['change'] = (current) => current ?? 'current value unknown';

/** Replaces a string value (channel name). */
export function text(value: string): WriteStep['change'] {
  return (current) => {
    const c = current?.[0];
    if (c?.[0] !== 's') return 'current name unknown';
    return [s(value)];
  };
}
