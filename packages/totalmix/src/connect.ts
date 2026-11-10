// Wires a TotalMixClient to a UDP transport and a store: the usual way to talk to TotalMix.

import { MixerStore } from '@faderlight/model';
import { UdpTransport, type UdpTransportOptions } from '@faderlight/osc';
import { TotalMixClient, type ClientOptions } from './client.ts';
import type { Clock } from './clock.ts';

export interface ConnectOptions extends Partial<ClientOptions> {
  /** Computer running TotalMix (default 127.0.0.1). */
  readonly host?: string;
  /** TotalMix "Port incoming" (default 7002). */
  readonly sendPort?: number;
  /** TotalMix "Port outgoing" (default 9002). */
  readonly listenPort?: number;
  readonly transport?: Partial<Omit<UdpTransportOptions, 'host' | 'sendPort' | 'listenPort'>>;
  /** Store to fill (default: a new one). */
  readonly store?: MixerStore;
  readonly clock?: Clock;
}

export interface TotalMixConnection {
  readonly client: TotalMixClient;
  readonly transport: UdpTransport;
  readonly store: MixerStore;
  /** Stops the client and closes the socket. */
  stop(): Promise<void>;
}

/** Binds the feedback port and keeps the store in sync with TotalMix until stop(). */
export function connectTotalMix(options: ConnectOptions = {}): TotalMixConnection {
  const store = options.store ?? new MixerStore();
  const transport = new UdpTransport({
    ...options.transport,
    host: options.host ?? '127.0.0.1',
    sendPort: options.sendPort ?? 7002,
    listenPort: options.listenPort ?? 9002,
  });
  const client = new TotalMixClient(transport, store, options);
  transport.on('packet', (p) => {
    client.receive(p.messages);
  });
  transport.on('source', (_current, previous) => {
    client.sourceChanged(previous);
  });
  transport.on('state', (state) => {
    if (state === 'open') client.start();
    else client.stop();
  });
  transport.start();
  return {
    client,
    transport,
    store,
    stop: async () => {
      client.stop();
      await transport.stop();
    },
  };
}
