// Web Push against stand-ins for `navigator.serviceWorker`, the Push API and `Notification`
// (testing.ts): what is read, asked, registered and removed, and what the shell's two calls and
// the worker's message do.
import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { pushOpenMessage } from '../../build/pushWorker.ts'
import { createWebClient } from '../api/client.ts'
import { ApiProblemError } from '../api/problem.ts'
import { createProblemHub } from '../api/problems.ts'
import { Providers } from '../app/App.tsx'
import { paths } from '../app/paths.ts'
import { Root } from '../app/Root.tsx'
import { routes } from '../app/routes.tsx'
import { PushLinks } from './PushLinks.tsx'
import {
  endpoint,
  keyBytes,
  pushStandIns,
  serverKey,
  type Browser,
  type PushStandIns,
} from './testing.ts'
import { usePushPrompt } from './usePush.ts'
import {
  base64url,
  bytesOf,
  forgetPush,
  pushTarget,
  readPushState,
  renewPush,
  requestPushPermission,
  subscribePush,
  unsubscribePush,
} from './worker.ts'

const origin = 'https://household.example'

/** Where a renewal tells what it was refused with, in a test that listens for none of it. */
const unheard = createProblemHub()

let browser: PushStandIns | undefined

function withPush(says: Browser = {}): PushStandIns {
  browser = pushStandIns(says)
  return browser
}

afterEach(() => {
  browser?.remove()
  browser = undefined
})

/** A server that answers the three requests Web Push makes, and keeps what it was sent. */
function server(answers: { readonly register?: () => Response; readonly remove?: () => Response }) {
  const sent: Request[] = []
  const api = createWebClient({
    origin,
    cookies: () => '__Host-hh_csrf=t',
    retry: { delays: [] },
    fetch: (request) => {
      sent.push(request.clone())
      const { pathname } = new URL(request.url)
      if (pathname.endsWith('/push/vapid-key')) {
        return Promise.resolve(Response.json({ key: serverKey }))
      }
      if (request.method === 'POST') {
        return Promise.resolve(
          answers.register?.() ??
            Response.json(
              { id: 's1', transport: 'web_push', created_at: '', last_seen_at: '' },
              { status: 201 },
            ),
        )
      }
      return Promise.resolve(answers.remove?.() ?? new Response(null, { status: 204 }))
    },
  })
  return { api, sent }
}

function refusal(status: number, code: string): Response {
  return Response.json(
    { type: `https://household.example/problems/${code}`, title: code, status, code, errors: [] },
    { status, headers: { 'Content-Type': 'application/problem+json' } },
  )
}

describe('what this browser says of notifications', () => {
  it('is that it has no Web Push, in a browser with none', async () => {
    expect(await readPushState()).toEqual({ permission: 'unsupported', subscribed: false })
    expect(await requestPushPermission()).toBe('unsupported')
  })

  it('is its permission, and no subscription until it allows them', async () => {
    const { notification } = withPush({ permission: 'default' })
    expect(await readPushState()).toEqual({ permission: 'default', subscribed: false })
    notification.permission = 'denied'
    expect(await readPushState()).toEqual({ permission: 'denied', subscribed: false })
    notification.permission = 'granted'
    expect(await readPushState()).toEqual({ permission: 'granted', subscribed: false })
  })

  it('is that it is subscribed where it holds a subscription', async () => {
    withPush({ permission: 'granted', subscribedUnder: bytesOf(serverKey) })
    expect(await readPushState()).toEqual({ permission: 'granted', subscribed: true })
  })

  it('is read with nothing registered and nothing asked', async () => {
    const { register, notification } = withPush({ permission: 'default' })
    await readPushState()
    expect(register).not.toHaveBeenCalled()
    expect(notification.requestPermission).not.toHaveBeenCalled()
  })
})

describe('the browser’s question', () => {
  it('is put once, and answered with what the browser then says', async () => {
    const { notification } = withPush({ permission: 'default', answer: 'denied' })
    expect(await requestPushPermission()).toBe('denied')
    expect(notification.requestPermission).toHaveBeenCalledTimes(1)
    // A browser that has answered is not asked again.
    expect(await requestPushPermission()).toBe('denied')
    expect(notification.requestPermission).toHaveBeenCalledTimes(1)
  })
})

describe('subscribing', () => {
  it('registers the worker, subscribes under the server’s key and tells the server', async () => {
    const { register, subscribe } = withPush({ permission: 'granted' })
    const { api, sent } = server({})
    expect(await subscribePush(api)).toEqual({ permission: 'granted', subscribed: true })

    expect(register).toHaveBeenCalledWith('/push-worker.js')
    const [options] = subscribe.mock.calls[0] ?? []
    expect(options?.userVisibleOnly).toBe(true)
    expect(options?.applicationServerKey).toEqual(bytesOf(serverKey))

    expect(sent.map((request) => `${request.method} ${new URL(request.url).pathname}`)).toEqual([
      'GET /api/v1/push/vapid-key',
      'POST /api/v1/push/subscriptions',
    ])
    expect(await sent[1]?.json()).toEqual({
      transport: 'web_push',
      endpoint,
      keys: { p256dh: base64url(keyBytes('p256dh')), auth: base64url(keyBytes('auth')) },
    })
  })

  it('keeps a subscription made under the server’s key, and makes one under another again', async () => {
    const kept = withPush({ permission: 'granted', subscribedUnder: bytesOf(serverKey) })
    await subscribePush(server({}).api)
    expect(kept.subscribe).not.toHaveBeenCalled()
    kept.remove()

    const replaced = withPush({
      permission: 'granted',
      subscribedUnder: new Uint8Array(65).fill(9),
    })
    await subscribePush(server({}).api)
    expect(replaced.unsubscribed()).toBe(1)
    expect(replaced.subscribe).toHaveBeenCalledTimes(1)
  })

  it('gives up a subscription the server refused, and says it failed', async () => {
    const { unsubscribed, subscription } = withPush({ permission: 'granted' })
    const { api } = server({ register: () => refusal(422, 'validation_failed') })
    await expect(subscribePush(api)).rejects.toBeInstanceOf(ApiProblemError)
    expect(unsubscribed()).toBe(1)
    expect(subscription()).toBeNull()
    expect(await readPushState()).toEqual({ permission: 'granted', subscribed: false })
  })

  it('keeps a subscription it already held when the server cannot be reached', async () => {
    const { unsubscribed } = withPush({
      permission: 'granted',
      subscribedUnder: bytesOf(serverKey),
    })
    const { api } = server({ register: () => refusal(500, 'internal') })
    await expect(subscribePush(api)).rejects.toBeInstanceOf(ApiProblemError)
    expect(unsubscribed()).toBe(0)
  })
})

describe('turning notifications off in this browser', () => {
  it('tells the server, then the browser, and stays off at the next sign-in', async () => {
    const { unsubscribed, subscribe } = withPush({
      permission: 'granted',
      subscribedUnder: bytesOf(serverKey),
    })
    const { api, sent } = server({})
    expect(await unsubscribePush(api)).toEqual({ permission: 'granted', subscribed: false })
    const [request] = sent
    expect(request?.method).toBe('DELETE')
    expect(new URL(request?.url ?? origin).searchParams.get('endpoint')).toBe(endpoint)
    expect(unsubscribed()).toBe(1)

    // The permission is granted still, and the member turned them off here: a sign-in leaves it.
    await renewPush(api, unheard)
    expect(subscribe).not.toHaveBeenCalled()
    expect(sent).toHaveLength(1)

    // Turned on again by the member, it is renewed again.
    await subscribePush(api)
    await renewPush(api, unheard)
    expect(sent.filter((each) => each.method === 'POST')).toHaveLength(2)
  })

  it('changes nothing where the server could not be told', async () => {
    const { unsubscribed } = withPush({
      permission: 'granted',
      subscribedUnder: bytesOf(serverKey),
    })
    const { api } = server({ remove: () => refusal(500, 'internal') })
    await expect(unsubscribePush(api)).rejects.toBeInstanceOf(ApiProblemError)
    expect(unsubscribed()).toBe(0)
    expect(await readPushState()).toEqual({ permission: 'granted', subscribed: true })
  })
})

describe('renewing after a sign-in', () => {
  it('registers a browser that allows notifications, asking nothing', async () => {
    const { notification, subscribe } = withPush({ permission: 'granted' })
    const { api, sent } = server({})
    await renewPush(api, unheard)
    expect(notification.requestPermission).not.toHaveBeenCalled()
    expect(subscribe).toHaveBeenCalledTimes(1)
    expect(sent.at(-1)?.method).toBe('POST')
  })

  it('leaves a browser that was never asked, or refused, as it is', async () => {
    const { notification, register } = withPush({ permission: 'default' })
    const { api, sent } = server({})
    await renewPush(api, unheard)
    notification.permission = 'denied'
    await renewPush(api, unheard)
    expect(notification.requestPermission).not.toHaveBeenCalled()
    expect(register).not.toHaveBeenCalled()
    expect(sent).toEqual([])
  })

  it('swallows a browser with no Push, and a server that fails', async () => {
    const quiet = server({})
    await expect(renewPush(quiet.api, unheard)).resolves.toBeUndefined()
    expect(quiet.sent).toEqual([])

    withPush({ permission: 'granted' })
    const failing = server({ register: () => refusal(500, 'internal') })
    await expect(renewPush(failing.api, unheard)).resolves.toBeUndefined()
  })

  it('tells what the server refused it with, as a request made outside any query must', async () => {
    withPush({ permission: 'granted' })
    const problems = createProblemHub()
    const told: (string | undefined)[] = []
    problems.subscribe((problem) => {
      told.push(problem.code)
    })
    // The session ended since this page read its account: the session is told so.
    const ended = server({ register: () => refusal(401, 'unauthenticated') })
    await expect(renewPush(ended.api, problems)).resolves.toBeUndefined()
    expect(told).toEqual(['unauthenticated'])
  })
})

describe('forgetting at a sign-out', () => {
  it('removes the subscription at the server and in the browser, and not the member’s choice', async () => {
    const { unsubscribed, subscribe } = withPush({
      permission: 'granted',
      subscribedUnder: bytesOf(serverKey),
    })
    const { api, sent } = server({})
    await forgetPush(api)
    expect(sent.map((request) => request.method)).toEqual(['DELETE'])
    expect(unsubscribed()).toBe(1)
    // The next sign-in subscribes it again.
    await renewPush(api, unheard)
    expect(subscribe).toHaveBeenCalledTimes(1)
  })

  it('lets go in the browser though the server did not answer, and swallows a browser with none', async () => {
    await expect(forgetPush(server({}).api)).resolves.toBeUndefined()

    const { unsubscribed } = withPush({
      permission: 'granted',
      subscribedUnder: bytesOf(serverKey),
    })
    const { api } = server({ remove: () => refusal(500, 'internal') })
    await expect(forgetPush(api)).resolves.toBeUndefined()
    expect(unsubscribed()).toBe(1)
  })
})

describe('a message from the worker', () => {
  it('names an address of the app’s own, and nothing else does', () => {
    expect(pushTarget({ type: pushOpenMessage, url: '/households/h1/sync?x=1#y' })).toBe(
      '/households/h1/sync?x=1#y',
    )
    for (const data of [
      null,
      'household.push.open',
      { type: 'other', url: '/account' },
      { type: pushOpenMessage },
      { type: pushOpenMessage, url: 'https://elsewhere.example/' },
      { type: pushOpenMessage, url: '//elsewhere.example/' },
      { type: pushOpenMessage, url: '/\\elsewhere.example/' },
    ]) {
      expect(pushTarget(data)).toBeNull()
    }
  })

  it('takes the page to the address a pressed notification names', async () => {
    const { post } = withPush({ permission: 'granted' })
    const router = createMemoryRouter(
      [
        { path: '/', Component: PushLinks },
        { path: '/households/:id', Component: PushLinks },
      ],
      { initialEntries: ['/'] },
    )
    render(<RouterProvider router={router} />)
    act(() => {
      post({ type: 'something else', url: '/households/h1' })
    })
    expect(router.state.location.pathname).toBe('/')
    act(() => {
      post({ type: pushOpenMessage, url: '/households/h1' })
    })
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/households/h1')
    })
  })
})

describe('the app, wherever it is open', () => {
  const me = {
    id: '01900000-0000-7000-8000-00000000d0e5',
    email: 'jana@example.test',
    email_verified: true,
    display_name: 'Jana',
    locale: 'en',
  }

  /** The app at a member's own account, over a server that keeps the order it was asked in. */
  function app() {
    const asked: string[] = []
    const client = createWebClient({
      origin,
      cookies: () => '__Host-hh_csrf=t',
      retry: { delays: [] },
      fetch: (request) => {
        const path = new URL(request.url).pathname.replace('/api/v1', '')
        asked.push(`${request.method} ${path}`)
        if (path === '/push/vapid-key') return Promise.resolve(Response.json({ key: serverKey }))
        if (path === '/me') return Promise.resolve(Response.json(me))
        if (request.method === 'GET') return Promise.resolve(Response.json({ items: [] }))
        return Promise.resolve(new Response(null, { status: 204 }))
      },
    })
    const router = createMemoryRouter(routes, { initialEntries: [paths.account.path] })
    render(
      <Providers persist={false} client={client} cookies={() => '__Host-hh_csrf=t'}>
        <RouterProvider router={router} />
      </Providers>,
    )
    return { asked, router }
  }

  it('registers a browser that allows notifications again for the member who is here', async () => {
    const { notification } = withPush({ permission: 'granted' })
    const { asked } = app()
    await waitFor(() => {
      expect(asked).toContain('POST /push/subscriptions')
    })
    expect(notification.requestPermission).not.toHaveBeenCalled()
  })

  it('has a screen that read this browser’s state before it was registered read it again', async () => {
    withPush({ permission: 'granted' })
    const said = { on: 'subscribed', off: 'not subscribed' }
    function Said() {
      const { state } = usePushPrompt()
      return <p>{state === undefined ? null : state.subscribed ? said.on : said.off}</p>
    }
    // The server's key is still on its way when the screen first reads what the browser holds.
    let give: (key: Response) => void = () => undefined
    const key = new Promise<Response>((resolve) => {
      give = resolve
    })
    const client = createWebClient({
      origin,
      cookies: () => '__Host-hh_csrf=t',
      retry: { delays: [] },
      fetch: (request) => {
        const path = new URL(request.url).pathname.replace('/api/v1', '')
        if (path === '/push/vapid-key') return key
        if (path === '/me') return Promise.resolve(Response.json(me))
        return Promise.resolve(new Response(null, { status: 204 }))
      },
    })
    const router = createMemoryRouter([
      { Component: Root, children: [{ path: '*', Component: Said }] },
    ])
    render(
      <Providers persist={false} client={client} cookies={() => '__Host-hh_csrf=t'}>
        <RouterProvider router={router} />
      </Providers>,
    )
    expect(await screen.findByText(said.off)).toBeInTheDocument()
    give(Response.json({ key: serverKey }))
    expect(await screen.findByText(said.on)).toBeInTheDocument()
  })

  it('asks a browser that was never asked nothing, and the server nothing of it', async () => {
    const { notification, register } = withPush({ permission: 'default' })
    const { asked } = app()
    await screen.findByRole('button', { name: 'Sign out' })
    expect(notification.requestPermission).not.toHaveBeenCalled()
    expect(register).not.toHaveBeenCalled()
    expect(asked.filter((request) => request.includes('/push/'))).toEqual([])
  })

  it('removes the browser’s subscription before a sign-out ends the session', async () => {
    withPush({ permission: 'granted', subscribedUnder: bytesOf(serverKey) })
    const { asked, router } = app()
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(paths.signIn.path)
    })
    const removed = asked.indexOf('DELETE /push/subscriptions')
    expect(removed).toBeGreaterThan(-1)
    expect(removed).toBeLessThan(asked.indexOf('POST /auth/logout'))
  })
})

describe('asking in context', () => {
  function around(api: ReturnType<typeof server>['api']) {
    return function Around({ children }: { readonly children: ReactNode }) {
      return (
        <Providers persist={false} client={api} cookies={() => ''}>
          {children}
        </Providers>
      )
    }
  }

  it('gives the state, asks in the press and subscribes a browser that says yes', async () => {
    const { notification } = withPush({ permission: 'default', answer: 'granted' })
    const { api, sent } = server({})
    const { result } = renderHook(() => usePushPrompt(), { wrapper: around(api) })
    await waitFor(() => {
      expect(result.current.state).toEqual({ permission: 'default', subscribed: false })
    })
    // Nothing was asked by drawing it.
    expect(notification.requestPermission).not.toHaveBeenCalled()

    let answered: unknown
    await act(async () => {
      answered = await result.current.ask()
    })
    expect(notification.requestPermission).toHaveBeenCalledTimes(1)
    expect(answered).toEqual({ permission: 'granted', subscribed: true })
    await waitFor(() => {
      expect(result.current.state).toEqual({ permission: 'granted', subscribed: true })
    })
    expect(sent.at(-1)?.method).toBe('POST')
  })

  it('subscribes nothing for a browser that says no', async () => {
    withPush({ permission: 'default', answer: 'denied' })
    const { api, sent } = server({})
    const { result } = renderHook(() => usePushPrompt(), { wrapper: around(api) })
    await waitFor(() => {
      expect(result.current.state?.permission).toBe('default')
    })
    await act(async () => {
      await result.current.ask()
    })
    await waitFor(() => {
      expect(result.current.state).toEqual({ permission: 'denied', subscribed: false })
    })
    expect(sent).toEqual([])
  })
})
