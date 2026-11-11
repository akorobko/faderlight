import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { packageRoot, thirdPartyNotices } from '../scripts/notices.ts';

const REPO = join(import.meta.dirname, '../../..');

describe('packageRoot', () => {
  it('finds the package a bundled module comes from', () => {
    expect(packageRoot('/r/node_modules/ws/lib/websocket.js')).toBe('/r/node_modules/ws');
    expect(packageRoot('/r/node_modules/@elgato/streamdeck/dist/index.js')).toBe(
      '/r/node_modules/@elgato/streamdeck',
    );
    expect(packageRoot('/r/node_modules/a/node_modules/b/index.js')).toBe(
      '/r/node_modules/a/node_modules/b',
    );
  });

  it("reads Rollup's virtual ids and Windows paths", () => {
    expect(packageRoot('\0/r/node_modules/ws/index.js?commonjs-proxy')).toBe('/r/node_modules/ws');
    expect(packageRoot('C:\\r\\node_modules\\@s\\p\\index.js')).toBe('C:\\r\\node_modules\\@s\\p');
  });

  it("leaves out the repository's own code and Rollup's helpers", () => {
    expect(packageRoot('/r/packages/deck/src/runtime.ts')).toBeUndefined();
    expect(packageRoot('\0commonjsHelpers.js')).toBeUndefined();
  });
});

describe('thirdPartyNotices', () => {
  it('lists each package once, by name, with its licence text, and skips our own', () => {
    const text = thirdPartyNotices([
      join(REPO, 'node_modules/ws/lib/websocket.js'),
      join(REPO, 'node_modules/ws/lib/sender.js'),
      join(REPO, 'node_modules/preact/dist/preact.module.js'),
      join(REPO, 'packages/deck/src/runtime.ts'),
    ]);
    const headings = text.split('\n').filter((l) => /^\S+ \d+\.\d+\.\d+ \(/.test(l));
    expect(headings.map((h) => h.split(' ')[0])).toEqual(['preact', 'ws']);
    expect(headings.every((h) => h.endsWith('(MIT)'))).toBe(true);
    expect(text).toContain('Permission is hereby granted');
  });
});
