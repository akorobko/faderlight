// The settings being edited. Every page edits one draft of the global settings; nothing reaches
// the plugin until Save, so typing a port number does not reconnect on every key. The plugin
// checks and clamps what it gets and sends back what it kept (and what it changed).

import type { GlobalSettings, JsonObject } from '@faderlight/deck';
import type { HelloResult } from '../src/protocol.ts';
import { Live } from './live.ts';
import type { Rpc } from './rpc.ts';

export interface SettingsState {
  /** What the plugin has. */
  readonly saved: GlobalSettings;
  /** What the pages show. */
  readonly draft: GlobalSettings;
  readonly defaults: GlobalSettings;
  readonly saving: boolean;
  /** What the plugin changed or refused at the last save. */
  readonly problems: readonly string[];
  /** The last save failed (not connected, say). */
  readonly error?: string | undefined;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export class SettingsModel {
  readonly state: Live<SettingsState | undefined> = new Live<SettingsState | undefined>(undefined);
  readonly version = new Live('');
  private readonly rpc: Rpc;

  constructor(rpc: Rpc) {
    this.rpc = rpc;
    rpc.link.subscribe((link) => {
      if (link === 'open') void this.load();
    });
    rpc.on('settings', (settings) => {
      const s = this.state.value;
      if (!s) return;
      // Changed elsewhere (another tab, the Stream Deck app): take it unless editing.
      const dirty = !same(s.draft, s.saved);
      this.state.set({ ...s, saved: settings, draft: dirty ? s.draft : settings });
    });
  }

  get dirty(): boolean {
    const s = this.state.value;
    return s !== undefined && !same(s.draft, s.saved);
  }

  private async load(): Promise<void> {
    const hello: HelloResult = await this.rpc.call('hello');
    this.version.set(hello.version);
    const s = this.state.value;
    const dirty = s !== undefined && !same(s.draft, s.saved);
    this.state.set({
      saved: hello.settings,
      draft: dirty ? s.draft : hello.settings,
      defaults: hello.defaults,
      saving: false,
      problems: [],
    });
  }

  /** Changes the draft. */
  edit(change: (draft: GlobalSettings) => GlobalSettings): void {
    const s = this.state.value;
    if (s) this.state.set({ ...s, draft: change(s.draft), problems: [], error: undefined });
  }

  discard(): void {
    const s = this.state.value;
    if (s) this.state.set({ ...s, draft: s.saved, problems: [], error: undefined });
  }

  /** Sends the draft (or the given settings) to the plugin. */
  async save(settings?: GlobalSettings): Promise<void> {
    const s = this.state.value;
    if (!s) return;
    const draft = settings ?? s.draft;
    this.patch({ draft, saving: true, error: undefined });
    try {
      const result = await this.rpc.call('settings.save', {
        settings: draft as unknown as JsonObject,
      });
      this.patch({
        saved: result.settings,
        draft: result.settings,
        saving: false,
        problems: result.problems,
      });
    } catch (e) {
      this.patch({ saving: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  private patch(change: Partial<SettingsState>): void {
    const s = this.state.value;
    if (s) this.state.set({ ...s, ...change });
  }
}
