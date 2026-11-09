# Faderlight — agent rules

Harness-neutral instructions for any coding agent working in this repo. Tool-specific entry files (e.g. `CLAUDE.md`) only point here.

- Keep the repo harness-neutral: rules live in AGENTS.md; no agent-specific folders (.claude/, .cursor/, …) or vendor names in code, docs or scripts, except one-line pointer files.
- Read docs/design/*.md (start with docs/design/README.md) and docs/protocol/global-osc.md before changing behaviour.
- Never use RME/TotalMix/Fireface/Elgato/Stream Deck names or artwork in product names, icons or UUIDs.
- Core packages (osc, totalmix, model, render) must not import @elgato/streamdeck.
- Every protocol change: update docs/protocol/global-osc.md + add decode/encode tests from a fixture.
- Every renderer change: regenerate goldens (`npm run render:goldens`) and attach renders/contact-sheet.png to the PR.
- UI changes: attach Playwright screenshots of virtual deck / Control Center.
- `npm run check` (lint, typecheck, test) must pass before pushing.
- Hardware facts unknown? Write a question in the PR and add a step to tools/capture/scripts/ — do not guess.
- Never commit RME/Elgato documents, tables, binaries or artwork; keep them in gitignored docs/vendor/ (run `scripts/fetch-vendor.sh`).
