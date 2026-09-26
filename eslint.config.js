// @ts-check
// One ESLint configuration for every TypeScript package. Each package runs `eslint .`
// from its own directory; ESLint finds this file by walking up from each linted file.
import eslint from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import tseslint from 'typescript-eslint'

export default defineConfig(
  globalIgnores(['**/dist/', '**/coverage/', '**/.turbo/']),
  {
    linterOptions: {
      // A suppression that suppresses nothing is an error, so a rule cannot be switched
      // off underneath a disable comment without the comment itself failing the lint.
      reportUnusedDisableDirectives: 'error',
    },
  },
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // 06-clients: "No `any`, no non-null assertions — both are lint errors, not
      // warnings." strictTypeChecked already sets both; they are restated so that a
      // change to the preset cannot quietly relax them.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      // 06-clients §8: "zero suppressions without a linked issue". `@ts-ignore` and
      // `@ts-nocheck` stay banned outright, and `@ts-expect-error` must cite the issue
      // that removes it, as `#123` or an `…/issues/123` link.
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          minimumDescriptionLength: 10,
          'ts-expect-error': { descriptionFormat: String.raw`(#|/issues/)\d+` },
        },
      ],
    },
  },
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },
)
