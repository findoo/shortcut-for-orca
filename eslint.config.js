import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config({ ignores: ['dist/', 'release/'] }, js.configs.recommended, ...tseslint.configs.recommended, {
  languageOptions: { globals: { process: 'readonly', console: 'readonly', Buffer: 'readonly', URL: 'readonly', URLSearchParams: 'readonly', fetch: 'readonly' } },
});
