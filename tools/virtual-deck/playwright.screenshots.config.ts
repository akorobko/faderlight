// The screenshots of the README and the website: npm run screenshots. They run the virtual deck
// against the simulator's band layout (a fuller session than the tests' studio layout) and
// save to docs/images/. Not part of `npm run e2e`: they only take pictures.
import { defineConfig } from '@playwright/test';

const PORT = 4181;

export default defineConfig({
  testDir: './screenshots',
  outputDir: './test-results',
  timeout: 60_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${String(PORT)}/`,
    viewport: { width: 980, height: 620 },
    deviceScaleFactor: 2,
    trace: 'off',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: `node src/cli.ts --port ${String(PORT)} --layout band --meters band`,
    cwd: import.meta.dirname,
    url: `http://127.0.0.1:${String(PORT)}/`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
