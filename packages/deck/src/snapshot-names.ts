// Snapshot names from TotalMix FX's own state file. Global OSC does not send them (no request
// or address for them is known, docs/protocol/global-osc.md §9), but TotalMix keeps them in
// the XML file it writes when it quits:
//
//   macOS: ~/Library/Application Support/RME TotalMix FX/last.<model><serial>.xml
//          <val e="SnapshotName 0" v="…"/> to "SnapshotName 7", inside <General>
//
// The file name holds the interface's serial number, so it is only ever read here, never
// logged or copied. Where TotalMix keeps this file on Windows is not known yet. A name renamed
// in TotalMix shows after TotalMix has quit once (that is when it writes the file).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { SnapshotNames } from './runtime.ts';

/** The eight snapshot names in a TotalMix state file, by snapshot (index 0 is snapshot 1). */
export function parseSnapshotNames(xml: string): (string | undefined)[] {
  const names: (string | undefined)[] = Array<string | undefined>(8).fill(undefined);
  for (const m of xml.matchAll(/<val\s+e="SnapshotName (\d)"\s+v="([^"]*)"\s*\/>/g)) {
    const i = Number(m[1]);
    const name = decodeXml(m[2] ?? '').trim();
    if (i < 8 && name !== '') names[i] = name;
  }
  return names;
}

function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, e: string) => {
    const lower = e.toLowerCase();
    if (lower.startsWith('#x')) return String.fromCodePoint(parseInt(lower.slice(2), 16));
    if (lower.startsWith('#')) return String.fromCodePoint(parseInt(lower.slice(1), 10));
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[lower] ?? whole;
  });
}

/** The folder TotalMix FX keeps its state in on this computer; undefined: not known. */
export function totalMixFolder(platform = process.platform, home = homedir()): string | undefined {
  return platform === 'darwin'
    ? join(home, 'Library', 'Application Support', 'RME TotalMix FX')
    : undefined;
}

/**
 * Reads snapshot names from the newest TotalMix state file in a folder, and again when that
 * file changes (checked at most every `checkMs`). Any failure (no folder, no file, unreadable)
 * means no names, never an error.
 */
export class TotalMixSnapshotNames implements SnapshotNames {
  private readonly folder: string | undefined;
  private readonly checkMs: number;
  private readonly now: () => number;
  private names: (string | undefined)[] = [];
  private checked = -Infinity;
  private seen = '';

  /** `folder`: where to look (`totalMixFolder()` on this computer); undefined: nowhere. */
  constructor(folder: string | undefined, checkMs = 5000, now: () => number = Date.now) {
    this.folder = folder;
    this.checkMs = checkMs;
    this.now = now;
  }

  name(n: number): string | undefined {
    const now = this.now();
    if (now - this.checked >= this.checkMs) {
      this.checked = now;
      this.refresh();
    }
    return this.names[n - 1];
  }

  private refresh(): void {
    const file = this.newestFile();
    if (!file) {
      this.names = [];
      this.seen = '';
      return;
    }
    const stamp = `${file.path}@${String(file.mtimeMs)}`;
    if (stamp === this.seen) return;
    try {
      this.names = parseSnapshotNames(readFileSync(file.path, 'utf8'));
      this.seen = stamp;
    } catch {
      this.names = [];
      this.seen = '';
    }
  }

  private newestFile(): { path: string; mtimeMs: number } | undefined {
    if (this.folder === undefined) return undefined;
    let newest: { path: string; mtimeMs: number } | undefined;
    try {
      for (const name of readdirSync(this.folder)) {
        if (!/^last\..*\.xml$/i.test(name)) continue;
        const path = join(this.folder, name);
        const { mtimeMs } = statSync(path);
        if (!newest || mtimeMs > newest.mtimeMs) newest = { path, mtimeMs };
      }
    } catch {
      return undefined;
    }
    return newest;
  }
}
