// @ts-check
// One ESLint configuration for every TypeScript package. Each package runs `eslint .`
// from its own directory; ESLint finds this file by walking up from each linted file.
import eslint from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import tseslint from 'typescript-eslint'

// 06-clients §8: "zero suppressions without a linked issue". A suppression cites the issue
// that removes it as `#123` or an `…/issues/123` link.
const linkedIssue = String.raw`(#|/issues/)\d+`

/**
 * Holds ESLint's own suppressions to that rule. An `eslint-disable`, `eslint-disable-line`
 * or `eslint-disable-next-line` directive, or an inline `eslint` rule setting, carries the
 * issue in its description: `// eslint-disable-next-line <rule> -- #123 <why>`. Without
 * this, one comment switches off `no-explicit-any` or `ban-ts-comment` and CI stays green.
 * @type {import('eslint').Rule.RuleModule}
 */
const linkedSuppressions = {
  meta: {
    type: 'problem',
    docs: { description: 'Require every ESLint suppression to cite the issue that removes it' },
    schema: [],
    messages: {
      unlinked:
        'A suppression cites the issue that removes it (06-clients §8): add it after ` -- `, ' +
        'as `#123` or an …/issues/123 link.',
    },
  },
  create(context) {
    const issue = new RegExp(linkedIssue, 'u')
    // ESLint reads only the `-line` forms from a `//` comment, and every form from `/* */`.
    const inLine = new Set(['eslint-disable-line', 'eslint-disable-next-line'])
    const inBlock = new Set([...inLine, 'eslint-disable', 'eslint'])
    return {
      Program() {
        // Each comment is split as ESLint splits a directive: the directive, then the
        // description after the first ` -- `.
        for (const comment of context.sourceCode.getAllComments()) {
          const separator = /\s-{2,}\s/u.exec(comment.value)
          const directive = separator ? comment.value.slice(0, separator.index) : comment.value
          const description = separator
            ? comment.value.slice(separator.index + separator[0].length)
            : ''
          const label = /^([a-z]+(?:-[a-z]+)*)(?:\s|$)/u.exec(directive.trim())?.[1] ?? ''
          const suppresses = (comment.type === 'Block' ? inBlock : inLine).has(label)
          if (suppresses && !issue.test(description) && comment.loc) {
            // Reported one column before the comment. A directive takes effect from its own
            // position, so a report on the comment itself is silenced by the very directive
            // it is about: a bare `/* eslint-disable */` or `// eslint-disable-line`, or one
            // naming this rule, would pass unlinked. Column -1 sorts ahead of every
            // directive on the line (the technique of eslint-plugin-eslint-comments).
            context.report({
              loc: { start: { line: comment.loc.start.line, column: -1 }, end: comment.loc.end },
              messageId: 'unlinked',
            })
          }
        }
      },
    }
  },
}

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
    plugins: {
      household: { rules: { 'linked-suppressions': linkedSuppressions } },
    },
    rules: {
      // 06-clients: "No `any`, no non-null assertions — both are lint errors, not
      // warnings." strictTypeChecked already sets both; they are restated so that a
      // change to the preset cannot quietly relax them.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      // 06-clients §8: "zero suppressions without a linked issue". `@ts-ignore` and
      // `@ts-nocheck` stay banned outright, and `@ts-expect-error` must cite the issue
      // that removes it; ESLint's own disable comments must too.
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          minimumDescriptionLength: 10,
          'ts-expect-error': { descriptionFormat: linkedIssue },
        },
      ],
      'household/linked-suppressions': 'error',
    },
  },
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },
)
