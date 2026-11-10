// Edits of the settings draft that keep it tidy: an emptied box takes its entry out, and a layout
// that is the default again leaves the settings, so a draft that was changed and changed back
// compares equal to what the plugin has. Types only from @faderlight/deck: the page must not
// bundle the deck runtime.

import type {
  BankSource,
  ChannelSettings,
  ColorHex,
  GlobalSettings,
  KeySpec,
  Layout,
  Page,
} from '@faderlight/deck';

/** An object without one of its fields. */
export function omit<T extends object, K extends keyof T>(o: T, key: K): Omit<T, K> {
  return Object.fromEntries(Object.entries(o).filter(([k]) => k !== key)) as Omit<T, K>;
}

/** A map with one entry set, or taken out (undefined). */
export function withEntry<T>(
  map: Readonly<Record<string, T>>,
  key: string,
  value: T | undefined,
): Record<string, T> {
  const rest = Object.fromEntries(Object.entries(map).filter(([k]) => k !== key));
  return value === undefined ? rest : { ...rest, [key]: value };
}

export const channelKey = (bus: string, index: number): string => `${bus}/${String(index)}`;

/** One channel's settings changed; fields set to undefined (or an empty name) go away. */
export function withChannel(
  draft: GlobalSettings,
  key: string,
  change: {
    readonly name?: string | undefined;
    readonly color?: ColorHex | undefined;
    readonly hidden?: boolean | undefined;
  },
): GlobalSettings {
  const merged: Record<string, unknown> = { ...draft.channels[key], ...change };
  const next: { name?: string; color?: ColorHex; hidden?: boolean } = {};
  if (typeof merged.name === 'string' && merged.name.trim() !== '') next.name = merged.name;
  if (typeof merged.color === 'string') next.color = merged.color as ColorHex;
  if (merged.hidden === true) next.hidden = true;
  const value: ChannelSettings | undefined = Object.keys(next).length > 0 ? next : undefined;
  return { ...draft, channels: withEntry(draft.channels, key, value) };
}

/** Where a Level Preset's level is kept: "main/1", "phones2/3", "4/1" (an output index). */
export interface PresetName {
  readonly output: 'main' | `phones${1 | 2 | 3 | 4}` | number;
  readonly n: number;
}

export function parsePreset(key: string): PresetName | undefined {
  const m = /^(main|phones[1-4]|\d+)\/([1-8])$/.exec(key);
  if (!m?.[1] || !m[2]) return undefined;
  const output = /^\d+$/.test(m[1]) ? Number(m[1]) : (m[1] as PresetName['output']);
  return { output, n: Number(m[2]) };
}

// --- layouts ------------------------------------------------------------------------------

/**
 * A layout as the builder keeps it: on each page the strip keys of a bank are numbered in
 * reading order, each bank is as long as its strip keys, and the page has the banks its strip
 * and bank keys name (keeping where each starts). So moving keys never leaves gaps in a bank.
 */
export function tidyLayout(layout: Layout): Layout {
  return { ...layout, pages: layout.pages.map(tidyPage) };
}

function tidyPage(page: Page): Page {
  const counts: number[] = [];
  let banks = 0;
  const keys = page.keys.map((k): KeySpec => {
    if (k.type === 'bank') banks = Math.max(banks, (k.bank ?? 0) + 1);
    if (k.type !== 'strip') return k;
    const bank = k.bank ?? 0;
    banks = Math.max(banks, bank + 1);
    const n = counts[bank] ?? 0;
    counts[bank] = n + 1;
    return { type: 'strip', n, ...(k.style ? { style: k.style } : {}), bank };
  });
  // In the order the plugin writes a page back, so a saved draft compares equal.
  if (banks === 0) return { name: page.name, keys };
  return {
    name: page.name,
    banks: Array.from({ length: banks }, (_, i) => ({
      source: page.banks?.[i]?.source ?? 'input',
      size: Math.max(1, counts[i] ?? 0),
    })),
    keys,
  };
}

const json = (v: unknown): string => JSON.stringify(v);

export const sameLayout = (a: Layout, b: Layout): boolean =>
  json(tidyLayout(a)) === json(tidyLayout(b));

/** The draft with a new layout; one that is the default again leaves the settings. */
export function withLayout(
  draft: GlobalSettings,
  layout: Layout,
  fallback: Layout,
): GlobalSettings {
  const rest: GlobalSettings = omit(draft, 'layout');
  return sameLayout(layout, fallback) ? rest : { ...rest, layout: tidyLayout(layout) };
}

/** One key of a page set. */
export function setKey(layout: Layout, page: number, index: number, spec: KeySpec): Layout {
  return {
    ...layout,
    pages: layout.pages.map((p, i) =>
      i === page ? { ...p, keys: p.keys.map((k, j) => (j === index ? spec : k)) } : p,
    ),
  };
}

/** Two keys of a page swapped (a key dragged onto another). */
export function swapKeys(layout: Layout, page: number, a: number, b: number): Layout {
  const keys = layout.pages[page]?.keys;
  const ka = keys?.[a];
  const kb = keys?.[b];
  if (!ka || !kb) return layout;
  return setKey(setKey(layout, page, a, kb), page, b, ka);
}

/** Page keys that go to a page by number follow it to its new place (`move(old)`). */
function remapPages(layout: Layout, move: (old: number) => number | undefined): Layout {
  return {
    ...layout,
    pages: layout.pages.map((p) => ({
      ...p,
      keys: p.keys.map((k): KeySpec => {
        if (k.type !== 'page' || k.to === undefined) return k;
        const to = move(k.to);
        return to === undefined ? { type: 'page', direction: 'next' } : { type: 'page', to };
      }),
    })),
  };
}

export function movePage(layout: Layout, from: number, to: number): Layout {
  const pages = [...layout.pages];
  const [page] = pages.splice(from, 1);
  if (!page || to < 0 || to > pages.length) return layout;
  pages.splice(to, 0, page);
  const order = pages.map((p) => layout.pages.indexOf(p));
  return remapPages({ ...layout, pages }, (old) => order.indexOf(old));
}

/** A page taken out; keys that went to it go to the next page instead. */
export function removePage(layout: Layout, index: number): Layout {
  if (layout.pages.length <= 1) return layout;
  const pages = layout.pages.filter((_, i) => i !== index);
  return remapPages({ ...layout, pages }, (old) =>
    old === index ? undefined : old > index ? old - 1 : old,
  );
}

export function addPage(layout: Layout, name: string): Layout {
  const keys = Array.from({ length: layout.columns * layout.rows }, () => EMPTY_KEY);
  return { ...layout, pages: [...layout.pages, { name, keys }] };
}

export function renamePage(layout: Layout, index: number, name: string): Layout {
  return {
    ...layout,
    pages: layout.pages.map((p, i) => (i === index ? { ...p, name } : p)),
  };
}

export function setBankSource(
  layout: Layout,
  page: number,
  bank: number,
  source: BankSource,
): Layout {
  return {
    ...layout,
    pages: layout.pages.map((p, i) =>
      i === page && p.banks
        ? { ...p, banks: p.banks.map((b, j) => (j === bank ? { ...b, source } : b)) }
        : p,
    ),
  };
}

export const EMPTY_KEY: KeySpec = { type: 'empty' };
