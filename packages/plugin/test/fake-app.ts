// A stand-in for the Stream Deck app: a WebSocket server that launches the built plugin the way
// the app does (`node bin/plugin.js -port … -pluginUUID … -registerEvent … -info …`, working
// directory = the .sdPlugin folder), answers its settings requests, sends key events and
// records what the plugin sends back. The plugin gets an empty home folder of its own, so
// nothing on the computer running the tests (such as TotalMix's state file with its snapshot
// names) changes what it does.

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { PLUGIN_UUID } from '../src/ids.ts';

export type Json = Record<string, unknown>;

export interface FakeDevice {
  readonly id: string;
  readonly name: string;
  readonly type: number;
  readonly size: { readonly columns: number; readonly rows: number };
}

/** A Stream Deck XL (device type 2, 8 x 4 keys). */
export const XL: FakeDevice = {
  id: 'XL-DEVICE',
  name: 'Stream Deck XL',
  type: 2,
  size: { columns: 8, rows: 4 },
};

export class FakeStreamDeck {
  /** Every message the plugin sent, oldest first. */
  readonly received: Json[] = [];
  globalSettings: Json = {};
  /** The plugin's stdout and stderr, for failure messages. */
  output = '';
  private server: WebSocketServer | undefined;
  private socket: WebSocket | undefined;
  private child: ChildProcess | undefined;
  private home: string | undefined;
  private waiters: { test: (m: Json) => boolean; resolve: (m: Json) => void }[] = [];

  async start(): Promise<number> {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>((resolve) => server.once('listening', resolve));
    server.on('connection', (socket) => {
      this.socket = socket;
      socket.on('message', (data: Buffer) => {
        this.onMessage(JSON.parse(data.toString('utf8')) as Json);
      });
    });
    this.server = server;
    return this.port;
  }

  get port(): number {
    const address = this.server?.address();
    return typeof address === 'object' && address !== null ? address.port : 0;
  }

  /** Starts the plugin in `pluginDir` and waits until it has registered. */
  async launch(pluginDir: string, devices: readonly FakeDevice[] = [XL]): Promise<void> {
    const info = {
      application: {
        font: 'Arial',
        language: 'en',
        platform: process.platform === 'win32' ? 'windows' : 'mac',
        platformVersion: '15.0',
        version: '7.1.0.22000',
      },
      plugin: { uuid: PLUGIN_UUID, version: '0.1.0.0' },
      devicePixelRatio: 2,
      colors: {
        buttonMouseOverBackgroundColor: '#464646FF',
        buttonPressedBackgroundColor: '#303030FF',
        buttonPressedBorderColor: '#646464FF',
        buttonPressedTextColor: '#969696FF',
        highlightColor: '#0078FFFF',
      },
      devices,
    };
    const home = mkdtempSync(join(tmpdir(), 'faderlight-home-'));
    this.home = home;
    const child = spawn(
      process.execPath,
      [
        join(pluginDir, 'bin/plugin.js'),
        '-port',
        String(this.port),
        '-pluginUUID',
        PLUGIN_UUID,
        '-registerEvent',
        'registerPlugin',
        '-info',
        JSON.stringify(info),
      ],
      {
        cwd: pluginDir,
        env: { ...process.env, HOME: home, USERPROFILE: home },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    child.stdout.on('data', (d: Buffer) => (this.output += d.toString()));
    child.stderr.on('data', (d: Buffer) => (this.output += d.toString()));
    this.child = child;
    await this.waitFor((m) => m.event === 'registerPlugin');
  }

  private onMessage(m: Json): void {
    this.received.push(m);
    if (m.event === 'getGlobalSettings') {
      this.send({
        event: 'didReceiveGlobalSettings',
        id: m.id,
        payload: { settings: this.globalSettings },
      });
    } else if (m.event === 'setGlobalSettings') {
      this.globalSettings = m.payload as Json;
    }
    this.waiters = this.waiters.filter((w) => {
      if (!w.test(m)) return true;
      w.resolve(m);
      return false;
    });
  }

  send(message: Json): void {
    if (!this.socket) throw new Error('the plugin is not connected');
    this.socket.send(JSON.stringify(message));
  }

  /** The next message (from now on) that passes `test`. */
  waitFor(test: (m: Json) => boolean, timeoutMs = 5000): Promise<Json> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`no matching message within ${String(timeoutMs)} ms\n${this.output}`));
      }, timeoutMs);
      this.waiters.push({
        test,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m);
        },
      });
    });
  }

  /** A key of `action` appears at `column`, `row`. */
  appear(
    context: string,
    action: string,
    coordinates: { column: number; row: number },
    settings: Json = {},
    device = XL.id,
  ): void {
    this.send({
      event: 'willAppear',
      action,
      context,
      device,
      payload: { controller: 'Keypad', coordinates, isInMultiAction: false, settings, state: 0 },
    });
  }

  disappear(context: string, action: string, device = XL.id): void {
    this.send({
      event: 'willDisappear',
      action,
      context,
      device,
      payload: {
        controller: 'Keypad',
        coordinates: { column: 0, row: 0 },
        isInMultiAction: false,
        settings: {},
      },
    });
  }

  key(event: 'keyDown' | 'keyUp', context: string, action: string, device = XL.id): void {
    this.send({
      event,
      action,
      context,
      device,
      payload: {
        coordinates: { column: 0, row: 0 },
        isInMultiAction: false,
        settings: {},
        state: 0,
      },
    });
  }

  /** setImage messages for one key, oldest first. */
  images(context: string): string[] {
    return this.received
      .filter((m) => m.event === 'setImage' && m.context === context)
      .map((m) => String((m.payload as Json).image));
  }

  async stop(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    if (child?.exitCode === null) {
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.kill();
      await exited;
    }
    if (this.home) rmSync(this.home, { recursive: true, force: true });
    this.home = undefined;
    await new Promise<void>((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      for (const client of this.server.clients) client.terminate();
      this.server.close(() => {
        resolve();
      });
    });
  }
}

/** The SVG inside a setImage data URL. */
export function svgOf(image: string): string {
  const prefix = 'data:image/svg+xml;charset=utf8,';
  if (!image.startsWith(prefix)) throw new Error(`not an SVG data URL: ${image.slice(0, 40)}`);
  return decodeURIComponent(image.slice(prefix.length));
}
