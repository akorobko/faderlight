// A value that components can follow (useLive), and the hook that follows a topic.

import { useEffect, useState } from 'preact/hooks';
import type { Notifications, Topic } from '../src/protocol.ts';
import type { Rpc } from './rpc.ts';

export class Live<T> {
  private current: T;
  private readonly listeners = new Set<(v: T) => void>();

  constructor(value: T) {
    this.current = value;
  }

  get value(): T {
    return this.current;
  }

  set(value: T): void {
    if (Object.is(value, this.current)) return;
    this.current = value;
    for (const l of this.listeners) l(value);
  }

  subscribe(listener: (v: T) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

/** The current value of a Live, redrawing the component when it changes. */
export function useLive<T>(live: Live<T>): T {
  const [value, setValue] = useState(live.value);
  useEffect(() => {
    setValue(live.value);
    return live.subscribe(setValue);
  }, [live]);
  return value;
}

/** The latest notification of a topic, while the component is shown. */
export function useTopic<T extends Topic>(rpc: Rpc, topic: T): Notifications[T] | undefined {
  const [value, setValue] = useState<Notifications[T] | undefined>(undefined);
  useEffect(() => rpc.on(topic, setValue), [rpc, topic]);
  return value;
}
