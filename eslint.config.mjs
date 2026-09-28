import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['**/node_modules/**', 'core/kit/vendor/**', '**/out/**', '**/dist/**'] },
  js.configs.recommended,
  { files: ['core/**/*.js'], languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.browser } } },
  { files: ['core/test/**/*.js', 'server/**/*.js', 'desktop/**/*.js', 'desktop/**/*.mjs', 'scripts/**/*.mjs', '*.mjs'], languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.node } } },
  { files: ['desktop/**/*.cjs'], languageOptions: { ecmaVersion: 2024, sourceType: 'commonjs', globals: { ...globals.node } } },
  { rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }] } },
];
