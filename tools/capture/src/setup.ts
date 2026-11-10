// TotalMix settings the capture expects, and what to check when nothing arrives.
// Keep in sync with tools/capture/README.md ("TotalMix settings").

export function setupChecklist(o: {
  host: string;
  sendPort: number;
  listenPort: number;
}): string[] {
  return [
    'TotalMix FX menu Options: "Enable OSC Control" is ticked.',
    'Options > Settings > OSC tab, pick a free Remote Controller slot (for example 2):',
    '  - "In Use" ticked',
    `  - Port incoming ${String(o.sendPort)}, Port outgoing ${String(o.listenPort)}`,
    `  - Remote Controller Address (IP or Host Name): ${o.host === 'localhost' ? '127.0.0.1' : o.host} (do not leave it empty)`,
    '  - Compatibility (Mode): Global OSC',
    '  - Details: Send changes, Send status and Re-send received ticked; Send all data on start,',
    '    Re-send if different, Send faders in linear scale and Receive to hidden channels NOT ticked',
    '  - Send Level Data ticked (and Send Peak Level, if your version has it)',
    'Nothing else on this computer listens on the same outgoing port (Companion, another plugin).',
  ];
}

export const troubleshooting: readonly string[] = [
  'No OSC traffic arrived from TotalMix. Check:',
  '  1. TotalMix FX is running and Options > "Enable OSC Control" is ticked.',
  '  2. The Remote Controller slot is "In Use" and set to Global OSC.',
  '  3. Ports match: TotalMix "Port incoming" = --send-port, "Port outgoing" = --listen-port.',
  '  4. "Remote Controller Address" is 127.0.0.1 (or this computer\'s IP), not empty.',
  '  5. "Send status" is ticked (it makes TotalMix send a heartbeat).',
];
