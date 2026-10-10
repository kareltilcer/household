// The privacy centre (A-34): the six rights and the one way of each, a member's own exports, the
// households whose changes they may stop, the two consents and what changing one asks of the
// server, and the authority of each country they are in.
import { onlineManager } from '@tanstack/react-query'
import { act, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { inHousehold, paths } from '../app/paths.ts'
import {
  accountOf,
  adam,
  createServer,
  home,
  jana,
  petr,
  problem,
  tilcerovi,
  type HouseholdServer,
} from '../household/testing.tsx'
import { leaveFor } from './leave.ts'
import { archive, exportId, job, open, ready } from './testing.tsx'

// No test navigates: what the page handed the browser is read off this.
vi.mock('./leave.ts', () => ({ leaveFor: vi.fn() }))

afterEach(() => {
  onlineManager.setOnline(true)
  vi.mocked(leaveFor).mockClear()
  vi.restoreAllMocks()
})

const at = paths.accountPrivacy.path
const chata = '0190a000-0000-7000-8000-0000000000a2'

/** A server that knows the account's exports and its consents: none, and neither given. */
function serving(me = jana): HouseholdServer {
  const server = createServer(me)
  server.on('GET /me/exports', () => Response.json({ items: [] }))
  server.on('GET /me/consents', () => Response.json({ analytics: false, marketing_email: false }))
  return server
}

/** Has `server` list `households` as its member's, each answering at its own address. */
function inHouseholds(
  server: HouseholdServer,
  households: readonly {
    readonly id: string
    readonly name: string
    readonly country?: string
    readonly role?: 'owner' | 'member'
    readonly suspended?: boolean
  }[],
) {
  server.on('GET /households', () =>
    Response.json({
      items: households.map((each) => ({
        id: each.id,
        name: each.name,
        my_role: each.role ?? 'owner',
        member_count: 2,
        entitlement:
          each.suspended === true
            ? { state: 'suspended', can_write: false, can_upload: false }
            : { state: 'active', can_write: true, can_upload: true },
      })),
    }),
  )
  for (const each of households) {
    server.on(`GET /households/${each.id}`, () =>
      each.suspended === true
        ? problem(404, 'not_found')
        : Response.json({ ...tilcerovi, id: each.id, name: each.name, country: each.country }),
    )
  }
}

async function centre(server: HouseholdServer = serving()) {
  const opened = open(at, server)
  await screen.findByRole('heading', { level: 1, name: 'Your data' })
  return opened
}

/** A right's section, by the plain words it is named in. */
const right = (name: string) => screen.getByRole('region', { name })

/**
 * The place of its own that the body of `section` gives the focus a control left behind: what
 * stands around `drawn`, something the body draws, inside the section.
 */
function placeIn(section: HTMLElement, drawn: HTMLElement): HTMLElement {
  const place = drawn.closest<HTMLElement>('[tabindex="-1"]')
  if (place === null || !section.contains(place)) {
    throw new Error('the body has no place of its own')
  }
  return place
}

/** The focus is on `place`, and not dropped to the page. */
async function focusIsOn(place: HTMLElement) {
  await waitFor(() => {
    expect(document.activeElement).toBe(place)
  })
}

const copy = 'Get a copy of everything'
const stopping = 'Stop all changes for now'
const consenting = 'Choose what you agree to'
const complaining = 'Complain to a regulator'

describe('the privacy centre', () => {
  it('is titled for what it shows, and says that each right is done here', async () => {
    await centre()
    await waitFor(() => {
      expect(document.title).toBe('Your data · Household')
    })
    expect(
      screen.getByText(
        // Not *with nobody to ask*: one of them is an owner's, and a member asks an owner.
        'Six rights over your data. Each has its way here, and none needs a request to Household.',
      ),
    ).toBeInTheDocument()
  })

  it('names the six rights in plain words, each with the regulation’s own term under it', async () => {
    await centre()
    const terms = [
      [copy, 'Access and portability'],
      ['Correct something', 'Rectification'],
      ['Delete your account', 'Erasure'],
      [stopping, 'Restriction of processing'],
      [consenting, 'Objection'],
      [complaining, 'Complaint'],
    ] as const
    expect(screen.getAllByRole('heading', { level: 2 }).map((each) => each.textContent)).toEqual(
      terms.map(([name]) => name),
    )
    for (const [name, term] of terms) {
      expect(within(right(name)).getByText(term)).toBeInTheDocument()
    }
  })

  it('leads to where something is corrected and to where the account is deleted, each with its time', async () => {
    await centre()
    const correcting = right('Correct something')
    expect(within(correcting).getByRole('link', { name: 'Your account' })).toHaveAttribute(
      'href',
      paths.account.path,
    )
    expect(within(correcting).getByText('Takes effect at once.')).toBeInTheDocument()
    const deleting = right('Delete your account')
    expect(within(deleting).getByRole('link', { name: 'Delete your account' })).toHaveAttribute(
      'href',
      paths.accountDelete.path,
    )
    expect(
      within(deleting).getByText('Thirty days in which you can cancel, then for good.'),
    ).toBeInTheDocument()
  })

  // A child profile deletes nothing and consents to nothing: neither is offered it.
  it('offers a child profile no deleting and no consent, and says why of each', async () => {
    const server = serving(accountOf(adam))
    await centre(server)
    const deleting = right('Delete your account')
    expect(within(deleting).queryByRole('link')).not.toBeInTheDocument()
    expect(
      within(deleting).getByText(
        'A child profile is removed by an owner of its household, from the household’s members.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    expect(
      within(right(consenting)).getByText(
        'A child profile is asked for neither: nothing is collected from it for statistics, and no news is sent to it.',
      ),
    ).toBeInTheDocument()
    // The server would refuse it: nothing is asked.
    expect(server.to('GET /me/consents')).toHaveLength(0)
  })
})

describe('a copy of everything that is a member’s own', () => {
  const ask = 'Export my data'

  it('teaches what it is where none was asked for, and asks for one from the account’s own address', async () => {
    const server = serving()
    server.on('POST /me/exports', () => {
      const asked = job({ scope: 'user', household_id: null })
      server.on('GET /me/exports', () => Response.json({ items: [asked] }))
      return Response.json(asked, { status: 202 })
    })
    const { user } = await centre(server)
    const section = right(copy)
    expect(
      await within(section).findByText(
        'No export yet. An export is one ZIP of what is yours, to keep or to take elsewhere.',
      ),
    ).toBeInTheDocument()
    await user.click(within(section).getByRole('button', { name: ask }))
    expect(
      await screen.findByText('The export was asked for. It is usually ready within a day.'),
    ).toBeInTheDocument()
    expect(server.to('POST /me/exports')).toHaveLength(1)
    expect(await within(section).findByText('Waiting to be made')).toBeInTheDocument()
    expect(within(section).queryByRole('button', { name: ask })).not.toBeInTheDocument()
    // The account's list, and no household's.
    expect(server.to(`POST /households/${home}/exports`)).toHaveLength(0)
    expect(server.to(`GET /households/${home}/exports`)).toHaveLength(0)
  })

  it('says what is in a member’s own archive, and downloads it by the account’s own address', async () => {
    const own = ready({
      scope: 'user',
      household_id: null,
      contents: ['account.json', 'households/', 'manifest.json'],
    })
    const server = serving()
    server.on('GET /me/exports', () => Response.json({ items: [own] }))
    server.on(`GET /me/exports/${exportId(1)}`, () => Response.json(own))
    const { user } = await centre(server)
    const section = right(copy)
    await user.click(await within(section).findByText('What is in it'))
    expect(within(section).getByText('account.json').closest('li')).toHaveTextContent(
      'What your account keeps outside any household',
    )
    expect(within(section).getByText('households/').closest('li')).toHaveTextContent(
      'Each household’s part, in a folder of its own',
    )
    // In the member's own zone.
    await user.click(
      within(section).getByRole('button', {
        name: 'Download the export asked for on Sep 9, 2026, 7:02 PM',
      }),
    )
    await waitFor(() => {
      expect(leaveFor).toHaveBeenCalledWith(archive)
    })
    expect(server.to(`GET /me/exports/${exportId(1)}`)).toHaveLength(1)
  })

  // A child profile has no address for the email that says one is ready.
  it('lets a child profile ask, and tells it to look here', async () => {
    await centre(serving(accountOf(adam)))
    const section = right(copy)
    expect(await within(section).findByRole('button', { name: ask })).toBeInTheDocument()
    expect(within(section).getByText(/No email will come/)).toBeInTheDocument()
  })

  it('says that a whole household’s copy is its owners’ to take', async () => {
    await centre()
    expect(
      within(right(copy)).getByText(
        'A copy of a whole household is for its owners, who take it from the household’s settings.',
      ),
    ).toBeInTheDocument()
  })
})

describe('stopping all changes, from an account', () => {
  it('leads an owner to the data of each household they own', async () => {
    const server = serving()
    inHouseholds(server, [
      { id: home, name: 'Tilcerovi', country: 'CZ' },
      { id: chata, name: 'Chata Vysočina', country: 'CZ', role: 'member' },
    ])
    await centre(server)
    const section = right(stopping)
    const way = await within(section).findByRole('link', { name: 'Open the data of Tilcerovi' })
    expect(way).toHaveAttribute('href', inHousehold.data(home))
    // One they are a member of is not theirs to stop.
    expect(within(section).getAllByRole('link')).toHaveLength(1)
    expect(within(section).getByText('Takes effect at once.')).toBeInTheDocument()
  })

  it('says whose it is to a member who owns no household', async () => {
    const server = serving(accountOf(petr))
    await centre(server)
    const section = right(stopping)
    expect(
      await within(section).findByText(
        'This is for a household’s owners, and you own no household. In one you are in, ask an owner.',
      ),
    ).toBeInTheDocument()
    expect(within(section).queryByRole('link')).not.toBeInTheDocument()
  })

  // A suspended household opens nothing (D-115), its data among it.
  it('passes over a household that is suspended', async () => {
    const server = serving()
    inHouseholds(server, [
      { id: home, name: 'Tilcerovi', suspended: true },
      { id: chata, name: 'Chata Vysočina', country: 'CZ' },
    ])
    await centre(server)
    const section = right(stopping)
    expect(
      await within(section).findByRole('link', { name: 'Open the data of Chata Vysočina' }),
    ).toBeInTheDocument()
    expect(within(section).getAllByRole('link')).toHaveLength(1)
    // And the page says once that it is left out, of every part of it.
    expect(
      screen.getByText(
        'A household of yours is suspended. Nothing of it can be read or exported while that lasts, so this page leaves it out.',
      ),
    ).toBeInTheDocument()
  })

  // Its owner is not told that they own no household, nor its member that they are in none.
  it('does not tell the owner of a suspended household, and of no other, that they own none', async () => {
    const server = serving()
    inHouseholds(server, [{ id: home, name: 'Tilcerovi', suspended: true }])
    await centre(server)
    expect(await screen.findByText(/^A household of yours is suspended\./)).toBeInTheDocument()
    const section = right(stopping)
    expect(within(section).queryByText(/you own no household/)).not.toBeInTheDocument()
    expect(within(section).queryByRole('link')).not.toBeInTheDocument()
    // Whose authority it is cannot be read off a household that answers nothing: it is asked.
    expect(
      await screen.findByText(
        'No household you are in says your country here. Choose the one you live in.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/You are in no household/)).not.toBeInTheDocument()
  })

  it('says the households could not be read, and reads them again', async () => {
    const server = serving()
    server.on('GET /households', () => Promise.reject(new TypeError('offline')))
    const { user } = await centre(server)
    const section = right(stopping)
    expect(
      await within(section).findByText('Your households could not be read'),
    ).toBeInTheDocument()
    server.on('GET /households', () =>
      Response.json({ items: [{ id: home, name: 'Tilcerovi', my_role: 'owner' }] }),
    )
    await user.click(within(section).getByRole('button', { name: 'Try again' }))
    const way = await within(section).findByRole('link', { name: 'Open the data of Tilcerovi' })
    // *Try again* left with the sentence it stood in: the focus it held is on this body's own
    // place, and not dropped to the page.
    await focusIsOn(placeIn(section, way))
  })
})

describe('the two consents', () => {
  const statistics = 'Allow usage statistics'
  const news = 'Email me news about Household'

  /** A server that keeps what it is sent, as the server does: both, replaced together. */
  function keeping(): HouseholdServer {
    const server = serving()
    let kept = { analytics: false, marketing_email: false }
    server.on('GET /me/consents', () => Response.json(kept))
    server.on('PUT /me/consents', async (request) => {
      kept = (await request.json()) as typeof kept
      return Response.json({ ...kept, updated_at: '2026-09-09T17:00:00Z' })
    })
    return server
  }

  it('are both off until their member turns one on, and say what each is', async () => {
    await centre()
    const analytics = await screen.findByRole('switch', { name: statistics })
    expect(analytics).not.toBeChecked()
    expect(analytics).toHaveAccessibleDescription(
      expect.stringContaining(
        'Which screens are opened, which features are used, how long things take, and reports of crashes. Never anything you typed: no name, title, message, amount or file name.',
      ),
    )
    // The web app collects none yet: the switch records the choice, and claims no more.
    expect(analytics).toHaveAccessibleDescription(
      expect.stringContaining(
        'Household on the web collects none of this yet. The switch records your choice.',
      ),
    )
    const marketing = screen.getByRole('switch', { name: news })
    expect(marketing).not.toBeChecked()
    expect(marketing).toHaveAccessibleDescription(
      'Occasional news of the product, to your account’s address. Every such email carries a link that stops them.',
    )
    expect(
      within(right(consenting)).getByText(
        'Both are off unless you turn them on, and Household works the same either way.',
      ),
    ).toBeInTheDocument()
  })

  // The server replaces both with what it is sent: one left out would be withdrawn (D-142).
  it('send both each time one is changed, as the screen holds them', async () => {
    const server = keeping()
    const { user } = await centre(server)
    await user.click(await screen.findByRole('switch', { name: statistics }))
    await waitFor(() => {
      expect(server.to('PUT /me/consents')).toHaveLength(1)
    })
    expect(await server.body('PUT /me/consents')).toEqual({
      analytics: true,
      marketing_email: false,
    })
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: statistics })).toBeChecked()
    })

    await user.click(screen.getByRole('switch', { name: news }))
    await waitFor(() => {
      expect(server.to('PUT /me/consents')).toHaveLength(2)
    })
    expect(await server.body('PUT /me/consents')).toEqual({
      analytics: true,
      marketing_email: true,
    })
    // Declining is the same switch: as easy as agreeing.
    await user.click(screen.getByRole('switch', { name: statistics }))
    await waitFor(() => {
      expect(server.to('PUT /me/consents')).toHaveLength(3)
    })
    expect(await server.body('PUT /me/consents')).toEqual({
      analytics: false,
      marketing_email: true,
    })
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: statistics })).not.toBeChecked()
    })
    expect(screen.getByRole('switch', { name: news })).toBeChecked()
    // What the server holds is read once the change is answered.
    await waitFor(() => {
      expect(server.to('GET /me/consents').length).toBeGreaterThan(1)
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  // Sent side by side, which of two the server took last is not the order their answers come in.
  it('draw the answer to the change made last, and then what the server holds', async () => {
    const server = serving()
    const answers: ((response: Response) => void)[] = []
    server.on(
      'PUT /me/consents',
      () =>
        new Promise<Response>((resolve) => {
          answers.push(resolve)
        }),
    )
    const { user } = await centre(server)
    await user.click(await screen.findByRole('switch', { name: statistics }))
    await user.click(screen.getByRole('switch', { name: news }))
    await waitFor(() => {
      expect(answers).toHaveLength(2)
    })
    // The second was sent with the first's change in it.
    expect(await server.body('PUT /me/consents')).toEqual({
      analytics: true,
      marketing_email: true,
    })
    // The second is answered first, and then the first, which the server took last.
    server.on('GET /me/consents', () => Response.json({ analytics: true, marketing_email: false }))
    act(() => {
      answers[1]?.(Response.json({ analytics: true, marketing_email: true }))
    })
    act(() => {
      answers[0]?.(Response.json({ analytics: true, marketing_email: false }))
    })
    // What the server holds is what is drawn in the end.
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: news })).not.toBeChecked()
    })
    expect(screen.getByRole('switch', { name: statistics })).toBeChecked()
  })

  // The read that follows is made once every change is answered, and not once the one made last
  // is: answered first, that one would have what the server holds read before the earlier one
  // landed on it, and nothing would then draw what the server came to hold.
  it('read what the server holds only once every change is answered, whichever is answered first', async () => {
    const server = serving()
    let kept = { analytics: false, marketing_email: false }
    server.on('GET /me/consents', () => Response.json(kept))
    // The server takes each change as its answer is let go, in that order.
    const taken: (() => void)[] = []
    server.on('PUT /me/consents', async (request) => {
      const sent = (await request.json()) as typeof kept
      return new Promise<Response>((resolve) => {
        taken.push(() => {
          kept = sent
          resolve(Response.json(sent))
        })
      })
    })
    const { user } = await centre(server)
    await user.click(await screen.findByRole('switch', { name: statistics }))
    await user.click(screen.getByRole('switch', { name: news }))
    await waitFor(() => {
      expect(taken).toHaveLength(2)
    })
    const reads = server.to('GET /me/consents').length
    // The second is taken and answered first: nothing is read yet, the first being on its way.
    act(() => {
      taken[1]?.()
    })
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: news })).toBeChecked()
    })
    expect(server.to('GET /me/consents')).toHaveLength(reads)
    // Then the first, which the server took last, and which says news is off.
    act(() => {
      taken[0]?.()
    })
    await waitFor(() => {
      expect(server.to('GET /me/consents').length).toBeGreaterThan(reads)
    })
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: news })).not.toBeChecked()
    })
    expect(screen.getByRole('switch', { name: statistics })).toBeChecked()
  })

  // Each change sends both, so a later one carries the earlier one's choice: where the server
  // took the later one, both switches are as chosen and as it holds them, whatever the earlier
  // one was answered.
  it('say nothing of an earlier change that was refused where the one made after it was taken', async () => {
    const server = serving()
    let kept = { analytics: false, marketing_email: false }
    server.on('GET /me/consents', () => Response.json(kept))
    const answers: ((response: Response) => void)[] = []
    server.on(
      'PUT /me/consents',
      () =>
        new Promise<Response>((resolve) => {
          answers.push(resolve)
        }),
    )
    const { user } = await centre(server)
    await user.click(await screen.findByRole('switch', { name: statistics }))
    await user.click(screen.getByRole('switch', { name: news }))
    await waitFor(() => {
      expect(answers).toHaveLength(2)
    })
    const reads = server.to('GET /me/consents').length
    // The first is refused, and the second, which carried the first's choice, is taken.
    kept = { analytics: true, marketing_email: true }
    act(() => {
      answers[0]?.(problem(429, 'rate_limited'))
    })
    act(() => {
      answers[1]?.(Response.json(kept))
    })
    // What the server holds is read once both are answered, and is what was chosen.
    await waitFor(() => {
      expect(server.to('GET /me/consents').length).toBeGreaterThan(reads)
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(screen.getByRole('switch', { name: statistics })).toBeChecked()
    expect(screen.getByRole('switch', { name: news })).toBeChecked()
    expect(screen.queryByText('Not saved')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('put a refused change back, say why, and let it be put away', async () => {
    const server = serving()
    server.on('PUT /me/consents', () => problem(429, 'rate_limited'))
    const { user } = await centre(server)
    await user.click(await screen.findByRole('switch', { name: statistics }))
    const strip = await screen.findByRole('alert')
    expect(strip).toHaveTextContent('Not saved')
    expect(strip).toHaveTextContent('Too many attempts. Try again in a little while.')
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: statistics })).not.toBeChecked()
    })
    await user.click(within(strip).getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    // *Dismiss* left with the strip it stood in: the focus it held is on the consents' own
    // place, and not dropped to the page.
    await focusIsOn(placeIn(right(consenting), screen.getByRole('switch', { name: statistics })))
  })

  it('are asked at once with no connection, say the server was not reached, and are sent by nothing later', async () => {
    const server = serving()
    server.on('PUT /me/consents', () => Promise.reject(new TypeError('offline')))
    const { user } = await centre(server)
    const control = await screen.findByRole('switch', { name: statistics })
    onlineManager.setOnline(false)
    await user.click(control)
    expect(await screen.findByRole('alert')).toHaveTextContent(/We couldn’t reach Household\./)
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: statistics })).not.toBeChecked()
    })
    act(() => {
      onlineManager.setOnline(true)
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(server.to('PUT /me/consents')).toHaveLength(1)
  })

  it('draw their shape while they are read, and say so where they could not be', async () => {
    const waiting = serving()
    waiting.on('GET /me/consents', () => new Promise<Response>(() => undefined))
    const first = await centre(waiting)
    expect(
      await within(right(consenting)).findByRole('status', { name: 'Loading' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    first.unmount()

    const failing = serving()
    failing.on('GET /me/consents', () => Promise.reject(new TypeError('offline')))
    const { user } = await centre(failing)
    const section = right(consenting)
    expect(
      await within(section).findByText('Your choices could not be read. Nothing was changed.'),
    ).toBeInTheDocument()
    // One body that could not be read takes no other with it.
    expect(within(right(copy)).getByRole('button', { name: 'Export my data' })).toBeInTheDocument()
    failing.on('GET /me/consents', () => Response.json({ analytics: true, marketing_email: false }))
    await user.click(within(section).getByRole('button', { name: 'Try again' }))
    const control = await screen.findByRole('switch', { name: statistics })
    expect(control).toBeChecked()
    // *Try again* left with the sentence it stood in: the focus it held is on the consents' own
    // place, and not dropped to the page.
    await focusIsOn(placeIn(section, control))
  })

  // A read that waits for a connection is no read under way: nothing is kept, and it is said.
  it('say they could not be read where they are asked for with no connection', async () => {
    const server = serving()
    server.on('GET /me', () => {
      // The connection goes once the account is known: what the screen then asks for waits.
      onlineManager.setOnline(false)
      return Response.json(server.me)
    })
    await centre(server)
    const section = right(consenting)
    expect(
      await within(section).findByText('Your choices could not be read. Nothing was changed.'),
    ).toBeInTheDocument()
    expect(within(section).queryByRole('status', { name: 'Loading' })).not.toBeInTheDocument()
    expect(server.to('GET /me/consents')).toHaveLength(0)
  })
})

describe('whom to complain to', () => {
  const leaves = 'Opens the authority’s own site in a new tab. It is not part of Household.'

  it('names the authority of the household’s country, and opens its own page in a new tab', async () => {
    const server = serving()
    await centre(server)
    const section = right(complaining)
    const authority = await within(section).findByRole('link', {
      name: 'Office for Personal Data Protection',
    })
    expect(within(section).getByText('Czechia')).toBeInTheDocument()
    expect(authority).toHaveAttribute(
      'href',
      'https://uoou.gov.cz/poradna/chci-podat-stiznost-na-spravce-nebo-zpracovatele',
    )
    expect(authority).toHaveAttribute('target', '_blank')
    expect(authority).toHaveAttribute('rel', 'noopener noreferrer')
    // That it leaves Household is said, and tied to the link.
    expect(authority).toHaveAccessibleDescription(leaves)
    // Nobody is asked for a country who is in a household: the household says it.
    expect(within(section).queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('names one for each country a member’s households are in, each once', async () => {
    const server = serving()
    inHouseholds(server, [
      { id: home, name: 'Tilcerovi', country: 'CZ' },
      { id: chata, name: 'Chata Vysočina', country: 'GB', role: 'member' },
      { id: '0190a000-0000-7000-8000-0000000000a3', name: 'Byt Brno', country: 'CZ' },
    ])
    await centre(server)
    const section = right(complaining)
    await within(section).findByRole('link', { name: 'Information Commission' })
    expect(
      within(section)
        .getAllByRole('listitem')
        .map((each) => each.textContent),
    ).toEqual([
      'CzechiaOffice for Personal Data Protection',
      'United KingdomInformation Commission',
    ])
  })

  // A suspended household answers nobody (D-115): asked for, it would hold the section.
  it('passes over a suspended household, and asks nothing of it', async () => {
    const server = serving()
    inHouseholds(server, [
      { id: home, name: 'Tilcerovi', suspended: true },
      { id: chata, name: 'Chata Vysočina', country: 'DE', role: 'member' },
    ])
    await centre(server)
    const section = right(complaining)
    expect(
      await within(section).findByRole('link', {
        name: 'The Federal Commissioner for Data Protection and Freedom of Information',
      }),
    ).toBeInTheDocument()
    expect(within(section).getAllByRole('listitem')).toHaveLength(1)
    expect(server.to(`GET /households/${home}`)).toHaveLength(0)
  })

  it('names the ones it could read where one household could not be', async () => {
    const server = serving()
    inHouseholds(server, [
      { id: home, name: 'Tilcerovi', country: 'CZ' },
      { id: chata, name: 'Chata Vysočina', country: 'GB' },
    ])
    server.on(`GET /households/${chata}`, () => problem(404, 'not_found'))
    await centre(server)
    const section = right(complaining)
    expect(
      await within(section).findByRole('link', { name: 'Office for Personal Data Protection' }),
    ).toBeInTheDocument()
    expect(within(section).getAllByRole('listitem')).toHaveLength(1)
  })

  it('says the authorities could not be read where none of the households could be, and reads again', async () => {
    const server = serving()
    server.on(`GET /households/${home}`, () => problem(404, 'not_found'))
    const { user } = await centre(server)
    const section = right(complaining)
    expect(
      await within(section).findByText('The authorities could not be read. Nothing was changed.'),
    ).toBeInTheDocument()
    server.on(`GET /households/${home}`, () => Response.json(tilcerovi))
    await user.click(within(section).getByRole('button', { name: 'Try again' }))
    const authority = await within(section).findByRole('link', {
      name: 'Office for Personal Data Protection',
    })
    // *Try again* left with the sentence it stood in: the focus it held is on the authorities'
    // own place, and not dropped to the page.
    await focusIsOn(placeIn(section, authority))
  })

  // The households unread, two bodies of the page say so, each with its own *Try again*, and
  // one read answers both. The focus goes to the place of the body whose control was pressed:
  // a page watched whole would hand it to whichever body looked first.
  it('keeps the focus in its own body where the households’ read is another body’s too', async () => {
    const server = serving()
    server.on('GET /households', () => Promise.reject(new TypeError('offline')))
    const { user } = await centre(server)
    const section = right(complaining)
    const other = right(stopping)
    expect(
      await within(section).findByText('The authorities could not be read. Nothing was changed.'),
    ).toBeInTheDocument()
    expect(await within(other).findByText('Your households could not be read')).toBeInTheDocument()
    server.on('GET /households', () =>
      Response.json({ items: [{ id: home, name: 'Tilcerovi', my_role: 'owner' }] }),
    )
    await user.click(within(section).getByRole('button', { name: 'Try again' }))
    const authority = await within(section).findByRole('link', {
      name: 'Office for Personal Data Protection',
    })
    const way = await within(other).findByRole('link', { name: 'Open the data of Tilcerovi' })
    await focusIsOn(placeIn(section, authority))
    expect(placeIn(other, way)).not.toHaveFocus()
  })

  // An account has no country, and a member in no household has none to read: the device's
  // languages say one, which is offered and can be changed.
  it('offers a member in no household the country their device names, as a choice', async () => {
    vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['cs', 'en'])
    const server = serving()
    inHouseholds(server, [])
    const { user } = await centre(server)
    const section = right(complaining)
    const country = await within(section).findByRole('combobox', { name: 'Your country' })
    expect(country).toHaveValue('CZ')
    expect(
      within(section).getByRole('link', { name: 'Office for Personal Data Protection' }),
    ).toHaveAccessibleDescription(leaves)
    await user.selectOptions(country, 'United Kingdom')
    expect(within(section).getByRole('link', { name: 'Information Commission' })).toHaveAttribute(
      'href',
      'https://ico.org.uk/make-a-complaint/',
    )
    expect(
      within(section).queryByRole('link', { name: 'Office for Personal Data Protection' }),
    ).not.toBeInTheDocument()
  })

  // No country is chosen for a member whose device names none Household has a profile of.
  it('asks for a country where the device names none, and names no authority until one is chosen', async () => {
    vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['fr-FR'])
    const server = serving()
    inHouseholds(server, [])
    const { user } = await centre(server)
    const section = right(complaining)
    const country = await within(section).findByRole('combobox', { name: 'Your country' })
    expect(country).toHaveValue('')
    expect(within(country).getByRole('option', { name: 'Choose a country' })).toBeDisabled()
    expect(within(section).queryByRole('link')).not.toBeInTheDocument()
    await user.selectOptions(country, 'Germany')
    expect(
      within(section).getByRole('link', {
        name: 'The Federal Commissioner for Data Protection and Freedom of Information',
      }),
    ).toBeInTheDocument()
  })

  it('says the authorities could not be read where the countries could not be', async () => {
    const server = serving()
    server.on('GET /reference/countries', () => Promise.reject(new TypeError('offline')))
    await centre(server)
    expect(
      await within(right(complaining)).findByText(
        'The authorities could not be read. Nothing was changed.',
      ),
    ).toBeInTheDocument()
    // The rest of the page reads all the same.
    expect(
      await screen.findByRole('switch', { name: 'Allow usage statistics' }),
    ).toBeInTheDocument()
  })
})
