// Notifications (F-20): what this browser says and is asked, against stand-ins for the parts of
// a browser jsdom has none of, and the preferences as they are read, changed and refused.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { pushStandIns, serverKey, type Browser, type PushStandIns } from '../push/testing.ts'
import { bytesOf } from '../push/worker.ts'
import {
  chata,
  createServer,
  invalid,
  jana,
  noContent,
  open,
  tilcerovi,
  type Server,
} from './testing.tsx'

const title = 'Notifications'

/** The contract's NotificationPreferences, as the stand-in server keeps one. */
interface Held {
  household_id: string | null
  enabled: boolean
  categories: Record<'direct' | 'household' | 'reminders' | 'digest', boolean>
  quiet_hours: { from: string; to: string } | null
}

const everythingOn: Held = {
  household_id: null,
  enabled: true,
  categories: { direct: true, household: true, reminders: true, digest: true },
  quiet_hours: null,
}

/** A server that keeps the account's preferences, and one household's, as the contract merges them. */
function withPreferences(server: Server, start: Held = everythingOn) {
  const held = new Map<string, Held>([['', start]])
  const scope = (request: Request) => new URL(request.url).searchParams.get('household_id') ?? ''
  server.on('GET /me/notification-preferences', (request) => {
    const household = scope(request)
    return Response.json({
      ...(held.get(household) ?? held.get('') ?? start),
      household_id: household === '' ? null : household,
    })
  })
  server.on('PATCH /me/notification-preferences', async (request) => {
    const household = scope(request)
    const before = held.get(household) ?? held.get('') ?? start
    const change = (await request.json()) as Partial<Held>
    const after: Held = {
      ...before,
      ...change,
      categories: { ...before.categories, ...change.categories },
      household_id: household === '' ? null : household,
    }
    held.set(household, after)
    return Response.json(after)
  })
  server.on('GET /push/vapid-key', () => Response.json({ key: serverKey }))
  server.on('POST /push/subscriptions', () =>
    Response.json(
      { id: 's1', transport: 'web_push', created_at: '', last_seen_at: '' },
      { status: 201 },
    ),
  )
  server.on('DELETE /push/subscriptions', noContent)
  return held
}

let browser: PushStandIns | undefined

function withPush(says: Browser): PushStandIns {
  browser = pushStandIns(says)
  return browser
}

afterEach(() => {
  browser?.remove()
  browser = undefined
})

async function notifications(server: Server) {
  const opened = open('/account/notifications', server)
  await screen.findByRole('heading', { level: 1, name: title })
  await screen.findByRole('switch', { name: 'Notifications from Household' })
  return opened
}

describe('this browser', () => {
  it('is said to have no notifications where it has none, with the settings still drawn', async () => {
    const server = createServer()
    withPreferences(server)
    await notifications(server)
    expect(
      await screen.findByText(
        'This browser can’t show notifications from Household. The settings below still reach your other devices.',
      ),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('switch')).toHaveLength(6)
  })

  it('is asked by a press alone, never as the page loads, and then subscribed', async () => {
    const { notification, subscribe } = withPush({ permission: 'default', answer: 'granted' })
    const server = createServer()
    withPreferences(server)
    const { user } = await notifications(server)
    const turnOn = await screen.findByRole('button', {
      name: 'Turn on notifications in this browser',
    })
    expect(notification.requestPermission).not.toHaveBeenCalled()
    expect(server.to('POST /push/subscriptions')).toHaveLength(0)

    await user.click(turnOn)
    expect(notification.requestPermission).toHaveBeenCalledTimes(1)
    expect(
      await screen.findByText(
        'This browser shows notifications from Household while you are signed in here.',
      ),
    ).toBeInTheDocument()
    expect(subscribe).toHaveBeenCalledTimes(1)
    expect(await server.body('POST /push/subscriptions')).toMatchObject({ transport: 'web_push' })
    expect(screen.getByRole('button', { name: 'Turn off in this browser' })).toBeInTheDocument()
  })

  it('is said to be blocking them once the member refused, with where to allow them', async () => {
    withPush({ permission: 'default', answer: 'denied' })
    const server = createServer()
    withPreferences(server)
    const { user } = await notifications(server)
    await user.click(
      await screen.findByRole('button', { name: 'Turn on notifications in this browser' }),
    )
    expect(await screen.findByText('This browser is blocking notifications')).toBeInTheDocument()
    expect(
      screen.getByText(
        /so the settings below reach your other devices only\. To allow them, open this site’s settings in the browser/,
      ),
    ).toBeInTheDocument()
    // Nothing is offered that could only fail, and the categories are there to be believed.
    expect(
      screen.queryByRole('button', { name: 'Turn on notifications in this browser' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'The weekly digest' })).toBeInTheDocument()
    expect(server.to('POST /push/subscriptions')).toHaveLength(0)
  })

  it('is turned off here, at the server and in the browser', async () => {
    const { unsubscribed } = withPush({
      permission: 'granted',
      subscribedUnder: bytesOf(serverKey),
    })
    const server = createServer()
    withPreferences(server)
    const { user } = await notifications(server)
    await user.click(await screen.findByRole('button', { name: 'Turn off in this browser' }))
    expect(
      await screen.findByText('This browser allows notifications, and they are turned off here.'),
    ).toBeInTheDocument()
    expect(server.to('DELETE /push/subscriptions')).toHaveLength(1)
    expect(unsubscribed()).toBe(1)
    // Turned on again without the browser's question, which it has answered.
    expect(
      screen.getByRole('button', { name: 'Turn on notifications in this browser' }),
    ).toBeInTheDocument()
  })

  it('says a browser that could not be subscribed could not be', async () => {
    withPush({ permission: 'granted', refuses: true })
    const server = createServer()
    withPreferences(server)
    const { user } = await notifications(server)
    await user.click(
      await screen.findByRole('button', { name: 'Turn on notifications in this browser' }),
    )
    expect(
      await screen.findByText(
        'This browser couldn’t be subscribed to notifications. Nothing else was changed.',
      ),
    ).toBeInTheDocument()
  })
})

describe('the preferences', () => {
  it('are the account’s defaults, with a second line for each category', async () => {
    const server = createServer()
    withPreferences(server)
    await notifications(server)
    const [read] = server.to('GET /me/notification-preferences')
    expect(new URL(read?.url ?? '').searchParams.has('household_id')).toBe(false)
    for (const [label, says] of [
      [
        'Someone messages or mentions me',
        'Assigned you something, mentioned you, asked you to take a turn, messaged you.',
      ],
      ['Something happens in the household', 'Something changed that you chose to be told about.'],
      [
        'Reminders I subscribed to',
        'A date you asked to be reminded of, such as the bins or a passport that expires.',
      ],
      ['The weekly digest', 'A summary on a schedule, such as the week ahead on Sunday evening.'],
    ] as const) {
      const control = screen.getByRole('switch', { name: label })
      expect(control).toBeChecked()
      expect(control).toHaveAccessibleDescription(says)
    }
    // No scope to choose between, for a member in no household.
    expect(screen.queryByRole('combobox', { name: 'Settings for' })).not.toBeInTheDocument()
  })

  it('are saved as they change, one member of the merge at a time', async () => {
    const server = createServer()
    withPreferences(server)
    const { user } = await notifications(server)
    await user.click(screen.getByRole('switch', { name: 'The weekly digest' }))
    await waitFor(async () => {
      expect(await server.body('PATCH /me/notification-preferences')).toEqual({
        categories: { digest: false },
      })
    })
    expect(screen.getByRole('switch', { name: 'The weekly digest' })).not.toBeChecked()

    await user.click(screen.getByRole('switch', { name: 'Notifications from Household' }))
    await waitFor(async () => {
      expect(await server.body('PATCH /me/notification-preferences')).toEqual({ enabled: false })
    })
    expect(
      await screen.findByText('Nothing reaches your devices. Everything still shows in the app.'),
    ).toBeInTheDocument()
    // The categories stay drawn and stay the member's to change.
    expect(screen.getByRole('switch', { name: 'Reminders I subscribed to' })).toBeEnabled()
  })

  it('are one household’s own from its first change, which the screen says', async () => {
    const server = createServer()
    server.on('GET /households', () => Response.json({ items: [tilcerovi, chata] }))
    withPreferences(server)
    const { user } = await notifications(server)
    const scope = await screen.findByRole('combobox', { name: 'Settings for' })
    expect(
      within(scope)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['All households (my defaults)', 'Tilcerovi', 'Chata Vysočina'])
    await user.selectOptions(scope, 'Chata Vysočina')
    expect(
      await screen.findByText(
        'Chata Vysočina follows your defaults until you change something here. From then on its settings are its own, and a later change to your defaults no longer reaches it.',
      ),
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(
        new URL(server.to('GET /me/notification-preferences').at(-1)?.url ?? '').searchParams.get(
          'household_id',
        ),
      ).toBe(chata.id)
    })
    await user.click(
      await screen.findByRole('switch', { name: 'Something happens in the household' }),
    )
    await waitFor(() => {
      expect(server.to('PATCH /me/notification-preferences')).toHaveLength(1)
    })
    const [sent] = server.to('PATCH /me/notification-preferences')
    expect(new URL(sent?.url ?? '').searchParams.get('household_id')).toBe(chata.id)
    expect(await server.body('PATCH /me/notification-preferences')).toEqual({
      categories: { household: false },
    })

    // The defaults were not touched by it.
    await user.selectOptions(scope, 'All households (my defaults)')
    expect(
      await screen.findByRole('switch', { name: 'Something happens in the household' }),
    ).toBeChecked()
  })

  it('hold quiet hours between two different times, saved when a time is left', async () => {
    const server = createServer()
    withPreferences(server)
    const { user } = await notifications(server)
    const quiet = screen.getByRole('switch', { name: 'Hold notifications during quiet hours' })
    expect(quiet).not.toBeChecked()
    expect(screen.queryByLabelText('From')).not.toBeInTheDocument()
    // The member's own clock is named, since the account names one.
    expect(quiet).toHaveAccessibleDescription(
      expect.stringContaining('They are read on your own clock, Europe/Prague.'),
    )

    await user.click(quiet)
    await waitFor(async () => {
      expect(await server.body('PATCH /me/notification-preferences')).toEqual({
        quiet_hours: { from: '22:00', to: '07:00' },
      })
    })
    const from = await screen.findByLabelText('From')
    const until = screen.getByLabelText('Until')
    expect(from).toHaveValue('22:00')
    expect(until).toHaveValue('07:00')

    fireEvent.change(from, { target: { value: '23:30' } })
    // Nothing is sent while it is being typed.
    expect(server.to('PATCH /me/notification-preferences')).toHaveLength(1)
    fireEvent.blur(from)
    await waitFor(async () => {
      expect(await server.body('PATCH /me/notification-preferences')).toEqual({
        quiet_hours: { from: '23:30', to: '07:00' },
      })
    })

    // The same time twice is no window: said under the two as it comes to be so, and not sent.
    fireEvent.change(until, { target: { value: '23:30' } })
    fireEvent.blur(until)
    expect(screen.getByRole('alert')).toHaveTextContent('Choose two different times.')
    expect(server.to('PATCH /me/notification-preferences')).toHaveLength(2)

    await user.click(screen.getByRole('switch', { name: 'Hold notifications during quiet hours' }))
    await waitFor(async () => {
      expect(await server.body('PATCH /me/notification-preferences')).toEqual({ quiet_hours: null })
    })
    await waitFor(() => {
      expect(screen.queryByLabelText('From')).not.toBeInTheDocument()
    })
  })

  it('say whose clock quiet hours are read on for an account with no timezone', async () => {
    const server = createServer({ ...jana, timezone: null })
    server.on('GET /households', () => Response.json({ items: [chata] }))
    withPreferences(server)
    const { user } = await notifications(server)
    expect(
      screen.getByRole('switch', { name: 'Hold notifications during quiet hours' }),
    ).toHaveAccessibleDescription(expect.stringContaining('on each household’s clock'))
    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Settings for' }),
      'Chata Vysočina',
    )
    await waitFor(() => {
      expect(
        screen.getByRole('switch', { name: 'Hold notifications during quiet hours' }),
      ).toHaveAccessibleDescription(expect.stringContaining('on the household’s clock'))
    })
  })

  it('put a control back when the server refuses the change, and say why', async () => {
    const server = createServer()
    withPreferences(server)
    const { user } = await notifications(server)
    server.on('PATCH /me/notification-preferences', () => invalid('/categories/digest'))
    const digest = screen.getByRole('switch', { name: 'The weekly digest' })
    await user.click(digest)
    expect(await screen.findByText('Not saved')).toBeInTheDocument()
    expect(
      screen.getByText('That change wasn’t accepted, and the setting is as it was.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'The weekly digest' })).toBeChecked()
    // Put away, the strip goes.
    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText('Not saved')).not.toBeInTheDocument()
  })

  it('say a change could not reach the server, and put it back', async () => {
    const server = createServer()
    withPreferences(server)
    const { user } = await notifications(server)
    server.on('PATCH /me/notification-preferences', () => Promise.reject(new TypeError('offline')))
    await user.click(screen.getByRole('switch', { name: 'Notifications from Household' }))
    expect(await screen.findByText(/^We couldn’t reach Household\./)).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Notifications from Household' })).toBeChecked()
  })

  it('say they did not load, and that nothing changed', async () => {
    const server = createServer()
    server.on('GET /me/notification-preferences', () => Promise.reject(new TypeError('offline')))
    const { user } = open('/account/notifications', server)
    expect(
      await screen.findByText(
        'Your notification settings did not load. What you are told about has not changed.',
      ),
    ).toBeInTheDocument()
    withPreferences(server)
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(
      await screen.findByRole('switch', { name: 'Notifications from Household' }),
    ).toBeInTheDocument()
  })

  it('say that email is a small fixed set that arrives whatever is off', async () => {
    const server = createServer()
    withPreferences(server)
    await notifications(server)
    expect(
      screen.getByText(
        'Email is a small, fixed set: security, billing, invitations, and being removed from a household. It arrives even with everything here off, and quiet hours do not hold it.',
      ),
    ).toBeInTheDocument()
  })
})
