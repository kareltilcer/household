// One member's page (PRD 17 §2): who reads what of whom, the levels as a form an owner fills in,
// a role made and unmade, a member removed, and what each refusal is said as. A child profile's
// own controls are held beside this (ChildProfile.test.tsx).
import { focusManager, onlineManager } from '@tanstack/react-query'
import { act, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { inHousehold } from '../../app/paths.ts'
import type { Membership } from '../data.ts'
import { defaultsFor } from '../grants.ts'
import {
  accountOf,
  adam,
  createServer,
  home,
  invalid,
  jana,
  klara,
  memberOf,
  milos,
  noContent,
  open,
  petr,
  problem,
  readBy,
  tilcerovi,
  type AccessLevel,
  type HouseholdServer,
} from '../testing.tsx'
import { grantChange } from './member.ts'

const at = `/households/${home}`

// A test that takes the connection away leaves the next one a browser that has it, and one
// that says the page is looked at again a page nobody has looked at.
afterEach(() => {
  focusManager.setFocused(undefined)
  onlineManager.setOnline(true)
})

/** Changes one member of `server`'s household, as the server holds them. */
function change(server: HouseholdServer, user: string, more: Partial<Membership>): Membership {
  const next = { ...memberOf(user, server.members), ...more }
  server.members = server.members.map((each) => (each.user_id === user ? next : each))
  return next
}

/** Makes `user` an owner of `server`'s household, as a promotion leaves them. */
function owning(server: HouseholdServer, user: string): Membership {
  return change(server, user, { role: 'owner', grants: defaultsFor('owner') })
}

/** A server whose member `reader` is signed in, and an owner beside Jana. */
function ownedBy(reader: string): HouseholdServer {
  const server = createServer(accountOf(reader))
  server.household = readBy(owning(server, reader))
  return server
}

/** Answers a change of `user`'s membership as the server does: merged, and a version on. */
function taking(server: HouseholdServer, user: string): void {
  server.on(`PATCH ${at}/members/${user}`, async (request) => {
    const asked = (await request.json()) as {
      role?: 'owner' | 'member'
      grants?: Record<string, AccessLevel>
    }
    const was = memberOf(user, server.members)
    const next = change(server, user, {
      ...(asked.role === undefined ? {} : { role: asked.role }),
      grants: { ...was.grants, ...asked.grants },
      version: (was.version ?? 0) + 1,
    })
    return Response.json(next, { headers: { ETag: `"${String(next.version)}"` } })
  })
}

/** Opens `user`'s page, and waits until it is titled with their name. */
async function page(user: string, server: HouseholdServer = createServer()) {
  const opened = open(inHousehold.member(home, user), server)
  const name = memberOf(user, server.members).display_name ?? ''
  await screen.findByRole('heading', { level: 1, name })
  return { ...opened, name }
}

/** What somebody holds, as the summary's terms say it: each level with how many modules. */
function terms(): (string | null)[] {
  const holds = screen.getByRole('region', { name: /^What .+ holds?$/ })
  return within(holds)
    .queryAllByRole('term')
    .map((term) => term.textContent)
}

const row = (module: string) => screen.getByRole('combobox', { name: module })

/** A second child profile, so that a child profile has another's page to read. */
const ema = '0190a000-0000-7000-8000-000000000006'

type Reader = 'owner' | 'member' | 'child' | 'holding nothing of the settings' | 'read-only'
type Subject = 'an owner' | 'the payer' | 'a member' | 'a child profile' | 'themself'

const subjects: readonly Subject[] = [
  'an owner',
  'the payer',
  'a member',
  'a child profile',
  'themself',
]

/**
 * The household as `reader` stands in it: Jana pays for it, Miloš is an owner beside her, and
 * the reader who is an owner is Petr, so that an owner has both another owner and the payer to
 * look at.
 */
function standingAs(reader: Reader): { readonly server: HouseholdServer; readonly me: string } {
  const owner = reader === 'owner' || reader === 'read-only'
  const me = reader === 'child' ? adam : reader === 'holding nothing of the settings' ? klara : petr
  const server = createServer(accountOf(me))
  owning(server, milos)
  server.members = [...server.members, { ...memberOf(adam), user_id: ema, display_name: 'Ema' }]
  server.on(`GET ${at}/members/${ema}`, () => Response.json(memberOf(ema, server.members)))
  if (owner) server.household = readBy(owning(server, petr))
  if (reader === 'read-only') {
    server.household = {
      ...server.household,
      entitlement: { state: 'read_only', can_write: false, can_upload: false },
    }
  }
  return { server, me }
}

/** Whose page `subject` is, for the reader `me`. */
function pageOf(subject: Subject, me: string): string {
  switch (subject) {
    case 'an owner':
      return milos
    case 'the payer':
      return jana.id
    case 'a member':
      return me === klara ? petr : klara
    case 'a child profile':
      return me === adam ? ema : adam
    case 'themself':
      return me
  }
}

const buttons = () => screen.queryAllByRole('button').map((button) => button.textContent)

describe('what a change of levels comes to', () => {
  it('tells a raise from a lowering, and names what is lowered to nothing', () => {
    const from = defaultsFor('member')
    expect(grantChange(from, { ...from, finance: 'view', shopping: 'view', chat: 'none' })).toEqual(
      { raised: ['finance'], lowered: ['shopping', 'chat'], off: ['chat'], settingsOff: false },
    )
    expect(grantChange(from, from)).toEqual({
      raised: [],
      lowered: [],
      off: [],
      settingsOff: false,
    })
  })

  // No level takes household settings out of anybody's app (D-167): lowered to nothing it is
  // lowered, and is not among the modules that leave.
  it('does not count household settings among what leaves an app, and says it was lowered to nothing', () => {
    const from = defaultsFor('member')
    expect(grantChange(from, { ...from, chat: 'none', admin: 'none' })).toEqual({
      raised: [],
      lowered: ['chat', 'admin'],
      off: ['chat'],
      settingsOff: true,
    })
    // Lowered to something, or raised from nothing, it was not lowered to nothing.
    expect(grantChange({ ...from, admin: 'manage' }, from).settingsOff).toBe(false)
    expect(grantChange({ ...from, admin: 'none' }, from).settingsOff).toBe(false)
  })
})

describe('one member’s page', () => {
  it('is titled with the member’s name, and says their role under it', async () => {
    await page(petr)
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(document.title).toBe('Petr Tilcer · Household')
    expect(screen.getByText('Member')).toBeInTheDocument()
    // It stands among the members, which the settings' own navigation says.
    expect(
      within(screen.getByRole('navigation', { name: 'Household settings' })).getByRole('link', {
        name: 'Members',
      }),
    ).toHaveAttribute('aria-current', 'page')
  })

  it('says of the payer that they pay for the household', async () => {
    await page(jana.id, createServer(accountOf(petr)))
    expect(screen.getByText('Owner · pays for the household')).toBeInTheDocument()
  })

  it('is the members’ page, and a skeleton, while the member is being read', async () => {
    const server = createServer()
    server.on(`GET ${at}/members/${petr}`, () => new Promise<Response>(() => undefined))
    open(inHousehold.member(home, petr), server)
    expect(await screen.findByRole('heading', { level: 1, name: 'Members' })).toBeInTheDocument()
    expect(document.title).toBe('Members · Household')
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
  })

  it('says the member could not be read and that nothing changed, and reads them again', async () => {
    const server = createServer()
    server.on(`GET ${at}/members/${petr}`, () => Promise.reject(new TypeError('offline')))
    const { user } = open(inHousehold.member(home, petr), server)
    expect(await screen.findByText('This member’s page did not load')).toBeInTheDocument()
    expect(screen.getByText('Nothing was changed, and nothing was lost.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Members' })).toBeInTheDocument()
    server.on(`GET ${at}/members/${petr}`, () => Response.json(memberOf(petr)))
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Petr Tilcer' }),
    ).toBeInTheDocument()
  })

  it('says a read that waits for a connection could not be made, and draws no skeleton for it', async () => {
    const server = createServer()
    // The connection goes as the household is read: the member is asked for with none.
    let read = false
    server.on(`GET ${at}`, () => {
      if (!read) onlineManager.setOnline(false)
      read = true
      return Response.json(server.household)
    })
    open(inHousehold.member(home, petr), server)
    expect(await screen.findByText('This member’s page did not load')).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: 'Loading' })).not.toBeInTheDocument()
    expect(server.to(`GET ${at}/members/${petr}`)).toHaveLength(0)
    act(() => {
      onlineManager.setOnline(true)
    })
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Petr Tilcer' }),
    ).toBeInTheDocument()
  })

  // That a change needs a connection is the shell's bar's to say (shell/HouseholdBars.tsx).
  it('is read as this browser kept it once the connection goes', async () => {
    await page(petr)
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    act(() => {
      window.dispatchEvent(new Event('offline'))
    })
    // What was read stays drawn, as it was read.
    expect(screen.getByRole('heading', { level: 1, name: 'Petr Tilcer' })).toBeInTheDocument()
    expect(row('Utilities')).toHaveValue('manage')
    expect(screen.queryByText('This member’s page did not load')).not.toBeInTheDocument()
  })

  it('opens nothing at an address that names no member, and leads back to the members', async () => {
    open(inHousehold.member(home, '0190a000-0000-7000-8000-0000000000ff'))
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'This link doesn’t open anything here.',
      }),
    ).toBeInTheDocument()
    // The neutral screen: it names nobody, gives no cause and offers no retry.
    expect(screen.getAllByRole('heading')).toHaveLength(1)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByRole('link')).toHaveAttribute('href', inHousehold.home(home))
  })

  // The server refuses an address that is no id before it looks for anybody (`422`), which is
  // no answer this page has a screen for: it is asked nothing.
  it('opens nothing at an address that is no id at all, and asks for nobody', async () => {
    const { server } = open(inHousehold.member(home, 'nobody'))
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'This link doesn’t open anything here.',
      }),
    ).toBeInTheDocument()
    expect(server.to(`GET ${at}/members/nobody`)).toHaveLength(0)
  })

  // Withdrawn: a member removed by somebody else while the page stood open.
  it('says a member who is gone is gone, where a change of them is pressed, and opens nothing', async () => {
    const server = createServer()
    const { user } = await page(petr, server)
    await user.selectOptions(row('Finance'), 'Can see')
    server.members = server.members.filter((each) => each.user_id !== petr)
    server.on(`PATCH ${at}/members/${petr}`, () => problem(404, 'not_found'))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(
      await screen.findByText(
        'That is no longer there to change. The page shows how things stand now.',
      ),
    ).toBeInTheDocument()
    // The member is read again, and is nobody: the page says no more than any dead address.
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'This link doesn’t open anything here.',
      }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })
})

describe('who may change what, for every reader of every member', () => {
  // An owner, in a household that takes writes: the one standing any control is drawn for.
  it.each<[Subject, { readonly rows: number; readonly controls: readonly string[] }]>([
    // An owner holds everything: no matrix. Their role and their membership are another owner's.
    ['an owner', { rows: 0, controls: ['Make Miloš Tilcer a member', 'Remove Miloš Tilcer'] }],
    // Billing moves before the payer's role or membership does: nothing that could only be refused.
    ['the payer', { rows: 0, controls: [] }],
    ['a member', { rows: 17, controls: ['Make Klára Nováková an owner', 'Remove Klára Nováková'] }],
    // No role control: a child profile becomes a member by a sign-in of its own.
    [
      'a child profile',
      {
        rows: 17,
        controls: [
          'Set a new PIN',
          'Give Adam their own sign-in',
          'Choose a picture',
          'Remove Adam',
        ],
      },
    ],
    // Nobody changes their own role or removes themself: they leave.
    ['themself', { rows: 0, controls: [] }],
  ])('draws an owner looking at %s the controls that are theirs', async (subject, drawn) => {
    const { server, me } = standingAs('owner')
    await page(pageOf(subject, me), server)
    expect(screen.queryAllByRole('combobox')).toHaveLength(drawn.rows)
    expect(buttons()).toEqual(drawn.controls)
    expect(screen.queryAllByRole('link', { name: 'Leave Tilcerovi' })).toHaveLength(
      subject === 'themself' ? 1 : 0,
    )
  })

  // Absence, not disabling: the same page without its controls, whoever it is about.
  describe.each<Reader>(['member', 'child', 'holding nothing of the settings', 'read-only'])(
    'for a reader who is %s',
    (reader) => {
      it.each(subjects)('draws what %s holds, and no control at all', async (subject) => {
        const { server, me } = standingAs(reader)
        await page(pageOf(subject, me), server)
        expect(terms().length).toBeGreaterThan(0)
        expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
        expect(buttons()).toEqual([])
        // The one way on a reader has is their own: leaving, which a child profile cannot.
        expect(screen.queryAllByRole('link', { name: 'Leave Tilcerovi' })).toHaveLength(
          subject === 'themself' && reader !== 'child' ? 1 : 0,
        )
      })
    },
  )
})

describe('what a member holds, as each reader reads it', () => {
  it('is a form for an owner looking at a member, begun from what is saved', async () => {
    const { name } = await page(petr)
    const matrix = screen.getByRole('list', { name: `What ${name} holds` })
    expect(within(matrix).getAllByRole('combobox')).toHaveLength(17)
    expect(row('Utilities')).toHaveValue('manage')
    expect(row('Shopping')).toHaveValue('contribute')
    expect(row('Finance')).toHaveValue('none')
    // Nothing is changed yet: there is nothing to save, and nothing said of a change.
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Put back' })).not.toBeInTheDocument()
    expect(terms()).toEqual([])
  })

  it('is read, gathered by level, by a member looking at another', async () => {
    await page(klara, createServer(accountOf(petr)))
    expect(
      screen.getByRole('heading', { level: 2, name: 'What Klára Nováková holds' }),
    ).toBeInTheDocument()
    // Household settings is no part of a level's count: what she holds there is said last, in
    // a sentence that is true of it.
    expect(terms()).toEqual([
      'Can add and edit · 1',
      'Can see · 2',
      'Off · 13',
      'Household settings',
    ])
    expect(screen.getByText(/^Not in their app at all/)).toBeInTheDocument()
    expect(
      screen.getByText(
        'In their app all the same, as in every member’s: the household’s profile, its members and its modules. Its invitations are not.',
      ),
    ).toBeInTheDocument()
    // The same page without its controls, and the frame says whose they are.
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(
      screen.getByText(
        'You can read everything here. Changing it is for an owner: Jana Tilcerová.',
      ),
    ).toBeInTheDocument()
  })

  it('speaks of the reader’s own app on their own page', async () => {
    await page(petr, createServer(accountOf(petr)))
    expect(screen.getByRole('heading', { level: 2, name: 'What you hold' })).toBeInTheDocument()
    expect(terms()).toEqual([
      'Can set it up · 1',
      'Can add and edit · 1',
      'Can see · 1',
      'Off · 13',
      'Household settings',
    ])
    expect(screen.getByText(/^Not in your app at all/)).toBeInTheDocument()
    expect(
      screen.getByText(
        'The household’s invitations, beside its profile, its members and its modules, which every member reads. Changing anything in the settings is for an owner.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('is read by a child profile, of themself and of anybody', async () => {
    const server = createServer(accountOf(adam))
    await page(adam, server)
    expect(screen.getByRole('heading', { level: 2, name: 'What you hold' })).toBeInTheDocument()
    expect(terms()).toEqual([
      'Can add and edit · 3',
      'Can see · 4',
      'Off · 9',
      'Household settings',
    ])
    // Read on a screen of household settings, which is in their app: the sentence says so.
    expect(screen.getByText(/^In your app all the same, as in every member’s/)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  // What `view` on household settings unlocks is the invitations: every member reads the members.
  it('is read by a member who holds nothing of the household’s settings', async () => {
    await page(petr, createServer(accountOf(klara)))
    expect(
      screen.getByRole('heading', { level: 2, name: 'What Petr Tilcer holds' }),
    ).toBeInTheDocument()
    expect(terms()).toEqual([
      'Can set it up · 1',
      'Can add and edit · 1',
      'Can see · 1',
      'Off · 13',
      'Household settings',
    ])
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('is read and not changed by an owner of a household that takes no writes', async () => {
    const server = createServer()
    server.household = {
      ...tilcerovi,
      entitlement: { state: 'read_only', can_write: false, can_upload: false },
    }
    await page(petr, server)
    expect(terms()).toEqual([
      'Can set it up · 1',
      'Can add and edit · 1',
      'Can see · 1',
      'Off · 13',
      'Household settings',
    ])
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText(/^Read-only: nothing here can be changed/)).toBeInTheDocument()
  })

  it('says that an owner holds everything, and to the owner who could what narrows it', async () => {
    const server = createServer()
    owning(server, milos)
    await page(milos, server)
    expect(terms()).toEqual(['Can set it up · 17'])
    expect(
      screen.getByText(
        'An owner can set up every module. To narrow what Miloš Tilcer holds, make them a member first.',
      ),
    ).toBeInTheDocument()
    // No matrix for an owner: there is nothing to fill in.
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('says that an owner holds everything to a member, and nothing of narrowing it', async () => {
    await page(jana.id, createServer(accountOf(petr)))
    expect(terms()).toEqual(['Can set it up · 17'])
    expect(screen.getByText('An owner can set up every module.')).toBeInTheDocument()
    expect(screen.queryByText(/make them a member first/)).not.toBeInTheDocument()
  })

  it('says so in the second person on an owner’s own page, which has no matrix', async () => {
    await page(jana.id)
    expect(screen.getByRole('heading', { level: 2, name: 'What you hold' })).toBeInTheDocument()
    expect(
      screen.getByText(
        'You are an owner, and an owner can set up every module. That is not narrowed while you are one.',
      ),
    ).toBeInTheDocument()
    expect(terms()).toEqual(['Can set it up · 17'])
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('never offers a child profile what a child may not hold, and says where the choices stop', async () => {
    await page(adam)
    expect(
      screen.getByText(
        'A child profile can’t set anything up, and can at most see Finance. The choices stop there.',
      ),
    ).toBeInTheDocument()
    const offered = (module: string) =>
      within(row(module))
        .getAllByRole('option')
        .map((option) => option.textContent)
    expect(offered('Chores')).toEqual(['Off', 'Can see', 'Can add and edit'])
    expect(offered('Finance')).toEqual(['Off', 'Can see'])
    expect(row('Chores')).toHaveValue('contribute')
  })

  it('says which modules the household has off, in the form and to a reader', async () => {
    const owner = createServer()
    owner.off = ['garden']
    const opened = await page(milos, owner)
    await waitFor(() => {
      expect(row('Garden')).toHaveAccessibleDescription(
        /Off for the whole household: this holds for when it is turned on\.$/,
      )
    })
    opened.unmount()

    const reader = createServer(accountOf(petr))
    reader.off = ['garden', 'finance']
    await page(milos, reader)
    // Finance is off too, and Miloš holds nothing on it: only what he holds is named.
    expect(
      await screen.findByText(
        'Off for the whole household just now: Garden. A level on a module that is off holds for when it is turned on.',
      ),
    ).toBeInTheDocument()
  })
})

describe('changing what a member holds', () => {
  it('says what a raise comes to before it is saved, and nothing of telling', async () => {
    const { user } = await page(petr)
    await user.selectOptions(row('Finance'), 'Can see')
    expect(row('Finance')).toHaveAccessibleDescription(
      'Everything in it can be read, and nothing changed. Changed from “Off”.',
    )
    const save = screen.getByRole('button', { name: 'Save changes' })
    // The save's own description: read with the button that would do it.
    expect(save).toHaveAccessibleDescription(
      '1 module is raised. Petr Tilcer is told of the change.',
    )
    expect(screen.getByRole('button', { name: 'Put back' })).toBeInTheDocument()
  })

  it('says of any change that its member is told of it', async () => {
    const { user } = await page(petr)
    await user.selectOptions(row('Shopping'), 'Can see')
    await user.selectOptions(row('Finance'), 'Can see')
    expect(screen.getByRole('button', { name: 'Save changes' })).toHaveAccessibleDescription(
      '1 module is raised. 1 module is lowered. Petr Tilcer is told of the change.',
    )
  })

  it('says of a module lowered to Off that it leaves their app and their devices, and deletes nothing', async () => {
    const { user } = await page(petr)
    await user.selectOptions(row('Utilities'), 'Off')
    expect(screen.getByRole('button', { name: 'Save changes' })).toHaveAccessibleDescription(
      '1 module is lowered. Utilities leaves Petr Tilcer’s app entirely, and their devices drop their copy of it. Nothing they added is deleted. Petr Tilcer is told of the change.',
    )
    // One summary for every row, and not a sentence a row.
    await user.selectOptions(row('Shopping'), 'Off')
    await user.selectOptions(row('Dashboard'), 'Can add and edit')
    expect(screen.getByRole('button', { name: 'Save changes' })).toHaveAccessibleDescription(
      '1 module is raised. 2 modules are lowered. Shopping and Utilities leave Petr Tilcer’s app entirely, and their devices drop their copy of them. Nothing they added is deleted. Petr Tilcer is told of the change.',
    )
  })

  // Household settings leaves nobody's app (D-167): what a member loses with it is the
  // household's invitations, and the summary says that and not that the module went.
  it('says of household settings lowered to Off what goes with it, and not that it leaves their app', async () => {
    const { user } = await page(petr)
    await user.selectOptions(row('Household settings'), 'Off')
    expect(row('Household settings')).toHaveAccessibleDescription(
      'In their app all the same, as in every member’s: the household’s profile, its members and its modules. Its invitations are not. Changed from “Can see”.',
    )
    expect(screen.getByRole('button', { name: 'Save changes' })).toHaveAccessibleDescription(
      '1 module is lowered. Petr Tilcer no longer reads the household’s invitations. Its profile, its members and its modules stay theirs to read. Petr Tilcer is told of the change.',
    )
    // Beside a module that does leave, each is said as what it is.
    await user.selectOptions(row('Utilities'), 'Off')
    expect(screen.getByRole('button', { name: 'Save changes' })).toHaveAccessibleDescription(
      '2 modules are lowered. Utilities leaves Petr Tilcer’s app entirely, and their devices drop their copy of it. Nothing they added is deleted. Petr Tilcer no longer reads the household’s invitations. Its profile, its members and its modules stay theirs to read. Petr Tilcer is told of the change.',
    )
  })

  it('sends the changed modules alone against the version it read, and says its member is told', async () => {
    const server = createServer()
    taking(server, petr)
    const { user, name } = await page(petr, server)
    const members = server.to(`GET ${at}/members`).length
    await user.selectOptions(row('Finance'), 'Can see')
    await user.selectOptions(row('Shopping'), 'Can see')
    // Changed and changed back: no change at all.
    await user.selectOptions(row('Garden'), 'Can set it up')
    await user.selectOptions(row('Garden'), 'Off')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(
      await screen.findByText('Petr Tilcer’s access is saved. They are told.'),
    ).toBeInTheDocument()
    const [sent] = server.to(`PATCH ${at}/members/${petr}`)
    expect(sent?.headers.get('If-Match')).toBe('"1"')
    expect(await server.body(`PATCH ${at}/members/${petr}`)).toEqual({
      grants: { finance: 'view', shopping: 'view' },
    })
    // The form is clean again: begun from what is now saved, with nothing to save.
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
    })
    expect(row('Finance')).toHaveValue('view')
    expect(row('Finance')).toHaveAccessibleDescription(
      'Everything in it can be read, and nothing changed.',
    )
    // The buttons went with the change: the focus one held is on the matrix they stood under.
    await waitFor(() => {
      expect(screen.getByRole('group', { name: `What ${name} holds` })).toHaveFocus()
    })
    // The household's members are read again, this one among them.
    await waitFor(() => {
      expect(server.to(`GET ${at}/members`).length).toBeGreaterThan(members)
    })
    expect(server.to(`GET ${at}/members/${petr}`).length).toBeGreaterThan(1)

    // The next change goes against the version the save answered.
    await user.selectOptions(row('Chat'), 'Can see')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    // A raise alone is saved, and its member is told of that too.
    await waitFor(() => {
      expect(server.to(`PATCH ${at}/members/${petr}`)).toHaveLength(2)
    })
    expect(server.to(`PATCH ${at}/members/${petr}`)[1]?.headers.get('If-Match')).toBe('"2"')
    expect(await server.body(`PATCH ${at}/members/${petr}`)).toEqual({ grants: { chat: 'view' } })
    // Saved: nothing is left to save.
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
    })
  })

  it('keeps a row chosen while a save was on its way as a change still to save', async () => {
    const server = createServer()
    let answer: () => void = () => undefined
    server.on(
      `PATCH ${at}/members/${petr}`,
      () =>
        new Promise<Response>((resolve) => {
          answer = () => {
            const grants = { ...memberOf(petr).grants, finance: 'view' as const }
            resolve(Response.json(change(server, petr, { grants, version: 2 })))
          }
        }),
    )
    const { user } = await page(petr, server)
    await user.selectOptions(row('Finance'), 'Can see')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => {
      expect(server.to(`PATCH ${at}/members/${petr}`)).toHaveLength(1)
    })
    await user.selectOptions(row('Chat'), 'Can see')
    // The save is on its way still, and its button busy still: a second press sends nothing
    // more, and nothing is put back from under a change that is being made.
    const save = screen.getByRole('button', { name: 'Save changes' })
    expect(save).toHaveAttribute('aria-busy', 'true')
    await user.click(save)
    await user.click(screen.getByRole('button', { name: 'Put back' }))
    expect(server.to(`PATCH ${at}/members/${petr}`)).toHaveLength(1)
    expect(row('Chat')).toHaveValue('view')
    expect(screen.queryByText('The levels are back to what is saved.')).not.toBeInTheDocument()
    answer()
    expect(
      await screen.findByText('Petr Tilcer’s access is saved. They are told.'),
    ).toBeInTheDocument()
    // What was sent is saved; what was chosen since was not sent, and is not dropped.
    expect(row('Finance')).toHaveAccessibleDescription(
      'Everything in it can be read, and nothing changed.',
    )
    expect(row('Chat')).toHaveValue('view')
    expect(screen.getByRole('button', { name: 'Save changes' })).toHaveAccessibleDescription(
      '1 module is raised. Petr Tilcer is told of the change.',
    )
  })

  // The same route draws the next member's page: what was chosen on one is not carried to it.
  it('drops what was chosen and not saved with the page it was chosen on, and asks nothing first', async () => {
    const server = createServer()
    const { user, router } = await page(petr, server)
    await user.selectOptions(row('Shopping'), 'Off')
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument()
    await act(() => router.navigate(inHousehold.member(home, klara)))
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Klára Nováková' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(row('Shopping')).toHaveValue('contribute')
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
    expect(server.to(`PATCH ${at}/members/${petr}`)).toHaveLength(0)
  })

  it('puts the rows back to what is saved, asks the server nothing, and says so', async () => {
    const server = createServer()
    const { user, name } = await page(petr, server)
    await user.selectOptions(row('Utilities'), 'Off')
    await user.click(screen.getByRole('button', { name: 'Put back' }))
    expect(row('Utilities')).toHaveValue('manage')
    expect(await screen.findByText('The levels are back to what is saved.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
    expect(server.to(`PATCH ${at}/members/${petr}`)).toHaveLength(0)
    await waitFor(() => {
      expect(screen.getByRole('group', { name: `What ${name} holds` })).toHaveFocus()
    })
  })

  it('says what the server refused a row for beside the row, which takes the focus', async () => {
    const server = createServer()
    server.on(`PATCH ${at}/members/${petr}`, () => invalid('/grants/finance'))
    const { user } = await page(petr, server)
    await user.selectOptions(row('Finance'), 'Can set it up')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => {
      expect(row('Finance')).toHaveAccessibleDescription(
        expect.stringContaining('That level can’t be given here. Choose another.'),
      )
    })
    await waitFor(() => {
      expect(row('Finance')).toHaveFocus()
    })
    // What was chosen is kept, to be chosen again.
    expect(row('Finance')).toHaveValue('manage')
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('puts the form back to what the server holds when somebody else changed the member, and says so', async () => {
    const server = createServer()
    server.on(`PATCH ${at}/members/${petr}`, () => {
      // Another owner turned Shopping off for Petr a moment ago.
      const now = change(server, petr, {
        grants: { ...memberOf(petr).grants, shopping: 'none' },
        version: 2,
      })
      return problem(409, 'version_conflict', { current: now, current_version: 2 })
    })
    const { user, name } = await page(petr, server)
    await user.selectOptions(row('Finance'), 'Can see')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Somebody else changed this just now. Here is how it stands; check it, and change it again if it still needs changing.',
    )
    // Nothing of this owner's change is laid over what the other one made.
    await waitFor(() => {
      expect(row('Shopping')).toHaveValue('none')
    })
    expect(row('Finance')).toHaveValue('none')
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByRole('group', { name: `What ${name} holds` })).toHaveFocus()
    })
    // Changed again, it is sent against the version that was read again.
    taking(server, petr)
    await user.selectOptions(row('Finance'), 'Can see')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => {
      expect(server.to(`PATCH ${at}/members/${petr}`)).toHaveLength(2)
    })
    expect(server.to(`PATCH ${at}/members/${petr}`)[1]?.headers.get('If-Match')).toBe('"2"')
  })

  it('says a save could not reach the server, keeps what was chosen, and sends nothing later', async () => {
    const server = createServer()
    server.on(`PATCH ${at}/members/${petr}`, () => Promise.reject(new TypeError('offline')))
    const { user } = await page(petr, server)
    await user.selectOptions(row('Finance'), 'Can see')
    act(() => {
      onlineManager.setOnline(false)
    })
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    // Asked at once, connection or none, and answered at once that it was not reached.
    expect(await screen.findByRole('alert')).toHaveTextContent(/^We couldn’t reach Household\./)
    expect(row('Finance')).toHaveValue('view')
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument()
    const asked = server.to(`PATCH ${at}/members/${petr}`).length
    expect(asked).toBeGreaterThan(0)
    act(() => {
      onlineManager.setOnline(true)
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(server.to(`PATCH ${at}/members/${petr}`)).toHaveLength(asked)
  })

  it('says a household that turned read-only changed nothing, and keeps the sentence when the form goes', async () => {
    const server = createServer()
    server.on(`PATCH ${at}/members/${petr}`, () => {
      // The subscription lapsed a moment ago.
      server.household = {
        ...server.household,
        entitlement: { state: 'read_only', can_write: false, can_upload: false },
      }
      return problem(402, 'entitlement_read_only', { state: 'read_only', remedy: 'subscribe' })
    })
    const { user } = await page(petr, server)
    await user.selectOptions(row('Finance'), 'Can see')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    const said = await screen.findByText('The household is read-only now, so nothing was changed.')
    expect(said.closest('[role="alert"]')).not.toBeNull()
    // The household is read again, as on every screen of the settings: no control is left to
    // be refused a second time, and what the page says of it stays.
    await waitFor(() => {
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: 'Remove Petr Tilcer' })).not.toBeInTheDocument()
    expect(said).toBeInTheDocument()
  })

  // A row chosen and then put back is no change. Kept as one, it would come back as this
  // owner's the moment another owner changed that row, and be sent over theirs.
  it('holds no change of a row that was put back, whoever changes that row next', async () => {
    const server = createServer()
    taking(server, petr)
    const { user } = await page(petr, server)
    await user.selectOptions(row('Finance'), 'Can see')
    await user.selectOptions(row('Finance'), 'Off')
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()

    // Another owner lets Petr see Finance, and the page is looked at again.
    change(server, petr, {
      grants: { ...memberOf(petr, server.members).grants, finance: 'view' },
      version: 2,
    })
    act(() => {
      focusManager.setFocused(true)
    })
    await waitFor(() => {
      expect(row('Finance')).toHaveValue('view')
    })
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()

    await user.selectOptions(row('Tasks'), 'Can see')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => {
      expect(server.to(`PATCH ${at}/members/${petr}`)).toHaveLength(1)
    })
    expect(await server.body(`PATCH ${at}/members/${petr}`)).toEqual({ grants: { tasks: 'view' } })
  })

  it('says an owner who is one no longer may not change it, and keeps the sentence when the form goes', async () => {
    const server = createServer()
    server.on(`PATCH ${at}/members/${petr}`, () => {
      // Another owner made Jana a member a moment ago.
      server.household = { ...server.household, my_role: 'member' }
      return problem(403, 'forbidden')
    })
    const { user } = await page(petr, server)
    await user.selectOptions(row('Finance'), 'Can see')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    const said = await screen.findByText(
      'Only an owner can change this, and you are not one any more. Nothing was changed.',
    )
    // The household is read again, and the page is a reader's: the form is gone.
    await waitFor(() => {
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    })
    expect(said).toBeInTheDocument()
    expect(terms()).toEqual([
      'Can set it up · 1',
      'Can add and edit · 1',
      'Can see · 1',
      'Off · 13',
      'Household settings',
    ])
    // Every control went, the one that held the focus among them: it is on the page's own place.
    await waitFor(() => {
      expect(document.activeElement).not.toBe(document.body)
    })
    expect(document.activeElement).toContainElement(
      screen.getByText(/^Only an owner can change this/),
    )
  })
})

describe('a member’s role', () => {
  it('makes a member an owner, after saying what owners can do', async () => {
    const server = createServer()
    server.on(`POST ${at}/ownership/transfer`, () => {
      const next = { ...owning(server, petr), version: 2 }
      change(server, petr, next)
      return Response.json(next, { headers: { ETag: '"2"' } })
    })
    const { user } = await page(petr, server)
    await user.click(screen.getByRole('button', { name: 'Make Petr Tilcer an owner' }))
    const dialog = screen.getByRole('dialog', { name: 'Make Petr Tilcer an owner?' })
    expect(dialog).toHaveAccessibleDescription(
      'Owners invite and remove people, change what each person holds, turn modules on and off, and can delete the household. An owner can set up every module. There can be several owners, and this does not move billing.',
    )
    expect(
      within(dialog)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Cancel', 'Make Petr Tilcer an owner'])
    await user.click(within(dialog).getByRole('button', { name: 'Make Petr Tilcer an owner' }))

    expect(await screen.findByText('Petr Tilcer is an owner. They are told.')).toBeInTheDocument()
    expect(await server.body(`POST ${at}/ownership/transfer`)).toEqual({ user_id: petr })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // The page is an owner's now: the same control offers the way back, and there is no matrix.
    expect(
      await screen.findByRole('button', { name: 'Make Petr Tilcer a member' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Owner')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    })
    expect(terms()).toEqual(['Can set it up · 17'])
  })

  it('makes another owner a member, after saying what they keep and what is withdrawn', async () => {
    const server = createServer()
    owning(server, milos)
    taking(server, milos)
    const { user } = await page(milos, server)
    await user.click(screen.getByRole('button', { name: 'Make Miloš Tilcer a member' }))
    const dialog = screen.getByRole('dialog', { name: 'Make Miloš Tilcer a member?' })
    expect(dialog).toHaveAccessibleDescription(
      'Miloš Tilcer can no longer invite or remove people, change what anybody holds, or turn modules on and off. They keep the levels they hold now, which stay “Can set it up” until you lower them. The invitations they sent that are still waiting are withdrawn, and so are the links they sent to give a child profile its own sign-in.',
    )
    expect(
      within(dialog)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Cancel', 'Make Miloš Tilcer a member'])
    await user.click(within(dialog).getByRole('button', { name: 'Make Miloš Tilcer a member' }))

    expect(await screen.findByText('Miloš Tilcer is a member. They are told.')).toBeInTheDocument()
    const [sent] = server.to(`PATCH ${at}/members/${milos}`)
    expect(sent?.headers.get('If-Match')).toBe('"1"')
    expect(await server.body(`PATCH ${at}/members/${milos}`)).toEqual({ role: 'member' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // A member's page: the levels they kept are now an owner's to lower.
    expect(
      await screen.findByRole('button', { name: 'Make Miloš Tilcer an owner' }),
    ).toBeInTheDocument()
    expect(await screen.findByRole('combobox', { name: 'Finance' })).toHaveValue('manage')
  })

  it('asks nothing of the server where the owner thinks better of it', async () => {
    const server = createServer()
    const { user } = await page(petr, server)
    await user.click(screen.getByRole('button', { name: 'Make Petr Tilcer an owner' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(server.to(`POST ${at}/ownership/transfer`)).toHaveLength(0)
  })

  it('says that the one who pays stays an owner until billing has moved, where the server says so', async () => {
    const server = createServer()
    owning(server, milos)
    server.on(`PATCH ${at}/members/${milos}`, () => problem(409, 'billing_payer'))
    const { user } = await page(milos, server)
    const members = server.to(`GET ${at}/members/${milos}`).length
    await user.click(screen.getByRole('button', { name: 'Make Miloš Tilcer a member' }))
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Make Miloš Tilcer a member',
      }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Miloš Tilcer pays for the household, so they stay an owner until billing has moved to another owner. Nothing was changed.',
    )
    // The question's ground has moved: it closes, and the member is read again.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(server.to(`GET ${at}/members/${milos}`).length).toBeGreaterThan(members)
    })
  })

  it('says a household keeps at least one owner, where the server says this one is the last', async () => {
    const server = createServer()
    owning(server, milos)
    server.on(`PATCH ${at}/members/${milos}`, () => problem(409, 'last_owner'))
    const { user } = await page(milos, server)
    await user.click(screen.getByRole('button', { name: 'Make Miloš Tilcer a member' }))
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Make Miloš Tilcer a member',
      }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Miloš Tilcer is the household’s only owner, and a household keeps at least one. Nothing was changed.',
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('says a change of role could not reach the server, and leaves the question open', async () => {
    const server = createServer()
    server.on(`POST ${at}/ownership/transfer`, () => Promise.reject(new TypeError('offline')))
    const { user } = await page(petr, server)
    await user.click(screen.getByRole('button', { name: 'Make Petr Tilcer an owner' }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Make Petr Tilcer an owner' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      /^We couldn’t reach Household\./,
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  // Billing moves only between owners (FR-HH6): no button that could only be refused.
  it('offers neither a change of role nor a removal for the one who pays, and says what has to happen first', async () => {
    await page(jana.id, ownedBy(petr))
    expect(screen.queryByRole('button', { name: /Make Jana/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Remove Jana/ })).not.toBeInTheDocument()
    expect(
      screen.getByText(
        'Jana Tilcerová pays for the household, so they stay an owner until billing has moved to another owner.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Jana Tilcerová pays for the household, so billing moves to another owner before they can be removed.',
      ),
    ).toBeInTheDocument()
  })

  it('changes nobody’s own role from their own page, and leads to leaving', async () => {
    await page(jana.id)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Your membership' })).toBeInTheDocument()
    expect(
      screen.getByText(
        'You can’t change your own role or remove yourself here. Leaving Tilcerovi has its own screen.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Leave Tilcerovi' })).toHaveAttribute(
      'href',
      inHousehold.leave(home),
    )
  })

  it('leads a member to leaving from their own page too, and a child profile nowhere', async () => {
    const own = await page(petr, createServer(accountOf(petr)))
    expect(screen.getByRole('link', { name: 'Leave Tilcerovi' })).toBeInTheDocument()
    own.unmount()
    await page(adam, createServer(accountOf(adam)))
    expect(screen.queryByRole('link', { name: 'Leave Tilcerovi' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Your membership' })).not.toBeInTheDocument()
  })

  it('draws no control of a role or a removal for a member, nor for an owner of a child profile’s role', async () => {
    const reader = await page(klara, createServer(accountOf(petr)))
    expect(screen.queryByRole('heading', { name: 'Role' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Remove from the household' })).toBeNull()
    reader.unmount()
    // A role is never changed to or from child: the profile is given a sign-in instead.
    await page(adam)
    expect(screen.queryByRole('heading', { name: 'Role' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Make Adam/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove Adam' })).toBeInTheDocument()
  })
})

describe('removing a member', () => {
  it('says what becomes of what they made, removes them, and goes to the members', async () => {
    const server = createServer()
    server.on(`DELETE ${at}/members/${petr}`, () => {
      server.members = server.members.filter((each) => each.user_id !== petr)
      return noContent()
    })
    const { user, router } = await page(petr, server)
    await user.click(screen.getByRole('button', { name: 'Remove Petr Tilcer' }))
    const dialog = screen.getByRole('dialog', { name: 'Remove Petr Tilcer from Tilcerovi?' })
    expect(dialog).toHaveAccessibleDescription(
      'What Petr Tilcer added stays: it is the household’s record, with their name on it. Their private notes and documents are deleted after thirty days, and they can export them until then. Petr Tilcer is told.',
    )
    // The safe choice first, then the one that names who is removed and from what.
    expect(
      within(dialog)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Cancel', 'Remove Petr Tilcer from Tilcerovi'])
    const asked = server.to(`GET ${at}/members/${petr}`).length
    const listed = server.to(`GET ${at}/members`).length
    await user.click(
      within(dialog).getByRole('button', { name: 'Remove Petr Tilcer from Tilcerovi' }),
    )

    expect(await screen.findByText('Petr Tilcer was removed. They are told.')).toBeInTheDocument()
    expect(server.to(`DELETE ${at}/members/${petr}`)).toHaveLength(1)
    // The page was about them: it goes to the list, in its own place in the history.
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(inHousehold.members(home))
    })
    expect(router.state.historyAction).toBe('REPLACE')
    expect(await screen.findByRole('heading', { level: 1, name: 'Members' })).toBeInTheDocument()
    // The household is read again once the page has left, and the member never is: their own
    // address would answer that it opens nothing, and the page would have said so on its way.
    await waitFor(() => {
      expect(server.to(`GET ${at}/members`).length).toBeGreaterThan(listed)
    })
    expect(server.to(`GET ${at}/members/${petr}`)).toHaveLength(asked)
    expect(screen.queryByText('This link doesn’t open anything here.')).not.toBeInTheDocument()
  })

  it('says of a child profile that it ends with its PIN and its sign-ins, and tells nobody', async () => {
    const server = createServer()
    server.on(`DELETE ${at}/members/${adam}`, noContent)
    const { user, router } = await page(adam, server)
    await user.click(screen.getByRole('button', { name: 'Remove Adam' }))
    const dialog = screen.getByRole('dialog', { name: 'Remove Adam from Tilcerovi?' })
    expect(dialog).toHaveAccessibleDescription(
      'The profile, its PIN and its sign-ins end with it: a child profile has no account outside the household. What Adam added stays, as the household’s record.',
    )
    await user.click(within(dialog).getByRole('button', { name: 'Remove Adam from Tilcerovi' }))
    expect(await screen.findByText('Adam was removed.')).toBeInTheDocument()
    expect(screen.queryByText(/They are told/)).not.toBeInTheDocument()
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(inHousehold.members(home))
    })
  })

  it('keeps a member the owner thinks better of removing', async () => {
    const server = createServer()
    const { user, router } = await page(petr, server)
    await user.click(screen.getByRole('button', { name: 'Remove Petr Tilcer' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(server.to(`DELETE ${at}/members/${petr}`)).toHaveLength(0)
    expect(router.state.location.pathname).toBe(inHousehold.member(home, petr))
  })

  it('says billing moves first where the server says they pay, and removes nobody', async () => {
    const server = createServer()
    server.on(`DELETE ${at}/members/${petr}`, () => problem(409, 'billing_payer'))
    const { user, router } = await page(petr, server)
    await user.click(screen.getByRole('button', { name: 'Remove Petr Tilcer' }))
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Remove Petr Tilcer from Tilcerovi',
      }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Petr Tilcer pays for the household, so billing moves to another owner before they can be removed.',
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(router.state.location.pathname).toBe(inHousehold.member(home, petr))
  })

  it('says a removal could not reach the server, and leaves the question open', async () => {
    const server = createServer()
    server.on(`DELETE ${at}/members/${petr}`, () => Promise.reject(new TypeError('offline')))
    const { user, router } = await page(petr, server)
    await user.click(screen.getByRole('button', { name: 'Remove Petr Tilcer' }))
    const dialog = screen.getByRole('dialog')
    await user.click(
      within(dialog).getByRole('button', { name: 'Remove Petr Tilcer from Tilcerovi' }),
    )
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      /^We couldn’t reach Household\./,
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(inHousehold.member(home, petr))
  })
})
