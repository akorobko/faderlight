// End-to-end tests of the virtual deck in Chromium: npm run e2e. They start the virtual deck
// with its simulator, press keys like a person would and save screenshots to renders/virtual-deck/.
import { defineConfig } from '@playwright/test';

const PORT = 4179;

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  timeout: 30_000,
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
    command: `node src/cli.ts --port ${String(PORT)}`,
    cwd: import.meta.dirname,
    url: `http://127.0.0.1:${String(PORT)}/`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
