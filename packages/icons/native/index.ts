/**
 * @household/icons/native — the glyphs and the illustrations as React Native components, drawn
 * with react-native-svg from the same drawings the web draws. React Native has no cascade for a
 * glyph to take its colour from, so a glyph is given one, a theme's value of a token, and an
 * illustration is given the theme its two tones are resolved in.
 */
import { resolve, type ColorName, type Theme } from '@household/tokens'
import { createElement, type ReactElement } from 'react'
import { Circle, G, Line, Path, Rect, Svg } from 'react-native-svg'
import {
  baseIcon,
  illustration,
  moduleIcon,
  statusIcon,
  type BaseId,
  type CompositionId,
  type Drawing,
  type NavigationId,
  type Node,
  type StatusId,
} from '../src/index.ts'

export interface IconProps {
  /** The glyph's colour: a theme's value of a status token, a module's accent or a text token. */
  readonly color: string
  /** The glyph's width and height, in px. Each set has its own default (`sizes`). */
  readonly size?: number
  /**
   * The glyph's name, translated, when it stands alone: an icon-only control has one, with no
   * exception (06-clients §4). Without one the glyph is decoration beside its word, and hidden.
   */
  readonly label?: string
}

/** react-native-svg's component for each shape of a drawing. */
const shapes = { path: Path, circle: Circle, rect: Rect, line: Line } as const

// Each of a drawing's attributes is one react-native-svg's component takes, under the same name:
// each case below is where a drawing is held to that component's own props.
function element(node: Node): ReactElement {
  switch (node.tag) {
    case 'g': {
      const { transform, children } = node
      return createElement(
        G,
        transform === undefined ? {} : { transform },
        ...children.map(element),
      )
    }
    case 'path': {
      const { tag, ...attributes } = node
      return createElement(shapes[tag], attributes)
    }
    case 'circle': {
      const { tag, ...attributes } = node
      return createElement(shapes[tag], attributes)
    }
    case 'rect': {
      const { tag, ...attributes } = node
      return createElement(shapes[tag], attributes)
    }
    case 'line': {
      const { tag, ...attributes } = node
      return createElement(shapes[tag], attributes)
    }
  }
}

function draw(drawing: Drawing, label: string | undefined, color?: string): ReactElement {
  const { children, ...attributes } = drawing
  return createElement(
    Svg,
    {
      ...attributes,
      // What `currentColor` is, in a drawing stroked in it.
      ...(color === undefined ? {} : { color }),
      ...(label === undefined
        ? {
            accessible: false,
            accessibilityElementsHidden: true,
            importantForAccessibility: 'no-hide-descendants' as const,
          }
        : { accessible: true, accessibilityRole: 'image' as const, accessibilityLabel: label }),
    },
    ...children.map(element),
  )
}

export function StatusIcon(props: IconProps & { readonly status: StatusId }): ReactElement {
  return draw(statusIcon(props.status, props.size), props.label, props.color)
}

/** A module's glyph, or Today's or Add's. */
export function ModuleIcon(props: IconProps & { readonly module: NavigationId }): ReactElement {
  return draw(moduleIcon(props.module, props.size), props.label, props.color)
}

export function BaseIcon(props: IconProps & { readonly name: BaseId }): ReactElement {
  return draw(baseIcon(props.name, props.size), props.label, props.color)
}

export interface IllustrationProps {
  readonly composition: CompositionId
  /** In px. The height follows from the frame's proportion. */
  readonly width: number
  /** The theme the illustration's ink and accent are resolved in. */
  readonly theme: Theme
}

/** A composition. Decoration: the sentence beside it says what it shows. */
export function Illustration(props: IllustrationProps): ReactElement {
  const paint = (name: ColorName) => resolve(name, props.theme)
  return draw(illustration(props.composition, paint, props.width), undefined)
}
