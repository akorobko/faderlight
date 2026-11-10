// Where the plugin's files live in the repo.

import { join } from 'node:path';
import { PLUGIN_UUID } from '../src/ids.ts';

export const PACKAGE_DIR = join(import.meta.dirname, '..');

/** The folder the Stream Deck app loads (`streamdeck link` points at it). */
export const PLUGIN_DIR = join(PACKAGE_DIR, `${PLUGIN_UUID}.sdPlugin`);

export const FONTS_DIR = join(PACKAGE_DIR, '../render/fonts');
