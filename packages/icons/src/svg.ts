/**
 * A drawing, as data: what an icon or an illustration is before either client draws it. The two
 * clients share no component (D-36), so they share this instead. `web/` draws a drawing as SVG
 * elements in the DOM and `native/` as react-native-svg's, each from the same tree, which is why
 * a composition renders the same on both. Attribute names are the camel-cased ones React's SVG
 * elements and react-native-svg's components both take, so neither client translates a drawing.
 */

/** How a shape is painted. A colour is `currentColor`, `none`, or what a client's paint gives. */
export interface Presentation {
  readonly fill?: string
  readonly fillOpacity?: number
  readonly stroke?: string
  readonly strokeWidth?: number
  readonly strokeLinecap?: 'round'
  readonly strokeLinejoin?: 'round'
  readonly strokeDasharray?: string
}

export interface Path extends Presentation {
  readonly tag: 'path'
  readonly d: string
}

export interface Circle extends Presentation {
  readonly tag: 'circle'
  readonly cx: number
  readonly cy: number
  readonly r: number
}

export interface Rect extends Presentation {
  readonly tag: 'rect'
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly rx?: number
  readonly ry?: number
}

export interface Line extends Presentation {
  readonly tag: 'line'
  readonly x1: number
  readonly y1: number
  readonly x2: number
  readonly y2: number
}

export type Shape = Path | Circle | Rect | Line

/** Shapes placed together: an illustration's part, moved and scaled into the frame. */
export interface Group {
  readonly tag: 'g'
  readonly transform?: string
  readonly children: readonly Shape[]
}

export type Node = Group | Shape

export interface Drawing extends Presentation {
  /** The drawing's own coordinates: `0 0 24 24` for a glyph. */
  readonly viewBox: string
  /** The size it is drawn at. An illustration with no width fills the width it is given. */
  readonly width?: number
  readonly height?: number
  readonly children: readonly Node[]
}

/**
 * A drawing's attributes as a client's element takes them: the attributes themselves where the
 * element's props have each of their names, and nothing where one is under a name they have not.
 * An object is assignable to props it has more names than, so handing a drawing's attributes to
 * an element holds each one's type and lets a name the element does not take pass, to be dropped
 * when it is drawn. Each client holds what it hands over to this as well.
 */
export type Taken<Attributes, Props> = Attributes extends unknown
  ? Exclude<keyof Attributes, keyof Props> extends never
    ? Attributes
    : never
  : never

/** A glyph of one stroke in the current colour, on the 24-unit grid. */
export function glyph(children: readonly Shape[], strokeWidth: number, size: number): Drawing {
  return {
    viewBox: '0 0 24 24',
    width: size,
    height: size,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    children,
  }
}

/** Each element of a drawing, groups and the shapes inside them, in drawing order. */
export function nodes(drawing: Drawing): Node[] {
  return drawing.children.flatMap((node) => (node.tag === 'g' ? [node, ...node.children] : [node]))
}
