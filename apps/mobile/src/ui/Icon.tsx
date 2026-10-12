// The glyphs and the illustrations of @household/icons, given what the web's inherit from the
// page and a native component must be handed (ADR 0024): a glyph its colour, by a token of the
// theme it is drawn in, and an illustration that theme. A glyph grows with the reader's text, as
// the word beside it does. One with no label is decoration and hidden from a screen reader;
// an icon-only control is named by its button, from the register (ui/Button.tsx).
import {
  BaseIcon as NativeBaseIcon,
  Illustration as NativeIllustration,
  ModuleIcon as NativeModuleIcon,
  StatusIcon as NativeStatusIcon,
} from '@household/icons/native'
import {
  sizes,
  statusGlyphs,
  type BaseId,
  type CompositionId,
  type NavigationId,
  type StatusId,
} from '@household/icons'
import type { ColorName } from '@household/tokens/native'
import { createContext, use, type ReactNode } from 'react'
import { useDisplay, useTheme, useThemeName } from '../display/DisplayProvider.tsx'

/**
 * The colour the words around a glyph are in, where a control says so: what `currentColor` is
 * on the web. A glyph drawn inside takes it unless it names a colour of its own.
 */
const InkContext = createContext<ColorName | null>(null)

/** Draws `children`'s glyphs in `color`: a button's leading glyph in the colour of its words. */
export function Ink({
  color,
  children,
}: {
  readonly color: ColorName
  readonly children: ReactNode
}) {
  return <InkContext value={color}>{children}</InkContext>
}

interface Shared {
  /** The colour it is stroked in, by its token. */
  readonly color?: ColorName
  /** Its size at a text scale of one, in px: one of its set's (`sizes`). */
  readonly size?: number
  /** A translated name. Left out, the glyph is decoration and hidden from a screen reader. */
  readonly label?: string
}

/** What a native glyph is handed: the token's value, the size at the reader's scale, the name. */
function useDrawn(
  { color, size, label }: Shared,
  standard: number,
): { color: string; size: number; label?: string } {
  const theme = useTheme()
  const ink = use(InkContext)
  const { textScale } = useDisplay()
  return {
    color: theme.color[color ?? ink ?? 'text-primary'],
    size: (size ?? standard) * textScale,
    ...(label === undefined ? {} : { label }),
  }
}

/** A status's glyph, in the status's own colour unless another is named. */
export function StatusIcon({ status, ...shared }: Shared & { readonly status: StatusId }) {
  const drawn = useDrawn(
    { ...shared, color: shared.color ?? statusGlyphs[status].token },
    sizes.status[0],
  )
  return <NativeStatusIcon status={status} {...drawn} />
}

/** A module's glyph, or Today's or Add's. */
export function ModuleIcon({ module, ...shared }: Shared & { readonly module: NavigationId }) {
  return <NativeModuleIcon module={module} {...useDrawn(shared, sizes.module[0])} />
}

export function BaseIcon({ name, ...shared }: Shared & { readonly name: BaseId }) {
  return <NativeBaseIcon name={name} {...useDrawn(shared, sizes.base[0])} />
}

/** A composition, in the theme it stands in. Decoration: the sentence beside it says what it shows. */
export function Illustration({
  composition,
  width,
}: {
  readonly composition: CompositionId
  /** In px, as drawn: an illustration does not grow with the text, and is not drawn at 200 %. */
  readonly width: number
}) {
  return <NativeIllustration composition={composition} width={width} theme={useThemeName()} />
}
