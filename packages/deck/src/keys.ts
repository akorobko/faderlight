// The controller for each spec type (controllers.ts, and detail.ts for the overlay).

import { CONTROLLERS, type Controller } from './controllers.ts';
import { detailController } from './detail.ts';
import type { KeySpec } from './specs.ts';

/** The controller for a spec, typed for that spec. */
export function controllerFor<S extends KeySpec>(spec: S): Controller<S> {
  const c = spec.type === 'detail' ? detailController : CONTROLLERS[spec.type];
  return c as unknown as Controller<S>;
}
