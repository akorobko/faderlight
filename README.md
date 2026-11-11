# Faderlight

A Stream Deck plugin (XL first) for controlling and monitoring RME audio interfaces through TotalMix FX.

Status: early development. Design: `docs/design/`.

## Development

Requires Node.js 24 (see `.nvmrc`).

```sh
npm ci
npm run check            # vendor guard, format, lint, typecheck, tests
npm run sim              # fake TotalMix FX on ports 7002/9002 (packages/simulator/README.md)
npm run render:goldens   # key images and renders/contact-sheet.png (packages/render/README.md)
npm run plugin:build     # the Stream Deck plugin (packages/plugin/README.md)
npm run plugin:pack      # the release file dist/Faderlight-<version>.streamDeckPlugin
npm run deck             # the keys on a web page, against the simulator (tools/virtual-deck)
npm run e2e              # browser tests of the virtual deck, screenshots in renders/virtual-deck/
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

RME reference documents are not in the repo; run `scripts/fetch-vendor.sh` to download them into `docs/vendor/`.

Not affiliated with RME or Elgato. "RME", "TotalMix", "Fireface", "Elgato" and "Stream Deck" are trademarks of their respective owners.
