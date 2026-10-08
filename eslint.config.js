// @ts-check
// One ESLint configuration for every TypeScript package. Each package runs `eslint .`
// from its own directory; ESLint finds this file by walking up from each linted file.
import eslint from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import tseslint from 'typescript-eslint'
// The lists the stylesheets' check reads too (tooling/src/stylesheets.ts).
import { colourFunctions, hexDigits, namedColours, primitive } from './tooling/colours.js'

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
 * reports a string that holds a letter where the UI shows it: JSX text; a string, template, or
 * a branch of a conditional or an operand of a concatenation, in a JSX child or in a prop
 * that renders text (a name from `visibleProps`, or one that reads as text, such as
 * `emptyText` or `headerTitle`); such a property of an object passed to a prop, or of each
 * object in an array passed to one (a navigator's `options={{ title }}`, a tab bar's
 * `items={[{ label }]}`); the message of a native dialog; and the title, message, button
 * texts and default value of React Native's `Alert`. A type assertion around any of them
 * hides nothing. A string with no letter (`·`, `—`, `%`) is not language.
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
    const assertions = new Set(['TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression'])

    /** @param {any} node An expression, returned without the type assertions around it */
    function unwrap(node) {
      let inner = node
      while (inner && assertions.has(inner.type)) inner = inner.expression
      return inner
    }

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

    /**
     * @param {any} node A prop's value: an object literal, or an array of them, whose text
     *   properties are checked
     */
    function checkObjects(node) {
      const value = unwrap(node)
      if (value?.type === 'ObjectExpression') checkProperties(value)
      else if (value?.type === 'ArrayExpression') {
        for (const element of value.elements) {
          const item = unwrap(element)
          if (item?.type === 'ObjectExpression') checkProperties(item)
        }
      }
    }

    /** @param {any} node An expression shown as it is, or a part of it that may be */
    function check(node) {
      const expression = unwrap(node)
      if (!expression) return
      switch (expression.type) {
        case 'Literal':
          if (typeof expression.value === 'string' && letter.test(expression.value)) {
            context.report({ node: expression, messageId: 'literal' })
          }
          return
        case 'TemplateLiteral':
          if (expression.quasis.some((q) => letter.test(q.value.cooked ?? q.value.raw))) {
            context.report({ node: expression, messageId: 'literal' })
          } else {
            // `${n} ${n === 1 ? 'item' : 'items'}`: the words are in what it interpolates.
            for (const part of expression.expressions) check(part)
          }
          return
        case 'BinaryExpression':
          // A concatenation shows the text of each operand.
          if (expression.operator === '+') {
            check(expression.left)
            check(expression.right)
          }
          return
        case 'ConditionalExpression':
          check(expression.consequent)
          check(expression.alternate)
          return
        case 'LogicalExpression':
          check(expression.right)
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
        else checkObjects(value)
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
          checkObjects(buttons)
          if (name === 'prompt') check(defaultValue)
        } else if (name !== undefined && dialogs.has(name)) {
          for (const arg of node.arguments) check(arg)
        }
      },
    }
  },
}

/**
 * 06-clients §3 and §8 (D-152): application code spends colour through @household/tokens'
 * semantic and component tokens, so that a screen follows its theme and every combination it
 * draws is a declared contrast pair. In client code it reports:
 *
 * - a raw colour in a string or a template: a hex colour, or a colour function (`rgb()`,
 *   `hsl()`, `oklch()`, …). `color-mix()` over tokens is no raw colour;
 * - a named colour (`white`, `red`) as the value of a property or a prop that takes a colour,
 *   alone or inside a shorthand (`border: '1px solid black'`). It is that value wherever the
 *   value is chosen or built: a branch of a conditional, an operand of `&&`, `||`, `??` or a
 *   concatenation, an interpolation, an element of an array (`colors={['white', 'black']}`), a
 *   property of an object the prop takes (`trackColor={{ false: 'grey' }}`), a destructured
 *   prop's default, or under a type assertion. A member it is assigned to is such a property
 *   (`node.style.color = 'red'`), and so is a class's own;
 * - a primitive: an import of `@household/tokens/primitives`, or a ramp's custom property
 *   (`--neutral-200`) in a string.
 *
 * A `#` in an attribute or a property that names or links, not paints (`href="#add"`, a
 * location's `hash`, written out or assigned), starts no colour, and neither does what a `url()`
 * holds, which refers to an element (`fill="url(#fade)"`). Anywhere else a string of a hex
 * colour's shape is taken for one: a selector or a number that spells one (`'#add'`, `'#123'`)
 * is not told from a colour handed to a function, which is the commoner of the two in a client.
 * A named colour is looked for only where a colour goes, since its word is a word everywhere
 * else, so one held in a variable and spent by that name passes: the reviews' to catch. A
 * relative colour (`rgb(from var(--accent) r g b)`) is a colour function as any other, since its
 * channels may be written out: a tint is a `color-mix()`. The space, radius, type and motion
 * scales are spent by name and are not this rule's.
 * @type {import('eslint').Rule.RuleModule}
 */
const semanticTokens = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Forbid raw colours and primitive tokens in client code (06-clients §3, D-152)',
    },
    schema: [],
    messages: {
      raw:
        'A raw colour is not a token (06-clients §3): name a semantic or a component token of ' +
        '@household/tokens, whose value follows the theme.',
      primitive:
        'A primitive is the semantic layer’s alone (06-clients §3, D-152): name a semantic or a ' +
        'component token of @household/tokens.',
    },
  },
  create(context) {
    // A hex colour inside a text: not where the `#` is part of a word, an entity or an address,
    // and not what a `url()` holds, which is a fragment.
    const hex = new RegExp(String.raw`(?<![\w&#/-])(?<!url\(\s*["']?)#${hexDigits}(?![\w-])`, 'i')
    const colourFunction = new RegExp(
      String.raw`(?<![\w-])(?:${[...colourFunctions].join('|')})\(`,
      'i',
    )
    const primitives = '@household/tokens/primitives'
    // Props and properties whose value is a colour, or a shorthand that holds one, under the
    // name a style object gives them, and every custom property, as the stylesheets' check has
    // it. `filter` is not among them: in an object it names too much else for its
    // `drop-shadow()` to be read for a colour's name.
    const takesColour =
      /^(?:--.+|color|fill|stroke|background(?:Image)?|outline|border(?:Top|Right|Bottom|Left|(?:Block|Inline)(?:Start|End)?|Image)?|columnRule|boxShadow|textShadow|textDecoration|WebkitTextStroke|.*[Cc]olors?)$/
    // Attributes that name or link: a `#` in one starts a fragment or an id, never a colour.
    const names =
      /^(?:href|to|id|htmlFor|key|name|testID|xlinkHref|xlink:href|data-.+|aria-(?:controls|labelledby|describedby|owns|activedescendant))$/
    // The properties of an object that do: a link's `href` and a location's `hash`. `to`,
    // `name`, `key` and `id` name anything in an object: `{ from: '#000', to: '#fff' }`.
    const nameProperties = /^(?:href|xlinkHref|hash)$/

    /**
     * @param {string} name A prop's or a property's name
     * @returns {string} It as a style object spells it: `background-color` as `backgroundColor`
     */
    function camelCased(name) {
      if (name.startsWith('--')) return name
      return name.replace(/-([a-z])/g, (_, letter) => String(letter).toUpperCase())
    }

    /**
     * @param {any} node A string or a template element
     * @returns {{ attribute: boolean, name: string }[]} The props and the properties it is the
     *   value of, the nearest first: its own, and each one whose value it is a part of
     */
    function places(node) {
      const found = []
      let value = node
      for (let parent = node.parent; parent; value = parent, parent = parent.parent) {
        switch (parent.type) {
          // What a value passes through on its way to the prop or the property that takes it.
          case 'TemplateLiteral':
          case 'JSXExpressionContainer':
          case 'ArrayExpression':
          case 'ObjectExpression':
          case 'LogicalExpression':
          case 'TSAsExpression':
          case 'TSSatisfiesExpression':
          case 'TSNonNullExpression':
            break
          case 'ConditionalExpression':
            // Its branches are what it gives; its test is not.
            if (parent.test === value) return found
            break
          case 'BinaryExpression':
            if (parent.operator !== '+') return found
            break
          case 'AssignmentPattern':
            // A destructured prop's default, `{ color = 'black' }`, is that prop's value.
            if (parent.right !== value) return found
            break
          case 'Property':
            if (parent.value !== value || parent.computed) return found
            found.push({
              attribute: false,
              name: parent.key.type === 'Identifier' ? parent.key.name : String(parent.key.value),
            })
            break
          case 'PropertyDefinition':
            // A class's property, `color = 'red'`, is one as an object's is.
            if (parent.value === value && !parent.computed) {
              found.push({
                attribute: false,
                name: parent.key.type === 'Literal' ? String(parent.key.value) : parent.key.name,
              })
            }
            return found
          case 'AssignmentExpression': {
            // And so is the member a value is assigned to: `node.style.color = 'red'`,
            // `location.hash = '#add'`. A member under a computed name is one where the name
            // is written out, `style['color']`.
            const { left } = parent
            if (parent.right !== value || left.type !== 'MemberExpression') return found
            if (!left.computed) found.push({ attribute: false, name: left.property.name })
            else if (left.property.type === 'Literal' && typeof left.property.value === 'string') {
              found.push({ attribute: false, name: left.property.value })
            }
            return found
          }
          case 'JSXAttribute':
            found.push({
              attribute: true,
              name:
                parent.name.type === 'JSXNamespacedName'
                  ? `${parent.name.namespace.name}:${parent.name.name.name}`
                  : parent.name.name,
            })
            return found
          default:
            return found
        }
      }
      return found
    }

    /**
     * @param {any} node A string or a template element
     * @param {string} text What it says
     */
    function check(node, text) {
      if (primitive.test(text)) {
        context.report({ node, messageId: 'primitive' })
        return
      }
      const held = places(node)
      const [nearest] = held
      if (nearest && (nearest.attribute ? names : nameProperties).test(nearest.name)) return
      const named =
        held.some((place) => takesColour.test(camelCased(place.name))) &&
        text.split(/[\s,()]+/).some((word) => namedColours.has(word.toLowerCase()))
      if (hex.test(text) || colourFunction.test(text) || named) {
        context.report({ node, messageId: 'raw' })
      }
    }

    /**
     * @param {any} source An import's or an export's source, which may be the primitives: a
     *   string, or a template that is one, with nothing interpolated
     */
    function checkSource(source) {
      const value =
        source?.type === 'Literal'
          ? source.value
          : source?.type === 'TemplateLiteral' && source.expressions.length === 0
            ? source.quasis[0]?.value.cooked
            : undefined
      if (
        typeof value === 'string' &&
        (value === primitives || value.startsWith(`${primitives}/`))
      ) {
        context.report({ node: source, messageId: 'primitive' })
      }
    }

    return {
      /** @param {any} node */
      Literal(node) {
        // A module's name is no colour, whatever it spells: the sources are checked below.
        if (typeof node.value !== 'string' || node.parent.source === node) return
        check(node, node.value)
      },
      /** @param {any} node */
      TemplateElement(node) {
        check(node, node.value.cooked ?? node.value.raw)
      },
      /** @param {any} node */
      ImportDeclaration(node) {
        checkSource(node.source)
      },
      /** @param {any} node */
      ImportExpression(node) {
        checkSource(node.source)
      },
      /** @param {any} node */
      ExportNamedDeclaration(node) {
        checkSource(node.source)
      },
      /** @param {any} node */
      ExportAllDeclaration(node) {
        checkSource(node.source)
      },
      /** @param {any} node */
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'require') {
          checkSource(node.arguments[0])
        }
      },
    }
  },
}

/** The i18n package's own entry, which holds all five catalogs: the web app imports `/lazy`. */
const wholeCatalogs = {
  name: '@household/i18n',
  allowTypeImports: true,
  message:
    'Import @household/i18n/lazy: the package’s own entry holds all five catalogs, and the web app loads one language at a time.',
}

/** The sync library's entries, imported for their types alone outside `apps/web/src/sync/open.ts`. */
const syncLibrary = ['@household/sync', '@household/sync/web'].map((name) => ({
  name,
  allowTypeImports: true,
  message:
    'Import @household/sync for its types alone: a value a screen needs of it at run time is handed over with the open replica (apps/web/src/sync/open.ts), which keeps the library out of a page until a replica is opened.',
}))

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
          'semantic-tokens': semanticTokens,
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
    // Architecture test 7: the clients render words from the catalogs, never literals. And
    // 06-clients §3: they spend colour through the semantic tokens, never raw or by a primitive.
    files: ['apps/**'],
    rules: { 'household/no-literal-strings': 'error', 'household/semantic-tokens': 'error' },
  },
  {
    // What the web app's first download must not hold (plan item 25, ADR 0026). It loads one
    // language at a time (D-159): the i18n package's own entry holds all five catalogs, and one
    // import of it puts them back. And nothing of the sync library or its SDK is in a page until
    // a replica is opened: every file imports it for its types alone, and `sync/open.ts`, the
    // one file fetched when a replica is, hands over what a screen needs of it at run time. A
    // test may hold all the catalogs, to say what a key reads in each, and the library's values.
    files: ['apps/web/src/**'],
    ignores: ['apps/web/src/**/*.test.{ts,tsx}', 'apps/web/src/test/**'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        { paths: [wholeCatalogs, ...syncLibrary] },
      ],
    },
  },
  {
    files: ['apps/web/src/sync/open.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', { paths: [wholeCatalogs] }],
    },
  },
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs', '**/*.jsx'],
    extends: [tseslint.configs.disableTypeChecked],
  },
)
