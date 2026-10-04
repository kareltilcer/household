/**
 * @household/icons/web — the glyphs and the illustrations as React components that draw SVG in
 * the DOM. A glyph is stroked in `currentColor`, so it takes the colour of the text it sits in: a
 * status's token or a module's accent is set on its surface, never on the glyph. An illustration
 * names its two tones as the tokens' custom properties, so it follows the theme of its scope.
 */
import { cssVar } from '@household/tokens'
import { createElement, type ReactElement, type SVGAttributes } from 'react'
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
  /** The glyph's width and height, in px. Each set has its own default (`sizes`). */
  readonly size?: number
  /**
   * The glyph's name, translated, when it stands alone: an icon-only control has one, with no
   * exception (06-clients §4). Without one the glyph is decoration beside its word, and hidden.
   */
  readonly label?: string
  readonly className?: string
}

// Each of a drawing's attributes is one React's SVG elements take, under the same name: the
// assignments below are where a drawing is held to that.
function element(node: Node): ReactElement {
  if (node.tag === 'g') {
    const { tag, children, ...attributes } = node
    const props: SVGAttributes<SVGGElement> = attributes
    return createElement(tag, props, ...children.map(element))
  }
  const { tag, ...attributes } = node
  const props: SVGAttributes<SVGElement> = attributes
  return createElement(tag, props)
}

function draw(drawing: Drawing, label: string | undefined, className?: string): ReactElement {
  const { children, ...attributes } = drawing
  const props: SVGAttributes<SVGSVGElement> = {
    ...attributes,
    // A drawing with no width fills the width it is given, and its height follows its viewBox.
    width: drawing.width ?? '100%',
    ...(className === undefined ? {} : { className }),
    ...(label === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label }),
  }
  return createElement('svg', props, ...children.map(element))
}

export function StatusIcon(props: IconProps & { readonly status: StatusId }): ReactElement {
  return draw(statusIcon(props.status, props.size), props.label, props.className)
}

/** A module's glyph, or Today's or Add's. */
export function ModuleIcon(props: IconProps & { readonly module: NavigationId }): ReactElement {
  return draw(moduleIcon(props.module, props.size), props.label, props.className)
}

export function BaseIcon(props: IconProps & { readonly name: BaseId }): ReactElement {
  return draw(baseIcon(props.name, props.size), props.label, props.className)
}

export interface IllustrationProps {
  readonly composition: CompositionId
  /** In px. With none the illustration fills the width it is given, and never sets its height. */
  readonly width?: number
  readonly className?: string
}

/** A composition. Decoration: the sentence beside it says what it shows. */
export function Illustration(props: IllustrationProps): ReactElement {
  return draw(illustration(props.composition, cssVar, props.width), undefined, props.className)
}
