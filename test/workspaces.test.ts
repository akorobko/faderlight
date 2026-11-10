// Guards the workspace conventions in AGENTS.md: every workspace is a private ESM package named
// @faderlight/<dir>, and packages are consumed straight from TypeScript source, so plain Node 24
// (type stripping, no build step) must be able to import every exported entry point.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

interface PackageJson {
  name?: string;
  private?: boolean;
  type?: string;
  exports?: string | Record<string, string>;
}

const root = join(import.meta.dirname, '..');

const workspaces = ['packages', 'tools']
  .filter((group) => existsSync(join(root, group)))
  .flatMap((group) =>
    readdirSync(join(root, group), { withFileTypes: true })
      .filter(
        (entry) => entry.isDirectory() && existsSync(join(root, group, entry.name, 'package.json')),
      )
      .map((entry) => {
        const dir = join(root, group, entry.name);
        const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as PackageJson;
        return { path: `${group}/${entry.name}`, dirName: entry.name, dir, pkg };
      }),
  );

const exportTargets = (exports: PackageJson['exports']): string[] =>
  exports === undefined ? [] : typeof exports === 'string' ? [exports] : Object.values(exports);

describe('workspaces', () => {
  it('finds the workspace packages', () => {
    expect(workspaces.length).toBeGreaterThan(0);
  });

  it.each(workspaces)('$path is a private ESM package named @faderlight/<dir>', (ws) => {
    expect(ws.pkg.name).toBe(`@faderlight/${ws.dirName}`);
    expect(ws.pkg.private).toBe(true);
    expect(ws.pkg.type).toBe('module');
  });

  it.each(workspaces.filter((ws) => ws.pkg.exports !== undefined))(
    '$path exports TypeScript source files that exist',
    (ws) => {
      for (const target of exportTargets(ws.pkg.exports)) {
        expect(target).toMatch(/^\.\/src\/.+\.ts$/);
        expect(existsSync(join(ws.dir, target))).toBe(true);
      }
    },
  );

  it('every exported package loads in plain Node without a build step', () => {
    const names = workspaces
      .filter((ws) => ws.pkg.exports !== undefined)
      .map((ws) => ws.pkg.name ?? ws.path);
    const script = names.map((name) => `await import(${JSON.stringify(name)});`).join('\n');
    const run = () =>
      execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
        cwd: root,
        encoding: 'utf8',
        stdio: 'pipe',
      });
    expect(run).not.toThrow();
  }, 30_000);
});
