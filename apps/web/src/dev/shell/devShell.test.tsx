// The shell's dev page (plan items 25 and 27): that it draws the entitlement banner in each of
// its drawings and the suspended lockout under one title, from fixtures, and that nothing it
// shows under the pseudo-locale is a word no catalog and no fixture accented. The measurements a
// browser takes, axe in both themes and the policy are the end-to-end suite's.
import { render, screen, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { describe, expect, it } from 'vitest'
import { Providers } from '../../app/App.tsx'
import { inHousehold, paths } from '../../app/paths.ts'
import { DevShell } from './DevShell.tsx'

function open() {
  const router = createMemoryRouter([{ path: paths.devShell.path, Component: DevShell }], {
    initialEntries: [paths.devShell.example],
  })
  return render(
    <Providers persist={false}>
      <RouterProvider router={router} />
    </Providers>,
  )
}

/** The case of the page headed `title`: its frame, with what it draws. */
function caseOf(title: string | RegExp): HTMLElement {
  const section = screen.getByRole('heading', { level: 2, name: title }).closest('section')
  if (section === null) throw new Error(`no case headed ${String(title)}`)
  return section
}

describe('the shell’s page', () => {
  it('has one title, whatever it draws under it', () => {
    open()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  // A-30's seven drawings, the trial having two, and a restriction twice more: beside a lapse,
  // and with nobody to name.
  it('draws the entitlement banner in each of its states, to each of its readers', () => {
    open()
    const notice = caseOf(/^Trial, with ten days or fewer left/)
    expect(within(notice).getByText('9 days of the trial left')).toBeVisible()
    expect(within(notice).getByRole('link', { name: 'Subscribe' })).toBeVisible()
    // The one banner that can be put away.
    expect(within(notice).getByRole('button', { name: 'Dismiss' })).toBeVisible()

    const banner = caseOf(/^Trial, with five days or fewer left/)
    expect(within(banner).getByText('3 days of the trial left')).toBeVisible()
    expect(within(banner).getByRole('link', { name: 'Go to billing' })).toBeVisible()
    expect(within(banner).queryByRole('button')).not.toBeInTheDocument()

    expect(
      within(caseOf(/^Past due/)).getByText('The last payment didn’t go through'),
    ).toBeVisible()

    const grace = caseOf(/^Grace/)
    expect(within(grace).getByText('New files can’t be added for now')).toBeVisible()
    expect(
      within(grace).getByText('Only an owner can change this: Jana Tilcerová and Petr Tilcer.'),
    ).toBeVisible()
    expect(within(grace).queryByRole('link')).not.toBeInTheDocument()

    const readOnly = caseOf('Read-only, to the payer')
    expect(within(readOnly).getByText('Tilcerovi is read-only')).toBeVisible()
    expect(within(readOnly).getByText(/^Its data is kept until Oct 9, 2027/)).toBeVisible()
    expect(within(readOnly).queryByRole('link', { name: 'Lift the restriction' })).toBeNull()

    const both = caseOf(/^Read-only with a restriction beside it/)
    expect(within(both).getByText('Tilcerovi is read-only')).toBeVisible()
    expect(
      within(both).getByText(/^An owner restricted this household on .*: Jana Tilcerová\.$/),
    ).toBeVisible()
    expect(within(both).getByRole('link', { name: 'Lift the restriction' })).toBeVisible()

    const cancelled = caseOf(/^Cancelled/)
    expect(within(cancelled).getByText('The subscription was cancelled')).toBeVisible()
    expect(within(cancelled).getByRole('link', { name: 'Your data' })).toBeVisible()

    const restricted = caseOf(/^Restricted, with its reason/)
    expect(within(restricted).getByText('This household is restricted')).toBeVisible()
    expect(
      within(restricted).getByText('The reason given: Until the insurance claim is settled.'),
    ).toBeVisible()

    const unnamed = caseOf(/^Restricted by an account that is gone/)
    expect(
      within(unnamed).getByText(/^An owner restricted this household on Sep 9, 2026, 2:02\sPM\.$/),
    ).toBeVisible()
    expect(within(unnamed).queryByText(/The reason given/)).not.toBeInTheDocument()
  })

  it('draws the lockout, with the notice as written and the way to a household that opens', () => {
    open()
    const lockout = caseOf(/^The lockout/)
    // Under the page's own title, and so no second `<h1>`.
    expect(
      within(lockout).getByRole('heading', { level: 3, name: 'Srub Šumava is suspended' }),
    ).toBeVisible()
    expect(within(lockout).getByText('Household suspended it on Sep 9, 2026.')).toBeVisible()
    expect(within(lockout).getByText(/^We were told that files kept here/)).toBeVisible()
    expect(within(lockout).getByRole('link', { name: 'Go to Tilcerovi' })).toHaveAttribute(
      'href',
      inHousehold.home('01900000-0000-7000-8000-0000000000a1'),
    )
    expect(within(lockout).getByRole('button', { name: 'Sign out' })).toBeVisible()
  })

  it('names a household that is open and read-only, and one that is suspended, each with its word', () => {
    open()
    const switcher = caseOf(/^Switcher: the household that is open is read-only/)
    expect(within(switcher).getByText('Owner · read-only')).toBeVisible()
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

  it('shows no word under the pseudo-locale that nothing accented', () => {
    window.localStorage.setItem('household.locale', 'en-XA')
    open()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/^⟦/)
    expect(plainWords()).toEqual([])
  })
})
