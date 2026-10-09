// Leaving a household (A-26): what stands in the way, said before anything is pressed and both
// refusals at once; the one request, what it is said to have come to and where it leads; the
// server's own refusal after the members were read; and the screen's states.
import { readProblem } from '@household/api'
import { onlineManager } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Outlet, RouterProvider, createMemoryRouter, useParams } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { chata } from '../account/testing.tsx'
import { createWebClient } from '../api/client.ts'
import { ApiProblemError } from '../api/problem.ts'
import { Providers } from '../app/App.tsx'
import { Signed } from '../app/guards.tsx'
import { Home } from '../app/Home.tsx'
import { inHousehold, paths } from '../app/paths.ts'
import type { Membership } from './data.ts'
import { HouseholdContext } from './HouseholdContext.tsx'
import { rememberHousehold, useHouseholdQuery } from './households.ts'
import { blockedBy, Leave } from './Leave.tsx'
import {
  accountOf,
  adam,
  createServer,
  home,
  jana,
  klara,
  members,
  noContent,
  open,
  origin,
  petr,
  problem,
  tilcerovi,
  type HouseholdServer,
} from './testing.tsx'

// A test that takes the connection away leaves the next one a browser that has it.
afterEach(() => {
  onlineManager.setOnline(true)
})

const title = 'Leave Tilcerovi'
const leaving = `POST /households/${home}/leave`
const reading = `GET /households/${home}/members`
const behind =
  'What you added stays with the household, with your name on it: it is the household’s record. Your private notes and documents are deleted after thirty days, and you can export them until then.'
const two = 'Two things have to be settled first, and here they both are.'
const one = 'One thing has to be settled first.'

/** The household's members with `changes` made to the ones it names. */
function membersWith(changes: Readonly<Record<string, Partial<Membership>>>): Membership[] {
  return members.map((each) => ({ ...each, ...changes[each.user_id ?? ''] }))
}

async function leave(server: HouseholdServer = createServer()) {
  const opened = open(inHousehold.leave(home), server)
  await screen.findByRole('heading', { level: 1, name: title })
  return opened
}

/** The screen once the members are read: what a member leaves behind is always said. */
async function read(server: HouseholdServer = createServer()) {
  const opened = await leave(server)
  await screen.findByRole('heading', { level: 2, name: 'What you leave behind' })
  return opened
}

const sections = () =>
  screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)

/** Presses the control that leaves, and the one that confirms it. */
async function confirmLeaving(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: title }))
  const dialog = screen.getByRole('dialog', { name: 'Leave Tilcerovi?' })
  await user.click(within(dialog).getByRole('button', { name: title }))
  return dialog
}

describe('what a refused leaving names', () => {
  /** A `409` as the client reads one off the wire. */
  const refusal = (code: string, more: Record<string, unknown> = {}) =>
    new ApiProblemError(readProblem(409, { type: 'about:blank', title: code, code, ...more }))

  it('is every reason at once', () => {
    expect(
      blockedBy(refusal('last_owner', { blocked_by: ['last_owner', 'billing_payer'] })),
    ).toEqual(['last_owner', 'billing_payer'])
    expect(blockedBy(refusal('billing_payer', { blocked_by: ['billing_payer'] }))).toEqual([
      'billing_payer',
    ])
  })

  it('is its own code at least, where it lists nothing this build knows', () => {
    expect(blockedBy(refusal('billing_payer'))).toEqual(['billing_payer'])
    expect(blockedBy(refusal('last_owner', { blocked_by: ['something_new'] }))).toEqual([
      'last_owner',
    ])
  })

  it('is nothing for any other failure', () => {
    expect(blockedBy(refusal('email_taken', { blocked_by: ['last_owner'] }))).toEqual([])
    expect(blockedBy(new TypeError('offline'))).toEqual([])
    expect(blockedBy(undefined)).toEqual([])
  })
})

describe('leaving a household', () => {
  it('lets a member with nothing in the way leave, after saying what they leave behind', async () => {
    const server = createServer(accountOf(petr))
    server.on(leaving, noContent)
    const { user, router } = await read(server)
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    await waitFor(() => {
      expect(document.title).toBe(`${title} · Household`)
    })
    // Nothing stands in the way, and nothing says that anything does.
    expect(sections()).toEqual(['What you leave behind'])
    expect(screen.getByText(behind)).toBeInTheDocument()
    expect(screen.queryByText(one)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: title }))
    const dialog = screen.getByRole('dialog', { name: 'Leave Tilcerovi?' })
    expect(dialog).toHaveAccessibleDescription(behind)
    // The safe choice first, then the one that names what is left.
    expect(
      within(dialog)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Cancel', title])
    expect(server.to(leaving)).toHaveLength(0)

    await user.click(within(dialog).getByRole('button', { name: title }))
    expect(await screen.findByText('You left Tilcerovi.')).toBeInTheDocument()
    const [sent] = server.to(leaving)
    expect(server.to(leaving)).toHaveLength(1)
    expect(await sent?.text()).toBe('')
    // On to where the app opens, and the screen is no entry to go back to.
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(paths.home.path)
    })
    await router.navigate(-1)
    expect(router.state.location.pathname).toBe(paths.home.path)
  })

  it('keeps nothing of the household in this browser once its member has left', async () => {
    const server = createServer(accountOf(petr))
    server.on(leaving, () => {
      // The household opens nothing for them from now on.
      server.on(`GET /households/${home}`, () => problem(404, 'not_found'))
      server.on(reading, () => problem(404, 'not_found'))
      return noContent()
    })
    const { user, router } = await read(server)
    await confirmLeaving(user)
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(paths.home.path)
    })
    const asked = server.to(`GET /households/${home}`).length
    // Its address is asked of the server again, and draws nothing this browser had kept.
    await router.navigate(inHousehold.leave(home))
    await waitFor(() => {
      expect(server.to(`GET /households/${home}`)).toHaveLength(asked + 1)
    })
    expect(screen.queryByRole('heading', { level: 1, name: title })).not.toBeInTheDocument()
  })

  it('keeps nothing of it either where the screen had gone before the answer came', async () => {
    const server = createServer(accountOf(petr))
    let answer = () => {}
    const held = new Promise<void>((resolve) => {
      answer = resolve
    })
    server.on(leaving, async () => {
      await held
      server.on(`GET /households/${home}`, () => problem(404, 'not_found'))
      server.on(reading, () => problem(404, 'not_found'))
      return noContent()
    })
    const { user, router } = await read(server)
    await confirmLeaving(user)
    await waitFor(() => {
      expect(server.to(leaving)).toHaveLength(1)
    })
    // The browser's own way back is held by no question, and the screen's tidying went with it.
    await act(() => router.navigate(inHousehold.modules(home)))
    await screen.findByRole('heading', { level: 1, name: 'Modules' })
    answer()

    // Out of the household, wherever in it they stood, and told so.
    expect(await screen.findByText('You left Tilcerovi.')).toBeInTheDocument()
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(paths.home.path)
    })
    const asked = server.to(`GET /households/${home}`).length
    await router.navigate(inHousehold.leave(home))
    await waitFor(() => {
      expect(server.to(`GET /households/${home}`)).toHaveLength(asked + 1)
    })
    expect(screen.queryByRole('heading', { level: 1, name: title })).not.toBeInTheDocument()
  })

  it('keeps the household when its member says so', async () => {
    const server = createServer(accountOf(petr))
    const { user } = await read(server)
    await user.click(screen.getByRole('button', { name: title }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(server.to(leaving)).toHaveLength(0)
  })

  it('tells the only owner who also pays both things at once, and offers no leaving', async () => {
    // Jana, as the household was made: its only owner, and the one who pays.
    await read()
    // Read in its place: it was so when the screen opened.
    expect(screen.getByText(two)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(sections()).toEqual([
      'You are the only owner',
      'You pay for the subscription',
      'What you leave behind',
    ])
    expect(
      screen.getByText(
        'If you go, nobody is left who can invite, remove or change what anyone sees. Make somebody else an owner first.',
      ),
    ).toBeInTheDocument()
    // What unblocks the first is a screen that exists, and is linked.
    expect(screen.getByRole('link', { name: 'Make somebody an owner' })).toHaveAttribute(
      'href',
      inHousehold.members(home),
    )
    // Billing's screens are not built: what has to happen is named, and leads nowhere.
    expect(
      screen.getByText(
        'Billing has to be handed to another owner before you go. A household whose payer has left lapses for a reason nobody in it can fix.',
      ),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('link')).toHaveLength(1)
    // Absent, and not disabled.
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText(behind)).toBeInTheDocument()
  })

  it('tells the only owner, who does not pay, the one thing', async () => {
    const server = createServer()
    server.members = membersWith({ [jana.id]: { is_billing_payer: false } })
    await read(server)
    expect(screen.getByText(one)).toBeInTheDocument()
    expect(sections()).toEqual(['You are the only owner', 'What you leave behind'])
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('tells whoever pays, where somebody else owns it too, the one thing', async () => {
    const server = createServer()
    server.members = membersWith({ [petr]: { role: 'owner' } })
    await read(server)
    expect(screen.getByText(one)).toBeInTheDocument()
    expect(sections()).toEqual(['You pay for the subscription', 'What you leave behind'])
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('tells the only member that leaving would leave nobody in the household', async () => {
    const server = createServer()
    server.members = members.filter((each) => each.user_id === jana.id)
    await read(server)
    expect(screen.getByText(two)).toBeInTheDocument()
    expect(sections()).toEqual([
      'You are the only member',
      'You pay for the subscription',
      'What you leave behind',
    ])
    expect(
      screen.getByText(
        'Leaving would leave Tilcerovi with nobody in it. Deleting the household is what ends it.',
      ),
    ).toBeInTheDocument()
    // There is nobody to make an owner, and deleting the household is not built: no link.
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('leads the only owner whose company is child profiles to where somebody is invited', async () => {
    const server = createServer()
    // Jana and the household's child profile: nobody the list of members could make an owner.
    server.members = membersWith({ [jana.id]: { is_billing_payer: false } }).filter(
      (each) => each.user_id === jana.id || each.role === 'child',
    )
    await read(server)
    expect(screen.getByText(one)).toBeInTheDocument()
    expect(sections()).toEqual(['You are the only owner', 'What you leave behind'])
    expect(
      screen.getByText(
        'If you go, nobody is left who can invite, remove or change what anyone sees, and a child profile can’t be an owner. Invite somebody as an owner first.',
      ),
    ).toBeInTheDocument()
    // No way to a list that can give no owner: the one that is drawn leads to the composer.
    expect(screen.queryByRole('link', { name: 'Make somebody an owner' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Invite somebody' })).toHaveAttribute(
      'href',
      inHousehold.invite(home),
    )
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('lets an owner leave where somebody else owns the household too, and pays', async () => {
    const server = createServer(accountOf(petr))
    server.members = membersWith({ [petr]: { role: 'owner' } })
    await read(server)
    expect(sections()).toEqual(['What you leave behind'])
    expect(screen.getByRole('button', { name: title })).toBeInTheDocument()
  })

  it('lets a member who holds nothing of the household’s settings leave', async () => {
    await read(createServer(accountOf(klara)))
    expect(screen.getByRole('button', { name: title })).toBeInTheDocument()
  })

  it('lets a member of a household that takes no writes leave it', async () => {
    const server = createServer(accountOf(petr))
    server.household = {
      ...server.household,
      entitlement: { state: 'read_only', can_write: false, can_upload: false },
    }
    server.on(leaving, noContent)
    const { user } = await read(server)
    await confirmLeaving(user)
    expect(await screen.findByText('You left Tilcerovi.')).toBeInTheDocument()
  })

  // Leaving is taken there, and making somebody an owner and inviting somebody are not
  // (FR-BI1): the way to either would lead to a screen that offers neither.
  it.each([
    ['somebody who could be made an owner', members],
    [
      'child profiles alone',
      members.filter((each) => each.user_id === jana.id || each.role === 'child'),
    ],
  ])(
    'tells the only owner of a household that takes no writes that a second owner has to wait, beside %s',
    async (_company, company) => {
      const server = createServer()
      server.household = {
        ...server.household,
        entitlement: { state: 'restricted', can_write: false, can_upload: false },
      }
      server.members = company.map((each) =>
        each.user_id === jana.id ? { ...each, is_billing_payer: false } : each,
      )
      await read(server)
      expect(sections()).toEqual(['You are the only owner', 'What you leave behind'])
      expect(
        screen.getByText(
          'That has to wait: nobody can be made an owner or invited while Tilcerovi can’t be changed.',
        ),
      ).toBeInTheDocument()
      expect(screen.queryByRole('link')).not.toBeInTheDocument()
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    },
  )

  it('tells a child profile that an owner removes it, and offers nothing', async () => {
    const server = createServer(accountOf(adam))
    await leave(server)
    expect(
      screen.getByText(
        'A child profile doesn’t leave its household. An owner removes it, from the household’s members.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument()
    // Nothing is worked out for a profile that does not leave.
    expect(server.to(reading)).toHaveLength(0)
  })
})

describe('the server’s own word on leaving', () => {
  it('draws both refusals it names after the members were read, says them, and reads again', async () => {
    // Petr read himself as a member with nothing in the way. Since then he was made the only
    // owner and handed the billing: the server names both at once.
    const server = createServer(accountOf(petr))
    server.on(leaving, () => {
      server.members = membersWith({
        [jana.id]: { role: 'member', is_billing_payer: false },
        [petr]: { role: 'owner', is_billing_payer: true },
      })
      return problem(409, 'last_owner', { blocked_by: ['last_owner', 'billing_payer'] })
    })
    const { user } = await read(server)
    await confirmLeaving(user)

    const said = await screen.findByRole('alert')
    expect(said).toHaveTextContent('You can’t leave yet')
    expect(said).toHaveTextContent(two)
    // The question is closed, and the control it was opened from is absent.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(sections()).toEqual([
      'You are the only owner',
      'You pay for the subscription',
      'What you leave behind',
    ])
    // The focus the question held is on the screen's own place, where it is all drawn.
    await waitFor(() => {
      expect(document.activeElement).not.toBe(document.body)
    })
    expect(document.activeElement).toContainElement(said)
    await waitFor(() => {
      expect(server.to(reading)).toHaveLength(2)
    })
    expect(server.to(leaving)).toHaveLength(1)
  })

  it('draws the one it names, where the members read here say nothing of it', async () => {
    const server = createServer(accountOf(petr))
    // A document that lists nothing: its own code is what it names.
    server.on(leaving, () => problem(409, 'billing_payer'))
    const { user } = await read(server)
    await confirmLeaving(user)
    expect(await screen.findByRole('alert')).toHaveTextContent(one)
    expect(sections()).toEqual(['You pay for the subscription', 'What you leave behind'])
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('says an owner whose account is being deleted does not count, where the members still name one', async () => {
    // Jana owns the household too, by every list a member can read, and the server counts
    // her as no owner: her account is scheduled for deletion (D-137).
    const server = createServer(accountOf(petr))
    server.members = membersWith({ [petr]: { role: 'owner' } })
    server.on(leaving, () => problem(409, 'last_owner', { blocked_by: ['last_owner'] }))
    const { user } = await read(server)
    await confirmLeaving(user)
    expect(await screen.findByRole('alert')).toHaveTextContent(one)
    expect(
      await screen.findByText('An owner whose account is being deleted does not count as one.'),
    ).toBeInTheDocument()
    expect(sections()).toEqual(['You are the only owner', 'What you leave behind'])
  })

  it('tells a child profile it refused that an owner removes it', async () => {
    const server = createServer(accountOf(petr))
    server.on(leaving, () => problem(403, 'forbidden'))
    const { user } = await read(server)
    await confirmLeaving(user)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A child profile doesn’t leave its household. An owner removes it, from the household’s members.',
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(document.activeElement).not.toBe(document.body)
    })
  })

  it('says a household that is no longer there to leave is not, and reads it again', async () => {
    const server = createServer(accountOf(petr))
    server.on(leaving, () => problem(404, 'not_found'))
    const { user } = await read(server)
    const asked = server.to(`GET /households/${home}`).length
    const dialog = await confirmLeaving(user)
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'That is no longer there to change. The page shows how things stand now.',
    )
    await waitFor(() => {
      expect(server.to(`GET /households/${home}`)).toHaveLength(asked + 1)
    })
  })

  it('says its own failure left them a member, in the question, which stays open', async () => {
    const server = createServer(accountOf(petr))
    server.on(leaving, () => problem(500, 'internal'))
    const { user, router } = await read(server)
    const dialog = await confirmLeaving(user)
    const first = await within(dialog).findByRole('alert')
    expect(first).toHaveTextContent(
      'Something went wrong at our end. You are still a member of Tilcerovi, and nothing has changed. Try again.',
    )
    expect(router.state.location.pathname).toBe(inHousehold.leave(home))

    // Asked again and refused again, it is said again: a banner of its own.
    server.on(leaving, () => problem(429, 'rate_limited'))
    await user.click(within(dialog).getByRole('button', { name: title }))
    await waitFor(() => {
      expect(within(dialog).getByRole('alert')).toHaveTextContent(
        'Too many attempts. Try again in a little while.',
      )
    })
    expect(within(dialog).getByRole('alert')).not.toBe(first)
  })
})

describe('leaving, in the screen’s states', () => {
  it('is the screen’s shape while the members are read, and offers nothing', async () => {
    const server = createServer(accountOf(petr))
    server.on(reading, () => new Promise<Response>(() => undefined))
    await leave(server)
    expect(await screen.findByRole('status', { name: 'Loading' })).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('says it could not be read where the members were not, offers no leaving, and reads again', async () => {
    const server = createServer(accountOf(petr))
    server.on(reading, () => Promise.reject(new TypeError('offline')))
    const { user } = await leave(server)
    expect(await screen.findByText('This page could not be read')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Whether anything stands in the way of leaving could not be worked out, so nothing is offered. You are still a member. Check your connection and try again.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: title })).not.toBeInTheDocument()

    server.on(reading, () => Response.json({ items: server.members }))
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('button', { name: title })).toBeInTheDocument()
  })

  it('says so, and draws no skeleton, while the browser has no connection to read them with', async () => {
    const server = createServer(accountOf(petr))
    // The connection goes as the household is read: its members are asked for with none.
    server.on(`GET /households/${home}`, () => {
      onlineManager.setOnline(false)
      return Response.json(server.household)
    })
    await leave(server)
    expect(await screen.findByText('This page could not be read')).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: 'Loading' })).not.toBeInTheDocument()
    expect(server.to(reading)).toHaveLength(0)
    server.on(`GET /households/${home}`, () => Response.json(server.household))
    act(() => {
      onlineManager.setOnline(true)
    })
    expect(await screen.findByRole('button', { name: title })).toBeInTheDocument()
  })

  it('asks at once though the browser says it has no connection, says they are still a member, and is sent by nothing later', async () => {
    const server = createServer(accountOf(petr))
    server.on(leaving, () => Promise.reject(new TypeError('offline')))
    const { user, router } = await read(server)
    onlineManager.setOnline(false)
    const dialog = await confirmLeaving(user)
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'We couldn’t reach Household, so you are still a member of Tilcerovi and nothing has changed. Check your connection and try again.',
    )
    // Not held for a connection behind a busy control.
    expect(within(dialog).getByRole('button', { name: title })).not.toHaveAttribute('aria-busy')
    act(() => {
      onlineManager.setOnline(true)
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    // Nothing waited for the connection: a leaving sent now would be nobody's press.
    expect(server.to(leaving)).toHaveLength(1)
    expect(router.state.location.pathname).toBe(inHousehold.leave(home))
  })
})

/** The household the address names, as its member reads it, around its screens. */
function InHousehold() {
  const { householdId = '' } = useParams()
  const household = useHouseholdQuery(householdId)
  if (household.data === undefined) return <main />
  return (
    <HouseholdContext value={household.data}>
      <main>
        <Outlet />
      </main>
    </HouseholdContext>
  )
}

function Elsewhere() {
  return <main />
}

describe('where the app opens once a household is left', () => {
  // The list of a member's households is kept in this browser, and where the app opens reads
  // it before the server has answered again (app/Home.tsx): left as it was, it would lead
  // straight back to the household that was left, the one the member was last in.
  it('is another of the member’s households, and not the one they left', async () => {
    const server = createServer(accountOf(petr))
    const summary = { id: home, name: tilcerovi.name, my_role: 'member', member_count: 5 }
    server.on('GET /households', () => Response.json({ items: [summary, chata] }))
    server.on(`GET /households/${chata.id}`, () =>
      Response.json({ ...server.household, id: chata.id, name: chata.name }),
    )
    server.on(leaving, () => {
      // The server's own list is a long time coming: the one this browser kept leads meanwhile.
      server.on('GET /households', () => new Promise<Response>(() => undefined))
      return noContent()
    })
    rememberHousehold(petr, home)
    const router = createMemoryRouter(
      [
        { path: paths.home.path, Component: Home },
        {
          Component: Signed,
          children: [
            {
              path: paths.household.path,
              Component: InHousehold,
              children: [
                { index: true, Component: Elsewhere },
                { path: paths.leave.path.slice(paths.household.path.length + 1), Component: Leave },
              ],
            },
          ],
        },
      ],
      { initialEntries: [paths.home.path] },
    )
    const cookies = () => '__Host-hh_csrf=t'
    render(
      <Providers
        persist={false}
        cookies={cookies}
        client={createWebClient({ origin, fetch: server.fetch, cookies, retry: { delays: [] } })}
      >
        <RouterProvider router={router} />
      </Providers>,
    )
    const user = userEvent.setup()
    // Opened at the household they were last in, by the list as it was read.
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(inHousehold.home(home))
    })
    await router.navigate(inHousehold.leave(home))
    await screen.findByRole('heading', { level: 2, name: 'What you leave behind' })
    await confirmLeaving(user)
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(inHousehold.home(chata.id))
    })
    expect(await screen.findByText('You left Tilcerovi.')).toBeInTheDocument()
  })
})
