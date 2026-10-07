// The harness's model, held as design/v1's `components.js` holds its own (`checks()`), and the
// page drawn from it. The measurements a browser takes, axe and the pseudo-locale pass are the
// end-to-end suite's (e2e/harness.spec.ts).
import { statusGlyphs } from '@household/icons'
import { catalogs, isMessageKey } from '@household/i18n'
import { render, screen, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { describe, expect, it } from 'vitest'
import { Providers } from '../../app/App.tsx'
import { dataStates, treatments, type Treatment } from '../../ui/states.ts'
import { Harness } from './Harness.tsx'
import { bodies, bodyIds, cellId, cellThemes, states, variantIds, variants } from './model.ts'

describe('the harness’s model', () => {
  it('has nine bodies and twelve states: a hundred and eight cells', () => {
    expect(bodyIds).toHaveLength(9)
    expect(Object.keys(bodies)).toEqual([...bodyIds])
    expect(Object.keys(states)).toEqual([...dataStates])
    expect(bodyIds.length * dataStates.length).toBe(108)
  })

  it('carries no state by colour alone: every mark is a glyph, a word and a token', () => {
    for (const state of dataStates) {
      const treatment: Treatment = treatments[state]
      if (treatment.mark === undefined) continue
      const glyph = statusGlyphs[treatment.mark]
      expect(glyph.paths.length, state).toBeGreaterThan(0)
      expect(glyph.token, state).toMatch(/^status-/)
      expect(isMessageKey(glyph.labelKey), state).toBe(true)
      expect(catalogs.en[glyph.labelKey].trim(), state).not.toBe('')
    }
  })

  it('gives every named state of every body a sentence of its own', () => {
    for (const id of bodyIds) {
      const body = bodies[id]
      for (const text of [
        body.error,
        body.rejected,
        body.withdrawn,
        body.readonly,
        body.empty.sentence,
        body.empty.example,
        body.empty.action,
        body.name,
        body.note,
      ]) {
        expect(text.trim(), id).not.toBe('')
      }
      expect(body.skeleton.length, id).toBeGreaterThan(0)
    }
    // No shared "Something went wrong": an error is written for the body it is about.
    expect(new Set(bodyIds.map((id) => bodies[id].error)).size).toBe(bodyIds.length)
    expect(new Set(bodyIds.map((id) => bodies[id].empty.sentence)).size).toBe(bodyIds.length)
  })

  it('is written so that the pseudo-locale can accent it: no brace, no straight apostrophe', () => {
    const texts = [
      ...bodyIds.flatMap((id) => {
        const body = bodies[id]
        return [
          body.name,
          body.note,
          body.error,
          body.rejected,
          body.withdrawn,
          body.readonly,
          ...Object.values(body.empty),
        ]
      }),
      ...dataStates.flatMap((state) => Object.values(states[state])),
      ...variantIds.map((variant) => variants[variant].name),
    ]
    expect(texts.filter((text) => /[{}'#]/.test(text))).toEqual([])
  })

  it('names each variant’s body', () => {
    for (const variant of variantIds) expect(bodyIds).toContain(variants[variant].body)
  })
})

function open(address: string) {
  const router = createMemoryRouter([{ path: '/dev/harness', Component: Harness }], {
    initialEntries: [address],
  })
  return render(
    <Providers persist={false}>
      <RouterProvider router={router} />
    </Providers>,
  )
}

describe('the harness', () => {
  it('draws every body in every state in both themes, each by its own treatment', () => {
    const { container } = open('/dev/harness')
    const drawn = [...container.querySelectorAll('[data-harness-cell]')].map((cell) => [
      cell.getAttribute('data-harness-cell'),
      cell.getAttribute('data-kind'),
      cell.getAttribute('data-theme'),
    ])
    expect(drawn).toEqual(
      bodyIds.flatMap((body) =>
        dataStates.flatMap((state) =>
          cellThemes.map((theme) => [cellId(body, state, theme), treatments[state].kind, theme]),
        ),
      ),
    )
    expect(drawn).toHaveLength(216)
    expect(container.querySelectorAll('[data-harness-variant]')).toHaveLength(variantIds.length * 2)
  }, 30_000)

  it('holds the page at 200 % text while it is open, and gives the scale back', () => {
    const { unmount } = open('/dev/harness?body=money')
    expect(document.documentElement).toHaveAttribute('data-scale', '200')
    expect(window.localStorage.getItem('household.display')).toBeNull()
    unmount()
  })

  it('draws at 100 % text when asked, and one body when asked for one', () => {
    open('/dev/harness?body=kv&scale=100')
    expect(document.documentElement).not.toHaveAttribute('data-scale')
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      bodies.kv.name,
    ])
  })

  it('draws nothing in an absent cell, and no write affordance in a state that writes nothing', () => {
    const { container } = open('/dev/harness?body=list')
    const cell = (state: string) => {
      const found = container.querySelector<HTMLElement>(
        `[data-harness-cell="list:${state}:light"]`,
      )
      if (found === null) throw new Error(`no ${state} cell`)
      return found
    }
    expect(cell('absent')).toBeEmptyDOMElement()
    expect(within(cell('populated')).getAllByRole('button', { name: 'Open' })).toHaveLength(3)
    for (const state of ['withdrawn', 'readonly']) {
      expect(within(cell(state)).queryByRole('button', { name: 'Open' })).not.toBeInTheDocument()
    }
    expect(container.querySelector(':disabled, [aria-disabled="true"]')).toBeNull()
  })

  it('accents its own sample text under the pseudo-locale, as a catalog’s message is', () => {
    window.localStorage.setItem('household.locale', 'en-XA')
    open('/dev/harness?body=money')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/^⟦Ţŵéľṽé-šţáţé/)
    expect(screen.getByRole('heading', { level: 2 }).textContent).toMatch(/^⟦Ṁóñéý ṽáľúé/)
  })
})
