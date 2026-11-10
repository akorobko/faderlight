// M0.3 baseline capture: about 5 minutes with a TotalMix FX + interface on Global OSC.
//
// Order matters: the idle step learns the background traffic (heartbeats), the request
// steps fill the value table that later write steps restore from, and manual steps come
// before writes so the person can see their own clicks echoed first.
//
// To answer a new hardware question, add a step here (or a new script next to this one)
// with a `why` that states the question, and ask for a new capture in the PR.

import {
  f,
  i,
  listen,
  manual,
  msg,
  nudgeDb,
  request,
  same,
  text,
  toggle,
  write,
  type Script,
} from '../src/steps.ts';

const sendchanIn = msg('/sendchan/input/{in}', f(1));

export const baseline: Script = {
  id: 'baseline',
  title: 'Baseline capture (about 5 minutes)',
  intro: [
    'This records what TotalMix FX sends and receives over Global OSC, step by step.',
    'Most steps run on their own. A few ask you to click something in TotalMix, and a few',
    'change a value for about a second and put it back (you will be asked first).',
    'Test channels (0-based): input {in}, output {out}, phones {ph}; change them with --input,',
    '--output and --phones if your interface differs from a UFX III.',
  ],
  steps: [
    listen({
      id: 'idle',
      title: 'Listen without sending anything',
      why: 'What does TotalMix send unprompted (heartbeat, /status/*, levels), and how often?',
      ms: 6000,
      background: true,
    }),

    // --- state requests -------------------------------------------------------------
    request({
      id: 'sendstate',
      title: 'Request /sendstate',
      why: 'What does /sendstate return?',
      send: [msg('/sendstate', f(1))],
    }),
    request({
      id: 'sendsettings',
      title: 'Request /sendsettings',
      why: 'What does /sendsettings return?',
      send: [msg('/sendsettings', f(1))],
    }),
    request({
      id: 'sendchan-input',
      title: 'Request one input channel ({inName})',
      why: 'Which per-channel addresses and argument types exist for a mic input?',
      send: [sendchanIn],
    }),
    request({
      id: 'sendchan-playback',
      title: 'Request one playback channel',
      why: 'Which addresses exist for a playback channel?',
      send: [msg('/sendchan/playback/{pb}', f(1))],
    }),
    request({
      id: 'sendchan-output',
      title: 'Request one output channel ({outName})',
      why: 'Which addresses exist for an output (volume, mute, ...)? Is /output/n/mute real?',
      send: [msg('/sendchan/output/{out}', f(1))],
    }),
    request({
      id: 'sendchan-phones',
      title: 'Request the phones output ({phName})',
      why: 'Do phones outputs carry anything extra?',
      send: [msg('/sendchan/output/{ph}', f(1))],
    }),
    request({
      id: 'sendsubmix',
      title: 'Request the submix of output {out}',
      why: 'What does /sendsubmix return (all /mix/.../{out}/* routes)?',
      send: [msg('/sendsubmix/{out}', f(1))],
    }),
    request({
      id: 'sendmix',
      title: 'Request /sendmix',
      why: 'Does /sendmix exist, and what does it return?',
      send: [msg('/sendmix', f(1))],
    }),
    request({
      id: 'argtype-int',
      title: 'Channel request with an int argument',
      why: 'Does TotalMix accept int32 arguments, or only float32?',
      send: [msg('/sendchan/input/{in}', i(1))],
    }),
    request({
      id: 'argtype-none',
      title: 'Channel request without an argument',
      why: 'Does a request need an argument at all?',
      send: [msg('/sendchan/input/{in}')],
    }),
    request({
      id: 'unknown-address',
      title: 'Unknown address',
      why: 'Does TotalMix answer unknown addresses (error, echo, nothing)?',
      send: [msg('/faderlight/probe', f(1))],
    }),
    request({
      id: 'burst',
      title: '24 channel requests back to back',
      why: 'Does TotalMix drop requests that arrive together (pacing for the plugin)?',
      send: Array.from({ length: 24 }, (_, n) => msg(`/sendchan/input/${String(n)}`, f(1))),
      settleMs: 1500,
      maxMs: 15000,
    }),
    request({
      id: 'sendall-2',
      title: 'Full dump: /sendall 2',
      why: 'Everything /sendall 2 returns, how long it takes and how it is packed into bundles.',
      send: [msg('/sendall', f(2))],
      settleMs: 2500,
      maxMs: 120000,
    }),
    request({
      id: 'sendall-1',
      title: 'Full dump: /sendall 1',
      why: 'Does /sendall 1 differ from /sendall 2?',
      send: [msg('/sendall', f(1))],
      settleMs: 2500,
      maxMs: 120000,
    }),

    // --- meters -----------------------------------------------------------------------
    listen({
      id: 'meters-quiet',
      title: 'Meters at full rate, no signal',
      why: 'Meter addresses, rate, bundle layout and the value for silence.',
      ms: 4000,
      meters: 'full',
    }),
    manual({
      id: 'meters-signal',
      title: 'Meters with signal on {inName}',
      why: 'Meter values with signal, peak and clip behaviour.',
      meters: 'full',
      text: [
        'Talk, sing or clap into {inName} for about 5 seconds.',
        'If you can do it safely (monitors down), make one loud clap close to the mic so the meter hits the top.',
      ],
    }),

    // --- what TotalMix sends when you change things yourself ----------------------------
    manual({
      id: 'ui-mute',
      title: 'Mute {inName} in TotalMix',
      why: 'Feedback for a mute change made in the GUI.',
      text: [
        'In the TotalMix window, click the mute button of {inName} in the top row (Hardware Inputs).',
        'Wait a second, then click it again so it is back the way it was.',
      ],
    }),
    manual({
      id: 'ui-solo',
      title: 'Solo {inName} in TotalMix',
      why: 'Feedback for solo (PFL) and the global solo state.',
      text: [
        'Click the solo button of {inName}, wait a second, then click it again to turn solo off.',
      ],
    }),
    manual({
      id: 'ui-fader',
      title: 'Move the {inName} fader',
      why: 'Feedback for a submix fader move (values, rate while dragging).',
      text: [
        'Drag the fader of {inName} (top row) down by a few dB, then back to about where it was.',
        'The exact value does not matter.',
      ],
    }),
    manual({
      id: 'ui-gain',
      title: 'Change the gain of {inName}',
      why: 'Gain feedback: address, units and step size.',
      text: [
        'Open the channel settings of {inName} (the wrench icon above its fader) or use the knob on the interface,',
        'turn Gain up by 1 to 3 dB, then back to where it was.',
      ],
    }),
    manual({
      id: 'ui-48v',
      title: 'Switch 48V on {inName}',
      optional: true,
      why: 'Phantom power feedback (address and values).',
      text: [
        'ONLY if nothing is plugged into {inName}, or a mic that is safe with phantom power (not a ribbon mic):',
        'turn your monitors down, switch 48V on, wait 2 seconds, then switch it back to how it was.',
        'Otherwise type s and press Enter to skip.',
      ],
    }),
    manual({
      id: 'ui-output',
      title: 'Move the {outName} output fader',
      why: 'Feedback for an output volume change.',
      text: [
        'Drag the {outName} fader in the bottom row (Hardware Outputs) down a little, then back.',
      ],
    }),
    manual({
      id: 'ui-dim',
      title: 'Dim on and off',
      why: 'Control Room feedback.',
      text: ['Click Dim in the Control Room section, wait a second, then click it again.'],
    }),
    manual({
      id: 'ui-color',
      title: 'Change the colour of {inName}',
      optional: true,
      why: 'Which colour is each /input/n/color number? Keys draw the channel colour as a tab.',
      text: [
        'In the channel settings of {inName}, pick each channel colour in turn, from the first to the',
        'last, about a second each, then set the colour back. Say in the PR which colours you picked.',
        'If you cannot find a colour setting, type s and press Enter to skip.',
      ],
    }),
    manual({
      id: 'ui-snapshot',
      title: 'Load a snapshot',
      optional: true,
      why: 'Snapshot load feedback, active-snapshot values and how much state follows a load.',
      text: [
        'ONLY if your current mix is saved in a snapshot (otherwise loading another one loses it):',
        'click another snapshot, wait 2 seconds, then click your own snapshot again.',
        'Otherwise type s and press Enter to skip.',
      ],
    }),

    // --- writes: change for about a second, then restore --------------------------------
    write({
      id: 'write-mute-float',
      title: 'Toggle mute of {inName} (float argument)',
      why: 'Is /input/n/mute an explicit set with float 0/1? What does Re-send received echo?',
      address: '/input/{in}/mute',
      change: toggle('f'),
      verify: sendchanIn,
    }),
    write({
      id: 'write-mute-int',
      title: 'Toggle mute of {inName} (int argument)',
      why: 'Is an int32 0/1 accepted for a switch?',
      address: '/input/{in}/mute',
      change: toggle('i'),
      verify: sendchanIn,
    }),
    write({
      id: 'write-mute-bool',
      title: 'Toggle mute of {inName} (T/F argument)',
      why: 'Are OSC true/false arguments accepted for a switch?',
      address: '/input/{in}/mute',
      change: toggle('TF'),
      verify: sendchanIn,
    }),
    write({
      id: 'write-mute-same',
      title: 'Write the current mute value of {inName} again',
      why: 'How does TotalMix echo a write that changes nothing?',
      address: '/input/{in}/mute',
      change: same,
      verify: sendchanIn,
    }),
    write({
      id: 'write-send-fader',
      title: 'Lower the {pbName} playback route to {outName} by 1 dB',
      why: 'Is /mix/pb/n/out/fader set in dB, and how is it confirmed? (Skipped when the route is off.)',
      address: '/mix/pb/{pb}/{out}/fader',
      change: nudgeDb(-1),
      verify: msg('/sendsubmix/{out}', f(1)),
    }),
    write({
      id: 'write-output-volume',
      title: 'Lower the {outName} output volume by 1 dB',
      why: 'Is /output/n/volume set in dB?',
      address: '/output/{out}/volume',
      change: nudgeDb(-1),
      verify: msg('/sendchan/output/{out}', f(1)),
    }),
    write({
      id: 'write-output-mute',
      title: 'Toggle mute of the {outName} output',
      why: 'Is /output/n/mute an explicit set? A Main mute would be /output/{mainout}/mute.',
      address: '/output/{out}/mute',
      change: toggle('f'),
      verify: msg('/sendchan/output/{out}', f(1)),
    }),
    write({
      id: 'write-gain',
      title: 'Lower the gain of {inName} by 1 dB',
      why: 'Is /input/n/gain set in dB, and is it echoed? (Skipped at 8 dB or less, where mic gain jumps to 0.)',
      address: '/input/{in}/gain',
      change: nudgeDb(-1, 8),
      verify: sendchanIn,
    }),
    write({
      id: 'write-dim',
      title: 'Toggle Dim',
      why: 'Is /controlroom/dim an explicit set or a toggle?',
      address: '/controlroom/dim',
      change: toggle('f'),
      // TotalMix does not echo numeric writes, so read the setting back.
      verify: msg('/sendsettings', f(1)),
    }),
    write({
      id: 'write-name',
      title: 'Rename {inName} to "FL test"',
      why: 'Can a channel be renamed over Global OSC, and is the new name echoed?',
      address: '/input/{in}/name',
      change: text('FL test'),
      verify: sendchanIn,
    }),

    // --- connection behaviour -----------------------------------------------------------
    manual({
      id: 'restart',
      title: 'Quit and restart TotalMix FX',
      optional: true,
      why: 'What does the plugin see when TotalMix quits and comes back (silence, startup burst)?',
      text: [
        'Quit TotalMix FX (TotalMix FX menu > Quit), wait about 5 seconds, then start it again.',
        'Your mix stays in the interface while TotalMix is closed.',
        'Press Enter once the TotalMix window is back (or type s to skip).',
      ],
    }),
    request({
      id: 'after-restart',
      title: 'Request /sendstate again',
      why: 'Does TotalMix answer straight away after a restart?',
      send: [msg('/sendstate', f(1))],
    }),
    listen({
      id: 'final',
      title: 'Listen for a few more seconds',
      why: 'Steady-state traffic at the end of the session.',
      ms: 3000,
    }),
  ],
};
