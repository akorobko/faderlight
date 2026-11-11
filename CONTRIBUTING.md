# Contributing to Faderlight

Thanks for helping. Bug reports, hardware findings and pull requests are all welcome.

## Reporting a bug

Open an [issue](https://github.com/akorobko/faderlight/issues/new/choose) with the bug report
form. The most useful things to include:

- What the Setup Assistant in the Control Center shows (a screenshot is fine).
- Your interface, TotalMix FX version, deck model and operating system.
- For a protocol problem, a capture from [tools/capture](tools/capture/README.md). Its `run`
  and `listen` commands mask serial numbers and computer names; check an older file with
  `node tools/capture/src/cli.ts redact` first.

Please don't attach RME or Elgato documents, tables or software. And check that a log or a
screenshot doesn't show your interface's serial number.

## Interfaces other than the UFX III

Faderlight was built against a Fireface UFX III. If you have another RME interface, a run of
the guided capture (`node tools/capture/src/cli.ts run`, about five minutes) tells us how its
channels and options look over Global OSC. It's the quickest way to get it supported.

## Development

Requires Node.js 24 (see `.nvmrc`). No interface needed: a simulator stands in for TotalMix FX,
and a virtual deck draws the keys in a browser.

```sh
npm ci
npm run check            # vendor guard, format, lint, typecheck, tests: must pass
npm run sim              # fake TotalMix FX on ports 7002/9002 (packages/simulator/README.md)
npm run deck             # the keys on a web page, against the simulator (tools/virtual-deck)
npm run e2e              # browser tests of the virtual deck, screenshots in renders/
npm run render:goldens   # key images and renders/contact-sheet.png (packages/render/README.md)
npm run plugin:build     # the Stream Deck plugin (packages/plugin/README.md)
npm run plugin:pack      # the release file dist/Faderlight-<version>.streamDeckPlugin
npm run screenshots      # the pictures in docs/images/
```

| Path                      | Contents                                       |
| ------------------------- | ---------------------------------------------- |
| `packages/osc`            | OSC codec and UDP transport                    |
| `packages/totalmix`       | TotalMix FX Global OSC adaptor                 |
| `packages/model`          | Mixer model, device profiles, meters           |
| `packages/render`         | Key renderers (SVG)                            |
| `packages/deck`           | Deck runtime: settings, gestures, layouts      |
| `packages/plugin`         | The Stream Deck plugin (SDK wiring, manifest)  |
| `packages/control-center` | Control Center: settings page and its server   |
| `packages/simulator`      | Fake TotalMix FX for hardware-free development |
| `tools/`                  | Developer tools (capture, virtual deck)        |
| `docs/design/`            | Design documents, starting with the README     |
| `docs/protocol/`          | Global OSC as TotalMix actually sends it       |

RME reference documents are not in the repository; `scripts/fetch-vendor.sh` downloads them
into `docs/vendor/`, which git ignores.

## Making a change

The rules for the code are in [AGENTS.md](AGENTS.md). They're written for coding agents, and
they apply to people too. The ones that most often matter:

- Read the design documents in [docs/design](docs/design/README.md) and
  [docs/protocol/global-osc.md](docs/protocol/global-osc.md) before changing behaviour.
- A protocol change updates `docs/protocol/global-osc.md` and adds decode and encode tests
  from a fixture.
- A renderer change regenerates the goldens (`npm run render:goldens`). A UI change comes with
  screenshots of the virtual deck or the Control Center.
- If you don't know how the hardware behaves, ask in the PR and add a step to
  `tools/capture/scripts/`. Don't guess.
- Never commit RME or Elgato material, and never use their names or artwork in product
  names, icons or identifiers.

One task per pull request, please. The PR template lists what to check. Every pull request
needs the maintainer's review before it merges.

## Licence

By contributing, you agree that your contribution is licensed under the project's
[licence](LICENSE).
