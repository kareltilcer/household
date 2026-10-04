// The glyphs and the compositions as the web draws them: each one's markup, held to a snapshot,
// so that a change to a glyph's data, a set's weight or the way a drawing becomes SVG is a line
// of a diff someone reads.
import { createElement, type SVGAttributes } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  baseIds,
  compositions,
  moduleGlyphs,
  statusGlyphs,
  type CompositionId,
  type NavigationId,
  type Path,
  type StatusId,
  type Taken,
} from '../src/index.ts'
import { BaseIcon, Illustration, ModuleIcon, StatusIcon } from './index.ts'

describe('the status glyphs', () => {
  it.each(Object.keys(statusGlyphs) as StatusId[])('%s', (status) => {
    expect(renderToStaticMarkup(createElement(StatusIcon, { status }))).toMatchSnapshot()
  })
})

describe('the navigation glyphs', () => {
  it.each(Object.keys(moduleGlyphs) as NavigationId[])('%s', (module) => {
    expect(renderToStaticMarkup(createElement(ModuleIcon, { module }))).toMatchSnapshot()
  })
})

describe('the base glyphs', () => {
  it.each(baseIds)('%s', (name) => {
    expect(renderToStaticMarkup(createElement(BaseIcon, { name }))).toMatchSnapshot()
  })
})

describe('the compositions', () => {
  it.each(Object.keys(compositions) as CompositionId[])('%s', (composition) => {
    expect(renderToStaticMarkup(createElement(Illustration, { composition }))).toMatchSnapshot()
  })
})

describe('a glyph', () => {
  it('is one stroke in the current colour, at its set’s weight and size', () => {
    const markup = renderToStaticMarkup(createElement(StatusIcon, { status: 'conflict' }))
    expect(markup).toBe(
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" ' +
        'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M4.6 4.6h9.8v9.8H4.6z"></path><path d="M9.6 9.6h9.8v9.8H9.6z"></path></svg>',
    )
    expect(renderToStaticMarkup(createElement(ModuleIcon, { module: 'garden' }))).toContain(
      'width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75"',
    )
    expect(renderToStaticMarkup(createElement(BaseIcon, { name: 'x', size: 24 }))).toContain(
      'width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"',
    )
  })

  it('is hidden beside its word, and an image with its label where it stands alone', () => {
    const beside = renderToStaticMarkup(createElement(BaseIcon, { name: 'trash-2' }))
    expect(beside).toContain('aria-hidden="true"')
    expect(beside).not.toContain('role=')
    const alone = renderToStaticMarkup(
      createElement(BaseIcon, { name: 'trash-2', label: 'Delete Milk' }),
    )
    expect(alone).toContain('role="img" aria-label="Delete Milk"')
    expect(alone).not.toContain('aria-hidden')
  })

  it('carries no colour of its own in either in-house set or the base set', () => {
    const all = [
      ...(Object.keys(statusGlyphs) as StatusId[]).map((status) =>
        createElement(StatusIcon, { status }),
      ),
      ...(Object.keys(moduleGlyphs) as NavigationId[]).map((module) =>
        createElement(ModuleIcon, { module }),
      ),
      ...baseIds.map((name) => createElement(BaseIcon, { name })),
    ].map((icon) => renderToStaticMarkup(icon))
    expect(all).toHaveLength(13 + 19 + 55)
    expect(all.filter((markup) => /#[0-9a-f]{3}|rgb|var\(|url\(/i.test(markup))).toEqual([])
    expect(all.filter((markup) => (markup.match(/fill=/g) ?? []).length !== 1)).toEqual([])
    expect(all.filter((markup) => (markup.match(/stroke=/g) ?? []).length !== 1)).toEqual([])
  })

  it('takes a class for its surface to size and colour it by', () => {
    expect(
      renderToStaticMarkup(createElement(StatusIcon, { status: 'synced', className: 'mark' })),
    ).toContain('class="mark"')
  })
})

describe('an illustration', () => {
  it('names its two tones as the tokens’ custom properties, and is decoration', () => {
    const markup = renderToStaticMarkup(
      createElement(Illustration, { composition: 'shopping.empty' }),
    )
    expect(markup).toContain('<svg viewBox="0 0 200 140" width="100%" aria-hidden="true">')
    expect(markup).toContain('stroke="var(--text-muted)"')
    expect(markup).toContain('stroke="var(--accent-family-keeping)"')
    expect(markup).toContain('fill="var(--accent-family-keeping)" fill-opacity="0.12"')
    expect(markup).toContain('<g transform="translate(104, 44) scale(1.25)">')
    expect(markup).toContain('stroke-dasharray="4 3.2"')
    expect(markup).not.toContain('height=')
    expect(markup).not.toMatch(/#[0-9A-F]{6}/i)
  })

  it('is drawn at a width in the frame’s proportion when given one', () => {
    expect(
      renderToStaticMarkup(
        createElement(Illustration, { composition: 'garden.setup.plot', width: 100 }),
      ),
    ).toContain('<svg viewBox="0 0 200 140" width="100" height="70" aria-hidden="true">')
  })
})

// Checked by this directory's type check: an object is assignable to props it has more names
// than, so what an assignment lets pass, `Taken` refuses.
describe('a drawing’s attributes', () => {
  it('are each under a name React’s SVG elements take, or do not compile', () => {
    type Props = SVGAttributes<SVGElement>
    expectTypeOf<Taken<Omit<Path, 'tag'>, Props>>().toEqualTypeOf<Omit<Path, 'tag'>>()
    type Hyphenated = Taken<{ readonly d: string; readonly 'stroke-width': number }, Props>
    type Misspelt = Taken<{ readonly d: string; readonly strokeDashArray?: string }, Props>
    expectTypeOf<Hyphenated>().toBeNever()
    expectTypeOf<Misspelt>().toBeNever()
  })
})
