// The sync UI's dev page and its model: that each case is the state it is named for, that the
// page draws each in both themes under one title, that a panel opens from it, and that nothing
// it shows under the pseudo-locale is a word no catalog and no fixture accented. The measurements
// a browser takes, axe and the policy are the end-to-end suite's.
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { describe, expect, it } from 'vitest'
import { Providers } from '../../app/App.tsx'
import { paths } from '../../app/paths.ts'
import { inboxState } from '../../sync/Inbox.tsx'
import { rejectionCodes } from '../../sync/rejection.ts'
import { DevSync } from './DevSync.tsx'
import { describersFor, everything, registry, rejections } from './fixtures.ts'
import {
  cellId,
  cellThemes,
  inboxCases,
  inboxStates,
  refusalCodes,
  rowCases,
  rowStates,
  texts,
} from './model.ts'

describe('the sync page’s model', () => {
  it('puts the inbox in each state F-5 requires, and in its own: each case is what it is named', () => {
    // The twelve but pending and syncing, which are a row's, and absent and withdrawn, which an
    // entry leaves with its row; and a tab that does not hold the replica.
    expect(inboxStates).toEqual([
      'loading',
      'empty',
      'populated',
      'error',
      'offline',
      'conflicted',
      'rejected',
      'readonly',
      'elsewhere',
    ])
    for (const state of inboxStates) {
      const { facts } = inboxCases[state]
      const entries = facts.phase === 'open' ? facts.entries : undefined
      expect(inboxState({ ...facts, entries }), state).toBe(state)
    }
  })

  it('has a refusal for every code the resolver has a sentence for, and one for no code of its', () => {
    expect(rejections.map((entry) => entry.code)).toEqual(refusalCodes)
    expect(refusalCodes.slice(0, -1)).toEqual([...rejectionCodes])
  })

  it('lists everything oldest first, as a replica’s inbox does', () => {
    const answered = everything.map((entry) => entry.answered_at)
    expect(answered).toEqual([...answered].sort())
    expect(new Set(everything.map((entry) => entry.mutation_id)).size).toBe(everything.length)
  })

  it('draws a row in every state that is not in sync, and in both withdrawals', () => {
    expect(rowStates.map((state) => rowCases[state].state.kind)).toEqual([
      'pending',
      'syncing',
      'conflict',
      'rejected',
      'merged',
      'withdrawn',
      'withdrawn',
    ])
  })

  it('describes every entity its answers are of', () => {
    const described = Object.keys(describersFor((text) => text))
    for (const entry of everything) expect(described, entry.id).toContain(entry.entity_type)
    for (const type of described) expect(Object.keys(registry.entities)).toContain(type)
  })

  it('is written so that the pseudo-locale can accent it: no brace, no straight apostrophe', () => {
    expect(texts().filter((text) => /[{}'#]/.test(text))).toEqual([])
    for (const text of texts()) expect(text.trim()).not.toBe('')
  })
})

function open() {
  const router = createMemoryRouter([{ path: paths.devSync.path, Component: DevSync }], {
    initialEntries: [paths.devSync.example],
  })
  return render(
    <Providers persist={false}>
      <RouterProvider router={router} />
    </Providers>,
  )
}

function cell(container: HTMLElement, id: string): HTMLElement {
  const found = container.querySelector<HTMLElement>(`[data-sync-cell="${id}"]`)
  if (found === null) throw new Error(`no cell ${id}`)
  return found
}

describe('the sync page', () => {
  it('has one title, and draws every state in both themes', () => {
    const { container } = open()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    const drawn = [...container.querySelectorAll('[data-sync-cell]')].map((found) => [
      found.getAttribute('data-sync-cell'),
      found.getAttribute('data-theme'),
    ])
    const states = [
      ['bar', ['offline', 'not-receiving']],
      ['inbox', inboxStates],
      ['resolvers', ['conflict', 'rejected']],
      ['kept', ['overridden', 'replaced']],
      ['row', rowStates],
      ['honesty', ['not-enough', 'zero']],
      ['connection', ['needed']],
    ] as const
    expect(drawn).toEqual(
      states.flatMap(([section, names]) =>
        names.flatMap((state) => cellThemes.map((theme) => [cellId(section, state, theme), theme])),
      ),
    )
  })

  it('draws no panel open, and opens one from the page', async () => {
    const { container } = open()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    const resolvers = cell(container, cellId('resolvers', 'rejected', 'dark'))
    // A control for every refusal, each opening the reason its code has.
    expect(within(resolvers).getAllByRole('button')).toHaveLength(refusalCodes.length)
    await userEvent.click(
      within(resolvers).getByRole('button', { name: 'Not accepted: fair_use_ceiling' }),
    )
    const panel = screen.getByRole('dialog')
    expect(within(panel).getByText(/already holds as many entries as it can/)).toBeVisible()
    // In the cell's own theme: the panel is drawn inside it.
    expect(panel.closest('[data-theme]')).toHaveAttribute('data-theme', 'dark')
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
  })

  it('lets a member answer in one cell and leaves the other theme’s as it was', async () => {
    const { container } = open()
    const light = cell(container, cellId('inbox', 'conflicted', 'light'))
    const dark = cell(container, cellId('inbox', 'conflicted', 'dark'))
    const name = 'Two versions of March electricity settlement. Open to resolve'
    await userEvent.click(within(light).getByRole('button', { name }))
    await userEvent.click(screen.getByRole('button', { name: 'Keep theirs' }))
    expect(within(light).queryByRole('button', { name })).not.toBeInTheDocument()
    expect(within(dark).getByRole('button', { name })).toBeVisible()
  })

  it('draws a withdrawn row as its sentence, with nothing that writes', () => {
    const { container } = open()
    const access = cell(container, cellId('row', 'withdrawn-access', 'light'))
    expect(access).toHaveTextContent(
      'Your access to this changed, so it was removed from this device.',
    )
    expect(within(access).queryByRole('button')).not.toBeInTheDocument()
    expect(cell(container, cellId('row', 'withdrawn-module', 'light'))).toHaveTextContent(
      /^This module was turned off for the household\./,
    )
  })

  it('draws the not-enough tile with its action, beside a genuine zero', () => {
    const { container } = open()
    const missing = cell(container, cellId('honesty', 'not-enough', 'light'))
    expect(within(missing).getByText('Not enough information')).toBeVisible()
    expect(within(missing).getByRole('button', { name: 'Add a reading' })).toBeVisible()
    const zero = cell(container, cellId('honesty', 'zero', 'light'))
    expect(within(zero).getByText('0')).toBeVisible()
    expect(within(zero).queryByRole('button')).not.toBeInTheDocument()
  })

  it('says the household’s changes are not arriving, in the bar’s own place', async () => {
    const { container } = open()
    const bar = cell(container, cellId('bar', 'not-receiving', 'light'))
    // Said politely, and so drawn before its words (ui/Banner).
    expect(
      await within(bar).findByText(
        'Not receiving changes from other members right now. What you change is still saved and sent.',
      ),
    ).toBeVisible()
    expect(within(bar).getByRole('status')).not.toHaveTextContent('Offline')
  })

  /**
   * The words on the page that the pseudo-locale left plain: a run of four letters or more, as
   * the end-to-end pass counts one (e2e/fixtures.ts), but for the months `Intl` writes into a
   * date. A shipped component's own word that is in no catalog would be one.
   */
  function plainWords(): string[] {
    const months = new Set(
      Array.from({ length: 12 }, (_, month) =>
        (['long', 'short'] as const).map((style) =>
          new Intl.DateTimeFormat('en', { month: style, timeZone: 'UTC' }).format(
            Date.UTC(2026, month, 1),
          ),
        ),
      ).flat(),
    )
    const found: string[] = []
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const parent = node.parentElement
      if (parent === null || parent.closest('script, style, option') !== null) continue
      const text = node.textContent ?? ''
      for (const word of text.match(/[A-Za-z]{4,}/g) ?? []) {
        if (!months.has(word)) found.push(`${word} in "${text.slice(0, 60)}"`)
      }
    }
    return found
  }

  it('shows no word under the pseudo-locale that nothing accented, on the page or in a panel', async () => {
    window.localStorage.setItem('household.locale', 'en-XA')
    const { container } = open()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/^⟦Šýñç ÚÍ/)
    expect(plainWords()).toEqual([])
    // And in each panel: the comparison, a refusal with its neighbour, and a confirmation.
    const resolvers = (state: string) => cell(container, cellId('resolvers', state, 'light'))
    await userEvent.click(within(resolvers('conflict')).getByRole('button'))
    expect(screen.getByRole('dialog')).toBeVisible()
    expect(plainWords()).toEqual([])
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: /^⟦Ķééþ ţĥéíŕš/ }),
    )
    const [first] = within(resolvers('rejected')).getAllByRole('button')
    if (first === undefined) throw new Error('no refusal is offered')
    await userEvent.click(first)
    expect(plainWords()).toEqual([])
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: /^⟦Ðíšçáŕð/ }),
    )
    expect(screen.getAllByRole('dialog')).toHaveLength(2)
    expect(plainWords()).toEqual([])
  })
})
