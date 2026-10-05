// 06-clients §3 and §8 (D-152), for the clients' stylesheets: application code spends colour
// through @household/tokens' semantic and component tokens, so that a screen follows its theme
// and every combination it draws is a declared contrast pair. This reads a stylesheet and reports
// a raw colour in any notation, and a primitive, a ramp's custom property, read or declared, in a
// declaration and in a constant of CSS Modules (`@value`), which a declaration spends by its name.
// The space, radius, type and motion scales are spent by name and are none of its business.
//
// It is the workspace's own check on PostCSS rather than stylelint, which plan item 23 first
// named: stylelint reaches `braces` through micromatch (GHSA-vfj7-8cjw-p6xm, with no patched
// version), which `pnpm audit` fails, as it failed Metro's in item 18. The ESLint rule
// `household/semantic-tokens` holds the clients' TypeScript to the same, from the same lists
// (tooling/colours.js). `lint-css.ts` runs this over the apps (`pnpm run lint:css`).
import postcss, { type AtRule, type Declaration } from 'postcss'
import parseValue from 'postcss-value-parser'
import { colourFunctions, hexColour, namedColours, primitive } from '../colours.js'

export interface Finding {
  readonly file: string
  readonly line: number
  readonly column: number
  readonly rule: 'raw' | 'primitive'
  /** The declaration, or the `@value`, as written. */
  readonly text: string
}

export const messages = {
  raw:
    'A raw colour is not a token (06-clients §3): name a semantic or a component token of ' +
    '@household/tokens, `var(--text-primary)`, whose value follows the theme.',
  primitive:
    'A primitive is the semantic layer’s alone (06-clients §3, D-152): name a semantic or a ' +
    'component token of @household/tokens.',
} as const

// Properties whose words are names an author made up, or a face's, never colours: `tan` is a
// colour in `color` and a grid area in `grid-area`.
const takesNames =
  /^(?:composes|font|font-family|animation|animation-name|transition|transition-property|will-change|grid(?:-.+)?|counter-.+|container(?:-name)?|view-transition-name|list-style(?:-type)?|content|quotes|page)$/

// A vendor's prefix, under which a property takes what it takes without one: `-webkit-animation`
// names a keyframes rule as `animation` does.
const vendorPrefix = /^-(?:webkit|moz|ms|o)-/

// A constant of CSS Modules, which the web's stylesheets are (PL-4): `@value rule: #dcdee6`, the
// colon optional. One that ends `from "./other.module.css"` imports names and holds no value.
const constant = /^value$/i
const constantImport = /\sfrom\s+(?:"[^"]*"|'[^']*'|[\w-]+)$/
const constantValue = /^[\w-]+\s*:?(.*)$/s

/** Whether a value states a colour outright: a hex colour, a colour function, or a colour's name. */
function statesColour(property: string, value: string): boolean {
  let found = false
  parseValue(value).walk((node) => {
    if (node.type === 'function') {
      const name = node.value.toLowerCase()
      if (colourFunctions.has(name)) found = true
      // What a URL holds is an address: its `#` starts a fragment.
      if (name === 'url') return false
    }
    if (node.type === 'word') {
      if (hexColour.test(node.value)) found = true
      if (!takesNames.test(property) && namedColours.has(node.value.toLowerCase())) found = true
    }
    return undefined
  })
  return found
}

/** The findings of one stylesheet. A stylesheet that does not parse throws, with its position. */
export function lintStylesheet(css: string, file: string): Finding[] {
  const findings: Finding[] = []
  const report = (node: Declaration | AtRule, rule: Finding['rule']) => {
    findings.push({
      file,
      line: node.source?.start?.line ?? 0,
      column: node.source?.start?.column ?? 0,
      rule,
      text: node.toString(),
    })
  }
  postcss.parse(css, { from: file }).walk((node) => {
    if (node.type === 'decl') {
      const property = node.prop.toLowerCase().replace(vendorPrefix, '')
      if (primitive.test(node.prop) || primitive.test(node.value)) report(node, 'primitive')
      // A custom property's value is checked as any other's: `--row-rule: #dcdee6` is a raw
      // colour under a name of the screen's own.
      if (statesColour(property, node.value)) report(node, 'raw')
    } else if (node.type === 'atrule' && constant.test(node.name)) {
      // And so is a constant's, which is a value under a name of the screen's own too. Its
      // name is no part of what it holds: `@value red: var(--danger)` states no colour.
      const params = node.params.trim()
      if (constantImport.test(params)) return
      if (primitive.test(params)) report(node, 'primitive')
      if (statesColour('', constantValue.exec(params)?.[1] ?? '')) report(node, 'raw')
    }
  })
  return findings
}
