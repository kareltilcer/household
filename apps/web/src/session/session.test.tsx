import { focusManager, useMutation } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useApi } from '../api/ApiProvider.tsx'
import { createWebClient } from '../api/client.ts'
import { csrfCookie } from '../api/names.ts'
import { unwrap } from '../api/problem.ts'
import { Providers } from '../app/App.tsx'
import { paths } from '../app/paths.ts'
import { inRoot, routes } from '../app/routes.tsx'
import { useI18n } from '../i18n/I18nProvider.tsx'
import { arrangementKey } from '../shell/arrangement.ts'
import { isReplicaDatabase, noteReplica, replicaDatabase } from '../sync/databases.ts'
import { Press } from '../test/render.tsx'
import { heldDestination, holdDestination, takeDestination } from './destination.ts'
import { useSession } from './SessionProvider.tsx'

const origin = 'https://household.example'

// A test that says the page is looked at again leaves the next one a page nobody has looked at.
afterEach(() => {
  focusManager.setFocused(undefined)
})
const signedIn = `${csrfCookie}=token`

const me = {
  id: '01900000-0000-7000-8000-00000000d0e5',
  email: 'jana@example.test',
  email_verified: true,
  display_name: 'Jana',
  locale: 'en',
}

function problem(status: number, code: string, more: Record<string, unknown> = {}): Response {
  return Response.json(
    { type: `https://household.example/problems/${code}`, title: code, status, code, ...more },
    { status, headers: { 'Content-Type': 'application/problem+json' } },
  )
}

type Respond = (request: Request) => Response | Promise<Response>

/** The app's providers over a server the test answers for, and what it was asked. */
function server(respond: Respond, cookies: () => string = () => signedIn) {
  const asked: string[] = []
  const client = createWebClient({
    origin,
    cookies,
    retry: { delays: [], sleep: () => Promise.resolve() },
    fetch: async (request) => {
      asked.push(`${request.method} ${new URL(request.url).pathname.replace('/api/v1', '')}`)
      return respond(request)
    },
  })
  return { asked, client, cookies }
}

/** What a screen reads of the session, and the two things it does to it. */
function Probe() {
  const session = useSession()
  const api = useApi()
  const { locale } = useI18n()
  // A write a member makes: the session hears of what it is refused with.
  const write = useMutation({
    mutationFn: async () => unwrap(await api.PATCH('/me', { body: { display_name: 'J' } })),
  })
  const who = session.state.status === 'member' ? session.state.me.display_name : ''
  return (
    <div>
      <output>{[session.state.status, who, session.ended ?? '', locale].join(' ').trim()}</output>
      <Press
        name="write"
        onPress={() => {
          write.mutate()
        }}
      />
      <Press
        name="leave"
        onPress={() => {
          session.signOut().catch(() => undefined)
        }}
      />
      <Press
        name="enter"
        onPress={() => {
          void session.entered()
        }}
      />
    </div>
  )
}

function open(at: ReturnType<typeof server>, table = inRoot([{ path: '/', Component: Probe }])) {
  const router = createMemoryRouter(table, { initialEntries: ['/'] })
  render(
    <Providers persist={false} client={at.client} cookies={at.cookies}>
      <RouterProvider router={router} />
    </Providers>,
  )
  return router
}

describe('who is signed in', () => {
  it('is nobody, and the server is not asked, in a browser that holds no session', async () => {
    const at = server(
      () => problem(401, 'unauthenticated'),
      () => '',
    )
    open(at)
    expect(await screen.findByRole('status')).toHaveTextContent('visitor')
    // A visitor's page asks the server nothing it would refuse.
    expect(at.asked).toEqual([])
  })

  it('is the account the server answers, where the browser holds a session', async () => {
    const at = server(() => Response.json(me))
    open(at)
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('member Jana')
    })
    expect(at.asked).toEqual(['GET /me'])
  })

  it('is nobody where the server no longer knows the session the browser holds', async () => {
    const at = server(() => problem(401, 'unauthenticated'))
    open(at)
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('visitor')
    })
  })

  it('is not known, and is said so with a way to ask again, where the server cannot be asked', async () => {
    let down = true
    const at = server(() => (down ? Promise.reject(new TypeError('network')) : Response.json(me)))
    const router = createMemoryRouter(routes, { initialEntries: [paths.account.path] })
    render(
      <Providers persist={false} client={at.client} cookies={at.cookies}>
        <RouterProvider router={router} />
      </Providers>,
    )
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Household can’t be reached' }),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('main')).toHaveLength(1)
    down = false
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => {
      expect(screen.queryByText('Household can’t be reached')).not.toBeInTheDocument()
    })
  })

  it('shows the app in the account’s language, once the account is known', async () => {
    const at = server(() => Response.json({ ...me, locale: 'cs-CZ' }))
    open(at)
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('member Jana cs')
    })
    expect(document.documentElement).toHaveAttribute('lang', 'cs')
  })
})

/**
 * The browser's databases, which jsdom has none of: a stand-in that lists none and notes each one
 * it is asked to delete.
 */
function databases() {
  const deleteDatabase = vi.fn()
  vi.stubGlobal('indexedDB', { databases: () => Promise.resolve([]), deleteDatabase })
  return deleteDatabase
}

describe('a session that ends', () => {
  /** A member whose next write the server answers with `refusal`. */
  async function refused(refusal: () => Response) {
    let ended = false
    const at = server((request) =>
      request.method === 'GET' && !ended ? Response.json(me) : refusal(),
    )
    open(at)
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('member Jana')
    })
    // What this browser kept for them: a replica's database, noted, and their own preference.
    noteReplica(me.id)
    window.localStorage.setItem(arrangementKey(me.id, me.id), '{}')
    ended = true
    await userEvent.click(screen.getByRole('button', { name: 'write' }))
    return at
  }

  it('by a 401 leaves nobody signed in, and removes what this browser kept of their households', async () => {
    const deleted = databases()
    const at = await refused(() => problem(401, 'unauthenticated'))
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('visitor expired')
    })
    await waitFor(() => {
      expect(deleted).toHaveBeenCalledWith(replicaDatabase(me.id))
    })
    await act(() => Promise.resolve())
    // The server said the session is gone, and is not asked whose it is again.
    expect(at.asked.filter((request) => request === 'GET /me')).toHaveLength(1)
    // A preference of theirs is no household's data, and stays.
    expect(window.localStorage.getItem(arrangementKey(me.id, me.id))).toBe('{}')
  })

  it('by a failed CSRF check asks them to sign in again, and removes nothing', async () => {
    const deleted = databases()
    await refused(() => problem(403, 'csrf_failed'))
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('visitor csrf')
    })
    expect(deleted).not.toHaveBeenCalled()
  })

  it('is not ended by a refusal that is about the request and not the session', async () => {
    await refused(() => problem(422, 'validation_failed', { errors: [] }))
    await act(() => Promise.resolve())
    expect(screen.getByRole('status')).toHaveTextContent('member Jana')
  })

  it('by signing out ends at the server first, and stays where the server could not be told', async () => {
    let reachable = false
    let signedOut = false
    const deleted = databases()
    const at = server((request) => {
      if (request.method === 'POST') {
        if (!reachable) return Promise.reject(new TypeError('network'))
        signedOut = true
        return new Response(null, { status: 204 })
      }
      return signedOut ? problem(401, 'unauthenticated') : Response.json(me)
    })
    open(at)
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('member Jana')
    })
    noteReplica(me.id)
    await userEvent.click(screen.getByRole('button', { name: 'leave' }))
    await act(() => Promise.resolve())
    // The session is the server's to end: unreached, the member is signed in still.
    expect(screen.getByRole('status')).toHaveTextContent('member Jana')
    expect(deleted).not.toHaveBeenCalled()

    reachable = true
    await userEvent.click(screen.getByRole('button', { name: 'leave' }))
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/^visitor en$/)
    })
    expect(at.asked).toContain('POST /auth/logout')
    expect(deleted).toHaveBeenCalledWith(replicaDatabase(me.id))
  })

  it('by signing out of a session the server ended already is signed out, and not said to have failed', async () => {
    let ended = false
    const deleted = databases()
    const at = server(() => (ended ? problem(401, 'unauthenticated') : Response.json(me)))
    open(at)
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('member Jana')
    })
    noteReplica(me.id)
    ended = true
    await userEvent.click(screen.getByRole('button', { name: 'leave' }))
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/^visitor en$/)
    })
    expect(deleted).toHaveBeenCalledWith(replicaDatabase(me.id))
  })

  it('is acted on where the page never knew the member: the account is kept for a day, and a replica for longer', async () => {
    const deleted = databases()
    // Left by a session of before: this page has read no account, and holds none.
    noteReplica(me.id)
    const at = server(() => problem(401, 'unauthenticated'))
    open(at)
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('visitor expired')
    })
    await waitFor(() => {
      expect(deleted).toHaveBeenCalledWith(replicaDatabase(me.id))
    })
    // The server said the session is gone, and is not asked again when the page is looked at.
    act(() => {
      focusManager.setFocused(true)
    })
    await act(() => Promise.resolve())
    expect(at.asked).toEqual(['GET /me'])
  })

  it('unheard of, its cookies lapsed with it, leaves no replica in a browser that holds no session', async () => {
    const deleted = databases()
    noteReplica(me.id)
    const at = server(
      () => problem(401, 'unauthenticated'),
      () => '',
    )
    open(at)
    await waitFor(() => {
      expect(deleted).toHaveBeenCalledWith(replicaDatabase(me.id))
    })
    expect(screen.getByRole('status')).toHaveTextContent(/^visitor en$/)
    expect(at.asked).toEqual([])
  })
})

describe('another member who signs in under an open page', () => {
  const other = { ...me, id: '01900000-0000-7000-8000-00000000beef', display_name: 'Petr' }

  it('is given nothing the first one’s page kept: it is removed, and the page starts again', async () => {
    const deleted = databases()
    const restart = vi.fn()
    let who = me
    const at = server(() => Response.json(who))
    const router = createMemoryRouter(inRoot([{ path: '/', Component: Probe }]), {
      initialEntries: ['/'],
    })
    render(
      <Providers persist={false} client={at.client} cookies={at.cookies} restart={restart}>
        <RouterProvider router={router} />
      </Providers>,
    )
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('member Jana')
    })
    noteReplica(me.id)
    // The account is read again, as when the page is looked at again, and is another member's:
    // they signed in from another tab of this browser.
    who = other
    await userEvent.click(screen.getByRole('button', { name: 'enter' }))
    await waitFor(() => {
      expect(restart).toHaveBeenCalledTimes(1)
    })
    expect(deleted).toHaveBeenCalledWith(replicaDatabase(me.id))
  })

  it('is no one new where the same member is read again, or signs in after signing out', async () => {
    const restart = vi.fn()
    databases()
    let signedOut = false
    const at = server((request) => {
      if (request.method === 'POST') {
        signedOut = true
        return new Response(null, { status: 204 })
      }
      return Response.json(signedOut ? other : me)
    })
    const router = createMemoryRouter(inRoot([{ path: '/', Component: Probe }]), {
      initialEntries: ['/'],
    })
    render(
      <Providers persist={false} client={at.client} cookies={at.cookies} restart={restart}>
        <RouterProvider router={router} />
      </Providers>,
    )
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('member Jana')
    })
    await userEvent.click(screen.getByRole('button', { name: 'enter' }))
    await act(() => Promise.resolve())
    // Signed out, what the page kept went with them: whoever signs in next starts from nothing.
    await userEvent.click(screen.getByRole('button', { name: 'leave' }))
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/^visitor en$/)
    })
    await userEvent.click(screen.getByRole('button', { name: 'enter' }))
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('member Petr')
    })
    expect(restart).not.toHaveBeenCalled()
  })
})

describe('a build the server no longer serves', () => {
  it('draws the screen that says so, and nothing else', async () => {
    const at = server(() => problem(400, 'update_required', { minimum_version: '9.0.0' }))
    open(at)
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Time to update' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

describe('the address held while a visitor signs in', () => {
  it('is held once, and is the app’s own or is not held', () => {
    expect(heldDestination()).toBeNull()
    holdDestination('/households/h1/sync?x=1#y')
    expect(heldDestination()).toBe('/households/h1/sync?x=1#y')
    expect(takeDestination()).toBe('/households/h1/sync?x=1#y')
    expect(heldDestination()).toBeNull()
    for (const foreign of [
      'https://evil.example/',
      '//evil.example',
      '/\\evil.example',
      'account',
    ]) {
      holdDestination(foreign)
      expect(heldDestination(), foreign).toBeNull()
    }
  })

  it('is not the address of a member who signed out themselves', async () => {
    let signedOut = false
    const at = server((request) => {
      if (request.method === 'POST') {
        signedOut = true
        return new Response(null, { status: 204 })
      }
      if (new URL(request.url).pathname.endsWith('/me')) {
        return signedOut ? problem(401, 'unauthenticated') : Response.json(me)
      }
      return Response.json({ items: [] })
    })
    const router = createMemoryRouter(routes, { initialEntries: [paths.account.path] })
    render(
      <Providers persist={false} client={at.client} cookies={at.cookies}>
        <RouterProvider router={router} />
      </Providers>,
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(paths.signIn.path)
    })
    // The next person to sign in here is not sent to where the last one was.
    expect(heldDestination()).toBeNull()
  })
})

describe('a replica’s database', () => {
  it('is known by its name, a household’s id, and the persisted cache’s is not', () => {
    expect(isReplicaDatabase(replicaDatabase(me.id.toUpperCase()))).toBe(true)
    expect(replicaDatabase(me.id.toUpperCase())).toBe(replicaDatabase(me.id))
    for (const other of ['household-web', 'household-.db', 'other.db', '']) {
      expect(isReplicaDatabase(other), other).toBe(false)
    }
  })
})
