// The Setup Assistant: TotalMix's OSC settings, checked one by one against what actually
// arrives (docs/design/03-ux.md §5.2). TotalMix cannot be asked how it is set up, so each check
// reads the traffic: no reply at all means the Remote Controller slot is off or on other ports,
// no meters means Send Level Data is off, and no change after moving a fader means Send changes
// is off. The wording of TotalMix's settings follows tools/capture/README.md.

import type { SnapshotNameSource } from '@faderlight/deck';
import type { ConnectionReport } from './diagnostics.ts';

export type CheckState = 'ok' | 'fail' | 'wait' | 'info';

export interface SetupCheck {
  readonly id: 'port' | 'reply' | 'sync' | 'levels' | 'changes' | 'names';
  readonly state: CheckState;
  readonly title: string;
  /** What was seen. */
  readonly detail: string;
  /** What to do in TotalMix (or elsewhere) when the check fails or waits. */
  readonly hint?: readonly string[] | undefined;
}

/** Probing this long without an answer is a failure, not a wait. */
export const NO_REPLY_AFTER_MS = 3000;

const port = (n: number): string => String(n);

/** The TotalMix settings for this connection, as a list of steps. */
export function totalMixSteps(
  r: Pick<ConnectionReport, 'sendPort' | 'listenPort' | 'host'>,
): string[] {
  const local = r.host === '127.0.0.1' || r.host === 'localhost';
  return [
    'In TotalMix FX 2.1 or later, menu Options: tick Enable OSC Control.',
    'Options → Settings → OSC: pick a Remote Controller slot and tick In Use.',
    `Port incoming ${port(r.sendPort)}, Port outgoing ${port(r.listenPort)}.`,
    local
      ? 'Remote Controller Address: 127.0.0.1 (not empty, not "localhost").'
      : "Remote Controller Address: this computer's IP address.",
    'Compatibility (Mode): Global OSC. If it only offers TotalMix 1.90 and 1.96, TotalMix is older than 2.1.',
  ];
}

export function setupChecks(r: ConnectionReport, names: SnapshotNameSource): SetupCheck[] {
  const checks: SetupCheck[] = [];
  const inUse = r.error?.code === 'EADDRINUSE';
  const listening = r.transport === 'open';

  checks.push(
    listening
      ? {
          id: 'port',
          state: 'ok',
          title: `Listening on port ${port(r.localPort ?? r.listenPort)}`,
          detail: 'The plugin is ready for what TotalMix sends.',
        }
      : inUse
        ? {
            id: 'port',
            state: 'fail',
            title: `Port ${port(r.listenPort)} is in use`,
            detail:
              'Another app already listens on it, so nothing from TotalMix reaches the plugin.',
            hint: [
              'Quit the other app (Bitfocus Companion, another OSC plugin, a capture), or',
              'choose another port here and the same Port outgoing in TotalMix.',
            ],
          }
        : {
            id: 'port',
            state: r.error ? 'fail' : 'wait',
            title: `Opening port ${port(r.listenPort)}`,
            detail: r.error ? `Failed: ${r.error.message}. Trying again.` : 'Starting…',
          },
  );

  const answering = r.link === 'live' || r.link === 'syncing';
  checks.push(
    answering
      ? {
          id: 'reply',
          state: 'ok',
          title: 'TotalMix answers',
          detail: r.device ? `Connected to ${r.device}.` : 'Connected.',
        }
      : r.link === 'stale'
        ? {
            id: 'reply',
            state: 'fail',
            title: 'TotalMix stopped answering',
            detail: 'It answered before. Is TotalMix still running?',
            hint: ['Start TotalMix FX again: the plugin reconnects by itself.'],
          }
        : {
            id: 'reply',
            state: listening && r.linkForMs >= NO_REPLY_AFTER_MS ? 'fail' : 'wait',
            title: 'TotalMix answers',
            detail: listening
              ? `No reply yet from ${r.host}:${port(r.sendPort)}.`
              : 'Waiting for the port.',
            hint: totalMixSteps(r),
          },
  );

  checks.push(
    r.synced && answering
      ? {
          id: 'sync',
          state: 'ok',
          title: 'Mixer read',
          detail: `${String(r.values)} values: names, levels and switches of the channels TotalMix shows.`,
        }
      : {
          id: 'sync',
          state: 'wait',
          title: 'Mixer read',
          detail: r.link === 'syncing' ? 'Reading the mixer…' : 'Waits for TotalMix to answer.',
        },
  );

  checks.push(
    r.rx.meters > 0
      ? {
          id: 'levels',
          state: 'ok',
          title: 'Level meters arrive',
          detail: `${String(r.rx.meters)} meter values so far.`,
        }
      : {
          id: 'levels',
          state: answering && r.synced ? 'fail' : 'wait',
          title: 'Level meters arrive',
          detail: 'No level data yet.',
          hint: [
            'In the Remote Controller slot: tick Send Level Data.',
            'TotalMix sends meters only while levels change: play something if it is quiet.',
          ],
        },
  );

  checks.push(
    r.unsolicited > 0
      ? {
          id: 'changes',
          state: 'ok',
          title: 'Changes in TotalMix arrive',
          detail: `${String(r.unsolicited)} so far.`,
        }
      : {
          id: 'changes',
          state: 'wait',
          title: 'Changes in TotalMix arrive',
          detail: answering
            ? 'Move a fader or press a Mute button in TotalMix now.'
            : 'Waits for TotalMix to answer.',
          hint: answering
            ? ['If this does not turn green: Details → tick Send changes and Send status.']
            : undefined,
        },
  );

  checks.push(
    names === 'file'
      ? {
          id: 'names',
          state: 'info',
          title: 'Snapshot names',
          detail: "Read from TotalMix's state file. Names you set in the Control Center win.",
        }
      : names === 'no-file'
        ? {
            id: 'names',
            state: 'info',
            title: 'Snapshot names',
            detail:
              'TotalMix writes them to its state file when it quits; quit it once to see them. Or set them in the Control Center.',
          }
        : {
            id: 'names',
            state: 'info',
            title: 'Snapshot names',
            detail:
              'Global OSC does not send them, and reading them from TotalMix is not supported on this system yet. Set them in the Control Center.',
          },
  );
  return checks;
}
