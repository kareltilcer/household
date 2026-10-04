// 06-clients §3 and §8 (D-152), for the clients' stylesheets: application code spends colour
// through @household/tokens' semantic and component tokens, so that a screen follows its theme
// and every combination it draws is a declared contrast pair. This reads a stylesheet and reports
// a raw colour in any notation, and a primitive, a ramp's custom property, read or declared. The
// space, radius, type and motion scales are spent by name and are none of its business.
//
// It is the workspace's own check on PostCSS rather than stylelint, which plan item 23 first
// named: stylelint reaches `braces` through micromatch (GHSA-vfj7-8cjw-p6xm, with no patched
// version), which `pnpm audit` fails, as it failed Metro's in item 18. The ESLint rule
// `household/semantic-tokens` holds the clients' TypeScript to the same, from the same lists
// (tooling/colours.js). `lint-css.ts` runs this over the apps (`pnpm run lint:css`).
import postcss from 'postcss'
import parseValue from 'postcss-value-parser'
import { colourFunctions, hexColour, namedColours, primitive } from '../colours.js'

export interface Finding {
  readonly file: string
  readonly line: number
  readonly column: number
  readonly rule: 'raw' | 'primitive'
  /** The declaration, as written. */
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
  postcss.parse(css, { from: file }).walkDecls((declaration) => {
    const property = declaration.prop.toLowerCase()
    const report = (rule: Finding['rule']) => {
      findings.push({
        file,
        line: declaration.source?.start?.line ?? 0,
        column: declaration.source?.start?.column ?? 0,
        rule,
        text: declaration.toString(),
      })
    }
    if (primitive.test(declaration.prop) || primitive.test(declaration.value)) report('primitive')
    // A custom property's value is checked as any other's: `--row-rule: #dcdee6` is a raw colour
    // under a name of the screen's own.
    if (statesColour(property, declaration.value)) report('raw')
  })
  return findings
}
