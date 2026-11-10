import eslint from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores([
    '**/node_modules/',
    '**/dist/',
    '**/coverage/',
    'docs/vendor/',
    'fixtures/',
    // Plugin build output (packages/plugin/scripts/build.ts).
    'packages/plugin/*.sdPlugin/bin/',
  ]),
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    // Only the plugin shell talks to the Stream Deck SDK (AGENTS.md, docs/design/02-architecture.md).
    ignores: ['packages/plugin/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@elgato/*'],
              message: 'Only packages/plugin may import the Stream Deck SDK.',
            },
          ],
        },
      ],
    },
  },
);
