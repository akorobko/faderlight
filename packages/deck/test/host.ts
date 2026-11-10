// A DeckHost for tests: records every image, alert, profile switch and saved setting. The
// runtime under test is given a renderer that returns the view as JSON, so a test can read what
// a key shows.
import type { KeyView, Theme } from '@faderlight/render';
import type { DeckHost, JsonObject } from '../src/index.ts';

export type ShownView = KeyView & Record<string, unknown>;

/** The renderer to give the runtime: the view and theme name as JSON. */
export const renderJson = (view: KeyView, theme: Theme): string =>
  JSON.stringify({ theme: theme.name, view });

/** Records what the runtime shows; images are the views as JSON, so tests can read them. */
export class TestHost implements DeckHost {
  readonly images = new Map<string, string[]>();
  readonly alerts: string[] = [];
  readonly oks: string[] = [];
  readonly profiles: [string, string | undefined][] = [];
  readonly saved: JsonObject[] = [];
  /** Sections the Control Center was opened on. */
  readonly opened: (string | undefined)[] = [];

  setImage(id: string, image: string): void {
    const list = this.images.get(id) ?? [];
    list.push(image);
    this.images.set(id, list);
  }

  showAlert(id: string): void {
    this.alerts.push(id);
  }

  showOk(id: string): void {
    this.oks.push(id);
  }

  switchToProfile(device: string, profile?: string): void {
    this.profiles.push([device, profile]);
  }

  saveSettings(settings: JsonObject): void {
    this.saved.push(settings);
  }

  openControlCenter(section?: string): void {
    this.opened.push(section);
  }

  /** The view the key shows now; undefined: blank (or nothing sent yet). */
  view(id: string): ShownView | undefined {
    return this.last(id)?.view;
  }

  theme(id: string): string | undefined {
    return this.last(id)?.theme;
  }

  private last(id: string): { theme: string; view: KeyView & Record<string, unknown> } | undefined {
    const image = this.images.get(id)?.at(-1);
    return image?.startsWith('{') === true
      ? (JSON.parse(image) as { theme: string; view: KeyView & Record<string, unknown> })
      : undefined;
  }

  count(id: string): number {
    return this.images.get(id)?.length ?? 0;
  }
}
