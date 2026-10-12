// Notifications (F-20): what this browser says and is asked, against stand-ins for the parts of
// a browser jsdom has none of, and the preferences as they are read, changed and refused.
import { defaultScheduler, notifyManager } from '@tanstack/react-query'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
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
  untold,
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
  notifyManager.setScheduler(defaultScheduler)
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
    // What the browser says as the screen opens is read in its place: nothing was pressed.
    const said = screen.getByText(
      'Notifications are not turned on in this browser. It asks you first.',
    )
    expect(said).not.toHaveAttribute('role')

    await user.click(turnOn)
    expect(notification.requestPermission).toHaveBeenCalledTimes(1)
    // What the press came to is said: the sentence that was there is a status, and its words
    // change where it stands, which a sentence that arrived in its place would not be.
    await waitFor(() => {
      expect(said).toHaveTextContent(
        'This browser shows notifications from Household while you are signed in here.',
      )
    })
    expect(said).toHaveAttribute('role', 'status')
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
    const blocking = await screen.findByText('This browser is blocking notifications')
    // What the press came to, and the control that was pressed is gone: said as it arrives.
    expect(blocking.closest('[role="status"]')).not.toBeNull()
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

  it('reads in its place that it was blocking them before the screen opened', async () => {
    withPush({ permission: 'denied' })
    const server = createServer()
    withPreferences(server)
    await notifications(server)
    const blocking = await screen.findByText('This browser is blocking notifications')
    // Nothing was pressed here: it is no answer to announce.
    expect(blocking.closest('[role="status"], [role="alert"]')).toBeNull()
  })

  it('is turned off here, at the server and in the browser', async () => {
    const { unsubscribed } = withPush({
      permission: 'granted',
      subscribedUnder: bytesOf(serverKey),
    })
    const server = createServer()
    withPreferences(server)
    const { user } = await notifications(server)
    const turnOff = await screen.findByRole('button', { name: 'Turn off in this browser' })
    const said = screen.getByText(
      'This browser shows notifications from Household while you are signed in here.',
    )
    await user.click(turnOff)
    // Said as it changes, by the sentence that was there, as turning them on is.
    await waitFor(() => {
      expect(said).toHaveTextContent(
        'This browser allows notifications, and they are turned off here.',
      )
    })
    expect(said).toHaveAttribute('role', 'status')
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

  // A press is answered in the press. React puts a switch back, as its event ends, to what was
  // last drawn, and what is kept is written after that and told to the screen later still:
  // drawn from that alone, a pressed switch stood as it was for a frame.
  it('are drawn as chosen in the press itself, before the query client tells the screen of the change', async () => {
    const server = createServer()
    withPreferences(server)
    await notifications(server)
    const digest = screen.getByRole('switch', { name: 'The weekly digest' })
    const tell = untold()
    fireEvent.click(digest)
    expect(digest).not.toBeChecked()
    // Nor is it put back once the change is on its way, and what is kept holds it.
    await waitFor(() => {
      expect(server.to('PATCH /me/notification-preferences')).toHaveLength(1)
    })
    expect(digest).not.toBeChecked()
    expect(screen.getByRole('switch', { name: 'Reminders I subscribed to' })).toBeChecked()
    // And told, the screen draws what is kept, which is the same.
    tell()
    expect(await screen.findByRole('switch', { name: 'The weekly digest' })).not.toBeChecked()
    expect(screen.queryByText('Not saved')).not.toBeInTheDocument()
  })

  // A switch sends what its press made of what it showed. Put back for a frame, a switch
  // pressed again in that frame was pressed as it had stood, and the second press, which was
  // to undo the first, sent the first again.
  it('take a second press on a switch as the first left it, which the screen was not yet told of', async () => {
    const server = createServer()
    withPreferences(server)
    await notifications(server)
    const digest = screen.getByRole('switch', { name: 'The weekly digest' })
    const tell = untold()
    fireEvent.click(digest)
    fireEvent.click(digest)
    expect(digest).toBeChecked()
    await waitFor(() => {
      expect(server.to('PATCH /me/notification-preferences')).toHaveLength(2)
    })
    expect(
      await Promise.all(
        server.to('PATCH /me/notification-preferences').map((request) => request.clone().json()),
      ),
    ).toEqual([{ categories: { digest: false } }, { categories: { digest: true } }])
    expect(digest).toBeChecked()
    tell()
    expect(await screen.findByRole('switch', { name: 'The weekly digest' })).toBeChecked()
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

  // Each is put back to what the server last said it holds. Put back to what was kept as it
  // was made, the second of two went back to the first one's choice, which the server never
  // took: a switch left drawn as saved, and with no connection nothing reads the server again
  // to say otherwise.
  it('put two changes that could not reach the server back to what it holds', async () => {
    const server = createServer()
    withPreferences(server)
    const { user } = await notifications(server)
    // Neither is answered until both are on their way, and then in the order they were made.
    let lose: () => void = () => undefined
    const lost = new Promise<void>((resolve) => {
      lose = resolve
    })
    server.on('PATCH /me/notification-preferences', async () => {
      await lost
      throw new TypeError('offline')
    })
    server.on('GET /me/notification-preferences', () => Promise.reject(new TypeError('offline')))
    await user.click(screen.getByRole('switch', { name: 'The weekly digest' }))
    await user.click(screen.getByRole('switch', { name: 'Reminders I subscribed to' }))
    await waitFor(() => {
      expect(server.to('PATCH /me/notification-preferences')).toHaveLength(2)
    })
    expect(screen.getByRole('switch', { name: 'The weekly digest' })).not.toBeChecked()
    expect(screen.getByRole('switch', { name: 'Reminders I subscribed to' })).not.toBeChecked()
    lose()
    expect(await screen.findByText(/^We couldn’t reach Household\./)).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: 'Reminders I subscribed to' })).toBeChecked()
    })
    expect(screen.getByRole('switch', { name: 'The weekly digest' })).toBeChecked()
    // And it is read again once neither is on its way, which here fails as they did.
    await waitFor(() => {
      expect(server.to('GET /me/notification-preferences').length).toBeGreaterThan(1)
    })
    expect(screen.getByRole('switch', { name: 'The weekly digest' })).toBeChecked()
  })

  // A read on its way when a switch is pressed was asked before the change, and answers with
  // what the server held then. Drawn, the switch went back under its member, and stayed so
  // where that answer came after the change's own.
  it('are not drawn over by the answer to a read asked before the press', async () => {
    const server = createServer()
    withPreferences(server)
    const { user } = await notifications(server)
    // The page is looked at again and reads again: this read is not answered yet.
    let answer: () => void = () => undefined
    server.on(
      'GET /me/notification-preferences',
      () =>
        new Promise<Response>((resolve) => {
          answer = () => {
            resolve(Response.json(everythingOn))
          }
        }),
    )
    act(() => {
      window.dispatchEvent(new Event('visibilitychange'))
    })
    await waitFor(() => {
      expect(server.to('GET /me/notification-preferences')).toHaveLength(2)
    })
    await user.click(screen.getByRole('switch', { name: 'The weekly digest' }))
    await waitFor(() => {
      expect(server.to('PATCH /me/notification-preferences')).toHaveLength(1)
    })
    expect(screen.getByRole('switch', { name: 'The weekly digest' })).not.toBeChecked()
    // Answered now, with the digest on, as the server held it when the read was asked.
    answer()
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)))
    expect(screen.getByRole('switch', { name: 'The weekly digest' })).not.toBeChecked()
    expect(screen.queryByText('Not saved')).not.toBeInTheDocument()
  })

  // A refused change is no reason to read the server while another is still on its way: that
  // read would be answered as the other lands, and drawn over it. It is read once none is.
  it('are read again after a refusal once no change is on its way, and not before', async () => {
    const server = createServer()
    const held = withPreferences(server)
    const { user } = await notifications(server)
    // Neither is answered until the test says: the first is refused, the second taken.
    const answers: (() => void)[] = []
    server.on(
      'PATCH /me/notification-preferences',
      () =>
        new Promise<Response>((resolve) => {
          const refused = answers.length === 0
          answers.push(() => {
            if (refused) {
              resolve(invalid('/categories/digest'))
              return
            }
            const taken: Held = {
              ...everythingOn,
              categories: { ...everythingOn.categories, reminders: false },
            }
            held.set('', taken)
            resolve(Response.json(taken))
          })
        }),
    )
    await user.click(screen.getByRole('switch', { name: 'The weekly digest' }))
    await user.click(screen.getByRole('switch', { name: 'Reminders I subscribed to' }))
    await waitFor(() => {
      expect(answers).toHaveLength(2)
    })
    answers[0]?.()
    // Put back, with the other still on its way and nothing read meanwhile.
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: 'The weekly digest' })).toBeChecked()
    })
    expect(server.to('GET /me/notification-preferences')).toHaveLength(1)
    // And the other stands as it was chosen: its own change is on its way still, and what
    // the first was put back to is not what was chosen since.
    expect(screen.getByRole('switch', { name: 'Reminders I subscribed to' })).not.toBeChecked()
    answers[1]?.()
    await waitFor(() => {
      expect(server.to('GET /me/notification-preferences')).toHaveLength(2)
    })
    expect(await screen.findByText('Not saved')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'The weekly digest' })).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Reminders I subscribed to' })).not.toBeChecked()
  })

  /**
   * A server that takes each change as it is asked, in that order, and answers none until the
   * test says: `answers[n]` answers the change made n-th with what the server held once it had
   * taken it.
   */
  function takenInOrder(server: Server, held: Map<string, Held>): (() => void)[] {
    const answers: (() => void)[] = []
    server.on('PATCH /me/notification-preferences', async (request) => {
      const before = held.get('') ?? everythingOn
      const change = (await request.json()) as Partial<Held>
      const after: Held = {
        ...before,
        ...change,
        categories: { ...before.categories, ...change.categories },
      }
      held.set('', after)
      return new Promise<Response>((resolve) => {
        answers.push(() => {
          resolve(Response.json(after))
        })
      })
    })
    return answers
  }

  // The answer to a change says what the server held once it had taken that one: under a
  // change made since and still on its way it holds nothing of that one's choice. Drawn as it
  // came, the later switch went back under its member until its own answer.
  it('keep a later change drawn as chosen while an earlier one is answered', async () => {
    const server = createServer()
    const held = withPreferences(server)
    const { user } = await notifications(server)
    const answers = takenInOrder(server, held)
    await user.click(screen.getByRole('switch', { name: 'The weekly digest' }))
    await user.click(screen.getByRole('switch', { name: 'Reminders I subscribed to' }))
    await waitFor(() => {
      expect(answers).toHaveLength(2)
    })
    answers[0]?.()
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)))
    expect(screen.getByRole('switch', { name: 'The weekly digest' })).not.toBeChecked()
    expect(screen.getByRole('switch', { name: 'Reminders I subscribed to' })).not.toBeChecked()
    expect(server.to('GET /me/notification-preferences')).toHaveLength(1)
    answers[1]?.()
    // Both answered: what the server holds now is read, once.
    await waitFor(() => {
      expect(server.to('GET /me/notification-preferences')).toHaveLength(2)
    })
    expect(screen.getByRole('switch', { name: 'The weekly digest' })).not.toBeChecked()
    expect(screen.getByRole('switch', { name: 'Reminders I subscribed to' })).not.toBeChecked()
    expect(screen.queryByText('Not saved')).not.toBeInTheDocument()
  })

  // Two changes sent side by side are answered in whichever order their answers come, which is
  // not always the order the server took them in: the answer that comes last may be the earlier
  // one's, which holds nothing of the later change. So what the server holds is read once both
  // are answered.
  it('are as the server holds them where two answers came the other way round', async () => {
    const server = createServer()
    const held = withPreferences(server)
    const { user } = await notifications(server)
    const answers = takenInOrder(server, held)
    await user.click(screen.getByRole('switch', { name: 'The weekly digest' }))
    await user.click(screen.getByRole('switch', { name: 'Reminders I subscribed to' }))
    await waitFor(() => {
      expect(answers).toHaveLength(2)
    })
    answers[1]?.()
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)))
    answers[0]?.()
    await waitFor(() => {
      expect(server.to('GET /me/notification-preferences')).toHaveLength(2)
    })
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)))
    expect(screen.getByRole('switch', { name: 'The weekly digest' })).not.toBeChecked()
    expect(screen.getByRole('switch', { name: 'Reminders I subscribed to' })).not.toBeChecked()
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

  it('say the member’s households could not be read where they could not, the defaults still drawn', async () => {
    const server = createServer()
    server.on('GET /households', () => Promise.reject(new TypeError('offline')))
    withPreferences(server)
    const { user } = await notifications(server)
    // Said as it arrives, where the control that chooses a household would be: with nothing
    // said, the screen would read as that of a member in no household.
    const unread = await screen.findByRole('alert')
    expect(unread).toHaveTextContent('Your households could not be read')
    expect(screen.queryByRole('combobox', { name: 'Settings for' })).not.toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Notifications from Household' })).toBeChecked()
    server.on('GET /households', () => Response.json({ items: [tilcerovi, chata] }))
    await user.click(within(unread).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('combobox', { name: 'Settings for' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
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
