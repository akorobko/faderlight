// Starts the virtual deck: node tools/virtual-deck/src/cli.ts [options], then open the address
// it prints. Without --totalmix it runs its own simulator.

import { parseArgs } from 'node:util';
import { LAYOUTS, METER_SETS, type LayoutName, type MeterSetName } from '@faderlight/simulator';
import { VirtualDeck, type ProfileName } from './server.ts';

export const USAGE = `Virtual deck: the Faderlight keys on a web page.

  --port <n>            HTTP port (default 8080)
  --layout <name>       simulator layout: ${LAYOUTS.join(', ')} (default studio)
  --meters <name>       simulator meters: ${METER_SETS.join(', ')}, off (default studio)
  --profile <name>      profile shown first: console, own (default console)
  --totalmix <host>     use TotalMix on this computer instead of the simulator
  --send-port <n>       TotalMix "Port incoming" (default 7002)
  --listen-port <n>     TotalMix "Port outgoing" (default 9002)
`;

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: '8080' },
    layout: { type: 'string', default: 'studio' },
    meters: { type: 'string', default: 'studio' },
    profile: { type: 'string', default: 'console' },
    totalmix: { type: 'string' },
    'send-port': { type: 'string', default: '7002' },
    'listen-port': { type: 'string', default: '9002' },
    help: { type: 'boolean', default: false },
  },
});

const oneOf = <T extends string>(v: string, options: readonly T[], what: string): T => {
  if ((options as readonly string[]).includes(v)) return v as T;
  throw new Error(`unknown ${what} "${v}"; expected one of ${options.join(', ')}`);
};

if (values.help) {
  process.stdout.write(USAGE);
} else {
  const deck = new VirtualDeck({
    port: Number(values.port),
    layout: oneOf<LayoutName>(values.layout, LAYOUTS, 'layout'),
    meters: oneOf<MeterSetName | 'off'>(values.meters, [...METER_SETS, 'off'], 'meter set'),
    profile: oneOf<ProfileName>(values.profile, ['console', 'own'], 'profile'),
    totalmix:
      values.totalmix === undefined
        ? undefined
        : {
            host: values.totalmix,
            sendPort: Number(values['send-port']),
            listenPort: Number(values['listen-port']),
          },
  });
  await deck.start();
  process.stdout.write(`virtual deck on ${deck.url}\n`);
  const stop = () => {
    void deck.stop().then(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
