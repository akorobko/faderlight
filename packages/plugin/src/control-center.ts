// The Control Center, started the first time something opens it (the Status key, or Open
// Control Center in a key's settings) and kept running until the plugin stops. Each opening
// hands the browser a fresh one-time link.

import { join } from 'node:path';
import {
  ControlCenterServer,
  readUiFiles,
  type ControlCenterHost,
} from '@faderlight/control-center';
import type { Logger } from '@faderlight/deck';

/** The built page, next to bin/ in the plugin folder (scripts/build.ts writes it). */
export const UI_FOLDER = 'control-center';

export class ControlCenter {
  private readonly host: ControlCenterHost;
  private readonly log: Logger;
  private readonly openUrl: (url: string) => Promise<void>;
  private server: ControlCenterServer | undefined;
  private starting: Promise<ControlCenterServer> | undefined;

  constructor(host: ControlCenterHost, log: Logger, openUrl: (url: string) => Promise<void>) {
    this.host = host;
    this.log = log;
    this.openUrl = openUrl;
  }

  /** Opens the Control Center in the browser on one of its sections. */
  async open(section?: string): Promise<void> {
    try {
      const server = await this.start();
      await this.openUrl(server.link(section));
    } catch (e) {
      this.log.error('could not open the Control Center:', e);
    }
  }

  /** The global settings changed (from the Stream Deck app): tell the open pages. */
  settingsChanged(): void {
    this.server?.settingsChanged();
  }

  async stop(): Promise<void> {
    await this.server?.stop();
  }

  private start(): Promise<ControlCenterServer> {
    this.starting ??= (async () => {
      // The app starts the plugin in its folder.
      const files = readUiFiles(join(process.cwd(), UI_FOLDER));
      const server = new ControlCenterServer({ host: this.host, files, log: this.log });
      await server.start();
      this.server = server;
      return server;
    })();
    this.starting.catch(() => {
      this.starting = undefined;
    });
    return this.starting;
  }
}
