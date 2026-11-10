// A mixer for deck tests without sockets: the TotalMix client talks to a simulated mixer
// (packages/simulator) through a fake link, all on one fake clock, so a test controls every
// reply and every timer.
import { MixerStore, type Target, type Value } from '@faderlight/model';
import { studioMixer, type SimMixer } from '@faderlight/simulator';
import { TotalMixClient } from '@faderlight/totalmix';
import type { MixerControl } from '../src/index.ts';
import { FakeClock } from './clock.ts';

export class Loopback implements MixerControl {
  readonly clock: FakeClock;
  readonly sim: SimMixer;
  readonly store = new MixerStore();
  readonly client: TotalMixClient;
  /** Writes the deck made, in order. */
  readonly writes: [Target, Value][] = [];
  /** While false, the mixer does not answer (TotalMix closed). */
  answering = true;

  constructor(clock = new FakeClock(), sim: SimMixer = studioMixer()) {
    this.clock = clock;
    this.sim = sim;
    this.client = new TotalMixClient(
      {
        send: (message) => {
          if (!this.answering) return true;
          const replies = this.sim.handle(message);
          this.clock.setTimeout(() => {
            for (const r of replies) this.client.receive(r);
          }, 1);
          return true;
        },
      },
      this.store,
      { clock: this.clock },
    );
  }

  /** Starts the client and runs the clock until it is live. */
  connect(): this {
    this.client.start();
    for (let t = 0; t < 10_000 && this.client.state !== 'live'; t += 50) this.clock.advance(50);
    if (this.client.state !== 'live') throw new Error(`not live: ${this.client.state}`);
    return this;
  }

  set(target: Target, value: Value): boolean {
    this.writes.push([target, value]);
    return this.client.set(target, value);
  }

  loadSnapshot(n: number): boolean {
    return this.client.loadSnapshot(n);
  }

  resync(): void {
    this.client.resync();
  }
}
