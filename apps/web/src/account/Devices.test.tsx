// Where an account is signed in (A-12, A-13): the two lists, what a confirmation says before it
// signs anything out, and how a session is named from the one thing the server keeps of it.
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createServer, jana, noContent, open, problem, type Server } from './testing.tsx'
import { agentOf } from './userAgent.ts'

const title = 'Where you are signed in'

const agents = {
  chromeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0',
  safariMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  safariPhone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  edgeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
  samsung:
    'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
  operaMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 OPR/115.0.0.0',
  chromeOs:
    'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
} as const

const here = {
  id: '0190a000-0000-7000-8000-0000000000b1',
  created_at: '2026-10-01T08:00:00Z',
  last_seen_at: '2026-10-08T07:30:00Z',
  approximate_location: null,
  user_agent: agents.firefoxLinux,
  is_current: true,
}
const laptop = {
  id: '0190a000-0000-7000-8000-0000000000b2',
  created_at: '2026-09-20T08:00:00Z',
  last_seen_at: '2026-10-07T16:12:00Z',
  approximate_location: null,
  user_agent: agents.chromeWindows,
  is_current: false,
}
const tablet = {
  id: '0190a000-0000-7000-8000-0000000000c1',
  label: 'iPad (kitchen)',
  platform: 'ios',
  app_version: '1.6.0',
  last_seen_at: '2026-10-06T19:03:00Z',
  push_enabled: true,
  is_current: false,
}
const phone = {
  id: '0190a000-0000-7000-8000-0000000000c2',
  label: '',
  platform: 'android',
  app_version: '1.6.0',
  last_seen_at: '2026-10-05T09:00:00Z',
  push_enabled: false,
  is_current: false,
}

function signedIn(server: Server, sessions: readonly object[], devices: readonly object[]) {
  server.on('GET /me/sessions', () => Response.json({ items: sessions }))
  server.on('GET /me/devices', () => Response.json({ items: devices }))
}

async function devices(server: Server) {
  const opened = open('/account/devices', server)
  await screen.findByRole('heading', { level: 1, name: title })
  return opened
}

describe('where an account is signed in', () => {
  it('is two lists, each row named, dated in the member’s own timezone', async () => {
    const server = createServer()
    signedIn(server, [laptop, here], [tablet, phone])
    await devices(server)
    const browsers = await screen.findByRole('list', { name: 'Browsers' })
    const rows = within(browsers).getAllByRole('listitem')
    // This browser first, whatever was seen last.
    expect(rows.map((row) => within(row).getAllByText(/./)[0]?.textContent)).toEqual([
      'Firefox on Linux',
      'Chrome on Windows',
    ])
    // 16:12 UTC is 18:12 in Prague, the member's own zone, whatever this device's is.
    expect(within(rows[1] as HTMLElement).getByText(/^Last seen .*6:12/)).toBeInTheDocument()
    expect(within(rows[1] as HTMLElement).queryByText(/request came from/)).toBeNull()

    const others = screen.getByRole('list', { name: 'Phones and tablets' })
    expect(
      within(others)
        .getAllByRole('listitem')
        .map((row) => within(row).getAllByText(/./)[0]?.textContent),
    ).toEqual(['iPad (kitchen)', 'Android phone or tablet'])
  })

  it('marks this browser, and gives it no way to be signed out from here', async () => {
    const server = createServer()
    signedIn(server, [here, laptop], [])
    await devices(server)
    const rows = within(await screen.findByRole('list', { name: 'Browsers' })).getAllByRole(
      'listitem',
    )
    expect(within(rows[0] as HTMLElement).getByText('This browser')).toBeInTheDocument()
    expect(within(rows[0] as HTMLElement).queryByRole('button')).not.toBeInTheDocument()
    expect(
      within(rows[1] as HTMLElement).getByRole('button', { name: 'Sign out Chrome on Windows' }),
    ).toBeInTheDocument()
  })

  it('names a place only where the server does, as where the request came from', async () => {
    const server = createServer()
    signedIn(server, [here, { ...laptop, approximate_location: 'Brno, Czechia' }], [])
    await devices(server)
    expect(
      await screen.findByText(/^Last seen .* · request came from Brno, Czechia$/),
    ).toBeInTheDocument()
  })

  it('signs a browser out after saying what goes with it, naming it in the question and the control', async () => {
    const server = createServer()
    signedIn(server, [here, laptop], [])
    server.on(`DELETE /me/sessions/${laptop.id}`, () => {
      signedIn(server, [here], [])
      return noContent()
    })
    const { user } = await devices(server)
    await user.click(await screen.findByRole('button', { name: 'Sign out Chrome on Windows' }))
    const dialog = screen.getByRole('dialog', { name: 'Sign out Chrome on Windows?' })
    expect(dialog).toHaveAccessibleDescription(
      'That browser is signed out at once. It drops its copy of your households the next time it opens Household, and anything it saved offline and had not sent goes with it.',
    )
    // The safe choice first, then the one that names what it signs out.
    expect(
      within(dialog)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Keep it signed in', 'Sign out Chrome on Windows'])
    await user.click(within(dialog).getByRole('button', { name: 'Sign out Chrome on Windows' }))

    expect(await screen.findByText('Chrome on Windows is signed out.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
    expect(server.to(`DELETE /me/sessions/${laptop.id}`)).toHaveLength(1)
    // The list is read again: only this browser is left.
    const left = await screen.findByText('Only this browser')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // The row the question was opened from went with what it named, and the focus the question
    // gave back with it: it is on the lists' own place, and not dropped to the page.
    await waitFor(() => {
      expect(document.activeElement).not.toBe(document.body)
    })
    expect(document.activeElement).toContainElement(left)
  })

  it('signs a device out, and says every trust goes where the account has a second step', async () => {
    const server = createServer({ ...jana, mfa_enabled: true, mfa_recovery_codes_left: 8 })
    signedIn(server, [here], [tablet])
    server.on(`DELETE /me/devices/${tablet.id}`, noContent)
    const { user } = await devices(server)
    await user.click(await screen.findByRole('button', { name: 'Sign out iPad (kitchen)' }))
    const dialog = screen.getByRole('dialog', { name: 'Sign out iPad (kitchen)?' })
    expect(dialog).toHaveAccessibleDescription(
      'That device is signed out at once. It drops its copy of your households the next time it opens the app, and anything it saved offline and had not sent goes with it. No browser or device stays trusted to skip the second step: each is asked for a code again.',
    )
    await user.click(within(dialog).getByRole('button', { name: 'Sign out iPad (kitchen)' }))
    await waitFor(() => {
      expect(server.to(`DELETE /me/devices/${tablet.id}`)).toHaveLength(1)
    })
    expect(await screen.findByText('iPad (kitchen) is signed out.')).toBeInTheDocument()
  })

  it('keeps a device signed in when the member says so', async () => {
    const server = createServer()
    signedIn(server, [here], [tablet])
    const { user } = await devices(server)
    await user.click(await screen.findByRole('button', { name: 'Sign out iPad (kitchen)' }))
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Keep it signed in' }),
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(server.to(`DELETE /me/devices/${tablet.id}`)).toHaveLength(0)
  })

  it('says one that is gone already was signed out already', async () => {
    const server = createServer()
    signedIn(server, [here, laptop], [])
    const { user } = await devices(server)
    await user.click(await screen.findByRole('button', { name: 'Sign out Chrome on Windows' }))
    signedIn(server, [here], [])
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Sign out Chrome on Windows',
      }),
    )
    expect(await screen.findByText('It was signed out already.')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('says a sign-out could not reach the server, and leaves the question open', async () => {
    const server = createServer()
    signedIn(server, [here, laptop], [])
    server.on(`DELETE /me/sessions/${laptop.id}`, () => Promise.reject(new TypeError('offline')))
    const { user } = await devices(server)
    await user.click(await screen.findByRole('button', { name: 'Sign out Chrome on Windows' }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Sign out Chrome on Windows' }))
    expect(await within(dialog).findByText(/^We couldn’t reach Household\./)).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('signs out everywhere, this browser too, and says so first', async () => {
    const server = createServer()
    signedIn(server, [here, laptop], [tablet])
    server.on('DELETE /me/sessions', () => {
      // Every session has ended, the one that asked among them.
      server.on('GET /me', () => problem(401, 'unauthenticated'))
      return noContent()
    })
    const { user, router } = await devices(server)
    await user.click(await screen.findByRole('button', { name: 'Sign out everywhere' }))
    const dialog = screen.getByRole('dialog', { name: 'Sign out everywhere?' })
    expect(dialog).toHaveAccessibleDescription(
      expect.stringContaining(
        'Every browser and every phone and tablet is signed out, this browser too: you will sign in again here.',
      ),
    )
    expect(
      within(dialog)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Stay signed in', 'Sign out everywhere'])
    await user.click(within(dialog).getByRole('button', { name: 'Sign out everywhere' }))
    // The app asks who is signed in, is told nobody is, and goes to the way in.
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/sign-in')
    })
    expect(server.to('DELETE /me/sessions')).toHaveLength(1)
  })

  it('draws this browser alone as the one row it is, with nothing to set up', async () => {
    const server = createServer()
    signedIn(server, [here], [])
    await devices(server)
    expect(await screen.findByText('Only this browser')).toBeInTheDocument()
    expect(screen.getByText('You are signed in here and nowhere else.')).toBeInTheDocument()
    const rows = within(screen.getByRole('list', { name: 'Browsers' })).getAllByRole('listitem')
    expect(rows).toHaveLength(1)
    expect(within(rows[0] as HTMLElement).getByText('Firefox on Linux')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('says the list did not load and that nothing was signed out, and reads it again', async () => {
    const server = createServer()
    server.on('GET /me/sessions', () => Promise.reject(new TypeError('offline')))
    server.on('GET /me/devices', () => Response.json({ items: [] }))
    const { user } = await devices(server)
    expect(await screen.findByText('The device list did not load')).toBeInTheDocument()
    expect(screen.getByText('Nothing was signed out, and nothing was lost.')).toBeInTheDocument()
    signedIn(server, [here, laptop], [])
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('list', { name: 'Browsers' })).toBeInTheDocument()
  })

  it('renames a device', async () => {
    const server = createServer()
    signedIn(server, [here], [phone])
    server.on(`PATCH /me/devices/${phone.id}`, async (request) => {
      const { label } = (await request.json()) as { label: string }
      signedIn(server, [here], [{ ...phone, label }])
      return Response.json({ ...phone, label })
    })
    const { user } = await devices(server)
    await user.click(await screen.findByRole('button', { name: 'Rename Android phone or tablet' }))
    const sheet = screen.getByRole('dialog', { name: 'Rename Android phone or tablet' })
    const name = within(sheet).getByRole('textbox', { name: 'Name' })
    await user.type(name, ' Pixel 6 ')
    await user.click(within(sheet).getByRole('button', { name: 'Save name' }))
    await waitFor(async () => {
      expect(await server.body(`PATCH /me/devices/${phone.id}`)).toEqual({ label: 'Pixel 6' })
    })
    // The panel closes onto a row still named as it was: that the name was saved is said.
    expect(await screen.findByText('The device’s name is saved.')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Sign out Pixel 6' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('says a name could not be saved on its field, which takes the focus', async () => {
    const server = createServer()
    signedIn(server, [here], [phone])
    server.on(`PATCH /me/devices/${phone.id}`, () => Promise.reject(new TypeError('offline')))
    const { user } = await devices(server)
    await user.click(await screen.findByRole('button', { name: 'Rename Android phone or tablet' }))
    const sheet = screen.getByRole('dialog', { name: 'Rename Android phone or tablet' })
    const name = within(sheet).getByRole('textbox', { name: 'Name' })
    await user.type(name, 'Pixel 6')
    await user.click(within(sheet).getByRole('button', { name: 'Save name' }))
    await waitFor(() => {
      expect(name).toHaveAccessibleDescription(
        expect.stringContaining('We couldn’t reach Household.'),
      )
    })
    await waitFor(() => {
      expect(name).toHaveFocus()
    })
    expect(name).toHaveValue('Pixel 6')
  })
})

describe('a session’s name', () => {
  it('is the browser and the system, for the common ones', () => {
    expect(agentOf(agents.chromeWindows)).toEqual({ browser: 'chrome', system: 'windows' })
    expect(agentOf(agents.firefoxLinux)).toEqual({ browser: 'firefox', system: 'linux' })
    expect(agentOf(agents.safariMac)).toEqual({ browser: 'safari', system: 'macos' })
    expect(agentOf(agents.safariPhone)).toEqual({ browser: 'safari', system: 'iphone' })
    // Each of these says Chrome and Safari too, and is neither.
    expect(agentOf(agents.edgeWindows)).toEqual({ browser: 'edge', system: 'windows' })
    expect(agentOf(agents.samsung)).toEqual({ browser: 'samsung', system: 'android' })
    expect(agentOf(agents.operaMac)).toEqual({ browser: 'opera', system: 'macos' })
    expect(agentOf(agents.chromeOs)).toEqual({ browser: 'chrome', system: 'chromeos' })
  })

  it('is neither for what it cannot tell, and a generic word is drawn', async () => {
    expect(agentOf('curl/8.4.0')).toEqual({ browser: undefined, system: undefined })
    expect(agentOf(undefined)).toEqual({ browser: undefined, system: undefined })
    const server = createServer()
    signedIn(server, [here, { ...laptop, user_agent: 'curl/8.4.0' }], [])
    await devices(server)
    expect(await screen.findByRole('button', { name: 'Sign out A browser' })).toBeInTheDocument()
    // What was sent is drawn nowhere as it was sent.
    expect(document.body).not.toHaveTextContent('curl')
  })
})
