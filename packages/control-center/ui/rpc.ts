// The page's side of the JSON-RPC protocol (src/protocol.ts): calls with promises, and topic
// listeners. A topic is subscribed while it has listeners, and again after a reconnect (the
// plugin restarting ends the session for good: the page then says so).

import type { Method, Methods, Notifications, RpcResponse, Topic } from '../src/protocol.ts';
import { Live } from './live.ts';

export type LinkState = 'connecting' | 'open' | 'closed';

type Listener<T extends Topic> = (params: Notifications[T]) => void;

interface Waiting {
  resolve(result: unknown): void;
  reject(error: Error): void;
}

export class RpcError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

export class Rpc {
  /** The WebSocket to the plugin. */
  readonly link = new Live<LinkState>('connecting');
  private readonly url: string;
  private socket: WebSocket | undefined;
  private next = 1;
  private readonly waiting = new Map<number, Waiting>();
  private readonly listeners = new Map<Topic, Set<Listener<Topic>>>();
  private retries = 0;

  constructor(url: string) {
    this.url = url;
  }

  connect(): void {
    this.link.set('connecting');
    const socket = new WebSocket(this.url);
    this.socket = socket;
    socket.addEventListener('open', () => {
      this.retries = 0;
      this.link.set('open');
      const topics = [...this.listeners.keys()];
      if (topics.length > 0) void this.call('subscribe', { topics });
    });
    socket.addEventListener('message', (e: MessageEvent<string>) => {
      this.receive(e.data);
    });
    socket.addEventListener('close', () => {
      this.socket = undefined;
      for (const w of this.waiting.values()) w.reject(new Error('disconnected'));
      this.waiting.clear();
      this.link.set('closed');
      // A short outage: try again a few times. A plugin that restarted has another port.
      if (this.retries++ < 5)
        setTimeout(() => {
          this.connect();
        }, 1000 * this.retries);
    });
  }

  call<M extends Method>(method: M, params?: Methods[M]['params']): Promise<Methods[M]['result']> {
    const socket = this.socket;
    if (socket?.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('not connected to the plugin'));
    }
    const id = this.next++;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  }

  /** Calls `listener` with every notification of a topic until the returned function is called. */
  on<T extends Topic>(topic: T, listener: Listener<T>): () => void {
    let set = this.listeners.get(topic);
    if (!set) {
      set = new Set();
      this.listeners.set(topic, set);
      if (this.link.value === 'open') void this.call('subscribe', { topics: [topic] });
    }
    set.add(listener as Listener<Topic>);
    return () => {
      const s = this.listeners.get(topic);
      if (!s) return;
      s.delete(listener as Listener<Topic>);
      if (s.size === 0) {
        this.listeners.delete(topic);
        if (this.link.value === 'open') void this.call('unsubscribe', { topics: [topic] });
      }
    };
  }

  private receive(text: string): void {
    const m = JSON.parse(text) as RpcResponse & { method?: string; params?: unknown };
    if (typeof m.method === 'string') {
      for (const l of this.listeners.get(m.method as Topic) ?? []) l(m.params as never);
      return;
    }
    if (typeof m.id !== 'number') return;
    const w = this.waiting.get(m.id);
    this.waiting.delete(m.id);
    if (!w) return;
    if (m.error) w.reject(new RpcError(m.error.code, m.error.message));
    else w.resolve(m.result);
  }
}
