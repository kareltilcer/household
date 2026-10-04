// The Done-when of plan item 23: the compositions render the same on web and React Native. The
// two clients draw one drawing, so what can differ is what each component does with it. Here the
// native components draw through a stand-in for react-native-svg whose every element is the SVG
// element of the same name, as react-native-svg's are, and the markup is held to the web's:
// every element, every attribute and every value. What the stand-in does not prove, that
// react-native-svg takes each attribute under that name and type, the type check of this
// directory does, against react-native-svg's own types.
import { resolve } from '@household/tokens'
import { createElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  baseIds,
  compositions,
  illustration,
  moduleGlyphs,
  statusGlyphs,
  type CompositionId,
  type NavigationId,
  type StatusId,
} from '../src/index.ts'
import * as web from '../web/index.ts'
import * as native from './index.ts'

interface Seen {
  /** What React Native's components take that an SVG element in the DOM does not. */
  readonly nativeOnly: readonly string[]
  /** The props the last root was drawn with. */
  root: Record<string, unknown>
}

const seen = vi.hoisted((): Seen => ({
  nativeOnly: [
    'color',
    'accessible',
    'accessibilityRole',
    'accessibilityLabel',
    'accessibilityElementsHidden',
    'importantForAccessibility',
  ],
  root: {},
}))

vi.mock('react-native-svg', async () => {
  const react = await import('react')
  type Props = Record<string, unknown> & { readonly children?: ReactNode }
  const stand =
    (tag: string) =>
    ({ children, ...props }: Props) =>
      react.createElement(tag, props, children)
  /** The root keeps what is React Native's own aside, for the test to read, and draws the rest. */
  const Svg = ({ children, ...props }: Props) => {
    seen.root = props
    const drawn = Object.fromEntries(
      Object.entries(props).filter(([name]) => !seen.nativeOnly.includes(name)),
    )
    return react.createElement('svg', drawn, children)
  }
  return {
    Svg,
    default: Svg,
    G: stand('g'),
    Path: stand('path'),
    Circle: stand('circle'),
    Rect: stand('rect'),
    Line: stand('line'),
  }
})

/** Markup without the web's own accessibility attributes, which the native root states its own way. */
function drawn(element: ReactElement): string {
  return renderToStaticMarkup(element).replace(/ (aria-hidden|role|aria-label)="[^"]*"/g, '')
}

describe('the compositions on React Native', () => {
  it.each(Object.keys(compositions) as CompositionId[])(
    '%s is the web’s drawing',
    (composition) => {
      for (const theme of ['light', 'dark'] as const) {
        const onNative = drawn(
          createElement(native.Illustration, { composition, width: 200, theme }),
        )
        const onWeb = drawn(createElement(web.Illustration, { composition, width: 200 }))
        // The web names a tone as a custom property, which its theme resolves; native is handed
        // the theme, and draws the value that property has in it.
        const resolved = onWeb.replace(/var\(--([a-z-]+)\)/g, (_, name: string) =>
          resolve(name as Parameters<typeof resolve>[0], theme),
        )
        expect(onNative).toBe(resolved)
        expect(onNative).toContain('<svg viewBox="0 0 200 140" width="200" height="140">')
        expect(onNative).not.toContain('var(')
      }
    },
  )

  it('draw every element of the drawing, in order', () => {
    const drawing = illustration('finance.setup.split', (name) => resolve(name, 'dark'), 200)
    const markup = drawn(
      createElement(native.Illustration, {
        composition: 'finance.setup.split',
        width: 200,
        theme: 'dark',
      }),
    )
    expect(markup.match(/<g /g)).toHaveLength(drawing.children.length)
    const paths = drawing.children.flatMap((node) => (node.tag === 'g' ? node.children : []))
    expect(markup.match(/<path /g)).toHaveLength(paths.length)
  })

  it('are hidden from assistive technology', () => {
    renderToStaticMarkup(
      createElement(native.Illustration, {
        composition: 'shopping.empty',
        width: 200,
        theme: 'light',
      }),
    )
    expect(seen.root).toMatchObject({
      accessible: false,
      accessibilityElementsHidden: true,
      importantForAccessibility: 'no-hide-descendants',
    })
    expect(seen.root).not.toHaveProperty('color')
  })
})

describe('the glyphs on React Native', () => {
  const color = resolve('status-conflict', 'light')

  it.each(Object.keys(statusGlyphs) as StatusId[])('status %s is the web’s drawing', (status) => {
    expect(drawn(createElement(native.StatusIcon, { status, color }))).toBe(
      drawn(createElement(web.StatusIcon, { status })),
    )
  })

  it.each(Object.keys(moduleGlyphs) as NavigationId[])(
    'module %s is the web’s drawing',
    (module) => {
      expect(drawn(createElement(native.ModuleIcon, { module, color, size: 28 }))).toBe(
        drawn(createElement(web.ModuleIcon, { module, size: 28 })),
      )
    },
  )

  it.each(baseIds)('base %s is the web’s drawing', (name) => {
    expect(drawn(createElement(native.BaseIcon, { name, color }))).toBe(
      drawn(createElement(web.BaseIcon, { name })),
    )
  })

  it('are stroked in the colour they are given, which is what currentColor is', () => {
    const markup = drawn(createElement(native.StatusIcon, { status: 'conflict', color }))
    expect(markup).toContain('stroke="currentColor"')
    expect(seen.root).toMatchObject({ color })
  })

  it('are an image with a label where they stand alone, and hidden beside their word', () => {
    renderToStaticMarkup(
      createElement(native.BaseIcon, { name: 'trash-2', color, label: 'Delete Milk' }),
    )
    expect(seen.root).toMatchObject({
      accessible: true,
      accessibilityRole: 'image',
      accessibilityLabel: 'Delete Milk',
    })
    renderToStaticMarkup(createElement(native.BaseIcon, { name: 'trash-2', color }))
    expect(seen.root).toMatchObject({ accessible: false, accessibilityElementsHidden: true })
    expect(seen.root).not.toHaveProperty('accessibilityLabel')
  })
})
