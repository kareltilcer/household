// The two resolvers and the kept loser (F-6, F-7, D-39): what each shows, what each control does
// to the replica, what is absent in a household that takes no writes, and what is said to
// whoever cannot see the screen. The web's cases, on a device
// (apps/web/src/sync/resolvers.test.tsx), over the same fixtures and a stand-in replica.
//
// A modal tells its owner when it has gone from the screen. Android says so as it is closed and
// iOS some time after, by an event Jest's stand-in for the platform's modal never sends. Jest
// runs as iOS: a case in which something waits for a modal to have gone runs as Android
// (`asAndroid`), or sends iOS's event itself. The accessibility rules hold what either draws.
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { money } from '@household/domain'
import { controls } from '@household/icons'
import { catalogs } from '@household/i18n'
import type { RecordedOutcome } from '@household/sync'
import { act, screen, userEvent, waitFor, within } from '@testing-library/react-native'
import { router } from 'expo-router'
import { useState, type ReactNode } from 'react'
import { Platform } from 'react-native'
import { paths } from '../app/paths.ts'
import { createFormatters } from '../i18n/format.ts'
import { expectAccessible } from '../test/a11y.ts'
import { render, type DrawOptions } from '../test/render.tsx'
import * as announcer from '../ui/announce.ts'
import { KeptLoser } from './KeptLoser.tsx'
import { rejectionCodes, rejectionOf } from './rejection.ts'
import { SyncFixture, type Sync } from './ReplicaProvider.tsx'
import { Resolver } from './Resolver.tsx'
import { standIn, type StandIn } from './standIn.ts'
import {
  conflict,
  conflictWithDeletion,
  describersFor,
  overriddenMerge,
  registry,
  rejections,
  rejectionWith,
  replacingMerge,
  settingFor,
} from './sync.fixtures.ts'

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }))

const en = catalogs.en
const format = createFormatters('en')

/** The fixtures as they are written: no pseudo-locale accents them here. */
const plain = (text: string) => text
const describers = describersFor(plain)

const settlement = 'March electricity settlement'
const oatMilk = 'Oat milk'
const amount = (minor: number) => format.money(money(minor, 'CZK'))
const at = (instant: string) => format.instant(instant, 'Europe/Prague')

interface HeldOptions {
  readonly writes?: boolean
  readonly retry?: (mutationId: string) => boolean
  readonly known?: typeof describers
  readonly onClosed?: () => void
}

/** How often a resolver asked to be closed. */
let closes = 0

/** A screen that holds an answer open in its resolver, and closes it when the resolver asks. */
function Held({
  outcome,
  writes = true,
  known = describers,
  onClosed,
}: HeldOptions & { readonly outcome: RecordedOutcome }) {
  const [shown, setShown] = useState<RecordedOutcome | undefined>(outcome)
  return (
    <Resolver
      outcome={shown}
      onClose={() => {
        closes += 1
        setShown(undefined)
      }}
      onClosed={onClosed}
      setting={settingFor(plain, { writes })}
      describers={known}
    />
  )
}

async function over(stand: StandIn, ui: ReactNode, options?: DrawOptions) {
  const sync: Sync = { replica: { phase: 'open', ...stand.opened }, online: true, receiving: true }
  return render(<SyncFixture value={sync}>{ui}</SyncFixture>, options)
}

async function resolving(outcome: RecordedOutcome, options: HeldOptions = {}, draw?: DrawOptions) {
  const stand = standIn({
    registry,
    entries: [outcome],
    ...(options.retry === undefined ? {} : { retry: options.retry }),
  })
  await over(stand, <Held outcome={outcome} {...options} />, draw)
  return stand
}

const sheet = () => screen.getByTestId('resolver:surface')
const version = (index: number) => screen.getByTestId(`sync:version:${String(index)}`)
const toasts = () => screen.queryAllByTestId('toast')

/** The platform that says a modal has gone as it is closed. */
function asAndroid(): void {
  jest.replaceProperty(Platform, 'OS', 'android')
}

beforeEach(() => {
  closes = 0
  jest.mocked(router.push).mockClear()
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('the conflict resolver', () => {
  it('asks which version is right, with both values, both authors and both times', async () => {
    await resolving(conflict)
    expect(screen.getByRole('header', { name: settlement })).toBeOnTheScreen()
    expect(within(sheet()).getByText(en['sync.conflict.question'])).toBeOnTheScreen()
    // Said three ways, and of the module it belongs to.
    expect(within(sheet()).getByTestId('status:conflict')).toHaveTextContent(
      en['a11y.status.conflict'],
    )
    expect(within(sheet()).getByText(en['module.finance.name'])).toBeOnTheScreen()
    // The member's own first, as their device made it; then the other author's, as the row says.
    expect(
      within(version(0)).getByRole('header', { name: en['sync.conflict.mine'] }),
    ).toBeOnTheScreen()
    expect(version(0)).toHaveTextContent(amount(45000), { exact: false })
    expect(version(0)).toHaveTextContent(at('2026-03-03T17:12:00Z'), { exact: false })
    expect(within(version(1)).getByRole('header', { name: 'Petr' })).toBeOnTheScreen()
    expect(version(1)).toHaveTextContent(amount(50000), { exact: false })
    expect(version(1)).toHaveTextContent(at('2026-03-03T17:40:00Z'), { exact: false })
    // No jargon: nothing of versions' numbers, of a remote, or of the server's own words.
    expect(sheet()).not.toHaveTextContent(/version_conflict|remote|vector|refused:/i)
    expectAccessible()
  })

  it('writes the member’s change again when they keep their own, closes, and says so in a toast', async () => {
    const announce = jest.spyOn(announcer, 'announce').mockImplementation(() => undefined)
    const stand = await resolving(conflict)
    await userEvent.press(screen.getByRole('button', { name: en['sync.conflict.keep_mine'] }))
    await waitFor(() => {
      expect(closes).toBe(1)
    })
    expect(stand.asked).toEqual([`retry:${conflict.mutation_id}`])
    expect(screen.queryByTestId('resolver:surface')).toBeNull()
    const kept = `Your version of ${settlement} was kept and will be sent.`
    expect(toasts()).toHaveLength(1)
    expect(toasts()[0]).toHaveTextContent(kept, { exact: false })
    // And said, once the screen reader has finished: no control of this screen says it.
    expect(announce).toHaveBeenCalledWith(`${en['ui.toast.label']}: ${kept}`)
  })

  it('gives the member’s change up when they keep the other', async () => {
    const stand = await resolving(conflict)
    await userEvent.press(screen.getByTestId('resolver:keep-theirs'))
    await waitFor(() => {
      expect(closes).toBe(1)
    })
    expect(stand.asked).toEqual([`discard:${conflict.mutation_id}`])
    expect(toasts()[0]).toHaveTextContent(
      `The other version of ${settlement} was kept. Yours was let go.`,
      { exact: false },
    )
  })

  it('says a retry wrote nothing, at once and aloud, stays open, and offers it no more', async () => {
    const announce = jest.spyOn(announcer, 'announce').mockImplementation(() => undefined)
    const stand = await resolving(conflict, { retry: () => false })
    await userEvent.press(screen.getByTestId('resolver:keep-mine'))
    const trouble = await screen.findByTestId('sync:trouble:nothing')
    expect(trouble).toHaveTextContent(en['device.sync.retry.nothing'], { exact: false })
    // On a device it is this device that no longer holds it.
    expect(en['device.sync.retry.nothing']).toContain('this device')
    expect(announce).toHaveBeenCalledWith(en['device.sync.retry.nothing'])
    expect(closes).toBe(0)
    expect(stand.asked).toEqual([`retry:${conflict.mutation_id}`])
    // Absent, and not disabled: the member's version cannot be sent again.
    expect(screen.queryByTestId('resolver:keep-mine')).toBeNull()
    expect(screen.getByTestId('resolver:keep-theirs')).toBeOnTheScreen()
    expectAccessible()
  })

  it('says a decision the replica could not carry out changed nothing, over whatever is being said', async () => {
    const urgent = jest.spyOn(announcer, 'announceNow').mockImplementation(() => undefined)
    await resolving(conflict, {
      retry: () => {
        throw new Error('the database is closed')
      },
    })
    await userEvent.press(screen.getByTestId('resolver:keep-mine'))
    expect(await screen.findByTestId('sync:trouble:failed')).toHaveTextContent(
      en['sync.action.failed'],
      { exact: false },
    )
    expect(urgent).toHaveBeenCalledWith(en['sync.action.failed'])
    expect(closes).toBe(0)
    // Both answers are there to be given again.
    expect(screen.getByTestId('resolver:keep-mine')).toBeOnTheScreen()
    expect(screen.getByTestId('resolver:keep-theirs')).toBeOnTheScreen()
  })

  it('takes one decision at a time: the one under way is busy, and the other takes no press', async () => {
    let write: (wrote: boolean) => void = () => undefined
    const stand = standIn({ registry, entries: [conflict] })
    const retry = jest
      .spyOn(stand.opened.replica, 'retry')
      .mockImplementation(() => new Promise<boolean>((resolve) => (write = resolve)))
    const discard = jest.spyOn(stand.opened.replica, 'discard')
    await over(stand, <Held outcome={conflict} />)
    await userEvent.press(screen.getByTestId('resolver:keep-mine'))
    expect(screen.getByTestId('resolver:keep-mine')).toBeBusy()
    // It stays where it is and keeps its name, and is said to take no press: never removed.
    expect(screen.getByTestId('resolver:keep-theirs')).toBeDisabled()
    await userEvent.press(screen.getByTestId('resolver:keep-theirs'))
    await userEvent.press(screen.getByTestId('resolver:keep-mine'))
    expect(discard).not.toHaveBeenCalled()
    expect(retry).toHaveBeenCalledTimes(1)
    expectAccessible(undefined, { outOfForm: [en['sync.conflict.keep_theirs']] })
    await act(() => {
      write(true)
    })
    await waitFor(() => {
      expect(closes).toBe(1)
    })
  })

  it('names an author it cannot name as another member, and a deletion as one', async () => {
    await resolving(conflictWithDeletion)
    expect(
      within(version(1)).getByRole('header', { name: en['sync.author.unknown'] }),
    ).toBeOnTheScreen()
    // A deleted row holds nothing to compare: it says that it was deleted, and when.
    expect(version(1)).toHaveTextContent(en['sync.version.deleted'], { exact: false })
    expect(version(1)).toHaveTextContent(at('2026-03-02T08:05:00Z'), { exact: false })
    expect(version(1)).not.toHaveTextContent(format.day('2026-03-10'), { exact: false })
    expect(version(0)).toHaveTextContent(format.day('2026-03-20'), { exact: false })
  })

  it('names the member’s own other device as theirs', async () => {
    const own = {
      ...conflict,
      row: { ...(conflict.row as object), updated_by: '0198a000-0000-7000-8000-0000000000a1' },
    }
    await resolving(own)
    expect(within(version(1)).getByRole('header', { name: en['sync.author.me'] })).toBeOnTheScreen()
  })

  it('reads and does not answer in a household that takes no writes, and says why', async () => {
    const stand = await resolving(conflict, { writes: false })
    // Absent, and not disabled: with one answer taken away it would be no question.
    expect(screen.queryByTestId('resolver:keep-mine')).toBeNull()
    expect(screen.queryByTestId('resolver:keep-theirs')).toBeNull()
    expect(screen.queryByTestId('resolver:open')).toBeNull()
    expect(within(sheet()).getByTestId('banner:warning')).toHaveTextContent(
      en['device.sync.conflict.readonly'],
      { exact: false },
    )
    // Both versions are still read.
    expect(version(0)).toHaveTextContent(amount(45000), { exact: false })
    expect(version(1)).toHaveTextContent(amount(50000), { exact: false })
    // And it is closed by its own control, with nothing asked of the replica.
    await userEvent.press(screen.getByRole('button', { name: en[controls.close_sheet.labelKey] }))
    expect(closes).toBe(1)
    expect(stand.asked).toEqual([])
    expectAccessible()
  })

  it('leads to the row’s own editor for a value that is neither, and has no field of its own', async () => {
    await resolving(conflict)
    expect(within(sheet()).getByText(en['sync.conflict.neither'])).toBeOnTheScreen()
    await userEvent.press(screen.getByTestId('resolver:open'))
    expect(closes).toBe(1)
    expect(jest.mocked(router.push).mock.calls).toEqual([[paths.devSync.path]])
  })

  it('draws nothing with no answer to show, and nothing where no replica is open', async () => {
    const stand = standIn({ registry })
    const view = await over(
      stand,
      <Resolver
        outcome={undefined}
        onClose={() => undefined}
        setting={settingFor(plain)}
        describers={describers}
      />,
    )
    expect(screen.queryByTestId('resolver')).toBeNull()
    await view.unmount()
    await render(
      <SyncFixture value={{ replica: { phase: 'opening' }, online: true, receiving: null }}>
        <Held outcome={conflict} />
      </SyncFixture>,
    )
    expect(screen.queryByTestId('resolver')).toBeNull()
  })

  it('is nothing clipped and nothing unnamed at 200 % text, in German', async () => {
    await resolving(conflict, {}, { scale: 2, locale: 'de' })
    expect(
      screen.getByRole('button', { name: catalogs.de['sync.conflict.keep_mine'] }),
    ).toBeOnTheScreen()
    expectAccessible()
  })
})

describe('a change that was not accepted', () => {
  it('has a sentence of its own for every code, and one for any other', () => {
    const codes = [...rejectionCodes, 'teapot', null]
    const sentences = codes.map((code) => en[rejectionOf(code).reason])
    for (const sentence of sentences) expect(sentence.trim()).not.toBe('')
    // The two that are no code share the one for anything else, and nothing else shares any.
    expect(new Set(sentences).size).toBe(rejectionCodes.length + 1)
    expect(rejectionOf('teapot')).toBe(rejectionOf(null))
    // No shared "something went wrong": none says only that it failed.
    expect(sentences.filter((sentence) => /something went wrong/i.test(sentence))).toEqual([])
    // And none says where a change is kept in a browser's words.
    expect(sentences.filter((sentence) => /browser|tab|reload/i.test(sentence))).toEqual([])
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
      expect([code, offered(code)]).toEqual([code, { retry: true, held: false }])
    }
  })

  it.each(rejections.map((entry) => [entry.code ?? '', entry] as const))(
    'says why in a sentence, and what can be done: %s',
    async (code, outcome) => {
      await resolving(outcome)
      const rejection = rejectionOf(code)
      expect(within(sheet()).getByText(en[rejection.reason])).toBeOnTheScreen()
      expect(within(sheet()).getByTestId('status:rejected')).toHaveTextContent(
        en['a11y.status.rejected'],
      )
      // The server's own words for it are a developer's, and are not shown.
      expect(sheet()).not.toHaveTextContent(`refused: ${code}`, { exact: false })
      expect(screen.queryByTestId('resolver:retry') !== null).toBe(rejection.retry)
      // A change that is held says where it is kept in its own sentence.
      expect(within(sheet()).queryByText(en['device.sync.rejected.kept']) !== null).toBe(
        !rejection.held,
      )
      expect(screen.getByTestId('resolver:discard')).toBeOnTheScreen()
      // Nothing that cannot act is drawn at all.
      expectAccessible()
    },
  )

  it('shows what the member entered, as its module describes it', async () => {
    await resolving(rejectionWith('validation_failed'))
    expect(
      within(version(0)).getByRole('header', { name: en['sync.change.yours'] }),
    ).toBeOnTheScreen()
    expect(version(0)).toHaveTextContent(oatMilk, { exact: false })
    expect(version(0)).toHaveTextContent(/Item.*Quantity/)
    // A position in a list is no field a member set by name.
    expect(version(0)).not.toHaveTextContent('a0V', { exact: false })
    // One version: nobody disagreed with anybody.
    expect(screen.queryByTestId('sync:version:1')).toBeNull()
  })

  it('names the neighbour’s value for a value that is out of order', async () => {
    await resolving(rejectionWith('monotonicity_violation'))
    expect(
      within(version(1)).getByRole('header', { name: en['sync.rejected.neighbour'] }),
    ).toBeOnTheScreen()
    expect(version(0)).toHaveTextContent(`${format.number(18116)} kWh`, { exact: false })
    expect(version(1)).toHaveTextContent(`${format.number(18402.4)} kWh`, { exact: false })
    // Nothing is said of a field the neighbour does not carry.
    expect(version(1)).not.toHaveTextContent(en['ui.kv.none'], { exact: false })
  })

  it('reads a row no module describes plainly: its module’s name, each field by its key', async () => {
    await resolving(rejectionWith('forbidden'), { known: {} })
    expect(screen.getByRole('header', { name: en['module.shopping.name'] })).toBeOnTheScreen()
    expect(version(0)).toHaveTextContent(/name.*Oat milk.*quantity.*2.*position.*a0V/)
    // With no module to say where the row is edited, no editor is offered.
    expect(screen.queryByTestId('resolver:edit')).toBeNull()
  })

  it('writes it again on a retry, closes, and says so', async () => {
    const stand = await resolving(rejectionWith('forbidden'))
    await userEvent.press(screen.getByRole('button', { name: en['ui.retry'] }))
    await waitFor(() => {
      expect(closes).toBe(1)
    })
    expect(stand.asked).toEqual([`retry:${rejectionWith('forbidden').mutation_id}`])
    expect(toasts()[0]).toHaveTextContent(`Your change to ${oatMilk} will be sent again.`, {
      exact: false,
    })
  })

  it('says a retry wrote nothing, and leaves the discard', async () => {
    await resolving(rejectionWith('forbidden'), { retry: () => false })
    await userEvent.press(screen.getByTestId('resolver:retry'))
    expect(await screen.findByTestId('sync:trouble:nothing')).toBeOnTheScreen()
    expect(screen.queryByTestId('resolver:retry')).toBeNull()
    expect(screen.getByTestId('resolver:discard')).toBeOnTheScreen()
    expect(closes).toBe(0)
  })

  it('discards only after a confirmation that names the change, drawn inside the sheet', async () => {
    asAndroid()
    const stand = await resolving(rejectionWith('forbidden'))
    await userEvent.press(screen.getByRole('button', { name: en['sync.rejected.discard'] }))
    expect(stand.asked).toEqual([])
    // Named for what it gives up, and saying what is lost.
    const confirmation = screen.getByTestId('resolver:confirm:surface')
    expect(
      within(confirmation).getByRole('header', { name: `Discard your change to ${oatMilk}` }),
    ).toBeOnTheScreen()
    expect(within(confirmation).getByText(en['sync.discard.body'])).toBeOnTheScreen()
    // Inside the sheet's own modal: iOS presents a modal from the one it stands in.
    expect(within(screen.getByTestId('resolver')).getByTestId('resolver:confirm')).toBeOnTheScreen()
    // The safe choice first, and the one that destroys names what it destroys.
    const [safe, destroys] = within(confirmation).getAllByRole('button')
    expect(safe).toHaveTextContent(en['sync.discard.keep'])
    expect(destroys).toHaveTextContent(en['sync.discard.confirm'])
    // The sheet's mark and the confirmation over it, as Android draws a glyph.
    expectAccessible()

    // Kept: the confirmation leaves, the sheet stays, and nothing was asked.
    await userEvent.press(screen.getByTestId('resolver:confirm:keep'))
    expect(screen.queryByTestId('resolver:confirm:surface')).toBeNull()
    expect(sheet()).toBeOnTheScreen()
    expect(stand.asked).toEqual([])

    await userEvent.press(screen.getByTestId('resolver:discard'))
    await userEvent.press(screen.getByTestId('resolver:confirm:discard'))
    await waitFor(() => {
      expect(closes).toBe(1)
    })
    expect(stand.asked).toEqual([`discard:${rejectionWith('forbidden').mutation_id}`])
    expect(screen.queryByTestId('resolver:surface')).toBeNull()
    expect(toasts()[0]).toHaveTextContent(`Your change to ${oatMilk} was discarded.`, {
      exact: false,
    })
  })

  it('stays on iOS until its confirmation has gone from the screen, whatever its owner says', async () => {
    const gone = jest.fn()
    await resolving(rejectionWith('forbidden'), { onClosed: gone })
    await userEvent.press(screen.getByTestId('resolver:discard'))
    const { onDismiss } = screen.getByTestId('resolver:confirm').props as {
      readonly onDismiss: () => void
    }
    await userEvent.press(screen.getByTestId('resolver:confirm:discard'))
    await waitFor(() => {
      expect(closes).toBe(1)
    })
    // Its owner has closed it, and the confirmation is still leaving: told to leave now, iOS
    // may keep the sheet where it is.
    expect(screen.getByTestId('resolver').props).toMatchObject({ visible: true })
    await act(() => {
      onDismiss()
    })
    expect(screen.queryByTestId('resolver:surface')).toBeNull()
    // And the sheet says it has gone only once the platform says so of it.
    expect(gone).not.toHaveBeenCalled()
  })

  it('offers no editor where the row’s module gives no address, and opens it where it gives one', async () => {
    const view = await resolving(rejectionWith('forbidden'))
    expect(screen.queryByTestId('resolver:edit')).toBeNull()
    expect(view.asked).toEqual([])
    await userEvent.press(screen.getByRole('button', { name: en[controls.close_sheet.labelKey] }))
  })

  it('opens the row’s own editor where its module gives one', async () => {
    await resolving(rejectionWith('monotonicity_violation'))
    await userEvent.press(screen.getByRole('button', { name: en['sync.rejected.edit'] }))
    expect(closes).toBe(1)
    expect(jest.mocked(router.push).mock.calls).toEqual([[paths.devSync.path]])
  })

  describe('in a household that takes no writes', () => {
    it('keeps Discard, and neither sends it again nor edits it: both would be writes', async () => {
      asAndroid()
      const stand = await resolving(rejectionWith('monotonicity_violation'), { writes: false })
      expect(screen.queryByTestId('resolver:retry')).toBeNull()
      expect(screen.queryByTestId('resolver:edit')).toBeNull()
      // What cannot be done now, what can, and that the rest waits.
      expect(within(sheet()).getByTestId('banner:warning')).toHaveTextContent(
        en['sync.rejected.readonly'],
        { exact: false },
      )
      // Giving it up is this device's own, and asks nothing of the server.
      await userEvent.press(screen.getByTestId('resolver:discard'))
      await userEvent.press(screen.getByTestId('resolver:confirm:discard'))
      await waitFor(() => {
        expect(closes).toBe(1)
      })
      expect(stand.asked).toEqual([
        `discard:${rejectionWith('monotonicity_violation').mutation_id}`,
      ])
    })

    it('lets a held change be declined before the replica sends it by itself, and says no more than its own sentence', async () => {
      const held = rejectionWith('entitlement_read_only')
      const stand = await resolving(held, { writes: false })
      expect(
        within(sheet()).getByText(en['device.sync.rejected.reason.entitlement_read_only']),
      ).toBeOnTheScreen()
      // Its own sentence says where it is kept and that it goes by itself: no strip beside it.
      expect(within(sheet()).queryByTestId('banner:warning')).toBeNull()
      expect(screen.queryByTestId('resolver:retry')).toBeNull()
      await userEvent.press(screen.getByTestId('resolver:discard'))
      await userEvent.press(screen.getByTestId('resolver:confirm:discard'))
      await waitFor(() => {
        expect(stand.asked).toEqual([`discard:${held.mutation_id}`])
      })
    })
  })

  it('is what a rejected answer opens, and a conflict the comparison', async () => {
    const view = await resolving(rejectionWith('forbidden'))
    expect(within(sheet()).getByTestId('status:rejected')).toBeOnTheScreen()
    expect(view.asked).toEqual([])
    // A merge opens nothing: its kept loser is a banner.
    const merged = standIn({ registry, entries: [overriddenMerge] })
    await screen.unmount()
    await over(merged, <Held outcome={overriddenMerge} />)
    expect(screen.queryByTestId('resolver')).toBeNull()
  })
})

describe('the kept loser', () => {
  async function kept(outcome: RecordedOutcome, announce = false) {
    const stand = standIn({ registry, entries: [outcome] })
    await over(
      stand,
      <KeptLoser
        outcome={outcome}
        setting={settingFor(plain)}
        describers={describers}
        announce={announce}
      />,
    )
    return stand
  }

  it('shows what the member entered beside what is saved, where a field was overridden', async () => {
    await kept(overriddenMerge)
    const banner = screen.getByTestId('sync:kept')
    expect(banner).toHaveTextContent(en['sync.kept.overridden.title'], { exact: false })
    expect(banner).toHaveTextContent(en['sync.kept.overridden.text'], { exact: false })
    expect(screen.getByTestId('sync:kept:mine')).toHaveTextContent(
      new RegExp(`^${en['sync.kept.mine']}.*Quantity.*2$`),
    )
    expect(screen.getByTestId('sync:kept:saved')).toHaveTextContent(
      new RegExp(`^${en['sync.kept.saved']}.*Quantity.*3$`),
    )
    expect(banner).toHaveTextContent(en['sync.kept.hint'], { exact: false })
    // Labels, and no headings: the banner stands on a screen whose headings are its own.
    expect(within(banner).queryAllByRole('header')).toEqual([])
    // A shopping item has no screen of its own among the fixtures: nothing leads to one.
    expect(screen.queryByTestId('sync:kept:open')).toBeNull()
    expectAccessible()
  })

  it('says a version the member’s own replaced was kept, and leads to the row', async () => {
    await kept(replacingMerge)
    const banner = screen.getByTestId('sync:kept')
    expect(banner).toHaveTextContent(en['sync.kept.replaced.title'], { exact: false })
    expect(banner).toHaveTextContent(en['sync.kept.replaced.text'], { exact: false })
    // Nothing of the member's is shown beside it: it is the other version that was kept.
    expect(screen.queryByTestId('sync:kept:mine')).toBeNull()
    await userEvent.press(screen.getByRole('button', { name: en['sync.row.open'] }))
    expect(jest.mocked(router.push).mock.calls).toEqual([[paths.devSync.path]])
  })

  it('is put away by its own control, which marks the answer seen', async () => {
    const stand = await kept(overriddenMerge)
    await userEvent.press(screen.getByRole('button', { name: en['sync.kept.put_away'] }))
    await waitFor(() => {
      expect(stand.asked).toEqual([`resolve:${overriddenMerge.mutation_id}`])
    })
  })

  it('is said as it arrives where its screen says it arrived, its title and its sentence, politely', async () => {
    const announce = jest.spyOn(announcer, 'announce').mockImplementation(() => undefined)
    const urgent = jest.spyOn(announcer, 'announceNow').mockImplementation(() => undefined)
    await kept(overriddenMerge, true)
    expect(announce.mock.calls).toEqual([
      [`${en['sync.kept.overridden.title']}\n${en['sync.kept.overridden.text']}`],
    ])
    // Here it is, and no question: nothing of it is a failure.
    expect(urgent).not.toHaveBeenCalled()
  })

  it('is read in its place where it was there as its screen opened', async () => {
    const announce = jest.spyOn(announcer, 'announce').mockImplementation(() => undefined)
    await kept(overriddenMerge)
    expect(announce).not.toHaveBeenCalled()
  })
})
