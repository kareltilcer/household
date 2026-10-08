// What an invitation's link opens (A-24): the token it carries and where it is kept, what the
// page shows to a visitor and to a member, the two answers and each thing the server may say to
// them, and what is said and where the focus goes when an answer takes its own control away.
import {
  dehydrate,
  focusManager,
  onlineManager,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UseStore } from 'idb-keyval'
import { useEffect } from 'react'
import { createMemoryRouter, RouterProvider, useLocation, type RouteObject } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { createWebClient } from '../api/client.ts'
import { deviceTimeZone } from '../api/problemText.ts'
import { createPersister, persistOptions } from '../api/query.ts'
import { Providers } from '../app/App.tsx'
import { VisitorOnly } from '../app/guards.tsx'
import { inHousehold, paths } from '../app/paths.ts'
import { Public } from '../app/Public.tsx'
import { SignIn } from '../auth/SignIn.tsx'
import { heldDestination, holdDestination, takeDestination } from '../session/destination.ts'
import { meKey, type Me } from '../session/SessionProvider.tsx'
import { waitingInvitationsKey, type InvitationForInvitee, type Membership } from './data.ts'
import { defaultsFor } from './grants.ts'
import { householdKey, householdsKey, moduleKeys } from './households.ts'
import { Invitation } from './Invitation.tsx'
import {
  forgetInvitationToken,
  heldInvitationToken,
  holdInvitationToken,
} from './invitationToken.ts'
import {
  accountOf,
  adam,
  createServer,
  home,
  jana,
  noContent,
  open,
  origin,
  problem,
  tilcerovi,
  type HouseholdServer,
} from './testing.tsx'

/** What the link carries: a word no other text of a page or a storage holds. */
const token = 'k7m2-4pqx'
const link = `${paths.invitation.path}#token=${token}`
const reading = `GET /me/invitations/${token}`
const accepting = `POST /me/invitations/${token}/accept`
const declining = `POST /me/invitations/${token}/decline`

const invited = 'Jana Tilcerová has invited you to Tilcerovi'
const waiting = 'An invitation to a household'

/** Somebody with an account who is in no household yet: the one the invitation is for. */
const marie: Me = {
  ...jana,
  id: '0190a000-0000-7000-8000-000000000009',
  display_name: 'Marie Nováková',
  email: 'marie@example.cz',
}

/** The invitation as its invitee is shown it: Jana's, as a member, with a member's defaults. */
function offered(more: Partial<InvitationForInvitee> = {}): InvitationForInvitee {
  return {
    token,
    household_name: 'Tilcerovi',
    household_avatar_url: null,
    invited_by: 'Jana Tilcerová',
    role: 'member',
    modules: moduleKeys.map((module) => ({ module, level: defaultsFor('member')[module] })),
    message: null,
    // Half past midnight on the 24th in Prague, and still the 23rd in Greenwich.
    expires_at: '2026-09-23T22:30:00Z',
    ...more,
  }
}

/** The membership an acceptance answers with. */
const joined: Membership = {
  user_id: marie.id,
  household_id: home,
  display_name: marie.display_name,
  email: marie.email ?? null,
  avatar_url: null,
  role: 'member',
  grants: defaultsFor('member'),
  is_billing_payer: false,
  joined_at: '2026-09-10T08:00:00Z',
  last_active_at: null,
  version: 1,
  child: null,
}

/** A server that knows the invitation, and whoever is signed in. */
function serving(me: Me = marie, invitation = offered()): HouseholdServer {
  const server = createServer(me)
  server.on(reading, () => Response.json(invitation))
  return server
}

/** An answer the test gives when it chooses to: the request waits for it meanwhile. */
function pending() {
  let settle: (response: Response) => void = () => undefined
  const response = new Promise<Response>((resolve) => {
    settle = resolve
  })
  return {
    response,
    answer: (given: Response) => {
      settle(given)
    },
  }
}

/** Has the page looked at again, as a member who comes back to its tab has it. */
function lookAgain(): void {
  act(() => {
    focusManager.setFocused(false)
    focusManager.setFocused(true)
  })
}

/** Everything this browser's two storages hold, their keys among it. */
function stored(): string {
  return [window.sessionStorage, window.localStorage]
    .flatMap((storage) =>
      Array.from({ length: storage.length }, (_, index) => {
        const key = storage.key(index) ?? ''
        return `${key}=${storage.getItem(key) ?? ''}`
      }),
    )
    .join('\n')
}

/** The page's title, once it reads `name`. */
function titled(name: string): Promise<HTMLElement> {
  return screen.findByRole('heading', { level: 1, name })
}

// The token and the address held for a visitor are in the page's memory, which the tests of one
// file share; and a test that takes the connection or the focus away leaves the next one a
// browser that has both.
afterEach(() => {
  forgetInvitationToken()
  takeDestination()
  focusManager.setFocused(undefined)
  onlineManager.setOnline(true)
})

/** Hands `to` the page's own cache as the page starts, before any screen's effect has run. */
function Cache({ to }: { readonly to: (queries: QueryClient) => void }) {
  const queries = useQueryClient()
  useEffect(() => {
    to(queries)
  }, [queries, to])
  return null
}

/** A place the page leads to: it is drawn as its own address. */
function Place() {
  const { pathname, search, hash } = useLocation()
  return (
    <main>
      <h1>{`${pathname}${search}${hash}`}</h1>
    </main>
  )
}

// The page as the app routes it, in the frame of the screens before sign-in, with the sign-in
// it sends a visitor to beside it.
const table: RouteObject[] = [
  {
    Component: Public,
    children: [
      { path: paths.invitation.path, Component: Invitation },
      { Component: VisitorOnly, children: [{ path: paths.signIn.path, Component: SignIn }] },
    ],
  },
  { path: '*', Component: Place },
]

const signedIn = () => '__Host-hh_csrf=t'

interface Keeping {
  /** Files in the page's cache what an earlier screen read, before the page reads anything. */
  readonly kept?: (queries: QueryClient) => void
  /** Draws the page under React's strict mode, as the app is drawn in development. */
  readonly strict?: boolean
  /** The page's cookies, where the test signs somebody in on the way. Left out, a member's. */
  readonly cookies?: () => string
}

/**
 * Opens `address` in the frame the app draws the page in, and hands the test the page's own
 * cache: what the page left in it is read afterwards.
 */
function openKeeping(
  address: string,
  server: HouseholdServer,
  { kept, strict = false, cookies = signedIn }: Keeping = {},
) {
  const caches: QueryClient[] = []
  const router = createMemoryRouter(table, { initialEntries: [address] })
  const client = createWebClient({ origin, fetch: server.fetch, cookies, retry: { delays: [] } })
  const drawn = render(
    <Providers persist={false} client={client} cookies={cookies}>
      <Cache
        to={(queries) => {
          caches.push(queries)
          kept?.(queries)
        }}
      />
      <RouterProvider router={router} />
    </Providers>,
    { reactStrictMode: strict },
  )
  const cache = (): QueryClient => {
    const [first] = caches
    if (first === undefined) throw new Error('the page has no cache yet')
    return first
  }
  return { ...drawn, router, cache, user: userEvent.setup() }
}

describe('the token an invitation’s link carries', () => {
  it('is read from the fragment, which the address then holds no longer', async () => {
    const server = serving()
    const { router } = open(link, server, { signedIn: false })
    expect(await titled(invited)).toBeInTheDocument()
    await waitFor(() => {
      expect(router.state.location.hash).toBe('')
    })
    expect(router.state.location.pathname).toBe(paths.invitation.path)
    // Read once, with the token the link carried.
    expect(server.to(reading)).toHaveLength(1)
  })

  it('is held in the page’s memory, and written to no storage', async () => {
    open(link, serving(), { signedIn: false })
    await titled(invited)
    expect(heldInvitationToken()).toBe(token)
    // The address a visitor comes back to is kept in the tab's storage, and names no token.
    await waitFor(() => {
      expect(window.sessionStorage).toHaveLength(1)
    })
    expect(stored()).not.toContain(token)
    expect(window.localStorage).toHaveLength(0)
  })

  it('is still held when a visitor comes back from signing in, to the invitation they were reading', async () => {
    const server = serving()
    let session = ''
    server.on('POST /auth/login', () => {
      session = signedIn()
      return Response.json({ tokens: null })
    })
    const { user, router } = openKeeping(link, server, { cookies: () => session })
    await user.click(await screen.findByRole('link', { name: 'Sign in to answer' }))

    // The sign-in says where it leads, and leads there: the address carries nothing by now.
    expect(
      await screen.findByText('After you sign in, you’ll go to the page you opened.'),
    ).toBeInTheDocument()
    await user.type(screen.getByLabelText('Email'), 'marie@example.cz')
    await user.type(screen.getByLabelText('Password'), 'a long enough password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('button', { name: 'Join Tilcerovi' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(paths.invitation.path)
    expect(router.state.location.hash).toBe('')
    // Read again as the member they are now, and the address held for them is held no longer.
    expect(server.to(reading)).toHaveLength(2)
    expect(heldDestination()).toBeNull()
    expect(screen.queryByRole('link', { name: 'Sign in to answer' })).not.toBeInTheDocument()
  })

  it('opens nothing where the address carries none, and says how that happens', async () => {
    const server = serving()
    // An address held for this page has nothing left to lead back to; any other is not its own.
    holdDestination(paths.invitation.path)
    const bare = open(paths.invitation.path, server, { signedIn: false })
    expect(await titled('There is no invitation to show here')).toBeInTheDocument()
    expect(
      screen.getByText(
        'This page shows the invitation that a link carries, and the link that opened it looks incomplete. It also lets go of the link when it is reloaded.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Open the link again from the email or message it came in. An invitation sent to your email address also waits on your account, once that address is confirmed.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute(
      'href',
      paths.signIn.path,
    )
    expect(heldDestination()).toBeNull()
    expect(server.sent).toHaveLength(0)
    bare.unmount()

    holdDestination('/account/devices')
    open(paths.invitation.path, server, { signedIn: false })
    await titled('There is no invitation to show here')
    expect(heldDestination()).toBe('/account/devices')
  })

  it('leads a member with no token to where the app opens', async () => {
    const server = serving()
    open(paths.invitation.path, server)
    expect(await screen.findByRole('link', { name: 'Go to Home' })).toHaveAttribute(
      'href',
      paths.home.path,
    )
    expect(server.to(reading)).toHaveLength(0)
  })

  it('is no more than a variable: held, read and forgotten', () => {
    expect(heldInvitationToken()).toBeNull()
    holdInvitationToken(token)
    expect(heldInvitationToken()).toBe(token)
    expect(stored()).toBe('')
    forgetInvitationToken()
    expect(heldInvitationToken()).toBeNull()
  })
})

describe('the read of an invitation', () => {
  it('is kept out of what this browser stores, and out of the page’s cache once it is left', async () => {
    const page = openKeeping(link, serving())
    await titled(invited)
    await screen.findByRole('button', { name: 'Join Tilcerovi' })
    const cache = page.cache()
    expect(cache.getQueryData(['invitation', token])).toMatchObject({
      household_name: 'Tilcerovi',
    })
    // As the app stores its cache (api/query.ts): the account is kept, and nothing of the token.
    const refusing: UseStore = () => Promise.reject(new Error('no storage in a test'))
    const { dehydrateOptions } = persistOptions(createPersister(refusing), 'build')
    const kept = dehydrate(cache, dehydrateOptions)
    expect(kept.queries.map((query) => query.queryKey)).toEqual([meKey])
    expect(JSON.stringify(kept)).not.toContain(token)

    page.unmount()
    await waitFor(() => {
      expect(cache.getQueryCache().find({ queryKey: ['invitation', token] })).toBeUndefined()
    })
  })

  // Every effect of the page is run, undone and run again there: what it holds and what it
  // takes come to the same.
  it('holds its token and takes the address held, under React’s strict mode as without', async () => {
    const server = serving()
    holdDestination(paths.invitation.path)
    const { router } = openKeeping(link, server, { strict: true })
    await screen.findByRole('button', { name: 'Join Tilcerovi' })
    expect(router.state.location.hash).toBe('')
    expect(heldInvitationToken()).toBe(token)
    expect(heldDestination()).toBeNull()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('draws the shape of the page under the title it has while nothing is read', async () => {
    const server = createServer(marie)
    const answer = pending()
    server.on(reading, () => answer.response)
    open(link, server)
    expect(await titled(waiting)).toBeInTheDocument()
    expect(document.title).toBe(`${waiting} · Household`)
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()

    answer.answer(Response.json(offered()))
    expect(await titled(invited)).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: 'Loading' })).not.toBeInTheDocument()
  })

  it('says it could not be read, as that arrives, and reads it again when asked', async () => {
    const server = createServer(marie)
    server.on(reading, () => Promise.reject(new TypeError('offline')))
    const { user } = open(link, server)
    const failure = await screen.findByRole('alert')
    expect(failure).toHaveTextContent('The invitation could not be read')
    expect(failure).toHaveTextContent(
      'It is as it was, and nothing was changed. Check your connection and try again.',
    )
    expect(screen.getByRole('heading', { level: 1, name: waiting })).toBeInTheDocument()
    // The link is as good as it was.
    expect(heldInvitationToken()).toBe(token)

    server.on(reading, () => Response.json(offered()))
    await user.click(within(failure).getByRole('button', { name: 'Try again' }))
    expect(await titled(invited)).toBeInTheDocument()
  })

  it('says when a limit clears, where the read met one', async () => {
    const server = createServer(marie)
    server.on(reading, () => problem(429, 'rate_limited', {}, { 'Retry-After': '600' }))
    open(link, server)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Too many attempts\. Try again at \d{1,2}:\d{2}/,
    )
  })

  // A read that waits for a connection is one that could not be made, to whoever is looking.
  it('is could not be read with no connection, never a skeleton, and is read when one returns', async () => {
    const server = serving()
    onlineManager.setOnline(false)
    open(link, server, { signedIn: false })
    expect(await screen.findByText('The invitation could not be read')).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: 'Loading' })).not.toBeInTheDocument()
    expect(server.to(reading)).toHaveLength(0)

    act(() => {
      onlineManager.setOnline(true)
    })
    expect(await titled(invited)).toBeInTheDocument()
  })

  it('is read again when the page is looked at again, and says what became of it meanwhile', async () => {
    const server = serving()
    open(link, server)
    await screen.findByRole('button', { name: 'Join Tilcerovi' })
    server.on(reading, () => problem(410, 'token_expired'))
    lookAgain()
    expect(await titled('This invitation has expired')).toBeInTheDocument()
    expect(server.to(reading)).toHaveLength(2)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(heldInvitationToken()).toBeNull()
    })
    // Found over, it is not asked about again.
    lookAgain()
    expect(server.to(reading)).toHaveLength(2)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'This invitation has expired',
    )
  })

  it.each([
    [
      'opens none',
      () => problem(404, 'not_found'),
      'This link opens no invitation',
      // An invitation sent again gets a new link, and the one before it answers as no link's.
      'It may have been cut short in copying. Or the invitation was sent again since, which gives it a new link and ends this one.',
      'Open the link from the newest email or message, or ask whoever invited you. Nothing about your account has changed.',
    ],
    [
      'has expired',
      () => problem(410, 'token_expired'),
      'This invitation has expired',
      // The preview does not say which kind it is: both lifetimes are said.
      'An invitation sent by email lasts 14 days, and an invitation link 72 hours.',
      'Ask whoever invited you for another. Nothing about your account has changed.',
    ],
    [
      'was answered already',
      () => problem(410, 'token_already_used'),
      'This invitation has already been answered',
      'It was accepted, declined or withdrawn, and it can’t be answered again. Opening it changed nothing about anybody’s account.',
      undefined,
    ],
  ])('says in the page’s place that the link %s', async (_, respond, title, sentence, next) => {
    const server = createServer(marie)
    server.on(reading, respond)
    holdDestination(paths.invitation.path)
    open(link, server)
    const heading = await titled(title)
    expect(screen.getByText(sentence)).toBeInTheDocument()
    if (next !== undefined) expect(screen.getByText(next)).toBeInTheDocument()
    expect(document.title).toBe(`${title} · Household`)
    // Its words took the place of the title the page opened with: they are said.
    expect(heading.parentElement).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByRole('link', { name: 'Go to Home' })).toHaveAttribute(
      'href',
      paths.home.path,
    )
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    // Nothing is left to come back with, or to.
    await waitFor(() => {
      expect(heldInvitationToken()).toBeNull()
    })
    expect(heldDestination()).toBeNull()
    lookAgain()
    expect(server.to(reading)).toHaveLength(1)
  })

  it('sends a visitor whose link opens nothing to the sign-in, with no address held', async () => {
    const server = createServer()
    server.on(reading, () => problem(410, 'token_already_used'))
    holdDestination(paths.invitation.path)
    open(link, server, { signedIn: false })
    await titled('This invitation has already been answered')
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute(
      'href',
      paths.signIn.path,
    )
    await waitFor(() => {
      expect(heldDestination()).toBeNull()
    })
  })
})

describe('what an invitation shows', () => {
  it('says who invites into what, as what, and exactly what that gives, to a member', async () => {
    holdDestination(paths.invitation.path)
    open(link, serving())
    expect(await titled(invited)).toBeInTheDocument()
    expect(document.title).toBe(`${invited} · Household`)
    expect(screen.getByText('Here is exactly what that gives you.')).toBeInTheDocument()
    // The two answers, once it is known who is here: the one that joins first.
    await screen.findByRole('button', { name: 'Join Tilcerovi' })
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Join Tilcerovi',
      'Decline',
    ])

    // The role in words, and never the contract's.
    expect(
      screen.getByRole('heading', { level: 2, name: 'You would join as a member' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('What you can do is exactly what is listed here, and nothing more.'),
    ).toBeInTheDocument()

    // The modules under each level, highest first, and what is off named aloud.
    // Household settings is no part of a level's count: it is said last, as what it is.
    expect(screen.getAllByRole('term').map((term) => term.textContent)).toEqual([
      'Can add and edit · 9',
      'Can see · 2',
      'Off · 5',
      'Household settings',
    ])
    const held = screen.getAllByRole('definition')
    expect(held[2]).toHaveTextContent(
      'Not in your app at all: no screen, no widget, no search result, no reminder.',
    )
    expect(held[2]).toHaveTextContent('Finance, Utilities, Garden, Property, and Vehicles')
    expect(held[3]).toHaveTextContent(
      'The household’s invitations, beside its profile, its members and its modules, which every member reads. Changing anything in the settings is for an owner.',
    )
    expect(screen.getByRole('main')).not.toHaveTextContent(/\b(none|view|contribute|manage)\b/)

    expect(screen.getByText('This can change later, and you will be told')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Jana Tilcerová, or any other owner of the household, can raise or lower any of it. You are told when that happens, so you never find out by something going missing.',
      ),
    ).toBeInTheDocument()
    // The day in the member's own zone, Prague's, whatever this device's is.
    expect(
      screen.getByText('This invitation stops working on September 24, 2026.'),
    ).toBeInTheDocument()

    // What declining does is said before it is pressed.
    expect(
      screen.getByText(
        'Declining is recorded and Jana Tilcerová is told. It closes this invitation for good, and adds nothing to your account.',
      ),
    ).toBeInTheDocument()
    // Nobody wrote anything with it.
    expect(screen.queryByRole('figure')).not.toBeInTheDocument()
    // A member is on the page: the address held for their return is held no longer.
    expect(heldDestination()).toBeNull()
  })

  it('says what an owner is, and gathers every module under the one level', async () => {
    const modules = moduleKeys.map((module) => ({ module, level: 'manage' as const }))
    open(link, serving(marie, offered({ role: 'owner', modules })))
    expect(
      await screen.findByRole('heading', { level: 2, name: 'You would join as an owner' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'An owner can set up everything, invite and remove people, turn modules on and off, and delete the household.',
      ),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('term').map((term) => term.textContent)).toEqual([
      'Can set it up · 17',
    ])
    expect(screen.queryByText(/Not in your app at all/)).not.toBeInTheDocument()
  })

  it('draws the inviter’s message as theirs, and as the text it is', async () => {
    const message = 'Babi, <b>tady</b> máme nákupy.\nA kalendář.'
    open(link, serving(marie, offered({ message })))
    const quoted = await screen.findByRole('figure')
    expect(within(quoted).getByText('Jana Tilcerová writes:')).toBeInTheDocument()
    // Whatever was typed is words: nothing of it is read as markup, and its lines are kept.
    expect(within(quoted).getByText(/<b>tady<\/b>/).textContent).toBe(message)
    expect(within(quoted).queryByText('tady')).not.toBeInTheDocument()
  })

  it('says nothing of a module the household has off', async () => {
    const on = offered().modules?.filter(
      ({ module }) => module !== 'garden' && module !== 'chat' && module !== 'documents',
    )
    open(link, serving(marie, offered({ modules: on ?? [] })))
    await titled(invited)
    expect(screen.getAllByRole('term').map((term) => term.textContent)).toEqual([
      'Can add and edit · 8',
      'Can see · 1',
      'Off · 4',
      'Household settings',
    ])
    const main = screen.getByRole('main')
    for (const name of ['Garden', 'Chat', 'Documents']) expect(main).not.toHaveTextContent(name)
  })
})

describe('a visitor at an invitation', () => {
  it('reads all of it, and is shown the two ways to an account in place of the answers', async () => {
    const server = serving()
    open(link, server, { signedIn: false })
    expect(await titled(invited)).toBeInTheDocument()
    // The three levels a member's defaults come to, and household settings by itself.
    expect(screen.getAllByRole('term')).toHaveLength(4)
    // Nobody's account names a zone: the day is this device's.
    const day = new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: deviceTimeZone() })
    expect(
      screen.getByText(
        `This invitation stops working on ${day.format(new Date('2026-09-23T22:30:00Z'))}.`,
      ),
    ).toBeInTheDocument()

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByText(/^Declining is recorded/)).not.toBeInTheDocument()
    expect(
      screen.getByText('To join or to decline, sign in first. Nothing happens until you answer.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign in to answer' })).toHaveAttribute(
      'href',
      paths.signIn.path,
    )
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute(
      'href',
      paths.register.path,
    )
    expect(
      screen.getByText(
        'Signing in brings you straight back to this page. If you create an account instead, confirm your email address and then open this link again: an invitation sent to that address will also be waiting on your account.',
      ),
    ).toBeInTheDocument()

    // Signing in leads back here (auth/SignIn.tsx), where the token is still held.
    await waitFor(() => {
      expect(heldDestination()).toBe(paths.invitation.path)
    })
    expect(heldInvitationToken()).toBe(token)
    // Nothing was asked of a session there is none of.
    expect(server.to('GET /me')).toHaveLength(0)
  })

  it('draws neither a visitor’s ways nor a member’s answers until it is known who is here', async () => {
    const server = serving()
    const account = pending()
    server.on('GET /me', () => account.response)
    open(link, server)
    expect(await titled(invited)).toBeInTheDocument()
    // The three levels a member's defaults come to, and household settings by itself.
    expect(screen.getAllByRole('term')).toHaveLength(4)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()

    account.answer(Response.json(marie))
    expect(await screen.findByRole('button', { name: 'Join Tilcerovi' })).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('says the account could not be read where it could not, and asks again', async () => {
    const server = serving()
    server.on('GET /me', () => Promise.reject(new TypeError('offline')))
    const { user } = open(link, server)
    await titled(invited)
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        'We couldn’t check who is signed in. Nothing was changed. Check your connection and try again.',
      )
    })
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Join Tilcerovi' })).not.toBeInTheDocument()

    server.on('GET /me', () => Response.json(marie))
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('button', { name: 'Join Tilcerovi' })).toBeInTheDocument()
  })
})

describe('joining', () => {
  it('asks the server, says so, and opens the household', async () => {
    const server = serving()
    server.on(accepting, () => Response.json(joined))
    // Held since they left here to sign in.
    holdDestination(paths.invitation.path)
    const { user, router } = open(link, server)
    await user.click(await screen.findByRole('button', { name: 'Join Tilcerovi' }))

    expect(await screen.findByText('You joined Tilcerovi.')).toBeInTheDocument()
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(inHousehold.home(home))
    })
    // In the invitation's place, so that Back does not lead to one that is spent.
    expect(router.state.historyAction).toBe('REPLACE')
    const [sent] = server.to(accepting)
    expect(server.to(accepting)).toHaveLength(1)
    expect(sent?.headers.get('Idempotency-Key')).toEqual(expect.any(String))
    expect(heldInvitationToken()).toBeNull()
    expect(heldDestination()).toBeNull()
    expect(stored()).not.toContain(token)
  })

  it('has the member’s households and the invitations that wait for them read again, and nothing else', async () => {
    const server = serving()
    server.on(accepting, () => Response.json(joined))
    const page = openKeeping(link, server, {
      kept: (queries) => {
        queries.setQueryData(householdsKey, [])
        queries.setQueryData(waitingInvitationsKey, [offered()])
        queries.setQueryData(householdKey(home), tilcerovi)
      },
    })
    await page.user.click(await screen.findByRole('button', { name: 'Join Tilcerovi' }))
    expect(await titled(inHousehold.home(home))).toBeInTheDocument()
    const cache = page.cache()
    expect(cache.getQueryState(householdsKey)?.isInvalidated).toBe(true)
    expect(cache.getQueryState(waitingInvitationsKey)?.isInvalidated).toBe(true)
    // By its whole key: a household filed under the list's is not asked for again.
    expect(cache.getQueryState(householdKey(home))?.isInvalidated).toBe(false)
  })

  it('is busy while it is asked, and takes no second answer meanwhile', async () => {
    const server = serving()
    const answer = pending()
    server.on(accepting, () => answer.response)
    server.on(declining, noContent)
    const { user, router } = open(link, server)
    const join = await screen.findByRole('button', { name: 'Join Tilcerovi' })
    await user.click(join)
    expect(join).toHaveAttribute('aria-busy', 'true')
    const decline = screen.getByRole('button', { name: 'Decline' })
    expect(decline).toHaveAttribute('aria-disabled', 'true')
    await user.click(decline)
    await user.click(join)
    expect(server.to(declining)).toHaveLength(0)
    expect(server.to(accepting)).toHaveLength(1)

    answer.answer(Response.json(joined))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(inHousehold.home(home))
    })
  })
})

describe('declining', () => {
  it('asks the server on the one press, and the page says what became of it', async () => {
    const server = serving()
    server.on(declining, noContent)
    const page = openKeeping(link, server, {
      kept: (queries) => {
        queries.setQueryData(waitingInvitationsKey, [offered()])
      },
    })
    await page.user.click(await screen.findByRole('button', { name: 'Decline' }))

    const heading = await titled('You declined the invitation to Tilcerovi')
    expect(
      screen.getByText('Jana Tilcerová is told. Nothing was added to your account.'),
    ).toBeInTheDocument()
    expect(server.to(declining)).toHaveLength(1)
    expect(server.to(accepting)).toHaveLength(0)
    // No question came between the press and the request.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    // Said, as the words of the one title change; and the focus, which was on a control that is
    // gone, is on the screen's own place and not dropped to the page.
    expect(heading.parentElement).toHaveAttribute('aria-live', 'polite')
    await waitFor(() => {
      expect(document.activeElement).not.toBe(document.body)
    })
    expect(document.activeElement).toContainElement(heading)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('term')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to Home' })).toHaveAttribute(
      'href',
      paths.home.path,
    )
    expect(heldInvitationToken()).toBeNull()
    expect(page.cache().getQueryState(waitingInvitationsKey)?.isInvalidated).toBe(true)

    // Answered, it is not read again, which would only say it was used.
    lookAgain()
    expect(server.to(reading)).toHaveLength(1)
    expect(heading).toHaveTextContent('You declined the invitation to Tilcerovi')
  })
})

describe('who may not join', () => {
  it('tells a child profile that it joins no other household, and offers no answer', async () => {
    open(link, serving(accountOf(adam)))
    expect(await screen.findByText('A child profile joins no other household')).toBeInTheDocument()
    expect(
      screen.getByText(
        'An owner of your household manages this profile, and it stays in the household it was made in. Nothing was changed.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByText(/^Declining is recorded/)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to Home' })).toBeInTheDocument()
  })

  it('draws verify your email first in the place of Join, for an account read as unverified', async () => {
    const server = serving({ ...marie, email_verified: false })
    open(link, server)
    expect(await screen.findByText('Verify your email first')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Joining a household is trust extended to your account, so your email address is confirmed first. Declining needs no confirmation. Everything else works as normal. Once you have opened the link in your email, come back here.',
      ),
    ).toBeInTheDocument()
    // There when the page opened: read in its place, and not said over whatever is being read.
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Send the verification link again' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Join Tilcerovi' })).not.toBeInTheDocument()
    // Declining extends no trust, and needs no verified address.
    expect(screen.getByRole('button', { name: 'Decline' })).toBeInTheDocument()
    expect(server.to(accepting)).toHaveLength(0)
  })

  it('takes the server’s word that the account is unverified, says it, and lifts by itself', async () => {
    const server = serving()
    server.on(accepting, () => problem(403, 'account_unverified'))
    const { user } = open(link, server)
    await user.click(await screen.findByRole('button', { name: 'Join Tilcerovi' }))

    // Said as it arrives, politely: a wait, and nobody's failure.
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Verify your email first')
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Join Tilcerovi' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Decline' })).toBeInTheDocument()
    // The control that was pressed is gone: the focus is on the screen's own place.
    await waitFor(() => {
      expect(document.activeElement).not.toBe(document.body)
    })
    expect(document.activeElement).toContainElement(screen.getByRole('heading', { level: 1 }))

    // The account is read again when the page is looked at again, as verified here.
    lookAgain()
    expect(await screen.findByRole('button', { name: 'Join Tilcerovi' })).toBeInTheDocument()
    expect(screen.queryByText('Verify your email first')).not.toBeInTheDocument()
  })
})

describe('an answer the server refuses', () => {
  // Sent to another address than the account's, or no longer open since the preview was read:
  // the server answers them alike, and the page does not guess.
  it.each([
    ['joining', 'Join Tilcerovi', accepting],
    ['declining', 'Decline', declining],
  ])(
    'says both things a 404 to %s may mean, and names the address signed in with',
    async (_, control, route) => {
      const server = serving()
      server.on(route, () => problem(404, 'not_found'))
      const { user } = open(link, server)
      await user.click(await screen.findByRole('button', { name: control }))

      const heading = await titled('This invitation can’t be answered from this account')
      expect(
        screen.getByText(
          'Either it was sent to a different email address than the one you are signed in with (marie@example.cz), or it stopped working a moment ago: it was withdrawn, answered, or sent again with a new link. We can’t tell which from here.',
        ),
      ).toBeInTheDocument()
      expect(
        screen.getByText(
          'If it was sent to another address of yours, sign out, sign in with that account and open the link again. Otherwise ask Jana Tilcerová.',
        ),
      ).toBeInTheDocument()
      // Signing out is the shell's, around the account's screens.
      expect(screen.getByRole('link', { name: 'Go to your account' })).toHaveAttribute(
        'href',
        paths.account.path,
      )
      expect(screen.getByRole('link', { name: 'Go to Home' })).toBeInTheDocument()
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
      expect(heading.parentElement).toHaveAttribute('aria-live', 'polite')
      await waitFor(() => {
        expect(document.activeElement).not.toBe(document.body)
      })
      expect(document.activeElement).toContainElement(heading)
      // It may yet be its addressee's, who is told to sign in as them: it is still held.
      expect(heldInvitationToken()).toBe(token)
      lookAgain()
      expect(server.to(reading)).toHaveLength(1)
    },
  )

  it('says an invitation that expired between the read and the answer has expired', async () => {
    const server = serving()
    server.on(accepting, () => problem(410, 'token_expired'))
    const { user } = open(link, server)
    await user.click(await screen.findByRole('button', { name: 'Join Tilcerovi' }))
    expect(await titled('This invitation has expired')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(heldInvitationToken()).toBeNull()
    })
  })

  it('says a household that is full is full, and that the invitation still stands', async () => {
    const server = serving()
    server.on(accepting, () =>
      problem(403, 'fair_use_ceiling', { resource: 'members', ceiling: 12 }),
    )
    const { user } = open(link, server)
    const join = await screen.findByRole('button', { name: 'Join Tilcerovi' })
    await user.click(join)
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        'Tilcerovi already has 12 members, which is as many as a household can have. The invitation still stands: somebody there has to make room before you can join.',
      )
    })
    // It stands: the page is as it was, its answers with it, and the focus where it was.
    expect(screen.getByRole('heading', { level: 1, name: invited })).toBeInTheDocument()
    expect(join).toHaveFocus()
    expect(join).not.toHaveAttribute('aria-busy')
    expect(heldInvitationToken()).toBe(token)
  })

  it.each([
    [
      'has lapsed',
      'entitlement_read_only',
      'read_only',
      'Tilcerovi takes no changes right now, because its subscription has lapsed, so your answer was not recorded. Nothing is wrong with the invitation or with you. Ask Jana Tilcerová, and answer once it is running again.',
    ],
    [
      'was put on hold by an owner',
      'entitlement_restricted',
      'restricted',
      'Tilcerovi takes no changes right now, because an owner has put it on hold, so your answer was not recorded. Nothing is wrong with the invitation or with you. Ask Jana Tilcerová, and answer once that is lifted.',
    ],
  ])('says a household that %s takes nobody for now', async (_, code, state, sentence) => {
    const server = serving()
    server.on(accepting, () => problem(402, code, { state, remedy: 'contact_owner' }))
    const { user } = open(link, server)
    await user.click(await screen.findByRole('button', { name: 'Join Tilcerovi' }))
    // A wait and no failure: said politely, and not as an alert.
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(sentence)
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Join Tilcerovi' })).toBeInTheDocument()
  })

  it('says a decline such a household could not record was not recorded', async () => {
    const server = serving()
    server.on(declining, () =>
      problem(402, 'entitlement_read_only', { state: 'canceled', remedy: 'contact_owner' }),
    )
    const { user } = open(link, server)
    await user.click(await screen.findByRole('button', { name: 'Decline' }))
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/so your answer was not recorded\./)
    })
    expect(screen.getByRole('heading', { level: 1, name: invited })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Decline' })).toBeInTheDocument()
  })

  it('says when a limit clears, and says a second refusal again', async () => {
    const server = serving()
    server.on(accepting, () => problem(429, 'rate_limited', {}, { 'Retry-After': '600' }))
    const { user } = open(link, server)
    const join = await screen.findByRole('button', { name: 'Join Tilcerovi' })
    await user.click(join)
    const first = await screen.findByRole('alert')
    expect(first).toHaveTextContent(/^Too many attempts\. Try again at \d{1,2}:\d{2}/)

    // A banner of its own for each refusal: one whose words only stayed would be said once.
    await user.click(join)
    await waitFor(() => {
      expect(server.to(accepting)).toHaveLength(2)
    })
    await waitFor(() => {
      expect(screen.getByRole('alert')).not.toBe(first)
    })
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })

  it('puts one answer’s refusal away when the other is pressed', async () => {
    const server = serving()
    server.on(accepting, () => problem(500, 'internal'))
    const answer = pending()
    server.on(declining, () => answer.response)
    const { user } = open(link, server)
    await user.click(await screen.findByRole('button', { name: 'Join Tilcerovi' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/^Something went wrong at our end\./)
    await user.click(screen.getByRole('button', { name: 'Decline' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    answer.answer(noContent())
    expect(await titled('You declined the invitation to Tilcerovi')).toBeInTheDocument()
  })

  // Asked at once (D-164): never held in the page to be sent when a connection returns.
  it('is asked with no connection, says the server was not reached, and is not sent later', async () => {
    const server = serving()
    server.on(accepting, () => Promise.reject(new TypeError('offline')))
    const { user } = open(link, server)
    const join = await screen.findByRole('button', { name: 'Join Tilcerovi' })
    onlineManager.setOnline(false)
    await user.click(join)
    expect(await screen.findByRole('alert')).toHaveTextContent(/^We couldn’t reach Household\./)
    expect(join).not.toHaveAttribute('aria-busy')
    expect(server.to(accepting)).toHaveLength(1)

    server.on(accepting, () => Response.json(joined))
    act(() => {
      onlineManager.setOnline(true)
    })
    await screen.findByRole('alert')
    expect(server.to(accepting)).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1, name: invited })).toBeInTheDocument()
  })
})
