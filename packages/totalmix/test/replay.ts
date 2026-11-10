// Answers state requests over UDP with the datagrams TotalMix sent for them in a capture.
// Not a simulator (that is packages/simulator, M2): it knows only the recorded requests, and like
// TotalMix it sends nothing back for numeric writes.
import { createSocket, type Socket } from 'node:dgram';
import { decodePacket, formatMessage, messagesOf, type OscMessage } from '@faderlight/osc';
import { step, type Capture } from './capture.ts';

/** Capture steps whose request is replayed, and the request each one sent. */
const REPLAYED_STEPS = [
  'sendstate',
  'sendsettings',
  'sendchan-input',
  'sendchan-playback',
  'sendchan-output',
  'sendchan-phones',
  'sendsubmix',
  'sendmix',
  'sendall-2',
  'sendall-1',
];

export class CaptureReplay {
  /** Requests and writes received, as text. */
  readonly received: string[] = [];
  private readonly replies = new Map<string, Uint8Array[]>();
  private inSocket: Socket | undefined;
  private outSocket: Socket | undefined;
  private client: { address: string; port: number } | undefined;
  private quit = false;
  private readonly meterFrame: Uint8Array | undefined;

  constructor(capture: Capture) {
    this.meterFrame = capture.received.find((d) => d.meter)?.raw;
    for (const id of REPLAYED_STEPS) {
      const s = step(capture, id);
      const request = s.sent[0]?.messages[0];
      if (!request) continue;
      this.replies.set(
        formatMessage(request),
        s.received.filter((d) => !d.meter).map((d) => d.raw),
      );
    }
  }

  /** Port that takes requests ("Port incoming"). */
  get port(): number {
    return this.inSocket?.address().port ?? 0;
  }

  /** Port that replies come from; changes on restart(). */
  get sourcePort(): number {
    return this.outSocket?.address().port ?? 0;
  }

  async start(): Promise<void> {
    const socket = createSocket('udp4');
    socket.on('message', (data, rinfo) => {
      this.client = { address: rinfo.address, port: rinfo.port };
      for (const m of messagesOf(decodePacket(new Uint8Array(data)))) this.onMessage(m);
    });
    await bind(socket);
    this.inSocket = socket;
    this.outSocket = await openOut();
  }

  /** Stops answering, like a TotalMix that was quit. */
  stopAnswering(): void {
    this.quit = true;
  }

  /** Answers again from a new source port, like a restarted TotalMix. */
  async restart(): Promise<void> {
    const old = this.outSocket;
    this.outSocket = await openOut();
    if (old) await close(old);
    this.quit = false;
  }

  /** Sends one recorded meter frame from the current source port. */
  sendMeters(): void {
    if (this.meterFrame) this.send(this.meterFrame);
  }

  async stop(): Promise<void> {
    for (const s of [this.inSocket, this.outSocket]) if (s) await close(s);
    this.inSocket = this.outSocket = undefined;
  }

  private onMessage(m: OscMessage): void {
    const text = formatMessage(m);
    this.received.push(text);
    if (this.quit) return;
    for (const raw of this.replies.get(text) ?? []) this.send(raw);
  }

  private send(raw: Uint8Array): void {
    if (!this.client || !this.outSocket) return;
    this.outSocket.send(raw, this.client.port, this.client.address);
  }
}

function bind(socket: Socket): Promise<void> {
  return new Promise((resolve) => {
    socket.bind(0, '127.0.0.1', resolve);
  });
}

async function openOut(): Promise<Socket> {
  const socket = createSocket('udp4');
  await bind(socket);
  return socket;
}

function close(socket: Socket): Promise<void> {
  return new Promise((resolve) => {
    socket.close(() => {
      resolve();
    });
  });
}
