import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['**/node_modules/**', 'core/kit/vendor/**', 'core/build/**', '**/out/**', '**/dist/**'] },
  js.configs.recommended,
  { files: ['core/**/*.js'], languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.browser } } },
  { files: ['core/test/**/*.js', 'server/**/*.js', 'desktop/**/*.js', 'desktop/**/*.mjs', 'scripts/**/*.mjs', '*.mjs'], languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.node } } },
  { files: ['desktop/**/*.cjs'], languageOptions: { ecmaVersion: 2024, sourceType: 'commonjs', globals: { ...globals.node } } },
  // The shared app code logs through the one logger (core/kit/log.js), never the console; the source walk in
  // core/test/logging-guard.test.js carries the same rule for the server and the desktop shell.
  { files: ['core/kit/**/*.js', 'core/app/**/*.js'], rules: { 'no-console': 'error' } },
  { rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }] } },
];
