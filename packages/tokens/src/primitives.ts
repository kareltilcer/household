/**
 * The colour primitives: the raw ramps of 01-foundations §1, ported from design/v1's
 * `foundations.js`. Only the semantic layer spends them. Application code names a semantic or a
 * component token, and the lint fails one that imports this file, names a ramp step as a custom
 * property, or writes a raw colour (06-clients §3, D-152). No stylesheet declares them: the
 * semantic tokens are emitted as resolved values (ADR 0024), so `var(--neutral-200)` is nothing.
 */

/** Thirteen neutral steps, lightest to darkest. */
export const neutral = {
  'neutral-50': '#F9FAFD',
  'neutral-100': '#F1F2F7',
  'neutral-200': '#E6E8EC',
  'neutral-300': '#D6D7DF',
  'neutral-400': '#BFC1CA',
  'neutral-500': '#A2A5AF',
  'neutral-600': '#888A94',
  'neutral-700': '#6A6E7A',
  'neutral-800': '#4E5057',
  'neutral-850': '#3B3D42',
  'neutral-900': '#2C2E38',
  'neutral-950': '#1A1B22',
  'neutral-990': '#12131A',
} as const

/**
 * Ten hues, two steps each: 600 is light-theme ink and 400 is dark-theme ink. Solved, not
 * eyeballed: every 600 clears 4.5:1 on surface-sunken, the darkest light surface, and every 400
 * clears 4.5:1 on surface-overlay, the lightest dark one. `angle` is the hue's, in degrees.
 */
export const hues = {
  indigo: { angle: 264, 600: '#476CBA', 400: '#6F97E9' },
  violet: { angle: 300, 600: '#7F5CB7', 400: '#AA86E5' },
  plum: { angle: 338, 600: '#A94B92', 400: '#D876BD' },
  teal: { angle: 196, 600: '#007B7C', 400: '#34A7A8' },
  tan: { angle: 55, 600: '#916444', 400: '#BE8E6D' },
  moss: { angle: 124, 600: '#5D7719', 400: '#86A249' },
  red: { angle: 25, 600: '#C43F3E', 400: '#F66C66' },
  amber: { angle: 72, 600: '#A05E00', 400: '#CE8A1A' },
  emerald: { angle: 162, 600: '#007E54', 400: '#3EAA7C' },
  azure: { angle: 238, 600: '#0074AE', 400: '#35A1DC' },
} as const

export type Hue = keyof typeof hues

/**
 * The ramps' names. A custom property named `--<ramp>-<step>` is a primitive, which the lint
 * refuses in application code; tooling/ holds the lint's own list to this one.
 */
export const ramps: readonly string[] = ['neutral', ...Object.keys(hues)]

/** Every primitive by its name, `neutral-50` or `indigo-600`. */
export const primitives: Readonly<Record<string, string>> = {
  ...neutral,
  ...Object.fromEntries(
    Object.entries(hues).flatMap(([hue, steps]) => [
      [`${hue}-600`, steps[600]],
      [`${hue}-400`, steps[400]],
    ]),
  ),
}
