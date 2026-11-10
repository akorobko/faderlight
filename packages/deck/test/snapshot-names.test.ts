import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DeckRuntime,
  parseSnapshotNames,
  totalMixFolder,
  TotalMixSnapshotNames,
} from '../src/index.ts';
import { renderJson, TestHost } from './host.ts';
import { Loopback } from './loopback.ts';

// A made-up state file in the shape TotalMix writes: only the parts the reader looks at.
const stateFile = (names: readonly string[]) =>
  [
    '<Preferences>',
    '  <General>',
    '    <val e="Something Else" v="1"/>',
    ...names.map((n, i) => `    <val e="SnapshotName ${String(i)}" v="${n}"/>`),
    '  </General>',
    '</Preferences>',
  ].join('\n');

describe('snapshot names from TotalMix', () => {
  const folders: string[] = [];
  const folder = () => {
    const dir = mkdtempSync(join(tmpdir(), 'faderlight-snapshots-'));
    folders.push(dir);
    return dir;
  };
  afterEach(() => {
    for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('reads all eight names, decodes entities and skips empty ones', () => {
    const names = parseSnapshotNames(
      stateFile(['Work', 'PC &amp; Mac', '', 'Mix &#52;', 'Mix 5', 'Mix 6', 'Mix 7', 'Mix 8']),
    );
    expect(names).toEqual([
      'Work',
      'PC & Mac',
      undefined,
      'Mix 4',
      'Mix 5',
      'Mix 6',
      'Mix 7',
      'Mix 8',
    ]);
    expect(parseSnapshotNames('<General/>')).toEqual(Array(8).fill(undefined));
  });

  it('knows where TotalMix keeps its state on macOS only', () => {
    expect(totalMixFolder('darwin', '/Users/someone')).toBe(
      '/Users/someone/Library/Application Support/RME TotalMix FX',
    );
    expect(totalMixFolder('win32', 'C:\\Users\\someone')).toBeUndefined();
  });

  it('uses the newest state file, and reads it again when it changes', () => {
    const dir = folder();
    let now = 0;
    writeFileSync(join(dir, 'last.ModelA000.xml'), stateFile(['Old']));
    utimesSync(join(dir, 'last.ModelA000.xml'), 1000, 1000);
    writeFileSync(join(dir, 'last.ModelB111.xml'), stateFile(['Work', 'Music']));
    writeFileSync(join(dir, 'other.xml'), stateFile(['Not this']));
    const names = new TotalMixSnapshotNames(dir, 5000, () => now);
    expect([names.name(1), names.name(2), names.name(3)]).toEqual(['Work', 'Music', undefined]);

    writeFileSync(join(dir, 'last.ModelB111.xml'), stateFile(['Tracking']));
    utimesSync(join(dir, 'last.ModelB111.xml'), 5_000_000, 5_000_000);
    expect(names.name(1)).toBe('Work');
    now = 5000;
    expect(names.name(1)).toBe('Tracking');
  });

  it('has no names when the folder or the file is missing', () => {
    expect(new TotalMixSnapshotNames(join(folder(), 'missing')).name(1)).toBeUndefined();
    expect(new TotalMixSnapshotNames(undefined).name(1)).toBeUndefined();
  });

  it('shows the names on the Snapshot keys', () => {
    const mixer = new Loopback().connect();
    const host = new TestHost();
    const deck = new DeckRuntime({
      mixer,
      host,
      clock: mixer.clock,
      render: renderJson,
      snapshotNames: { name: (n) => ['Work', 'Music'][n - 1] },
    });
    deck.appear({ id: 's1', device: 'XL', kind: 'snapshot', settings: { n: 1 } });
    deck.appear({ id: 's3', device: 'XL', kind: 'snapshot', settings: { n: 3 } });
    mixer.clock.advance(200);
    expect(host.view('s1')).toMatchObject({ kind: 'snapshot', n: 1, name: 'Work' });
    expect(host.view('s3')).toMatchObject({ kind: 'snapshot', n: 3 });
    expect(host.view('s3')).not.toHaveProperty('name');
  });
});
