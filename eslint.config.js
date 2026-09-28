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

/**
 * Architecture test 7 (PRD 01 §10, D-29): no user-visible string literal in client code, so
 * every word a member reads comes from @household/i18n's catalogs in their language. It
 * reports a string that holds a letter where the UI shows it: JSX text; a string, template or
 * a branch of a conditional in a JSX child or in a prop that renders text (a name from
 * `visibleProps`, or one that reads as text, such as `emptyText` or `headerTitle`); such a
 * property of an object passed to a prop (a navigator's `options={{ title }}`); the message
 * of a native dialog; and the title, message, button texts and default value of React
 * Native's `Alert`. A string with no letter (`·`, `—`, `%`) is not language.
 * @type {import('eslint').Rule.RuleModule}
 */
const noLiteralStrings = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Forbid user-visible string literals in client code (architecture test 7)',
    },
    schema: [],
    messages: {
      literal:
        'A user-visible string is a translation key (D-29): render it with the translator from ' +
        '@household/i18n and add the key to all five catalogs.',
    },
  },
  create(context) {
    const letter = /\p{L}/u
    const visibleProps = new Set([
      'alt',
      'aria-description',
      'aria-label',
      'aria-placeholder',
      'aria-roledescription',
      'aria-valuetext',
      'accessibilityHint',
      'accessibilityLabel',
      'children',
      'label',
      'placeholder',
      'title',
    ])
    // Matched against the name with its first letter capitalised, so `text` and `message`
    // read as text as `emptyText` and `errorMessage` do.
    const textLikeProp =
      /(Label|Title|Text|Message|Placeholder|Caption|Description|Heading|Hint|Tooltip)$/
    // Names that end like text but take an enumerated value, never words.
    const enumeratedProps = new Set(['enterKeyHint'])
    const dialogs = new Set(['alert', 'confirm', 'prompt'])

    /** @param {unknown} name A prop's or a property's name */
    function showsText(name) {
      if (typeof name !== 'string' || name === '' || enumeratedProps.has(name)) return false
      return (
        visibleProps.has(name) || textLikeProp.test(name.charAt(0).toUpperCase() + name.slice(1))
      )
    }

    /** @param {any} object An object literal, whose text properties are checked */
    function checkProperties(object) {
      for (const property of object.properties) {
        if (property.type !== 'Property' || property.computed) continue
        const key =
          property.key.type === 'Identifier'
            ? property.key.name
            : property.key.type === 'Literal'
              ? String(property.key.value)
              : undefined
        if (showsText(key)) check(property.value)
      }
    }

    /** @param {any} node An expression shown as it is, or a branch that may be */
    function check(node) {
      if (!node) return
      switch (node.type) {
        case 'Literal':
          if (typeof node.value === 'string' && letter.test(node.value)) {
            context.report({ node, messageId: 'literal' })
          }
          return
        case 'TemplateLiteral':
          if (node.quasis.some((q) => letter.test(q.value.cooked ?? q.value.raw))) {
            context.report({ node, messageId: 'literal' })
          }
          return
        case 'ConditionalExpression':
          check(node.consequent)
          check(node.alternate)
          return
        case 'LogicalExpression':
          check(node.right)
          return
        default:
      }
    }

    return {
      /** @param {any} node */
      JSXText(node) {
        if (letter.test(node.value)) context.report({ node, messageId: 'literal' })
      },
      /** @param {any} node */
      JSXAttribute(node) {
        const name =
          node.name.type === 'JSXNamespacedName'
            ? `${node.name.namespace.name}:${node.name.name.name}`
            : node.name.name
        const value =
          node.value?.type === 'JSXExpressionContainer' ? node.value.expression : node.value
        if (showsText(name)) check(value)
        else if (value?.type === 'ObjectExpression') checkProperties(value)
      },
      /** @param {any} node */
      JSXExpressionContainer(node) {
        if (node.parent.type === 'JSXElement' || node.parent.type === 'JSXFragment') {
          check(node.expression)
        }
      },
      /** @param {any} node */
      CallExpression(node) {
        const callee = node.callee
        const name =
          callee.type === 'Identifier'
            ? callee.name
            : callee.type === 'MemberExpression' && callee.property.type === 'Identifier'
              ? callee.property.name
              : undefined
        const onAlert =
          callee.type === 'MemberExpression' &&
          callee.object.type === 'Identifier' &&
          callee.object.name === 'Alert'
        if (onAlert) {
          // React Native's Alert.alert(title, message, buttons, options) and
          // Alert.prompt(title, message, buttons, type, defaultValue, keyboardType): each
          // button shows its `text`; the type and the keyboard type are enumerated.
          const [title, message, buttons, , defaultValue] = node.arguments
          check(title)
          check(message)
          if (buttons?.type === 'ArrayExpression') {
            for (const button of buttons.elements) {
              if (button?.type === 'ObjectExpression') checkProperties(button)
            }
          }
          if (name === 'prompt') check(defaultValue)
        } else if (name !== undefined && dialogs.has(name)) {
          for (const arg of node.arguments) check(arg)
        }
      },
    }
  },
}

export default defineConfig(
  // design/ holds the clickable ES5 prototype, a reference that never ships; Prettier and
  // CodeQL skip it too. An editor that lints it with this file would flag every script.
  // src/generated/ is written by each package's `gen` script from a committed source (the
  // contract, the English catalog) and is never edited by hand.
  globalIgnores(['**/dist/', '**/coverage/', '**/.turbo/', 'design/', 'packages/*/src/generated/']),
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
      household: {
        rules: {
          'linked-suppressions': linkedSuppressions,
          'no-literal-strings': noLiteralStrings,
        },
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
    // Architecture test 7: the clients render words from the catalogs, never literals.
    files: ['apps/**'],
    rules: { 'household/no-literal-strings': 'error' },
  },
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs', '**/*.jsx'],
    extends: [tseslint.configs.disableTypeChecked],
  },
)
