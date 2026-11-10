// The action registry: every action the plugin offers in the Stream Deck app's action list.
// packages/plugin's manifest.json declares one action per entry (a test keeps them in step);
// the runtime decides what each one does from its kind.

export type ActionKind =
  | 'slot'
  | 'channel'
  | 'output'
  | 'phones'
  | 'snapshot'
  | 'monitor'
  | 'global'
  | 'status'
  | 'step'
  | 'console'
  | 'preset'
  | 'exit'
  | 'test-image';

export interface ActionInfo {
  readonly kind: ActionKind;
  /** Name in the action list. */
  readonly name: string;
  readonly tooltip: string;
}

export const ACTIONS: readonly ActionInfo[] = [
  {
    kind: 'slot',
    name: 'Console Slot',
    tooltip:
      'One key of the Console layout: what it shows follows the page, the bank and the Channel Detail overlay.',
  },
  {
    kind: 'channel',
    name: 'Channel',
    tooltip:
      'An input or playback channel: name, gain or level, meter. Tap mutes, hold opens details.',
  },
  {
    kind: 'output',
    name: 'Main / Output',
    tooltip: 'The Main output or another output: volume and meter. Tap mutes.',
  },
  { kind: 'phones', name: 'Phones', tooltip: 'A headphone output: volume and meter. Tap mutes.' },
  {
    kind: 'snapshot',
    name: 'Snapshot',
    tooltip: 'Loads a mixer snapshot and shows which one is loaded.',
  },
  {
    kind: 'monitor',
    name: 'Monitor Switch',
    tooltip: 'Dim, Mono, Talkback, Speaker B or External input of the control room section.',
  },
  { kind: 'global', name: 'Global Mute / Solo', tooltip: 'The mixer-wide mute or solo switch.' },
  {
    kind: 'status',
    name: 'Status',
    tooltip:
      'Connection to the mixer and the interface model. Tap opens the Control Center, hold reads the whole mixer again.',
  },
  {
    kind: 'step',
    name: 'Volume Step',
    tooltip: 'Turns Main, a Phones output or another output up or down; hold to repeat.',
  },
  {
    kind: 'console',
    name: 'Open Console',
    tooltip: 'Switches this device to the bundled Console profile.',
  },
  {
    kind: 'preset',
    name: 'Level Preset',
    tooltip:
      'A saved level for Main, a Phones output or another output. Tap sets it, hold saves the current level.',
  },
  {
    kind: 'exit',
    name: 'Exit Console',
    tooltip: 'Leaves the Console profile for the profile this device showed before it.',
  },
  {
    kind: 'test-image',
    name: 'Test Images',
    tooltip:
      'Development aid: shows the renderer test images. Tap for the next page, hold to switch between the SVG and the reference PNG.',
  },
];

export const ACTION_KINDS: readonly ActionKind[] = ACTIONS.map((a) => a.kind);

export function isActionKind(s: string): s is ActionKind {
  return (ACTION_KINDS as readonly string[]).includes(s);
}
