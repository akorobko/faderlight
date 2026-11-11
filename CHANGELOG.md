# Changelog

Each release's section is its release notes: the release workflow copies it into the GitHub
release (`npm run plugin:pack`, see packages/plugin/README.md, "Releasing").

## 0.1.1

The first release on GitHub, for TotalMix FX 2.1 or later (Global OSC). The Console needs a
Stream Deck XL. The single keys work on any Stream Deck with keys. What the plugin does is
listed under [0.1.0](https://github.com/akorobko/faderlight/blob/main/CHANGELOG.md#010). Since
then:

- Keys and meters redraw at most 10 times a second, as Elgato's guidelines ask. A higher rate
  saved by 0.1.0 counts as 10.
- The Control Center links to the setup guide and the Faderlight website.
- The plugin comes with its MIT licence and the licences of the packages it bundles.

## 0.1.0

The first release, for TotalMix FX 2.1 or later (Global OSC). The Console needs a Stream Deck
XL. The single keys work on any Stream Deck with keys.

- The Console profile: snapshots, the Status key, two banks of seven channel strips, Main,
  Phones 1 and 2, a Main level preset, Dim, Mono and Exit, with Inputs and Outputs pages.
- Channel keys with the TotalMix name and colour, gain or fader in dB, 48V and Inst badges, and
  a stereo meter whose clip mark stays until cleared. A tap mutes.
- Channel Detail on a long press: gain, 48V, phase, Inst, AutoSet, mute, solo, fader, low cut,
  EQ, dynamics, five sends and the FX send.
- Keys for any profile: Channel, Main / Output, Phones, Snapshot, Monitor Switch, Global Mute /
  Solo, Status, Volume Step, Level Preset, Open Console and Exit Console.
- The Control Center in the browser: the Setup Assistant and a packet log, channel names and
  colours, snapshot names, the layout builder with templates, behaviour and appearance
  settings, and a settings backup.
