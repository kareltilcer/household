/**
 * The stylesheet: every token as a CSS custom property. `scripts/css.ts` writes what this
 * returns to `tokens.css`, which is committed so that a token's change is a line of a diff.
 *
 * - **Themes.** The complete light palette is on the root; the dark block redeclares only what
 *   changes, and nothing is defined there alone (01-foundations §2). `data-theme` takes `light`,
 *   `dark` or `system`, on the root or on any element, so that a page can draw both themes side
 *   by side: a theme's block therefore declares every colour name as a resolved value, the
 *   statuses and the modules' accents among them. An alias written `var(--positive)` on the root
 *   would be computed there, and a dark scope inside a light page would inherit the light value.
 * - **Density.** `[data-density='compact']` on a table changes its cell padding and its rule.
 * - **Text scale.** `data-scale='200'` on the root doubles the root font size, which every type
 *   step, being in rem, follows: the 200 % case of 07-delivery §3 without the browser's setting.
 * - **Motion.** Under `prefers-reduced-motion`, or `data-motion='reduced'`, every duration is
 *   0 ms: a transition becomes an instant state change. The thresholds are untouched: the
 *   2000 ms hold is the only feedback that the gesture is working (01-foundations §7).
 */
import type { Theme } from './color.ts'
import { fonts } from './fonts.ts'
import { colorNames, resolve, type ColorName } from './names.ts'
import {
  density,
  durations,
  easings,
  radii,
  reducedMotion,
  shadows,
  space,
  tabularFigures,
  thresholds,
  typeScale,
  type DensityScale,
  type DurationToken,
  type EasingToken,
  type RadiusToken,
  type Shadow,
  type ShadowToken,
  type SpaceToken,
  type ThresholdToken,
  type TypeToken,
} from './scale.ts'

/** The custom properties `tokens.css` declares, by name: a token outside this is not emitted. */
export type CustomProperty =
  | ColorName
  | SpaceToken
  | RadiusToken
  | ShadowToken
  | DurationToken
  | EasingToken
  | ThresholdToken
  | Exclude<keyof DensityScale, 'secondaryLine'>
  | 'font-sans'
  | 'font-mono'
  | 'figures-tabular'
  | `type-${TypeToken}-${'family' | 'size' | 'line' | 'weight' | 'tracking'}`
  | 'type-overline-transform'

/** A token as CSS reads it: `var(--text-primary)`. */
export function cssVar<Name extends CustomProperty>(name: Name): `var(--${Name})` {
  return `var(--${name})`
}

type Declaration = readonly [property: CustomProperty, value: string]

export interface Rule {
  /** The at-rule this rule is inside, if any: `@media (prefers-color-scheme: dark)`. */
  readonly media?: string
  readonly selector: string
  readonly declarations: readonly Declaration[]
}

/** An object's entries, with its keys as it declares them. */
function entries<Key extends string, Value>(of: Readonly<Record<Key, Value>>): [Key, Value][] {
  return Object.entries(of) as [Key, Value][]
}

function px(value: number | string): string {
  if (typeof value === 'string') return value
  return value === 0 ? '0' : `${String(value)}px`
}
const ms = (value: number) => `${String(value)}ms`
const em = (value: number) => (value === 0 ? '0' : `${String(value)}em`)

function shadow(layers: readonly Shadow[]): string {
  return layers.map((l) => `${px(l.x)} ${px(l.y)} ${px(l.blur)} ${l.color}`).join(', ')
}

/**
 * A theme's colours and shadows: every one of them, or only those that differ from light's.
 */
function theme(name: Theme, all: boolean): Declaration[] {
  return [
    ...colorNames
      .filter((token) => all || resolve(token, name) !== resolve(token, 'light'))
      .map((token): Declaration => [token, resolve(token, name)]),
    ...entries(shadows)
      .filter(([, layers]) => all || shadow(layers[name]) !== shadow(layers.light))
      .map(([token, layers]): Declaration => [token, shadow(layers[name])]),
  ]
}

function scales(): Declaration[] {
  const { comfortable } = density
  return [
    ...entries(space).map(([token, value]): Declaration => [token, px(value)]),
    ...entries(radii).map(([token, value]): Declaration => [token, px(value)]),
    ['font-sans', fonts.sans.stack],
    ['font-mono', fonts.mono.stack],
    ['figures-tabular', tabularFigures.join(' ')],
    ...entries(typeScale).flatMap(([step, type]): Declaration[] => [
      [`type-${step}-family`, cssVar(`font-${type.face}`)],
      [`type-${step}-size`, `${String(type.size)}rem`],
      [`type-${step}-line`, String(type.line)],
      [`type-${step}-weight`, String(type.weight)],
      [`type-${step}-tracking`, em(type.tracking)],
    ]),
    ['type-overline-transform', 'uppercase'],
    ...entries(durations).map(([token, value]): Declaration => [token, ms(value)]),
    ...entries(easings).map(([token, points]): Declaration => [
      token,
      `cubic-bezier(${points.join(', ')})`,
    ]),
    ...entries(thresholds).map(([token, value]): Declaration => [token, ms(value)]),
    ['dens-pad-x', px(comfortable['dens-pad-x'])],
    ['dens-pad-y', px(comfortable['dens-pad-y'])],
    ['dens-row-min', px(comfortable['dens-row-min'])],
  ]
}

function still(): Declaration[] {
  return entries(durations).map(([token]): Declaration => [token, ms(reducedMotion.duration)])
}

/** The stylesheet's rules, in order. A later rule wins over an earlier one of its specificity. */
export function rules(): Rule[] {
  const { comfortable, compact } = density
  return [
    {
      selector: ":root, [data-theme='light'], [data-theme='system']",
      declarations: theme('light', true),
    },
    { selector: "[data-theme='dark']", declarations: theme('dark', false) },
    {
      media: '@media (prefers-color-scheme: dark)',
      selector: "[data-theme='system']",
      declarations: theme('dark', false),
    },
    { selector: ':root', declarations: scales() },
    // The rule's colour is a theme's, so it is declared in every theme's scope, where that
    // theme's value of it is computed; a compact scope, and a theme's scope inside one, take
    // the divider.
    {
      selector: ':root, [data-theme]',
      declarations: [['dens-rule', cssVar(comfortable['dens-rule'])]],
    },
    {
      selector: "[data-density='compact'], [data-density='compact'] [data-theme]",
      declarations: [
        ['dens-pad-x', px(compact['dens-pad-x'])],
        ['dens-pad-y', px(compact['dens-pad-y'])],
        ['dens-row-min', px(compact['dens-row-min'])],
        ['dens-rule', cssVar(compact['dens-rule'])],
      ],
    },
    { selector: "[data-motion='reduced']", declarations: still() },
    { media: '@media (prefers-reduced-motion: reduce)', selector: ':root', declarations: still() },
  ]
}

function print(rule: Rule, indent: string): string {
  const selectors = rule.selector.split(', ').join(`,\n${indent}`)
  const body = rule.declarations.map(([p, v]) => `${indent}  --${p}: ${v};`).join('\n')
  return `${indent}${selectors} {\n${body}\n${indent}}`
}

/** `tokens.css`, whole. */
export function stylesheet(): string {
  return [
    '/* Generated by scripts/css.ts from src/. Do not edit: change the tokens and run',
    '   `pnpm --filter @household/tokens css`. */',
    ...rules().map((rule) =>
      rule.media === undefined ? print(rule, '') : `${rule.media} {\n${print(rule, '  ')}\n}`,
    ),
    // rem follows the root's font size, so the root is where a text scale is set.
    ":root[data-scale='200'] {\n  font-size: 200%;\n}",
    '',
  ].join('\n')
}
