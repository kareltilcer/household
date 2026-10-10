// The entitlement banner (A-30): which one a household's answer asks for, what each of its seven
// drawings says to each of its three readers and where it leads them, and, above a household's
// screens as the shell draws it, when it is read in its place and when it is announced, the one
// notice that is put away, and where it stands under the offline bar.
import { focusManager } from '@tanstack/react-query'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, RouterProvider, createMemoryRouter, useParams } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { createWebClient } from '../api/client.ts'
import { Providers } from '../app/App.tsx'
import { Signed } from '../app/guards.tsx'
import { inHousehold, paths } from '../app/paths.ts'
import type { Reader } from '../household/data.ts'
import { HouseholdContext } from '../household/HouseholdContext.tsx'
import { useHouseholdQuery } from '../household/households.ts'
import {
  accountOf,
  adam,
  createServer,
  home,
  jana,
  memberOf,
  members,
  origin,
  petr,
  readBy,
  type HouseholdServer,
} from '../household/testing.tsx'
import { SyncFixture, type Sync } from '../sync/ReplicaProvider.tsx'
import { draw } from '../test/render.tsx'
import {
  bannerId,
  bannerOf,
  daysLeft,
  putAway,
  putAwayNow,
  trialNoticeKey,
  type Entitlement,
} from './entitlement.ts'
import { EntitlementBannerView } from './EntitlementBanner.tsx'
import { contentId } from './Frame.tsx'
import { HouseholdBars } from './HouseholdBars.tsx'

// A test that says the page is looked at again leaves the next one a page nobody has looked at.
afterEach(() => {
  focusManager.setFocused(undefined)
})

const zone = 'Europe/Prague'
/** The moment the banners of the view's tests are drawn at: 21 September, at noon in Prague. */
const now = Date.parse('2026-09-21T10:00:00Z')

const restriction = {
  restricted_by: { user_id: jana.id, label: 'Jana Tilcerová', is_former_member: false },
  restricted_at: '2026-09-09T12:02:00Z',
  reason: 'Until the insurance claim is settled.',
}

const states = {
  notice: { state: 'trialing', trial_notice: 'notice', trial_ends_at: '2026-09-30T08:00:00Z' },
  banner: { state: 'trialing', trial_notice: 'banner', trial_ends_at: '2026-09-24T08:00:00Z' },
  pastDue: { state: 'past_due', can_write: true, can_upload: true },
  grace: { state: 'grace', can_upload: false, grace_ends_at: '2026-10-05T08:00:00Z' },
  readOnly: { state: 'read_only', can_write: false, data_retained_until: '2027-10-09T08:00:00Z' },
  canceled: { state: 'canceled', can_write: false, data_retained_until: '2027-10-09T08:00:00Z' },
  restricted: { state: 'restricted', can_write: false, restriction },
} as const satisfies Record<string, Entitlement>

describe('which banner a household’s entitlement asks for', () => {
  it('is none for a household in good standing, nor for a trial with more than ten days left', () => {
    expect(bannerOf({ state: 'active' }, true)).toBeNull()
    expect(
      bannerOf(
        { state: 'trialing', trial_notice: 'none', trial_ends_at: '2026-10-30T08:00:00Z' },
        true,
      ),
    ).toBeNull()
    expect(bannerOf(undefined, true)).toBeNull()
    expect(bannerOf({}, false)).toBeNull()
  })

  // The stage is the server's to say (DD-9): the days are counted to be shown, never to decide.
  it('is the trial’s, in the stage the server names', () => {
    expect(bannerOf(states.notice, false)).toEqual({
      kind: 'trial',
      stage: 'notice',
      endsAt: '2026-09-30T08:00:00Z',
    })
    expect(bannerOf(states.banner, true)).toMatchObject({ kind: 'trial', stage: 'banner' })
    // A trial whose end the answer does not carry has nothing to count from.
    expect(bannerOf({ state: 'trialing', trial_notice: 'banner' }, true)).toBeNull()
  })

  it('is a failed payment’s for an owner, and none for anybody else (PRD 04 §6)', () => {
    expect(bannerOf(states.pastDue, true)).toEqual({ kind: 'past_due' })
    expect(bannerOf(states.pastDue, false)).toBeNull()
  })

  it('is the state’s own for every member, with what the answer carries of it', () => {
    expect(bannerOf(states.grace, false)).toEqual({
      kind: 'grace',
      endsAt: '2026-10-05T08:00:00Z',
    })
    expect(bannerOf(states.readOnly, false)).toEqual({
      kind: 'read_only',
      retainedUntil: '2027-10-09T08:00:00Z',
      restriction: null,
    })
    expect(bannerOf(states.canceled, true)).toMatchObject({ kind: 'canceled' })
    expect(bannerOf(states.restricted, false)).toEqual({ kind: 'restricted', restriction })
  })

  // The household's own deletion comes first, and the erasure takes whichever does: the day a
  // lapse would keep its data until is a day it does not reach, and is not said.
  it('carries no day its data is kept until where the household’s deletion is scheduled', () => {
    expect(bannerOf(states.readOnly, true, true)).toEqual({
      kind: 'read_only',
      retainedUntil: null,
      restriction: null,
    })
    expect(bannerOf(states.canceled, false, true)).toMatchObject({ retainedUntil: null })
    expect(bannerOf(states.readOnly, true, false)).toMatchObject({
      retainedUntil: '2027-10-09T08:00:00Z',
    })
  })

  // D-114: the lapse outranks the restriction, which is carried beside it.
  it('is the lapse’s for a household that is lapsed and restricted, the restriction beside it', () => {
    expect(bannerOf({ ...states.readOnly, restriction }, true)).toMatchObject({
      kind: 'read_only',
      restriction,
    })
  })

  // No banner: its household answers nothing, and the shell draws its lockout (Lockout.tsx).
  it('is none for a suspended household', () => {
    expect(bannerOf({ state: 'suspended', suspended_at: '2026-09-09T12:02:00Z' }, true)).toBeNull()
  })

  it('tells one banner from another by its state, its stage, and a restriction that arrived', () => {
    const id = (entitlement: Entitlement) => {
      const shown = bannerOf(entitlement, true)
      return shown === null ? null : bannerId(shown)
    }
    const all = [
      states.notice,
      states.banner,
      states.pastDue,
      states.grace,
      states.readOnly,
      { ...states.readOnly, restriction },
      states.canceled,
      states.restricted,
    ].map(id)
    expect(new Set(all).size).toBe(all.length)
    // A trial that staff extended is another notice.
    expect(id({ ...states.notice, trial_ends_at: '2026-10-14T08:00:00Z' })).not.toBe(
      id(states.notice),
    )
    expect(id(states.grace)).toBe(id({ ...states.grace }))
  })
})

describe('the days a trial has left', () => {
  it('are whole days of the calendar, in the zone its day is shown in', () => {
    expect(daysLeft('2026-09-30T08:00:00Z', now, zone)).toBe(9)
    expect(daysLeft('2026-09-22T08:00:00Z', now, zone)).toBe(1)
    // It ends half an hour past midnight in Prague, which is the day before in London: an hour
    // and a half before, there is a day left in the one and none in the other.
    const late = Date.parse('2026-09-30T21:00:00Z')
    expect(daysLeft('2026-09-30T22:30:00Z', late, zone)).toBe(1)
    expect(daysLeft('2026-09-30T22:30:00Z', late, 'Europe/London')).toBe(0)
  })

  // A trial that has ended reads `trialing` until the server's hourly job moves it.
  it('are never fewer than none', () => {
    expect(daysLeft('2026-09-21T18:00:00Z', now, zone)).toBe(0)
    expect(daysLeft('2026-09-19T08:00:00Z', now, zone)).toBe(0)
    expect(daysLeft('not a time', now, zone)).toBe(0)
  })
})

describe('the first trial notice, put away', () => {
  it('is kept in this browser for one member and one household, with the trial’s end', () => {
    expect(putAway(jana.id, home)).toBeNull()
    putAwayNow(jana.id, home, '2026-09-30T08:00:00Z')
    expect(putAway(jana.id, home)).toBe('2026-09-30T08:00:00Z')
    expect(window.localStorage.getItem(trialNoticeKey(jana.id.toUpperCase(), home))).toBe(
      '2026-09-30T08:00:00Z',
    )
    // Another member of the same browser, and the same member's other household, were told
    // nothing yet.
    expect(putAway(petr, home)).toBeNull()
    expect(putAway(jana.id, '0190a000-0000-7000-8000-0000000000a2')).toBeNull()
  })
})

/** The banner `entitlement` asks for, drawn to `reader`. */
function banner(
  entitlement: Entitlement,
  reader: Reader,
  {
    owners = ['Jana Tilcerová', 'Petr Tilcer'],
    announce = false,
    at = now,
  }: {
    readonly owners?: readonly string[]
    readonly announce?: boolean
    readonly at?: number
  } = {},
) {
  const shown = bannerOf(entitlement, reader !== 'member')
  if (shown === null) throw new Error('this entitlement asks for no banner')
  return draw(
    <MemoryRouter>
      <EntitlementBannerView
        household={{ id: home, name: 'Tilcerovi' }}
        shown={shown}
        reader={reader}
        owners={owners}
        zone={zone}
        now={at}
        announce={announce}
      />
    </MemoryRouter>,
  )
}

/** The links a banner draws, by name, each with where it leads. */
function ways(): Record<string, string | null> {
  return Object.fromEntries(
    screen.queryAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')]),
  )
}

const ask = 'Only an owner can change this: Jana Tilcerová and Petr Tilcer.'
const held =
  'Changes waiting in this browser are kept, and sent once the household can be changed again.'
const keptUntil = 'Its data is kept until Oct 9, 2027, then deleted.'
const restrictedBy =
  /^An owner restricted this household on Sep 9, 2026, 2:02\sPM: Jana Tilcerová\.$/

describe('the trial’s banner', () => {
  it('says how long is left and what happens next, and leads the payer to subscribing', () => {
    banner(states.notice, 'payer')
    expect(screen.getByText('9 days of the trial left')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Everything works as it does now until Sep 30, 2026. Without a subscription, new files can’t be added after that, and later the household becomes read-only.',
      ),
    ).toBeInTheDocument()
    expect(ways()).toEqual({ Subscribe: inHousehold.subscribe(home) })
    // An owner is told nobody's name: they can act themselves.
    expect(screen.queryByText(/Only an owner/)).not.toBeInTheDocument()
  })

  it('leads another owner to billing, where the plan is read: subscribing is the payer’s', () => {
    banner(states.banner, 'owner')
    expect(screen.getByText('3 days of the trial left')).toBeInTheDocument()
    expect(ways()).toEqual({ 'Go to billing': inHousehold.billing(home) })
  })

  it('tells a member whom to ask, and leads them nowhere', () => {
    banner(states.banner, 'member')
    expect(screen.getByText(ask)).toBeInTheDocument()
    expect(ways()).toEqual({})
  })

  it('counts its last day in the singular, and says a trial that has ended is ending', () => {
    banner(states.banner, 'payer', { at: Date.parse('2026-09-23T10:00:00Z') })
    expect(screen.getByText('1 day of the trial left')).toBeInTheDocument()
    cleanup()
    banner(states.banner, 'payer', { at: Date.parse('2026-09-25T10:00:00Z') })
    expect(screen.getByText('The trial is ending')).toBeInTheDocument()
  })

  // No price in any banner: the plans are an owner's to read, on billing's own screens.
  it('names no price, to anybody', () => {
    for (const reader of ['payer', 'owner', 'member'] as const) {
      const { container } = banner(states.banner, reader)
      expect(container).not.toHaveTextContent(/€|EUR|CZK|\d[.,]\d\d/)
      cleanup()
    }
  })
})

describe('the banner of a payment that failed', () => {
  it.each(['payer', 'owner'] as const)(
    'says nothing has changed, and leads the %s to billing',
    (reader) => {
      const { container } = banner(states.pastDue, reader)
      expect(screen.getByText('The last payment didn’t go through')).toBeInTheDocument()
      expect(
        screen.getByText(
          'Everything still works. If the payment keeps failing, new files can’t be added.',
        ),
      ).toBeInTheDocument()
      expect(ways()).toEqual({ 'Go to billing': inHousehold.billing(home) })
      // No day of a next attempt, and no count of days: no answer carries either (D-134).
      expect(container).not.toHaveTextContent(/\d/)
    },
  )
})

describe('the banner of a household in grace', () => {
  it('says what still works and the day it becomes read-only, and no day of deletion', () => {
    const { container } = banner(states.grace, 'member')
    expect(screen.getByText('New files can’t be added for now')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Everything already here can be read and changed. Uploads come back with a paid subscription.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText('If nothing changes, the household becomes read-only on Oct 5, 2026.'),
    ).toBeInTheDocument()
    expect(screen.getByText(ask)).toBeInTheDocument()
    expect(container).not.toHaveTextContent(/deleted/)
    expect(ways()).toEqual({})
  })

  it.each(['payer', 'owner'] as const)('leads the %s to billing', (reader) => {
    banner(states.grace, reader)
    expect(ways()).toEqual({ 'Go to billing': inHousehold.billing(home) })
  })

  it('says no day where the answer carries none', () => {
    banner({ state: 'grace' }, 'payer')
    expect(screen.queryByText(/becomes read-only on/)).not.toBeInTheDocument()
  })
})

describe('the banner of a read-only household', () => {
  it('names the state, what is held and the day of deletion, and leads an owner to billing and to the export', () => {
    banner(states.readOnly, 'payer')
    expect(screen.getByText('Tilcerovi is read-only')).toBeInTheDocument()
    expect(
      screen.getByText(
        // A subscription, and not *the*: a trial that ran out lapses with none.
        'Everything can still be read. Nothing can be added or changed until a subscription is paid for.',
      ),
    ).toBeInTheDocument()
    // FR-BI2: what waits in this browser is held, and not lost.
    expect(screen.getByText(held)).toBeInTheDocument()
    expect(screen.getByText(keptUntil)).toBeInTheDocument()
    expect(ways()).toEqual({
      'Go to billing': inHousehold.billing(home),
      'Export the household': inHousehold.exports(home),
    })
  })

  // The household's export is an owner's: a member's is of their own data.
  it('tells a member whom to ask, and leads them to their own data', () => {
    banner(states.readOnly, 'member')
    expect(screen.getByText(keptUntil)).toBeInTheDocument()
    expect(screen.getByText(ask)).toBeInTheDocument()
    expect(ways()).toEqual({ 'Your data': paths.accountPrivacy.path })
  })

  it('says who restricted it beside the lapse, and leads an owner to where that is lifted too', () => {
    banner({ ...states.readOnly, restriction }, 'owner')
    expect(screen.getByText('Tilcerovi is read-only')).toBeInTheDocument()
    expect(screen.getByText(keptUntil)).toBeInTheDocument()
    expect(screen.getByText(restrictedBy)).toBeInTheDocument()
    expect(
      screen.getByText('The reason given: Until the insurance claim is settled.'),
    ).toBeInTheDocument()
    expect(ways()).toEqual({
      'Go to billing': inHousehold.billing(home),
      'Export the household': inHousehold.exports(home),
      'Lift the restriction': inHousehold.data(home),
    })
  })

  it('says no day of deletion where the answer carries none', () => {
    banner({ state: 'read_only' }, 'payer')
    expect(screen.queryByText(/kept until/)).not.toBeInTheDocument()
  })
})

describe('the banner of a cancelled subscription', () => {
  it('leads its payer to subscribing again, and to the export', () => {
    banner(states.canceled, 'payer')
    expect(screen.getByText('The subscription was cancelled')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Everything can still be read. Nothing can be added or changed unless the household subscribes again.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText(held)).toBeInTheDocument()
    expect(screen.getByText(keptUntil)).toBeInTheDocument()
    expect(ways()).toEqual({
      Subscribe: inHousehold.subscribe(home),
      'Export the household': inHousehold.exports(home),
    })
  })

  it('leads another owner to billing, and to the export', () => {
    banner(states.canceled, 'owner')
    expect(ways()).toEqual({
      'Go to billing': inHousehold.billing(home),
      'Export the household': inHousehold.exports(home),
    })
  })

  // Nothing a member reads says who cancelled, or when: neither is said.
  it('tells a member whom to ask and where their own data is, and not who cancelled', () => {
    const { container } = banner(states.canceled, 'member')
    expect(screen.getByText(ask)).toBeInTheDocument()
    expect(ways()).toEqual({ 'Your data': paths.accountPrivacy.path })
    expect(container).not.toHaveTextContent(/cancelled on|You cancelled/)
  })
})

describe('the banner of a restricted household', () => {
  it('names who restricted it, when and why, what still works, and leads an owner to where it is lifted', () => {
    const { container } = banner(states.restricted, 'owner')
    expect(screen.getByText('This household is restricted')).toBeInTheDocument()
    expect(screen.getByText(restrictedBy)).toBeInTheDocument()
    // The owner's own words, as written.
    expect(
      screen.getByText('The reason given: Until the insurance claim is settled.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Everything can still be read. Nothing can be added or changed until an owner lifts the restriction. The subscription is not affected.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText(held)).toBeInTheDocument()
    expect(ways()).toEqual({ 'Lift the restriction': inHousehold.data(home) })
    // No day of deletion: nothing of a restricted household is on its way out.
    expect(container).not.toHaveTextContent(/deleted|kept until/)
  })

  // Somebody who has left since is no owner to name as one: the data screen says who it was.
  it('names nobody as an owner who is a member no longer', () => {
    const { container } = banner(
      {
        state: 'restricted',
        restriction: {
          ...restriction,
          restricted_by: { ...restriction.restricted_by, is_former_member: true },
        },
      },
      'owner',
    )
    expect(
      screen.getByText(/^An owner restricted this household on Sep 9, 2026, 2:02\sPM\.$/),
    ).toBeInTheDocument()
    expect(container).not.toHaveTextContent('Jana Tilcerová')
  })

  it('names nobody once that account is gone, and gives no reason where none was given', () => {
    banner(
      {
        state: 'restricted',
        restriction: {
          restricted_by: { user_id: null, label: '', is_former_member: true },
          restricted_at: '2026-09-09T12:02:00Z',
          reason: null,
        },
      },
      'member',
      { owners: [] },
    )
    expect(
      screen.getByText(/^An owner restricted this household on Sep 9, 2026, 2:02\sPM\.$/),
    ).toBeInTheDocument()
    expect(screen.queryByText(/The reason given/)).not.toBeInTheDocument()
    // The members could not be read: whose it is to lift is said without a name.
    expect(screen.getByText('Only an owner can change this.')).toBeInTheDocument()
    expect(ways()).toEqual({})
  })
})

describe('every drawing of the banner', () => {
  const drawings: readonly (readonly [string, Entitlement, Reader])[] = [
    ['the trial’s notice', states.notice, 'payer'],
    ['the trial’s banner', states.banner, 'owner'],
    ['past due', states.pastDue, 'payer'],
    ['grace', states.grace, 'member'],
    ['read-only', { ...states.readOnly, restriction }, 'owner'],
    ['cancelled', states.canceled, 'member'],
    ['restricted', states.restricted, 'member'],
  ]

  it.each(drawings)('shows none of the contract’s own words: %s', (_name, entitlement, reader) => {
    const { container } = banner(entitlement, reader)
    expect(container).not.toHaveTextContent(
      /trialing|past_due|read_only|canceled|entitlement|restricted_by|can_write/,
    )
  })

  // A lapse is said at once, as an alert; any other state politely, once its words are drawn.
  it.each(drawings)(
    'is announced when it is said to have arrived: %s',
    async (_name, entitlement, reader) => {
      banner(entitlement, reader, { announce: true })
      const lapse = entitlement.state === 'read_only' || entitlement.state === 'canceled'
      const said = await screen.findByRole(lapse ? 'alert' : 'status')
      // Its title and at least one sentence, once they are drawn.
      await waitFor(() => {
        expect(said.querySelectorAll('p').length).toBeGreaterThan(1)
      })
    },
  )

  it.each(drawings)('is read in its place otherwise: %s', (_name, entitlement, reader) => {
    banner(entitlement, reader)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    // Nothing of it is put away: only the shell gives the first notice its control.
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

const inSync: Sync = { replica: { phase: 'opening' }, online: true, receiving: null }
const offline: Sync = { replica: { phase: 'opening' }, online: false, receiving: false }

/** What stands above a household's screens, over the household as its address reads it. */
function Above({ sync }: { readonly sync: Sync }) {
  const { householdId = '' } = useParams()
  const household = useHouseholdQuery(householdId)
  if (household.data === undefined) return null
  return (
    <HouseholdContext value={household.data}>
      <SyncFixture value={sync}>
        <HouseholdBars />
        <main id={contentId} tabIndex={-1} />
      </SyncFixture>
    </HouseholdContext>
  )
}

/** Opens `address` for `server`'s member, with what the shell draws above the household's screens. */
async function above(
  server: HouseholdServer,
  { sync = inSync, address = inHousehold.home(home) } = {},
) {
  const router = createMemoryRouter(
    [
      {
        Component: Signed,
        children: [{ path: `${paths.household.path}/*`, element: <Above sync={sync} /> }],
      },
    ],
    { initialEntries: [address] },
  )
  const cookies = () => '__Host-hh_csrf=t'
  const client = createWebClient({ origin, fetch: server.fetch, cookies, retry: { delays: [] } })
  const drawn = render(
    <Providers persist={false} client={client} cookies={cookies}>
      <RouterProvider router={router} />
    </Providers>,
  )
  // The household's own landmark, which takes the focus: the one that stands while it is not yet
  // known who is signed in takes none.
  await waitFor(() => {
    expect(screen.getByRole('main')).toHaveAttribute('tabindex', '-1')
  })
  return { ...drawn, user: userEvent.setup() }
}

/** A server whose household is in `entitlement`, read by Jana, its owner and payer, or by `user`. */
function serving(entitlement: Entitlement, user: string = jana.id): HouseholdServer {
  const server = user === jana.id ? createServer() : createServer(accountOf(user))
  server.household = { ...server.household, entitlement }
  return server
}

/** Says the page is looked at again: what it shows is read again. */
function lookAgain(): void {
  act(() => {
    focusManager.setFocused(false)
    focusManager.setFocused(true)
  })
}

const membersRoute = `GET /households/${home}/members`
/** A trial in its notice's days, whenever the test runs. */
const trialEnds = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString()
const trialNotice: Entitlement = {
  state: 'trialing',
  can_write: true,
  trial_notice: 'notice',
  trial_ends_at: trialEnds,
}

describe('the banner above a household’s screens', () => {
  it('is nothing for a household in good standing, which asks for nobody’s name', async () => {
    const server = createServer()
    const { container } = await above(server)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(container.querySelector('p')).toBeNull()
    // The members are read for the banner alone: who pays, and whom to ask.
    expect(server.to(membersRoute)).toHaveLength(0)
  })

  it('is read in its place where it stood as the household was opened', async () => {
    await above(serving(states.readOnly))
    expect(await screen.findByText('Tilcerovi is read-only')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  // Who pays is the member's own row among the household's members.
  it('leads whoever pays to subscribing in a trial, once the members say who that is', async () => {
    await above(serving({ ...states.banner, trial_ends_at: trialEnds }))
    expect(await screen.findByRole('link', { name: 'Subscribe' })).toHaveAttribute(
      'href',
      inHousehold.subscribe(home),
    )
    expect(screen.queryByRole('link', { name: 'Go to billing' })).not.toBeInTheDocument()
  })

  it('leads an owner who does not pay to billing', async () => {
    const server = createServer(accountOf(petr))
    server.members = members.map((each) =>
      each.user_id === petr ? { ...each, role: 'owner' } : each,
    )
    server.household = {
      ...readBy(memberOf(petr, server.members)),
      entitlement: { ...states.banner, trial_ends_at: trialEnds },
    }
    await above(server)
    expect(await screen.findByRole('link', { name: 'Go to billing' })).toHaveAttribute(
      'href',
      inHousehold.billing(home),
    )
    await waitFor(() => {
      expect(server.to(membersRoute).length).toBeGreaterThan(0)
    })
    expect(screen.queryByRole('link', { name: 'Subscribe' })).not.toBeInTheDocument()
  })

  it('tells a member whom to ask, by the owners’ names, and a child profile the same', async () => {
    await above(serving(states.grace, petr))
    expect(
      await screen.findByText('Only an owner can change this: Jana Tilcerová.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    cleanup()
    await above(serving(states.grace, adam))
    expect(
      await screen.findByText('Only an owner can change this: Jana Tilcerová.'),
    ).toBeInTheDocument()
  })

  it('draws a payment that failed for an owner, and nothing of it for a member', async () => {
    await above(serving(states.pastDue))
    expect(await screen.findByText('The last payment didn’t go through')).toBeInTheDocument()
    cleanup()
    const server = serving(states.pastDue, petr)
    await above(server)
    expect(screen.queryByText('The last payment didn’t go through')).not.toBeInTheDocument()
    expect(server.to(membersRoute)).toHaveLength(0)
  })

  // The household read again, after a write or when the page is looked at again, may say
  // another state: nothing moved the focus to its banner, so it is said.
  it('announces a banner that arrives while its member is here, politely or, for a lapse, at once', async () => {
    const server = createServer()
    await above(server)
    server.household = { ...server.household, entitlement: states.restricted }
    lookAgain()
    const polite = await screen.findByRole('status')
    expect(await within(polite).findByText('This household is restricted')).toBeInTheDocument()

    server.household = { ...server.household, entitlement: states.readOnly }
    lookAgain()
    const urgent = await screen.findByRole('alert')
    expect(within(urgent).getByText('Tilcerovi is read-only')).toBeInTheDocument()
    // One banner at a time: the one it took the place of is gone.
    expect(screen.queryByText('This household is restricted')).not.toBeInTheDocument()

    // And a household that writes again is said by its absence.
    server.household = { ...server.household, entitlement: { state: 'active', can_write: true } }
    lookAgain()
    await waitFor(() => {
      expect(screen.queryByText('Tilcerovi is read-only')).not.toBeInTheDocument()
    })
  })

  it('does not announce again a banner that is as it was when the household is read again', async () => {
    const server = serving(states.readOnly)
    await above(server)
    await screen.findByText('Tilcerovi is read-only')
    const before = server.to(`GET /households/${home}`).length
    lookAgain()
    await waitFor(() => {
      expect(server.to(`GET /households/${home}`).length).toBeGreaterThan(before)
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('the first trial notice', () => {
  it('is put away once, kept in this browser, and the focus goes to the page', async () => {
    const { user } = await above(serving(trialNotice))
    expect(await screen.findByText(/of the trial left$/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText(/of the trial left$/)).not.toBeInTheDocument()
    // Its control left with it: the focus is on the page's landmark, and not dropped.
    expect(screen.getByRole('main')).toHaveFocus()
    expect(putAway(jana.id, home)).toBe(trialEnds)

    // On the next visit it is not said again.
    cleanup()
    await above(serving(trialNotice))
    await waitFor(() => {
      expect(screen.queryByText(/of the trial left$/)).not.toBeInTheDocument()
    })
  })

  it('is said again for a trial that staff extended, and to another member of this browser', async () => {
    putAwayNow(jana.id, home, trialEnds)
    const later = new Date(Date.parse(trialEnds) + 14 * 24 * 60 * 60 * 1000).toISOString()
    await above(serving({ ...trialNotice, trial_ends_at: later }))
    expect(await screen.findByText(/of the trial left$/)).toBeInTheDocument()
    cleanup()
    await above(serving(trialNotice, petr))
    expect(await screen.findByText(/of the trial left$/)).toBeInTheDocument()
  })

  // The last five days' banner stays: nothing puts it away, and nothing kept hides it.
  it('gives way to a banner that cannot be put away', async () => {
    putAwayNow(jana.id, home, trialEnds)
    await above(serving({ ...trialNotice, trial_notice: 'banner' }))
    expect(await screen.findByText(/of the trial left$/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument()
  })
})

describe('the banner and the offline bar', () => {
  const reading = 'Offline — you are reading what this browser kept.'

  it('stand together, the bar first: a read-only household read with no connection', async () => {
    await above(serving(states.readOnly), { sync: offline })
    const bar = await screen.findByText(reading)
    const title = await screen.findByText('Tilcerovi is read-only')
    expect(bar.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
  })

  // A household that takes no writes keeps no change of its member's to send: the bar promises
  // nothing of one, over its modules, and neither does the sentence that changes are not arriving.
  it('promises nothing of a change in a household that takes none', async () => {
    await above(serving(states.restricted), { sync: offline })
    expect(await screen.findByText(reading)).toBeInTheDocument()
    expect(screen.queryByText('Offline — changes are saved and will sync')).not.toBeInTheDocument()
    cleanup()
    await above(serving(states.restricted), {
      sync: { replica: { phase: 'opening' }, online: true, receiving: false },
    })
    expect(
      await screen.findByText('Not receiving changes from other members right now.'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/still saved and sent/)).not.toBeInTheDocument()
  })

  // What is still changed there, billing, the household's data, leaving, is changed at once.
  it('still says over such a household’s settings that a change needs a connection', async () => {
    await above(serving(states.readOnly), { sync: offline, address: inHousehold.billing(home) })
    expect(
      await screen.findByText(
        'Offline — you are reading what this browser kept. Changing anything here needs a connection.',
      ),
    ).toBeInTheDocument()
  })

  it('says what it always said in a household that writes', async () => {
    await above(serving(states.grace), { sync: offline })
    expect(await screen.findByText('Offline — changes are saved and will sync')).toBeInTheDocument()
    expect(await screen.findByText('New files can’t be added for now')).toBeInTheDocument()
  })
})
