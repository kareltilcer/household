// The two resolvers and the kept-loser banner (F-6, F-7), over a stand-in replica and fixture
// answers: what each says of an answer, and what each decision asks of the replica.
import { catalogs } from '@household/i18n'
import type { RecordedOutcome } from '@household/sync'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { Providers } from '../app/App.tsx'
import { paths } from '../app/paths.ts'
import {
  answer,
  conflict,
  conflictWithDeletion,
  describersFor,
  me,
  overriddenMerge,
  registry,
  rejections,
  rejectionWith,
  replacingMerge,
  settingFor,
} from '../dev/sync/fixtures.ts'
import { standIn, type StandIn } from '../dev/sync/standIn.ts'
import { ConflictResolver } from './ConflictResolver.tsx'
import { KeptLoser } from './KeptLoser.tsx'
import { rejectionCodes, rejectionOf } from './rejection.ts'
import { RejectedResolver } from './RejectedResolver.tsx'
import { SyncFixture, type Sync } from './ReplicaProvider.tsx'
import { Resolver } from './Resolver.tsx'

const words = {
  settlement: 'March electricity settlement',
  mine: 'Your version',
  petr: 'Petr',
  keepMine: 'Keep mine',
  keepTheirs: 'Keep theirs',
  keptMine: 'Your version of March electricity settlement was kept and will be sent.',
  keptTheirs: 'The other version of March electricity settlement was kept. Yours was let go.',
  nothing:
    'Nothing was sent: this is no longer in this browser, so there was nothing to change. You can let your change go.',
  failed: 'That didn’t work, and nothing was changed. Try again.',
  another: 'Another member',
  elsewhere: 'You, on another device',
  deleted: 'Deleted',
  readonly:
    'This household can’t be changed right now, so neither version can be chosen yet. Yours is kept in this browser, and the question waits here.',
  open: 'Open it',
  retry: 'Try again',
  edit: 'Edit',
  discard: 'Discard',
  oatMilk: 'Oat milk',
  discardTitle: 'Discard your change to Oat milk',
  discardBody:
    'What you entered is let go: it is never sent, and no longer shown here. It can’t be brought back.',
  keepIt: 'Keep it',
  discardIt: 'Discard the change',
  discarded: 'Your change to Oat milk was discarded.',
  retried: 'Your change to Oat milk will be sent again.',
  yours: 'Your change',
  neighbour: 'The entry next to it',
  kept: 'Your change isn’t lost. It stays in this browser until you decide what to do with it.',
  waits:
    'This household can’t be changed right now. You can decide what to do with this once it can.',
  shopping: 'Shopping',
  entered: 'What you entered',
  saved: 'What is saved now',
  overridden: 'Part of your change was replaced',
  replaced: 'Your change replaced a version you hadn’t seen',
  putAway: 'Put it away',
  hint: 'Copy anything you still need. Once you put it away, it is no longer shown here.',
  page: 'Somewhere else',
} as const

/** The fixtures as they are written: no pseudo-locale accents them here. */
const plain = (text: string) => text
const describers = describersFor(plain)

/** `ui` on a page of its own, over `stand`, with the address the fixtures' rows open at beside it. */
function draw(ui: ReactNode, stand: StandIn) {
  const sync: Sync = { replica: { phase: 'open', ...stand.opened }, online: true, receiving: true }
  const router = createMemoryRouter(
    [
      { path: '/', element: <SyncFixture value={sync}>{ui}</SyncFixture> },
      { path: paths.devSync.path, element: <p>{words.page}</p> },
    ],
    { initialEntries: ['/'] },
  )
  render(
    <Providers persist={false}>
      <RouterProvider router={router} />
    </Providers>,
  )
  return router
}

function drawConflict(
  outcome: RecordedOutcome,
  { writes = true, retry }: { writes?: boolean; retry?: () => boolean } = {},
) {
  const stand = standIn({ registry, entries: [outcome], ...(retry === undefined ? {} : { retry }) })
  const onClose = vi.fn()
  const router = draw(
    <ConflictResolver
      outcome={outcome}
      onClose={onClose}
      setting={settingFor(plain, { writes })}
      describers={describers}
    />,
    stand,
  )
  return { stand, onClose, router }
}

function drawRejected(
  outcome: RecordedOutcome,
  {
    writes = true,
    known = describers,
    retry,
  }: Parameters<typeof drawConflict>[1] & {
    known?: typeof describers
  } = {},
) {
  const stand = standIn({ registry, entries: [outcome], ...(retry === undefined ? {} : { retry }) })
  const onClose = vi.fn()
  const router = draw(
    <RejectedResolver
      outcome={outcome}
      onClose={onClose}
      setting={settingFor(plain, { writes })}
      describers={known}
    />,
    stand,
  )
  return { stand, onClose, router }
}

/** The block of one version in a panel, by its heading. */
function version(name: string): HTMLElement {
  const block = screen.getByRole('heading', { level: 3, name }).closest('section')
  if (block === null) throw new Error(`no version headed ${name}`)
  return block
}

describe('the conflict resolver', () => {
  it('asks which version is right, with both values, both authors and both times', () => {
    drawConflict(conflict)
    const panel = screen.getByRole('dialog', { name: words.settlement })
    expect(within(panel).getByText(/Which one is right\?$/)).toBeVisible()
    // The member's own: what they set, and when their device made the change, in the
    // household's zone, which is an hour ahead of the instant as it is written.
    expect(version(words.mine)).toHaveTextContent(/450\.00/)
    expect(version(words.mine)).toHaveTextContent(/6:12/)
    // The other author's: the row the server answered with, under their name.
    expect(version(words.petr)).toHaveTextContent(/500\.00/)
    expect(version(words.petr)).toHaveTextContent(/6:40/)
    // No jargon: nothing of the answer's own vocabulary is drawn.
    expect(panel).not.toHaveTextContent(/version_conflict|amount_minor|remote|refused:/)
    expect(within(panel).getByText('Two versions')).toBeVisible()
    expect(within(panel).getByText('Finance')).toBeVisible()
  })

  it('writes the member’s change again when they keep their own, and says so', async () => {
    const { stand, onClose } = drawConflict(conflict)
    await userEvent.click(screen.getByRole('button', { name: words.keepMine }))
    expect(stand.asked).toEqual(['retry:c1'])
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(words.keptMine)).toBeVisible()
  })

  it('gives the member’s change up when they keep the other', async () => {
    const { stand, onClose } = drawConflict(conflict)
    await userEvent.click(screen.getByRole('button', { name: words.keepTheirs }))
    expect(stand.asked).toEqual(['discard:c1'])
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(words.keptTheirs)).toBeVisible()
  })

  it('says a retry wrote nothing, stays open, and offers it no more', async () => {
    const { stand, onClose } = drawConflict(conflict, { retry: () => false })
    await userEvent.click(screen.getByRole('button', { name: words.keepMine }))
    expect(await screen.findByText(words.nothing)).toBeVisible()
    expect(stand.asked).toEqual(['retry:c1'])
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: words.keepMine })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: words.keepTheirs })).toBeVisible()
  })

  it('says a decision the replica could not carry out changed nothing', async () => {
    const { onClose } = drawConflict(conflict, {
      retry: () => {
        throw new Error('the database is closed')
      },
    })
    await userEvent.click(screen.getByRole('button', { name: words.keepMine }))
    expect(await screen.findByRole('alert')).toHaveTextContent(words.failed)
    expect(onClose).not.toHaveBeenCalled()
    // And it can be asked again.
    expect(screen.getByRole('button', { name: words.keepMine })).toBeVisible()
  })

  it('names an author it cannot name as another member, and a deletion as one', () => {
    drawConflict(conflictWithDeletion)
    expect(version(words.another)).toHaveTextContent(words.deleted)
    // A deletion holds nothing to compare.
    expect(within(version(words.another)).queryByRole('term')).not.toBeInTheDocument()
    expect(within(version(words.mine)).getByRole('term')).toHaveTextContent('Due')
  })

  it('names the member’s own other device as theirs', () => {
    drawConflict(
      answer({
        id: 'c3',
        entityType: 'finance.settlement',
        outcome: 'conflict',
        fields: { amount_minor: 100 },
        row: { title: words.settlement, amount_minor: 200, currency: 'CZK', updated_by: me },
      }),
    )
    expect(version(words.elsewhere)).toHaveTextContent(/2\.00/)
  })

  // Read-only removes the answer, and not the question (FR-BI2): neither version can be chosen
  // where one of them could not be sent, and the conflict waits as it is.
  it('reads and does not answer in a household that does not write, and says why', () => {
    const { stand, onClose } = drawConflict(conflict, { writes: false })
    const panel = screen.getByRole('dialog', { name: words.settlement })
    expect(within(panel).getByText(words.readonly)).toBeVisible()
    // Both versions are still there to read.
    expect(version(words.mine)).toHaveTextContent(/450\.00/)
    expect(version(words.petr)).toHaveTextContent(/500\.00/)
    expect(screen.queryByRole('button', { name: words.keepMine })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: words.keepTheirs })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: words.open })).not.toBeInTheDocument()
    // Its one control closes it. Absent, not disabled.
    expect(within(panel).getAllByRole('button')).toHaveLength(1)
    expect(document.querySelector(':disabled, [aria-disabled="true"]')).toBeNull()
    expect(stand.asked).toEqual([])
    expect(onClose).not.toHaveBeenCalled()
  })

  it('leads to the row’s own editor for a value that is neither, and has no field of its own', async () => {
    const { onClose, router } = drawConflict(conflict)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: words.open }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(router.state.location.pathname).toBe(paths.devSync.path)
  })

  it('is closed with no answer, and with no replica open in this tab', () => {
    const stand = standIn({ registry })
    draw(
      <Resolver
        outcome={undefined}
        onClose={() => undefined}
        setting={settingFor(plain)}
        describers={describers}
      />,
      stand,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('a change that was not accepted', () => {
  it('has a sentence of its own for every code, and one for any other', () => {
    const codes = [...rejectionCodes, 'teapot', null]
    const sentences = codes.map((code) => catalogs.en[rejectionOf(code).reason])
    for (const sentence of sentences) expect(sentence.trim()).not.toBe('')
    // The two that are no code share the one for anything else, and nothing else shares any.
    expect(new Set(sentences).size).toBe(rejectionCodes.length + 1)
    expect(rejectionOf('teapot')).toBe(rejectionOf(null))
    // No shared "something went wrong": none says only that it failed.
    expect(sentences.filter((sentence) => /something went wrong/i.test(sentence))).toEqual([])
  })

  it('is offered again only where sending it again could be accepted', () => {
    const offered = (code: string) => {
      const { retry, held } = rejectionOf(code)
      return { retry, held }
    }
    // Held, and sent by the replica itself when the household writes again (FR-BI2).
    expect(offered('entitlement_read_only')).toEqual({ retry: false, held: true })
    expect(offered('entitlement_restricted')).toEqual({ retry: false, held: true })
    // One mutation the server will not take at its size is the same size the second time.
    expect(offered('payload_too_large')).toEqual({ retry: false, held: false })
    for (const code of [
      'monotonicity_violation',
      'forbidden',
      'not_found',
      'validation_failed',
      'fair_use_ceiling',
      'teapot',
    ]) {
      expect(offered(code), code).toEqual({ retry: true, held: false })
    }
  })

  it.each(rejections.map((entry) => [entry.code ?? '', entry] as const))(
    'says why in a sentence, and what can be done: %s',
    (code, outcome) => {
      drawRejected(outcome)
      const rejection = rejectionOf(code)
      const panel = screen.getByRole('dialog')
      expect(within(panel).getByText(catalogs.en[rejection.reason])).toBeVisible()
      expect(within(panel).getByText('Not accepted')).toBeVisible()
      // The server's own words for it are a developer's, and are not shown.
      expect(panel).not.toHaveTextContent(`refused: ${code}`)
      expect(within(panel).queryByRole('button', { name: words.retry }) !== null).toBe(
        rejection.retry,
      )
      // A change that is held says where it is kept in its own sentence.
      expect(within(panel).queryByText(words.kept) !== null).toBe(!rejection.held)
      expect(within(panel).getByRole('button', { name: words.discard })).toBeVisible()
      expect(document.querySelector(':disabled, [aria-disabled="true"]')).toBeNull()
    },
  )

  it('shows what the member entered, as its module describes it', () => {
    drawRejected(rejectionWith('validation_failed'))
    const mine = version(words.yours)
    expect(
      within(mine)
        .getAllByRole('term')
        .map((term) => term.textContent),
    ).toEqual(['Item', 'Quantity'])
    expect(mine).toHaveTextContent(words.oatMilk)
    // A position in a list is no field a member set by name.
    expect(mine).not.toHaveTextContent('a0V')
  })

  it('names the neighbour’s value for a value that is out of order', () => {
    drawRejected(rejectionWith('monotonicity_violation'))
    expect(version(words.yours)).toHaveTextContent(/18,116 kWh/)
    const beside = version(words.neighbour)
    expect(beside).toHaveTextContent(/18,402\.4 kWh/)
    expect(beside).toHaveTextContent(/Mar 3, 2026/)
    // The sentence covers a value below the entry before it and one above the entry after it.
    expect(
      screen.getByText(/lower than the one before it or higher than the one after it/),
    ).toBeVisible()
  })

  it('reads a row no module describes plainly: its module’s name, each field by its key', () => {
    drawRejected(rejectionWith('forbidden'), { known: {} })
    expect(screen.getByRole('dialog', { name: words.shopping })).toBeVisible()
    const mine = version(words.yours)
    expect(
      within(mine)
        .getAllByRole('term')
        .map((term) => term.textContent),
    ).toEqual(['name', 'quantity', 'position'])
    expect(
      within(mine)
        .getAllByRole('definition')
        .map((value) => value.textContent),
    ).toEqual([words.oatMilk, '2', 'a0V'])
  })

  it('writes it again on a retry, and says so', async () => {
    const { stand, onClose } = drawRejected(rejectionWith('forbidden'))
    await userEvent.click(screen.getByRole('button', { name: words.retry }))
    expect(stand.asked).toEqual([`retry:${rejectionWith('forbidden').mutation_id}`])
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(words.retried)).toBeVisible()
  })

  it('says a retry wrote nothing, and leaves the discard', async () => {
    const { onClose } = drawRejected(rejectionWith('not_found'), { retry: () => false })
    await userEvent.click(screen.getByRole('button', { name: words.retry }))
    expect(await screen.findByText(words.nothing)).toBeVisible()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: words.retry })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: words.discard })).toBeVisible()
  })

  it('discards only after a confirmation that names the change', async () => {
    const outcome = rejectionWith('validation_failed')
    const { stand, onClose } = drawRejected(outcome)
    await userEvent.click(screen.getByRole('button', { name: words.discard }))
    const confirmation = screen.getByRole('dialog', { name: words.discardTitle })
    expect(confirmation).toHaveAccessibleDescription(words.discardBody)
    // The safe choice first, and it changes nothing.
    const [safe, destructive] = within(confirmation).getAllByRole('button')
    expect(safe).toHaveAccessibleName(words.keepIt)
    expect(destructive).toHaveAccessibleName(words.discardIt)
    await userEvent.click(within(confirmation).getByRole('button', { name: words.keepIt }))
    expect(screen.queryByRole('dialog', { name: words.discardTitle })).not.toBeInTheDocument()
    expect(stand.asked).toEqual([])
    expect(onClose).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: words.discard }))
    await userEvent.click(screen.getByRole('button', { name: words.discardIt }))
    expect(stand.asked).toEqual([`discard:${outcome.mutation_id}`])
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(words.discarded)).toBeVisible()
  })

  it('offers no editor where the row’s module gives no address', () => {
    // A shopping item is edited in its list, which the fixtures give no address of.
    drawRejected(rejectionWith('forbidden'))
    expect(screen.queryByRole('button', { name: words.edit })).not.toBeInTheDocument()
  })

  it('opens the row’s own editor where its module gives one', async () => {
    const { onClose, router } = drawRejected(rejectionWith('monotonicity_violation'))
    await userEvent.click(screen.getByRole('button', { name: words.edit }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(router.state.location.pathname).toBe(paths.devSync.path)
  })

  // Sending it again and giving it up are one choice, and with the first taken away it is none:
  // the change stays where it is kept until the household writes again.
  it.each(rejections.map((entry) => [entry.code ?? '', entry] as const))(
    'reads and does not answer in a household that does not write: %s',
    (code, outcome) => {
      const { stand } = drawRejected(outcome, { writes: false })
      const panel = screen.getByRole('dialog')
      const rejection = rejectionOf(code)
      // The reason is said as ever, and what the member entered is there to read.
      expect(within(panel).getByText(catalogs.en[rejection.reason])).toBeVisible()
      expect(version(words.yours)).toBeVisible()
      expect(screen.queryByRole('button', { name: words.retry })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: words.edit })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: words.discard })).not.toBeInTheDocument()
      // Its one control closes it. Absent, not disabled.
      expect(within(panel).getAllByRole('button')).toHaveLength(1)
      expect(document.querySelector(':disabled, [aria-disabled="true"]')).toBeNull()
      // A change that is held says in its own sentence that it goes by itself; any other says
      // that what becomes of it is decided once the household writes.
      expect(within(panel).queryByText(words.waits) !== null).toBe(!rejection.held)
      expect(stand.asked).toEqual([])
    },
  )

  it('is what a rejected row’s mark opens, and a conflict’s the comparison', () => {
    const stand = standIn({ registry })
    draw(
      <Resolver
        outcome={rejectionWith('forbidden')}
        onClose={() => undefined}
        setting={settingFor(plain)}
        describers={describers}
      />,
      stand,
    )
    expect(screen.getByRole('dialog', { name: words.oatMilk })).toBeVisible()
    expect(screen.getByText('Not accepted')).toBeVisible()
  })
})

describe('the kept loser', () => {
  function drawKept(outcome: RecordedOutcome) {
    const stand = standIn({ registry, entries: [outcome] })
    const router = draw(
      <KeptLoser outcome={outcome} setting={settingFor(plain)} describers={describers} />,
      stand,
    )
    return { stand, router }
  }

  it('shows what the member entered beside what is saved, where a field was overridden', () => {
    drawKept(overriddenMerge)
    expect(screen.getByText(words.overridden)).toBeVisible()
    const block = (label: string) => {
      const found = screen.getByText(label).parentElement
      if (found === null) throw new Error(`no block labelled ${label}`)
      return found
    }
    expect(within(block(words.entered)).getByRole('definition')).toHaveTextContent('2')
    expect(within(block(words.saved)).getByRole('definition')).toHaveTextContent('3')
    // What they entered is kept in this browser alone: the banner says to take what is needed.
    expect(screen.getByText(words.hint)).toBeVisible()
    // It is no question: nothing asks which is right.
    expect(screen.queryByRole('button', { name: words.keepMine })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('says a version the member’s own replaced was kept, and leads to the row', async () => {
    const { router } = drawKept(replacingMerge)
    expect(screen.getByText(words.replaced)).toBeVisible()
    expect(screen.getByText(/The version yours replaced wasn’t lost: it was kept\.$/)).toBeVisible()
    // Nothing of the member's was lost, so there is nothing to copy.
    expect(screen.queryByText(words.hint)).not.toBeInTheDocument()
    expect(screen.queryByText(words.entered)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: words.open }))
    expect(router.state.location.pathname).toBe(paths.devSync.path)
  })

  it('is put away by its own control, which marks the answer seen', async () => {
    const { stand } = drawKept(overriddenMerge)
    await userEvent.click(screen.getByRole('button', { name: words.putAway }))
    expect(stand.asked).toEqual(['resolve:m1'])
  })
})
