// Identifiers the Stream Deck app knows the plugin by. The plugin UUID is also the name of the
// .sdPlugin folder; every action UUID is the plugin UUID plus the action's kind.

import { isActionKind, type ActionKind } from '@faderlight/deck';

export const PLUGIN_UUID = 'dev.faderlight.mixer';

export const actionUuid = (kind: ActionKind): string => `${PLUGIN_UUID}.${kind}`;

/** The kind of one of our action UUIDs, or undefined for anything else. */
export function kindOfAction(uuid: string): ActionKind | undefined {
  const prefix = `${PLUGIN_UUID}.`;
  if (!uuid.startsWith(prefix)) return undefined;
  const kind = uuid.slice(prefix.length);
  return isActionKind(kind) ? kind : undefined;
}

/** The bundled Console profile, as the manifest names it (its path without the extension). */
export const CONSOLE_PROFILE = 'profiles/Console';
