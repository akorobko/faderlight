import { describe, expect, it } from 'vitest';
import { message, TRUE, int } from '@faderlight/osc';
import {
  bandMixer,
  fullMixer,
  meterSignals,
  parseAddress,
  SimMixer,
  studioMixer,
} from '../src/index.ts';
import { flat, req, set, texts } from './helpers.ts';

/** UFX III with Mic 9/10 as a stereo strip, Mic 11 mono, AN 1/2 out as Main, all else hidden. */
function small(): SimMixer {
  const m = new SimMixer({ hidden: true });
  m.setVisible('input', 8, true);
  m.setStereo('input', 8, true);
  m.setVisible('input', 10, true);
  m.setVisible('playback', 0, true);
  m.setStereo('playback', 0, true);
  m.setVisible('output', 0, true);
  m.setStereo('output', 0, true);
  m.setValue('/output/0/volume', -20);
  m.saveSnapshot(1);
  return m;
}

describe('parseAddress', () => {
  it('knows channel, route, setting, snapshot and status addresses', () => {
    expect(parseAddress('/input/8/eq/band1freq')).toEqual({
      kind: 'channel',
      bus: 'input',
      index: 8,
      field: 'eq/band1freq',
    });
    expect(parseAddress('/mix/pb/0/2/fader')).toEqual({
      kind: 'route',
      source: 'pb',
      index: 0,
      output: 2,
      field: 'fader',
    });
    expect(parseAddress('/controlroom/dim')).toEqual({
      kind: 'setting',
      address: '/controlroom/dim',
    });
    expect(parseAddress('/snapshot/load/8')).toEqual({ kind: 'snapshot', n: 8 });
    expect(parseAddress('/durec/state')).toEqual({ kind: 'status', field: 'durec' });
  });

  it('rejects what TotalMix does not have', () => {
    for (const a of [
      '/input/8/pfl',
      '/input/x/mute',
      '/mix/out/0/0/fader',
      '/snapshot/load/9',
      '/controlroom/recall',
      '/faderlight/probe',
    ]) {
      expect(parseAddress(a), a).toBeUndefined();
    }
  });
});

describe('requests', () => {
  it('answers /sendstate with device, connection, DSP and DURec state', () => {
    expect(flat(new SimMixer().handle(req('/sendstate')))).toEqual([
      '/status/device s:"Fireface UFX III (00000000)"',
      '/status/connection f:1',
      '/status/dsp f:0',
      '/durec/state s:"Not ready"',
    ]);
  });

  it('ignores the argument of a request', () => {
    const m = small();
    const plain = flat(m.handle(message('/sendchan/input/8')));
    expect(flat(m.handle(message('/sendchan/input/8', int(7))))).toEqual(plain);
    expect(plain.length).toBeGreaterThan(0);
  });

  it('sends settings, then the snapshot states in an emission of their own', () => {
    const reply = texts(small().handle(req('/sendsettings')));
    expect(reply).toHaveLength(2);
    expect(reply[0]?.[0]).toBe('/globalmute f:0');
    expect(reply[0]).toHaveLength(54);
    expect(reply[1]).toEqual([
      '/snapshot/load/1 f:2',
      ...[2, 3, 4, 5, 6, 7, 8].map((k) => `/snapshot/load/${String(k)} f:0`),
    ]);
  });

  it('sends a mic channel in TotalMix order, with 48V, Inst and AutoSet but no ref level', () => {
    const reply = flat(small().handle(req('/sendchan/input/10')));
    expect(reply.slice(0, 6)).toEqual([
      '/input/10/stereo f:0',
      '/input/10/name s:"Mic 11"',
      '/input/10/mute f:0',
      '/input/10/gain f:0',
      '/input/10/autoset f:0',
      '/input/10/phase f:0',
    ]);
    expect(reply).toHaveLength(41);
    expect(reply.at(-1)).toBe('/input/10/color f:1');
    expect(reply.some((t) => t.includes('reflevel'))).toBe(false);
  });

  it('sends only per-side settings for the right channel of a stereo strip', () => {
    expect(flat(small().handle(req('/sendchan/input/9')))).toEqual([
      '/input/9/gain f:0',
      '/input/9/phase f:0',
      '/input/9/playchan f:0',
    ]);
    expect(flat(small().handle(req('/sendchan/playback/1')))).toEqual(['/playback/1/phase f:0']);
  });

  it('sends nothing for hidden or missing channels and unknown requests', () => {
    const m = small();
    for (const a of ['/sendchan/input/0', '/sendchan/input/500', '/sendsubmix/1', '/sendmore']) {
      expect(m.handle(req(a)), a).toEqual([]);
    }
  });

  it('sends a submix with every visible source, routes that are off included', () => {
    expect(flat(small().handle(req('/sendsubmix/0')))).toEqual([
      '/mix/in/8/0/fader f:-300',
      '/mix/in/8/0/balpan f:0',
      '/mix/in/8/0/groupflags f:0',
      '/mix/in/8/0/solo f:0',
      '/mix/in/10/0/fader f:-300',
      '/mix/in/10/0/balpan f:0',
      '/mix/in/10/0/groupflags f:0',
      '/mix/in/10/0/solo f:0',
      // TotalMix's factory routing: playback n to output n at 0 dB.
      '/mix/pb/0/0/fader f:0',
      '/mix/pb/0/0/balpan f:0',
      '/mix/pb/0/0/groupflags f:0',
      '/mix/pb/0/0/solo f:0',
    ]);
  });

  it('/sendall 2 leaves out routes at or below -65 dB', () => {
    const m = small();
    m.setValue('/mix/in/8/0/fader', -65);
    m.setValue('/mix/in/10/0/fader', -64.9);
    const all = flat(m.handle(req('/sendall', 1)));
    const on = flat(m.handle(req('/sendall', 2)));
    const routes = (list: string[]): string[] =>
      list.filter((t) => t.startsWith('/mix/') && t.includes('/fader'));
    expect(routes(all)).toHaveLength(3);
    expect(routes(on)).toEqual(['/mix/in/10/0/fader f:-64.9000015258789', '/mix/pb/0/0/fader f:0']);
  });

  it('/sendall sends state, channels, settings and routes, then the snapshot states', () => {
    const reply = texts(small().handle(req('/sendall', 1)));
    expect(reply).toHaveLength(2);
    const [main = [], snapshots = []] = reply;
    expect(main.slice(0, 4).map((t) => t.split(' ')[0])).toEqual([
      '/status/device',
      '/status/connection',
      '/status/dsp',
      '/durec/state',
    ]);
    const firstOf = (prefix: string): number => main.findIndex((t) => t.startsWith(prefix));
    expect(firstOf('/input/8/')).toBeLessThan(firstOf('/input/9/'));
    expect(firstOf('/input/9/')).toBeLessThan(firstOf('/playback/0/'));
    expect(firstOf('/playback/1/')).toBeLessThan(firstOf('/output/0/'));
    expect(firstOf('/output/1/')).toBeLessThan(firstOf('/globalmute'));
    expect(firstOf('/echo/width')).toBeLessThan(firstOf('/mix/'));
    expect(snapshots).toHaveLength(8);
  });

  it('a full layout sends a reply in the tens of thousands of messages', () => {
    const count = flat(fullMixer().handle(req('/sendall', 1))).length;
    expect(count).toBeGreaterThan(20_000);
  });
});

describe('writes', () => {
  it('sets a value without echoing it; the next request shows it', () => {
    const m = small();
    m.handle(req('/sendsettings')); // snapshot 1 is active
    expect(texts(m.handle(set('/input/8/mute', 1)))).toEqual([['/snapshot/load/1 f:3']]);
    expect(flat(m.handle(req('/sendchan/input/8')))).toContain('/input/8/mute f:1');
  });

  it('marks the active snapshot as modified only once', () => {
    const m = small();
    m.handle(set('/input/8/mute', 1));
    expect(m.handle(set('/input/8/mute', 0))).toEqual([]);
    expect(m.get('/snapshot/load/1')).toBe(3);
  });

  it('accepts float, int and True for switches, and sets rather than toggles', () => {
    const m = small();
    m.handle(message('/input/8/mute', int(1)));
    expect(m.get('/input/8/mute')).toBe(1);
    m.handle(message('/input/8/mute', TRUE));
    expect(m.get('/input/8/mute')).toBe(1);
    m.handle(set('/input/8/mute', 0));
    m.handle(set('/input/8/mute', 0));
    expect(m.get('/input/8/mute')).toBe(0);
  });

  it('echoes a name write', () => {
    const m = small();
    expect(texts(m.handle(set('/input/8/name', 'Vox')))).toEqual([['/input/8/name s:"Vox"']]);
    expect(m.get('/snapshot/load/1')).toBe(2); // names are not snapshot state
  });

  it('ignores writes to hidden channels, strip settings at a right index and wrong types', () => {
    const m = small();
    for (const msg of [
      set('/input/0/mute', 1),
      set('/input/9/mute', 1),
      set('/input/8/mute', 'yes'),
      set('/input/8/name', 3),
      set('/input/12/48v', 1), // digital input: no 48V
      set('/status/dsp', 50),
      set('/faderlight/probe', 1),
    ]) {
      expect(m.handle(msg), msg.address).toEqual([]);
    }
    expect(m.get('/input/0/mute')).toBe(0);
    expect(m.get('/input/9/mute')).toBe(0);
    expect(m.get('/snapshot/load/1')).toBe(2);
  });

  it('snaps mic and line gain to the preamp range', () => {
    const m = small();
    m.handle(set('/input/8/gain', 3));
    expect(m.get('/input/8/gain')).toBe(8); // mic gain jumps from 0 to 8 dB
    m.handle(set('/input/9/gain', 99));
    expect(m.get('/input/9/gain')).toBe(75);
    m.handle(set('/input/8/instrument', 1));
    m.handle(set('/input/8/gain', 60));
    expect(m.get('/input/8/gain')).toBe(50);
  });

  it('Dim sends the dimmed Main volume, not the dim state', () => {
    const m = small();
    expect(texts(m.handle(set('/controlroom/dim', 1)))).toEqual([['/output/0/volume f:-40']]);
    expect(m.get('/output/0/volume')).toBe(-40);
    expect(texts(m.handle(set('/controlroom/dim', 0)))).toEqual([['/output/0/volume f:-20']]);
  });

  it('a Main volume write while dimmed sets the dimmed value', () => {
    const m = small();
    m.handle(set('/controlroom/dim', 1));
    m.handle(set('/output/0/volume', -30));
    expect(m.get('/output/0/volume')).toBe(-30);
    m.handle(set('/controlroom/dim', 0));
    expect(m.get('/output/0/volume')).toBe(-10);
  });

  it('writes a route fader within -300 to +6 dB', () => {
    const m = small();
    m.handle(set('/mix/in/8/0/fader', -4.5));
    expect(m.get('/mix/in/8/0/fader')).toBe(-4.5);
    m.handle(set('/mix/in/8/0/fader', 20));
    expect(m.get('/mix/in/8/0/fader')).toBe(6);
    expect(m.handle(set('/mix/in/9/0/fader', 0))).toEqual([]); // right index
    expect(m.handle(set('/mix/in/8/1/fader', 0))).toEqual([]); // right index
  });

  it('a stereo write pairs or splits strips', () => {
    const m = small();
    m.handle(set('/input/8/stereo', 0));
    expect(m.strips('input')).toEqual([8, 9, 10]);
    expect(m.get('/input/8/name')).toBe('Mic 9');
    m.handle(set('/input/8/stereo', 1));
    expect(m.strips('input')).toEqual([8, 10]);
    expect(m.get('/input/8/name')).toBe('Mic 9/10');
  });
});

describe('changes made in TotalMix', () => {
  it('are sent, followed by the snapshot becoming modified', () => {
    const m = small();
    expect(texts(m.change('/input/8/mute', true))).toEqual([
      ['/input/8/mute f:1'],
      ['/snapshot/load/1 f:3'],
    ]);
    expect(m.change('/input/8/mute', true)).toEqual([]);
  });

  it('a solo click reports the route group flags with it', () => {
    expect(texts(small().change('/mix/in/8/0/solo', 1))[0]).toEqual([
      '/mix/in/8/0/groupflags f:0',
      '/mix/in/8/0/solo f:1',
    ]);
  });

  it('Dim reports the Main volume, then the dim state', () => {
    expect(texts(small().change('/controlroom/dim', 1))).toEqual([
      ['/output/0/volume f:-40', '/controlroom/dim f:1'],
    ]);
  });
});

describe('snapshots', () => {
  it('a load restores values, sends those that changed, then the states', () => {
    const m = small();
    m.setValue('/input/8/mute', 1);
    m.setValue('/output/0/mute', 1);
    m.setValue('/mix/in/10/0/fader', -6);
    m.saveSnapshot(2);
    m.loadSnapshot(1);
    expect(texts(m.loadSnapshot(2))).toEqual([
      ['/input/8/mute f:1', '/output/0/mute f:1', '/mix/in/10/0/fader f:-6'],
      ['/snapshot/load/1 f:0', '/snapshot/load/2 f:2'],
    ]);
    expect(texts(m.handle(set('/snapshot/load/1', 1)))).toEqual([
      ['/input/8/mute f:0', '/output/0/mute f:0', '/mix/in/10/0/fader f:-300'],
      ['/snapshot/load/1 f:2', '/snapshot/load/2 f:0'],
    ]);
  });

  it('a slot never saved only switches the states', () => {
    expect(texts(small().loadSnapshot(5))).toEqual([
      ['/snapshot/load/1 f:0', '/snapshot/load/5 f:2'],
    ]);
  });

  it('reloading a modified snapshot makes it active again', () => {
    const m = small();
    m.change('/input/8/mute', 1);
    expect(texts(m.loadSnapshot(1))).toEqual([['/input/8/mute f:0'], ['/snapshot/load/1 f:2']]);
  });
});

describe('layouts', () => {
  it('the studio layout shows a few named strips and has snapshot 1 active', () => {
    const m = studioMixer();
    expect(m.strips('input')).toEqual([0, 8, 9, 10]);
    expect(m.strips('playback')).toEqual([0, 2]);
    expect(m.strips('output')).toEqual([0, 8, 10]);
    expect(m.get('/input/8/name')).toBe('Vocal');
    expect(m.get('/input/8/48v')).toBe(1);
    expect(m.get('/controlroom/mainout')).toBe(0);
    expect(m.get('/snapshot/load/1')).toBe(2);
    expect(texts(m.loadSnapshot(2))[0]).toEqual([
      '/input/0/mute f:1',
      '/playback/2/mute f:1',
      '/mix/in/8/8/fader f:0',
    ]);
  });

  it('the band layout fills both channel rows of the Console and mutes the synth', () => {
    const m = bandMixer();
    expect(m.strips('input')).toEqual([0, 2, 4, 8, 9, 10, 11, 14, 16]);
    expect(m.strips('playback')).toEqual([0, 2, 4, 6]);
    expect(m.strips('output')).toEqual([0, 2, 8, 10, 12, 14]);
    expect(m.get('/input/2/mute')).toBe(1);
    expect(m.get('/input/9/instrument')).toBe(1);
    expect(m.get('/snapshot/load/1')).toBe(2);
    const signals = meterSignals('band', m);
    expect(signals.get('in/10')).toMatchObject({ type: 'drums' });
    expect(signals.get('in/8')).toMatchObject({ type: 'noise', db: -18 });
    expect(signals.get('pb/2')).toMatchObject({ type: 'noise', db: -40 });
  });

  it('a higher sample rate removes ADAT and MADI channels', () => {
    const m = fullMixer();
    expect(m.visibleChannels('input')).toHaveLength(94);
    m.setSpeed('double');
    expect(m.visibleChannels('input')).toHaveLength(54);
    expect(m.handle(req('/sendchan/input/60'))).toEqual([]);
    m.setSpeed('quad');
    expect(m.strips('output')).toHaveLength(17);
  });
});
