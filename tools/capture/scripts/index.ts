// Capture scripts, selected with `--script <id>`.

import type { Script } from '../src/steps.ts';
import { baseline } from './baseline.ts';

export const scripts: Readonly<Record<string, Script>> = { [baseline.id]: baseline };
