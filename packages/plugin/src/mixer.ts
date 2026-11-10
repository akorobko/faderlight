// The plugin's one connection to TotalMix. The store outlives the connection: when the user
// changes the host or ports, the old client stops, the store is cleared (it may be another
// interface now) and a new client fills it.

import type { ConnectionSettings, Logger } from '@faderlight/deck';
import { MixerStore, type Target, type Value } from '@faderlight/model';
import { connectTotalMix, type TotalMixConnection } from '@faderlight/totalmix';

export class MixerConnection {
  readonly store = new MixerStore();
  private readonly log: Logger;
  private connection: TotalMixConnection | undefined;
  private settings: ConnectionSettings | undefined;

  constructor(log: Logger) {
    this.log = log;
  }

  /** Connects with these settings, or does nothing if they did not change. */
  configure(settings: ConnectionSettings): void {
    const s = this.settings;
    if (
      s?.host === settings.host &&
      s.sendPort === settings.sendPort &&
      s.listenPort === settings.listenPort
    ) {
      return;
    }
    const previous = this.connection;
    this.settings = settings;
    this.connection = undefined;
    void (async () => {
      if (previous) {
        await previous.stop();
        this.store.clear();
      }
      // A newer configure() call won while the old socket was closing.
      if (this.settings !== settings) return;
      this.log.info(
        `connecting to TotalMix at ${settings.host}:${String(settings.sendPort)}, listening on ${String(settings.listenPort)}`,
      );
      const conn = connectTotalMix({ ...settings, store: this.store });
      conn.client.on('state', (state, from) => {
        this.log.info(`TotalMix link: ${from} -> ${state}`);
      });
      conn.client.on('commandFailed', (target, value, reason) => {
        this.log.warn(`write failed (${reason}):`, target, value);
      });
      conn.transport.on('socketError', (error) => {
        this.log.warn(`UDP: ${error.message}`);
      });
      this.connection = conn;
    })();
  }

  /** Writes a value; false when not connected. */
  set(target: Target, value: Value): boolean {
    return this.connection?.client.set(target, value) ?? false;
  }

  loadSnapshot(n: number): boolean {
    return this.connection?.client.loadSnapshot(n) ?? false;
  }

  resync(): void {
    this.connection?.client.resync();
  }

  async stop(): Promise<void> {
    this.settings = undefined;
    const conn = this.connection;
    this.connection = undefined;
    await conn?.stop();
  }
}
