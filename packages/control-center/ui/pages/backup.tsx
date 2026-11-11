// Backup (docs/design/03-ux.md §5.2): all settings as a JSON file, read back from one, or set
// back to the defaults. Importing and resetting change the draft: Save puts it on the deck.

import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { JsonObject } from '@faderlight/deck';
import type { PageProps } from '../app.tsx';
import { Button, Card, Page } from '../components.tsx';
import { download, readJsonFile } from '../files.ts';
import { useLive } from '../live.ts';

export function BackupPage(props: PageProps): JSX.Element {
  const state = useLive(props.settings.state);
  const [note, setNote] = useState<string | undefined>(undefined);
  if (!state) return <></>;

  const importSettings = async (): Promise<void> => {
    let file: unknown;
    try {
      file = await readJsonFile();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
      return;
    }
    if (file === undefined) return;
    if (typeof file !== 'object' || file === null || Array.isArray(file)) {
      setNote('That file holds no settings.');
      return;
    }
    const checked = await props.settings.check(file as JsonObject);
    props.settings.edit(() => checked.settings);
    setNote(
      checked.problems.length === 0
        ? 'Settings imported. Save to use them.'
        : `Settings imported; these were left at their defaults: ${checked.problems.join('; ')}`,
    );
  };

  return (
    <Page
      title="Backup"
      intro="All the settings in one file: to keep, to move to another computer, or to start again."
    >
      <div class="grid">
        <Card title="Export" id="export">
          <p class="muted note first">
            Saves the settings as these pages show them, unsaved changes included: the connection,
            names and colours, timings, the layout and the Level Preset levels.
          </p>
          <Button
            kind="primary"
            onClick={() => {
              download('faderlight-settings.json', state.draft);
            }}
          >
            Export settings
          </Button>
        </Card>
        <Card title="Import" id="import">
          <p class="muted note first">
            Reads a file exported here (or by an earlier version). The plugin checks every value;
            Save puts them on the deck, Discard keeps the settings you have.
          </p>
          <Button onClick={() => void importSettings()}>Import settings</Button>
        </Card>
        <Card title="Start again" id="reset">
          <p class="muted note first">
            Sets everything back to how the plugin comes: TotalMix on this computer, no names or
            colours of your own, and the Studio Console layout. Nothing changes until Save.
          </p>
          <Button
            kind="danger"
            onClick={() => {
              props.settings.edit(() => state.defaults);
              setNote('Back to the defaults in the draft. Save to use them, or Discard.');
            }}
          >
            Reset to defaults
          </Button>
        </Card>
      </div>
      {note !== undefined && (
        <p class="banner info" role="status">
          {note}
        </p>
      )}
    </Page>
  );
}
