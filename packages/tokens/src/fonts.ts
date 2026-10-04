/**
 * The two faces (PL-13): IBM Plex Sans for the UI and IBM Plex Mono for numeric columns, both
 * SIL OFL, self-hosted and never fetched from a font CDN (N8). On the web they are the packages
 * `fonts.css` imports, which a bundler serves from the app's own origin: the sans as one variable
 * file per script, the mono as a file per weight, each with its Latin Extended subset. A native
 * app has no cascade and no variable axis to ask a weight of, so it registers one static file per
 * weight under the family names here (plan item 28) and a type step names its family whole.
 */
import type { Face } from './scale.ts'

export const fonts = {
  sans: {
    family: 'IBM Plex Sans Variable',
    stack: "'IBM Plex Sans Variable', system-ui, sans-serif",
    weights: [400, 500, 600],
    native: { 400: 'IBMPlexSans-Regular', 500: 'IBMPlexSans-Medium', 600: 'IBMPlexSans-SemiBold' },
  },
  mono: {
    family: 'IBM Plex Mono',
    stack: "'IBM Plex Mono', ui-monospace, monospace",
    weights: [400, 500],
    native: { 400: 'IBMPlexMono-Regular', 500: 'IBMPlexMono-Medium' },
  },
} as const satisfies Record<
  Face,
  {
    /** The family `fonts.css` declares. */
    readonly family: string
    /** The `font-family` value: the face, then the system's own while it loads or if it cannot. */
    readonly stack: string
    /** The weights the type scale sets this face in. */
    readonly weights: readonly number[]
    /** The family a native app registers each weight's file under. */
    readonly native: Readonly<Record<number, string>>
  }
>
