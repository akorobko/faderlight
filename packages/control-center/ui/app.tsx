// The Control Center app: a navigation column with the sections (docs/design/03-ux.md §5.2),
// the section shown (from the address's #fragment, so the plugin can open one directly), the
// mixer's status in the header and a bar to save or discard edits.

import type { JSX } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { Button, Dot, type DotState } from './components.tsx';
import { useLive, useTopic } from './live.ts';
import { AppearancePage } from './pages/appearance.tsx';
import { BehaviourPage } from './pages/behaviour.tsx';
import { ChannelsPage } from './pages/channels.tsx';
import { ConnectionPage } from './pages/connection.tsx';
import type { Rpc } from './rpc.ts';
import { SettingsModel } from './settings.ts';

export interface PageProps {
  readonly rpc: Rpc;
  readonly settings: SettingsModel;
}

interface Section {
  readonly id: string;
  readonly title: string;
  readonly page: (props: PageProps) => JSX.Element;
}

export const SECTIONS: readonly Section[] = [
  { id: 'connection', title: 'Connection', page: ConnectionPage },
  { id: 'channels', title: 'Device & Channels', page: ChannelsPage },
  { id: 'behaviour', title: 'Behaviour', page: BehaviourPage },
  { id: 'appearance', title: 'Appearance', page: AppearancePage },
];

const sectionOf = (hash: string): Section => {
  const id = decodeURIComponent(hash.replace(/^#/, ''));
  const found = SECTIONS.find((s) => s.id === id) ?? SECTIONS[0];
  if (!found) throw new Error('no sections');
  return found;
};

const LINK_DOT: Readonly<Record<string, DotState>> = {
  live: 'ok',
  syncing: 'busy',
  probing: 'busy',
  stale: 'fail',
  idle: 'off',
};

const LINK_WORD: Readonly<Record<string, string>> = {
  live: 'Live',
  syncing: 'Reading the mixer',
  probing: 'Looking for TotalMix',
  stale: 'TotalMix stopped answering',
  idle: 'Not connected',
};

export function App(props: { readonly rpc: Rpc }): JSX.Element {
  const { rpc } = props;
  const settings = useMemo(() => new SettingsModel(rpc), [rpc]);
  const state = useLive(settings.state);
  const version = useLive(settings.version);
  const link = useLive(rpc.link);
  const mixer = useTopic(rpc, 'mixer');
  const [section, setSection] = useState(() => sectionOf(location.hash));

  useEffect(() => {
    const follow = (): void => {
      setSection(sectionOf(location.hash));
    };
    addEventListener('hashchange', follow);
    return () => {
      removeEventListener('hashchange', follow);
    };
  }, []);

  useEffect(() => {
    document.title = `${section.title} · Faderlight Control Center`;
  }, [section]);

  // Leaving with unsaved edits asks first.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent): void => {
      if (settings.dirty) e.preventDefault();
    };
    addEventListener('beforeunload', warn);
    return () => {
      removeEventListener('beforeunload', warn);
    };
  }, [settings]);

  const dirty = state !== undefined && JSON.stringify(state.draft) !== JSON.stringify(state.saved);
  const Current = section.page;

  return (
    <div class="app">
      <nav class="nav" aria-label="Sections">
        <div class="brand">
          <span class="brand-mark" aria-hidden="true" />
          <span>
            <strong>Faderlight</strong>
            <small>Control Center</small>
          </span>
        </div>
        <ul>
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} aria-current={s.id === section.id ? 'page' : undefined}>
                {s.title}
              </a>
            </li>
          ))}
        </ul>
        <div class="nav-foot">{version && `Plugin ${version}`}</div>
      </nav>
      <main class="main">
        <header class="topbar">
          <span class="mixer-status" data-testid="mixer-status">
            <Dot state={link === 'open' ? (LINK_DOT[mixer?.link ?? 'idle'] ?? 'off') : 'off'} />
            <span>
              {link === 'open' ? (LINK_WORD[mixer?.link ?? 'idle'] ?? '') : 'Not connected'}
              {link === 'open' && mixer?.device !== undefined && (
                <strong class="device"> · {mixer.device}</strong>
              )}
            </span>
          </span>
        </header>
        {link === 'closed' && (
          <div class="banner fail" role="alert">
            The plugin does not answer. If the Stream Deck app restarted, open the Control Center
            again from the Stream Deck (tap the Status key).
          </div>
        )}
        {state === undefined ? (
          <p class="loading">Connecting to the plugin…</p>
        ) : (
          <Current rpc={rpc} settings={settings} />
        )}
        {state !== undefined &&
          (dirty || state.problems.length > 0 || state.error !== undefined) && (
            <div class="savebar" role="region" aria-label="Unsaved changes">
              <div class="savebar-text">
                {state.error !== undefined ? (
                  <span class="fail-text">Not saved: {state.error}</span>
                ) : dirty ? (
                  'You have unsaved changes.'
                ) : (
                  <span>
                    Saved. The plugin adjusted:{' '}
                    {state.problems.map((p) => (
                      <code key={p}>{p}</code>
                    ))}
                  </span>
                )}
              </div>
              {dirty ? (
                <div class="savebar-actions">
                  <Button
                    kind="quiet"
                    onClick={() => {
                      settings.discard();
                    }}
                    disabled={state.saving}
                  >
                    Discard
                  </Button>
                  <Button
                    kind="primary"
                    onClick={() => void settings.save()}
                    disabled={state.saving}
                  >
                    {state.saving ? 'Saving…' : 'Save'}
                  </Button>
                </div>
              ) : (
                <div class="savebar-actions">
                  <Button
                    kind="quiet"
                    onClick={() => {
                      settings.discard();
                    }}
                  >
                    OK
                  </Button>
                </div>
              )}
            </div>
          )}
      </main>
    </div>
  );
}
