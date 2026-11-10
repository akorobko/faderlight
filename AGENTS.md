# Faderlight — agent rules

Harness-neutral instructions for any coding agent working in this repo.

- Keep the repo harness-neutral: rules live in AGENTS.md; no agent-specific files or folders (CLAUDE.md, .claude/, .cursor/, …) and no agent-tool names in code, docs or scripts.
- Read docs/design/*.md (start with docs/design/README.md) and docs/protocol/global-osc.md before changing behaviour.
- Never use RME/TotalMix/Fireface/Elgato/Stream Deck names or artwork in product names, icons or UUIDs.
- Core packages (osc, totalmix, model, render) must not import @elgato/streamdeck.
- Every protocol change: update docs/protocol/global-osc.md + add decode/encode tests from a fixture.
- Every renderer change: regenerate goldens (`npm run render:goldens`) and attach renders/contact-sheet.png to the PR.
- UI changes: attach Playwright screenshots of virtual deck / Control Center.
- Node 24 (`.nvmrc`). Workspaces live in packages/* and tools/*; each is `@faderlight/<dir>`, private, `"type": "module"`. Library packages export TypeScript source (`"exports": { ".": "./src/index.ts" }`): no build step, Node runs the source directly.
- Write erasable TypeScript only (no enums, namespaces or parameter properties) and import relative files with their `.ts` extension; `tsc` enforces both.
- Tests are `*.test.ts` files in a workspace's src/ or test/ folder; the root Vitest config picks them up.
- `npm run check` (vendor guard, Prettier, ESLint, tsc, Vitest) must pass before pushing; `npm run format` fixes formatting.
- Hardware facts unknown? Write a question in the PR and add a step to tools/capture/scripts/ — do not guess.
- No personal details in code, docs, commit messages or PR descriptions: no people's names, emails, local paths, machine or runner names, or links to private repos and pages. Say "the maintainer" instead.
- Capture files never reach GitHub with hardware serial numbers or computer names in them: `run` and `listen` mask them, and older files go through `node tools/capture/src/cli.ts redact` first. Pushing is permanent, even on a branch.
- Never commit RME/Elgato documents, tables, binaries or artwork; keep them in gitignored docs/vendor/ (run `scripts/fetch-vendor.sh`).
