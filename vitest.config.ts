import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['{packages,tools}/*/{src,test}/**/*.test.ts', 'test/**/*.test.ts'],
  },
});
