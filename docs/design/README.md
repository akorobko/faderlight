# Faderlight — design pack (working name)

A Stream Deck plugin (XL first) to control and monitor RME interfaces (Fireface UFX III first) through TotalMix FX.

| Doc | Contents |
|---|---|
| [01-capabilities.md](01-capabilities.md) | UFX III + Stream Deck XL capabilities, TotalMix Global/classic OSC address space, MIDI, existing plugins |
| [02-architecture.md](02-architecture.md) | Tech stack, repo layout, runtime architecture, performance targets |
| [03-ux.md](03-ux.md) | Key anatomy, gestures, Channel Detail overlay, default XL layout, PI + Control Center settings |
| [04-naming.md](04-naming.md) | Trademark-safe name + alternatives |
| [05-agentic-plan.md](05-agentic-plan.md) | Milestones/tasks, simulator, capture tool, testing without hardware, CLAUDE.md draft |
| [UX mockup (canvas)](https://claude.ai/artifact/UwZ1hZm3rRiLWQBF9sqoYm) (private link, owner only) | Key states, XL Console page, Channel Detail overlay, Control Center, Property Inspector |

## Key decisions

1. **TypeScript + Node 24 + Elgato SDK v3** (Stream Deck 7.1+), macOS and Windows. No native modules.
2. **TotalMix FX Global OSC (TotalMix FX ≥ 2.1)** over UDP is the only v1 protocol. Classic OSC and MIDI deferred.
3. **Plugin-managed layout**: one bundled XL "Console" profile of Slot actions; banks/pages/detail overlay handled by the plugin.
4. **Settings split**: minimal Property Inspector + a local browser "Control Center" with live device data.
5. **Hardware-free development**: own OSC simulator, captured traffic fixtures, PNG goldens, virtual deck with Playwright.

## Open questions for Alexey

- ~~TotalMix version~~ latest (2.10) ✓ · ~~repo name~~ `akorobko/faderlight` ✓
- RME vendor files stay out of git (gitignored `docs/vendor/`).
- Existing free plugin "TotalMix FX Control" (shells-dw) already covers a lot; this project differentiates on XL density, plugin-managed layout, and the settings app — still want to build our own? (Assumed yes.)
