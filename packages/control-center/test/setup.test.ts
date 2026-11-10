import { describe, expect, it } from 'vitest';
import type { ConnectionReport } from '../src/diagnostics.ts';
import { NO_REPLY_AFTER_MS, setupChecks, totalMixSteps, type SetupCheck } from '../src/setup.ts';

const LIVE: ConnectionReport = {
  host: '127.0.0.1',
  sendPort: 7002,
  listenPort: 9002,
  transport: 'open',
  localPort: 9002,
  link: 'live',
  linkForMs: 5000,
  device: 'Fireface UFX III',
  synced: true,
  values: 1085,
  source: '127.0.0.1:52391',
  rx: { datagrams: 120, messages: 1300, meters: 400, lastAgoMs: 10, lastMeterAgoMs: 10 },
  tx: { datagrams: 20, lastAgoMs: 500 },
  unsolicited: 3,
  lastUnsolicitedAgoMs: 2000,
  unknown: 0,
  decodeErrors: 0,
  dropped: 0,
};

const states = (checks: SetupCheck[]): Record<string, string> =>
  Object.fromEntries(checks.map((c) => [c.id, c.state]));

describe('the Setup Assistant', () => {
  it('passes every check on a working connection', () => {
    expect(states(setupChecks(LIVE, 'file'))).toEqual({
      port: 'ok',
      reply: 'ok',
      sync: 'ok',
      levels: 'ok',
      changes: 'ok',
      names: 'info',
    });
    expect(setupChecks(LIVE, 'file')[1]?.detail).toBe('Connected to Fireface UFX III.');
  });

  it('names the port when another app holds it', () => {
    const checks = setupChecks(
      {
        ...LIVE,
        transport: 'waiting',
        link: 'idle',
        error: { message: 'bind EADDRINUSE 127.0.0.1:9002', code: 'EADDRINUSE', agoMs: 100 },
      },
      'file',
    );
    expect(checks[0]).toMatchObject({ state: 'fail', title: 'Port 9002 is in use' });
    expect(checks[1]?.state).toBe('wait');
  });

  it('waits a few seconds for a reply, then lists the TotalMix settings', () => {
    const probing = {
      ...LIVE,
      link: 'probing',
      synced: false,
      rx: { ...LIVE.rx, meters: 0 },
    } as const;
    expect(setupChecks({ ...probing, linkForMs: 500 }, 'file')[1]?.state).toBe('wait');
    const failed = setupChecks({ ...probing, linkForMs: NO_REPLY_AFTER_MS }, 'file')[1];
    expect(failed?.state).toBe('fail');
    expect(failed?.detail).toBe('No reply yet from 127.0.0.1:7002.');
    expect(failed?.hint).toEqual(totalMixSteps(LIVE));
    expect(failed?.hint?.join(' ')).toMatch(/Port incoming 7002, Port outgoing 9002/);
  });

  it('says when TotalMix stopped answering', () => {
    expect(setupChecks({ ...LIVE, link: 'stale' }, 'file')[1]).toMatchObject({
      state: 'fail',
      title: 'TotalMix stopped answering',
    });
  });

  it('asks for Send Level Data when no meters arrive', () => {
    const check = setupChecks({ ...LIVE, rx: { ...LIVE.rx, meters: 0 } }, 'file')[3];
    expect(check?.state).toBe('fail');
    expect(check?.hint?.[0]).toMatch(/Send Level Data/);
  });

  it('asks to move a fader until a change made in TotalMix arrives', () => {
    const check = setupChecks({ ...LIVE, unsolicited: 0 }, 'file')[4];
    expect(check).toMatchObject({ state: 'wait' });
    expect(check?.detail).toMatch(/Move a fader/);
    expect(check?.hint?.[0]).toMatch(/Send changes/);
  });

  it('says where snapshot names come from', () => {
    expect(setupChecks(LIVE, 'no-file')[5]?.detail).toMatch(/when it quits/);
    expect(setupChecks(LIVE, 'unsupported')[5]?.detail).toMatch(/not supported/);
  });

  it('asks for this computer’s address when TotalMix runs on another one', () => {
    expect(totalMixSteps({ ...LIVE, host: '192.168.1.20' })[3]).toMatch(/this computer's IP/);
  });
});
