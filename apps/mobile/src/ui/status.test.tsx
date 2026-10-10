// What says a state: the status and sync marks, banners, the offline bar, skeletons and the
// teaching empty state (02-components §0, §2 and §4.2). The web's `status.test.tsx` is its twin.
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { controls, statusGlyphs, type StatusId } from '@household/icons'
import { catalogs } from '@household/i18n'
import { nativeThemes, type ColorName } from '@household/tokens/native'
import { act, screen, userEvent, within } from '@testing-library/react-native'
import { Animated } from 'react-native'
import type { TestInstance } from 'test-renderer'
import { drawingsOf, elementsOf, expectAccessible, nameOf, statusTestID } from '../test/a11y.ts'
import { render, styleOf } from '../test/render.tsx'
import * as announcer from './announce.ts'
import { Banner, type BannerTone } from './Banner.tsx'
import { Button } from './Button.tsx'
import { EmptyState } from './EmptyState.tsx'
import { OfflineBar } from './OfflineBar.tsx'
import { Skeleton } from './Skeleton.tsx'
import { StatusMark, SyncMark, syncStates, type SyncState } from './StatusMark.tsx'

const en = catalogs.en

const words = {
  row: 'Electricity advance',
  reason: 'That reading is lower than the one on 3 March.',
  readonly: 'Read-only',
  retry: 'Retry',
  sentence: 'No readings on this meter yet.',
  example: 'Petr reads the cellar meter on the first of each month.',
  add: 'Add a reading',
  receiving: 'Changes made elsewhere are not arriving.',
} as const

const statuses = Object.keys(statusGlyphs) as StatusId[]

/** Whether `element` draws the kit's illustration, by its frame. */
function isIllustration(element: TestInstance): boolean {
  return element.props.vbWidth === 200 && element.props.vbHeight === 140
}

/** Moves the test's clock on, and draws what became due. */
async function advance(ms: number): Promise<void> {
  await act(() => {
    jest.advanceTimersByTime(ms)
  })
}

let said: jest.SpiedFunction<typeof announcer.announce>
let saidNow: jest.SpiedFunction<typeof announcer.announceNow>

beforeEach(() => {
  said = jest.spyOn(announcer, 'announce').mockImplementation(() => undefined)
  saidNow = jest.spyOn(announcer, 'announceNow').mockImplementation(() => undefined)
})
afterEach(() => {
  jest.restoreAllMocks()
  jest.useRealTimers()
})

describe('a status', () => {
  it.each(statuses)('is its colour token, its glyph and its word together: %s', async (status) => {
    for (const theme of ['light', 'dark'] as const) {
      const view = await render(<StatusMark status={status} />, { theme })
      const mark = screen.getByTestId(statusTestID(status))
      const [glyph] = drawingsOf(mark)
      // The token is the status's own, whose pair on each ground is declared and tested.
      expect(glyph?.props.color).toBe(nativeThemes[theme].color[statusGlyphs[status].token])
      expect(within(mark).getByText(en[statusGlyphs[status].labelKey])).toBeOnTheScreen()
      expectAccessible()
      await view.unmount()
    }
  })

  it('has thirteen states, each with a word of its own', async () => {
    await render(
      <>
        {statuses.map((status) => (
          <StatusMark key={status} status={status} />
        ))}
      </>,
    )
    const names = statuses.map((status) => nameOf(screen.getByTestId(statusTestID(status))))
    expect(new Set(names).size).toBe(13)
    expect(names).not.toContain('')
  })

  it('keeps its word for a screen reader where there is no room to draw it', async () => {
    await render(<StatusMark status="rejected" words="hidden" />)
    const word = en['a11y.status.rejected']
    expect(screen.queryByText(word)).toBeNull()
    // One thing, called by its word: the rules hold a status to a glyph and a word.
    expect(screen.getByRole('text', { name: word })).toBeOnTheScreen()
    expectAccessible()
  })

  it('says its word in the member’s language', async () => {
    await render(<StatusMark status="pending" />, { locale: 'cs' })
    expect(screen.getByText(catalogs.cs['a11y.status.pending'])).toBeOnTheScreen()
  })
})

describe('the sync mark', () => {
  const mark = (state: SyncState) => screen.queryByTestId(statusTestID(state))

  it('has no synced state: a row in sync carries no mark', () => {
    expect(syncStates).toEqual(['pending', 'syncing', 'conflict', 'rejected'])
  })

  it('shows syncing only once it has taken longer than a moment', async () => {
    jest.useFakeTimers()
    const view = await render(<SyncMark state="syncing" />)
    await advance(799)
    expect(mark('syncing')).toBeNull()
    await advance(1)
    expect(screen.getByText(en['a11y.status.syncing'])).toBeOnTheScreen()
    expectAccessible()

    // A sync that finished in time was never shown, and one that starts again waits again.
    await view.rerender(<SyncMark state="pending" />)
    await view.rerender(<SyncMark state="syncing" />)
    expect(mark('syncing')).toBeNull()
  })

  it('measures the moment from when the sync began, where it is told when', async () => {
    jest.useFakeTimers()
    // A row drawn again in the middle of a long sync shows its mark at once: it waits no second
    // time.
    const view = await render(<SyncMark state="syncing" since={Date.now() - 5000} />)
    expect(mark('syncing')).not.toBeNull()
    await view.unmount()

    await render(<SyncMark state="syncing" since={Date.now() - 300} />)
    await advance(499)
    expect(mark('syncing')).toBeNull()
    await advance(1)
    expect(mark('syncing')).not.toBeNull()
  })

  it('stays shown when its owner learns when the write began, with no moment withdrawn', async () => {
    jest.useFakeTimers()
    const view = await render(<SyncMark state="syncing" />)
    await advance(800)
    expect(mark('syncing')).not.toBeNull()
    // No timer has run since: withdrawn and drawn again a moment later, it would be gone here.
    await view.rerender(<SyncMark state="syncing" since={Date.now() - 800} />)
    expect(mark('syncing')).not.toBeNull()
    await view.rerender(<SyncMark state="syncing" />)
    expect(mark('syncing')).not.toBeNull()
  })

  it('waits again when its owner says a write began just now', async () => {
    jest.useFakeTimers()
    const view = await render(<SyncMark state="syncing" since={Date.now() - 5000} />)
    expect(mark('syncing')).not.toBeNull()
    await advance(1000)
    await view.rerender(<SyncMark state="syncing" since={Date.now()} />)
    expect(mark('syncing')).toBeNull()
    await advance(800)
    expect(mark('syncing')).not.toBeNull()
  })

  it('draws at once the mark of a row that turns to a sync begun more than a moment ago', async () => {
    jest.useFakeTimers()
    const view = await render(<SyncMark state="pending" />)
    await advance(10_000)
    await view.rerender(<SyncMark state="syncing" since={Date.now() - 1000} />)
    expect(mark('syncing')).not.toBeNull()
  })

  it('counts the moment from when it was drawn where the time it is told is no time', async () => {
    jest.useFakeTimers()
    // What a date that does not parse comes to: no number is equal to it, itself included.
    await render(<SyncMark state="syncing" since={Number.NaN} />)
    expect(mark('syncing')).toBeNull()
    await advance(799)
    expect(mark('syncing')).toBeNull()
    await advance(1)
    expect(mark('syncing')).not.toBeNull()
  })

  it('is unchanged by reduced motion: the moment is a threshold, and no animation', async () => {
    jest.useFakeTimers()
    await render(<SyncMark state="syncing" />, { motion: 'reduced' })
    await advance(799)
    expect(mark('syncing')).toBeNull()
    await advance(1)
    expect(mark('syncing')).not.toBeNull()
  })

  it('shows every other state at once', async () => {
    await render(<SyncMark state="pending" />)
    expect(screen.getByText(en['a11y.status.pending'])).toBeOnTheScreen()
  })

  it.each(['pending', 'syncing'] as const)(
    'is words where there is nothing to open, whatever way it is given: %s',
    async (state) => {
      jest.useFakeTimers()
      await render(<SyncMark state={state} onOpen={() => undefined} />)
      await advance(800)
      expect(mark(state)).not.toBeNull()
      expect(screen.queryByRole('button')).toBeNull()
    },
  )

  it('is a control, named for what opening it does, where a state can be opened', async () => {
    const onOpen = jest.fn()
    await render(<SyncMark state="rejected" onOpen={onOpen} />)
    const name = en[controls.sync_state.labelKey].replace('{state}', en['a11y.status.rejected'])
    await userEvent.press(screen.getByRole('button', { name }))
    // With nothing: the press is the control's own, and no event of it is its owner's.
    expect(onOpen.mock.calls).toEqual([[]])
    // The word it draws is in its name, and it is a status still: a glyph and a word.
    expect(screen.getByText(en['a11y.status.rejected'])).toBeOnTheScreen()
    expectAccessible()
  })

  it('names the row whose two versions a conflict’s control opens', async () => {
    await render(<SyncMark state="conflict" name={words.row} onOpen={() => undefined} />)
    const name = en[controls.conflict.labelKey].replace('{name}', words.row)
    expect(screen.getByRole('button', { name })).toBeOnTheScreen()
    expectAccessible()
  })

  it('is as large as any target where it is a control, with its word or without, at 200 % too', async () => {
    await render(<SyncMark state="conflict" words="hidden" onOpen={() => undefined} />, {
      scale: 2,
    })
    const control = screen.getByRole('button')
    expect(styleOf(control)).toMatchObject({ minHeight: 88, minWidth: 88 })
    // Drawn as a glyph alone, it is called what the register calls it.
    expect(nameOf(control)).toBe(
      en[controls.sync_state.labelKey].replace('{state}', en['a11y.status.conflict']),
    )
    expectAccessible()
  })
})

describe('a banner', () => {
  const rules: Readonly<Record<BannerTone, ColorName>> = {
    neutral: 'border-strong',
    info: 'info',
    warning: 'warning',
    danger: 'danger',
  }

  it.each<BannerTone>(['neutral', 'info', 'warning', 'danger'])(
    'says a %s state in a sentence, with a glyph that only repeats it',
    async (tone) => {
      for (const theme of ['light', 'dark'] as const) {
        const view = await render(<Banner tone={tone}>{words.reason}</Banner>, { theme })
        const banner = screen.getByTestId(`banner:${tone}`)
        expect(within(banner).getByText(words.reason)).toBeOnTheScreen()
        // The tone's own colour is its rule's, and never the sentence's ink.
        expect(styleOf(banner).borderStartColor).toBe(nativeThemes[theme].color[rules[tone]])
        expect(drawingsOf(banner)).toHaveLength(1)
        expectAccessible()
        await view.unmount()
      }
      // One that was there when the screen opened is read in its place, and not announced.
      expect(said).not.toHaveBeenCalled()
      expect(saidNow).not.toHaveBeenCalled()
    },
  )

  it('carries its title and the actions that answer it', async () => {
    const onRetry = jest.fn()
    await render(
      <Banner
        tone="warning"
        title={words.readonly}
        actions={<Button onPress={onRetry}>{words.retry}</Button>}
      >
        {words.reason}
      </Banner>,
    )
    expect(screen.getByText(words.readonly)).toBeOnTheScreen()
    await userEvent.press(screen.getByRole('button', { name: words.retry }))
    expect(onRetry).toHaveBeenCalledTimes(1)
    expectAccessible()
  })

  it('is announced when it arrives while the member is here: at once only for a failure', async () => {
    const view = await render(
      <Banner tone="danger" announce>
        {words.reason}
      </Banner>,
    )
    expect(saidNow.mock.calls).toEqual([[words.reason]])
    expect(said).not.toHaveBeenCalled()
    await view.unmount()
    saidNow.mockClear()

    await render(
      <Banner tone="info" title={words.readonly} announce>
        {words.reason}
      </Banner>,
    )
    // Its title, a pause, its sentence: what stands under them is read in its place.
    expect(said.mock.calls).toEqual([[`${words.readonly}\n${words.reason}`]])
    expect(saidNow).not.toHaveBeenCalled()
  })

  it('is said once, and again only when what it says changes', async () => {
    const view = await render(
      <Banner tone="warning" announce>
        {words.reason}
      </Banner>,
    )
    await view.rerender(
      <Banner tone="warning" announce actions={<Button>{words.retry}</Button>}>
        {words.reason}
      </Banner>,
    )
    expect(said).toHaveBeenCalledTimes(1)
    await view.rerender(
      <Banner tone="warning" announce>
        {words.sentence}
      </Banner>,
    )
    expect(said.mock.calls).toEqual([[words.reason], [words.sentence]])
  })

  it('draws what stands under its sentence, which is no part of what is said', async () => {
    await render(
      <Banner tone="info" announce detail={<Button>{words.add}</Button>}>
        {words.reason}
      </Banner>,
    )
    expect(screen.getByRole('button', { name: words.add })).toBeOnTheScreen()
    expect(said.mock.calls).toEqual([[words.reason]])
  })

  it('can be put away only where it is given a way', async () => {
    const onDismiss = jest.fn()
    const view = await render(<Banner tone="info">{words.reason}</Banner>)
    expect(screen.queryByRole('button')).toBeNull()
    await view.rerender(
      <Banner tone="info" onDismiss={onDismiss}>
        {words.reason}
      </Banner>,
    )
    await userEvent.press(screen.getByRole('button', { name: en[controls.dismiss.labelKey] }))
    expect(onDismiss.mock.calls).toEqual([[]])
    expectAccessible()
  })
})

describe('the offline bar', () => {
  it('says the product’s own sentence, with the offline glyph in the status’s colour beside it', async () => {
    await render(<OfflineBar />)
    const bar = screen.getByTestId('offline-bar')
    expect(within(bar).getByText(en['ui.offline.bar'])).toBeOnTheScreen()
    const [glyph] = drawingsOf(bar)
    expect(glyph?.props.color).toBe(nativeThemes.light.color['status-offline'])
    expectAccessible()
  })

  it('is said once the screen reader has finished, as it arrives and as its owner changes what it says', async () => {
    const view = await render(<OfflineBar />)
    expect(said.mock.calls).toEqual([[en['ui.offline.bar']]])
    expect(saidNow).not.toHaveBeenCalled()
    await view.rerender(<OfflineBar />)
    expect(said).toHaveBeenCalledTimes(1)
    // One bar, whose words change where it stands.
    await view.rerender(<OfflineBar sentence={words.receiving} />)
    expect(screen.getByText(words.receiving)).toBeOnTheScreen()
    expect(said.mock.calls).toEqual([[en['ui.offline.bar']], [words.receiving]])
  })

  it('is read in its place, and not said, where its owner says it was there already', async () => {
    await render(<OfflineBar announce={false} />)
    expect(screen.getByText(en['ui.offline.bar'])).toBeOnTheScreen()
    expect(said).not.toHaveBeenCalled()
  })
})

describe('a skeleton', () => {
  const bars = [
    [58, 1],
    [34, 0.8125],
  ] as const

  it('says it is loading once, and draws the shape it was given', async () => {
    await render(<Skeleton bars={bars} />)
    const skeleton = screen.getByLabelText(en['ui.loading'])
    expect(skeleton).toBeBusy()
    expect(skeleton.props.accessible).toBe(true)
    // The bars are a shape: no word is drawn, and nothing in it is a picture or a spinner.
    expect(elementsOf(skeleton).filter((inner) => inner.type === 'Text')).toEqual([])
    expect(elementsOf(skeleton).map((inner) => inner.type)).toEqual(['View', 'View', 'View'])
    expect(skeleton.children.map((bar) => styleOf(bar as TestInstance))).toMatchObject([
      { width: '58%', height: 16 },
      { width: '34%', height: 13 },
    ])
    expectAccessible()
  })

  it('is as tall as the reader’s text makes what it stands for', async () => {
    await render(<Skeleton bars={bars} />, { scale: 2 })
    const skeleton = screen.getByLabelText(en['ui.loading'])
    expect(skeleton.children.map((bar) => styleOf(bar as TestInstance).height)).toEqual([32, 26])
  })

  it('breathes for as long as it is drawn, and stands still under reduced motion', async () => {
    const loop = jest.spyOn(Animated, 'loop')
    const view = await render(<Skeleton bars={bars} />)
    expect(loop).toHaveBeenCalledTimes(1)
    await view.unmount()
    loop.mockClear()

    await render(<Skeleton bars={bars} />, { motion: 'reduced' })
    expect(loop).not.toHaveBeenCalled()
    expect(screen.getByLabelText(en['ui.loading'])).toBeBusy()
  })
})

describe('the teaching empty state', () => {
  const empty = (
    <EmptyState
      sentence={words.sentence}
      example={words.example}
      action={<Button variant="primary">{words.add}</Button>}
      composition="utilities.not_enough"
    />
  )

  it('is one sentence, one example marked as one, and one action', async () => {
    await render(empty)
    expect(screen.getByText(words.sentence)).toBeOnTheScreen()
    expect(screen.getByText(en['ui.empty.example'])).toBeOnTheScreen()
    expect(screen.getByText(words.example)).toBeOnTheScreen()
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expectAccessible()
  })

  it('draws its illustration as decoration at 100 % text', async () => {
    await render(empty)
    const pictures = drawingsOf(screen.getByTestId('empty-state')).filter(isIllustration)
    expect(pictures).toHaveLength(1)
    expect(pictures[0]?.props.accessibilityElementsHidden).toBe(true)
  })

  it('gives the illustration’s room to the sentence at 200 % text', async () => {
    await render(empty, { scale: 2 })
    expect(drawingsOf(screen.getByTestId('empty-state')).filter(isIllustration)).toEqual([])
    expect(screen.getByText(words.sentence)).toBeOnTheScreen()
    expectAccessible()
  })

  it('offers no action to a member who may not write, and frames no example it has none of', async () => {
    await render(<EmptyState sentence={words.sentence} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByText(en['ui.empty.example'])).toBeNull()
  })

  it('frames an example that is a row as it frames one that is a sentence', async () => {
    await render(
      <EmptyState sentence={words.sentence} example={<StatusMark status="estimated" />} />,
    )
    expect(screen.getByText(en['ui.empty.example'])).toBeOnTheScreen()
    expect(screen.getByText(en['a11y.status.estimated'])).toBeOnTheScreen()
  })
})
