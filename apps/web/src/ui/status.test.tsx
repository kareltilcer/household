// What says a state: the status and sync marks, banners, the offline bar, skeletons and the
// teaching empty state (02-components §0, §2 and §4.2).
import { statusGlyphs, type StatusId } from '@household/icons'
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { storageKey } from '../display/modes.ts'
import { draw, rootFollowsScale } from '../test/render.tsx'
import { Banner, OfflineBar, type BannerTone } from './Banner.tsx'
import { Button } from './Button.tsx'
import { EmptyState } from './EmptyState.tsx'
import { Skeleton } from './Skeleton.tsx'
import { StatusMark, SyncMark, syncStates } from './StatusMark.tsx'

const words = {
  row: 'Electricity advance',
  reason: 'That reading is lower than the one on 3 March.',
  readonly: 'Read-only',
  retry: 'Retry',
  sentence: 'No readings on this meter yet.',
  example: 'Petr reads the cellar meter on the first of each month.',
  add: 'Add a reading',
} as const

const statuses = Object.keys(statusGlyphs) as StatusId[]

describe('a status', () => {
  it.each(statuses)('is its colour token, its glyph and its word together: %s', (status) => {
    const { container } = draw(<StatusMark status={status} />)
    const mark = container.querySelector(`[data-status="${status}"]`)
    expect(mark?.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    // The token is the status's own, whose pair on each ground is declared and tested.
    expect(mark?.querySelector('span')).toHaveStyle({
      color: `var(--${statusGlyphs[status].token})`,
    })
    expect(mark?.textContent.trim()).not.toBe('')
  })

  it('has thirteen states, each with a word of its own', () => {
    draw(
      <>
        {statuses.map((status) => (
          <StatusMark key={status} status={status} />
        ))}
      </>,
    )
    const said = statuses.map(
      (status) => document.querySelector(`[data-status="${status}"]`)?.textContent,
    )
    expect(new Set(said).size).toBe(13)
  })

  it('keeps its word for assistive technology where there is no room to draw it', () => {
    draw(<StatusMark status="rejected" words="hidden" />)
    const word = screen.getByText('Not accepted')
    expect(word.className).toContain('visuallyHidden')
  })

  it('says its word in the member’s language', () => {
    draw(<StatusMark status="pending" />, 'cs')
    expect(screen.getByText('Zatím neodesláno')).toBeInTheDocument()
  })
})

describe('the sync mark', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('has no synced state: a row in sync carries no mark', () => {
    expect(syncStates).toEqual(['pending', 'syncing', 'conflict', 'rejected'])
  })

  it('shows syncing only once it has taken longer than a moment', () => {
    vi.useFakeTimers()
    const { container, rerender } = draw(<SyncMark state="syncing" />)
    act(() => {
      vi.advanceTimersByTime(799)
    })
    expect(container.querySelector('[data-status]')).toBeNull()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.getByText('Sending')).toBeInTheDocument()

    // A sync that finished in time was never shown, and one that starts again waits again.
    rerender(<SyncMark state="pending" />)
    rerender(<SyncMark state="syncing" />)
    expect(container.querySelector('[data-status="syncing"]')).toBeNull()
  })

  it('shows every other state at once', () => {
    draw(<SyncMark state="pending" />)
    expect(screen.getByText('Not sent yet')).toBeInTheDocument()
  })

  it('is a control, named for what opening it does, where a state can be opened', async () => {
    const onOpen = vi.fn()
    draw(<SyncMark state="rejected" onOpen={onOpen} />)
    await userEvent.click(screen.getByRole('button', { name: 'Not accepted. Open for details' }))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('names the row whose two versions a conflict’s control opens', () => {
    draw(<SyncMark state="conflict" name={words.row} onOpen={() => undefined} />)
    expect(
      screen.getByRole('button', {
        name: 'Two versions of Electricity advance. Open to resolve',
      }),
    ).toBeInTheDocument()
  })
})

describe('a banner', () => {
  it.each<BannerTone>(['neutral', 'info', 'warning', 'danger'])(
    'says a %s state in a sentence, with a glyph that only repeats it',
    (tone) => {
      const { container } = draw(<Banner tone={tone}>{words.reason}</Banner>)
      expect(screen.getByText(words.reason)).toBeVisible()
      expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
      expect(container.firstElementChild?.className).toContain(tone)
      // One that was there when the screen opened is read in its place, and not announced.
      expect(container.firstElementChild).not.toHaveAttribute('role')
    },
  )

  it('carries its title and the actions that answer it', async () => {
    const onRetry = vi.fn()
    draw(
      <Banner
        tone="warning"
        title={words.readonly}
        actions={<Button onClick={onRetry}>{words.retry}</Button>}
      >
        {words.reason}
      </Banner>,
    )
    expect(screen.getByText(words.readonly)).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: words.retry }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('is announced when it arrives while the member is here: urgently only for a failure', () => {
    const { rerender } = draw(
      <Banner tone="danger" announce>
        {words.reason}
      </Banner>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent(words.reason)
    rerender(
      <Banner tone="info" announce>
        {words.reason}
      </Banner>,
    )
    expect(screen.getByRole('status')).toHaveTextContent(words.reason)
  })

  it('can be put away only where it is given a way', async () => {
    const onDismiss = vi.fn()
    const { rerender } = draw(<Banner tone="info">{words.reason}</Banner>)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    rerender(
      <Banner tone="info" onDismiss={onDismiss}>
        {words.reason}
      </Banner>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})

describe('the offline bar', () => {
  it('says the product’s own sentence, with the offline glyph beside it', () => {
    const { container } = draw(<OfflineBar />)
    expect(screen.getByRole('status')).toHaveTextContent(
      'Offline — changes are saved and will sync',
    )
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('a skeleton', () => {
  it('says it is loading once, and draws the shape it was given', () => {
    const { container } = draw(
      <Skeleton
        bars={[
          [58, 1],
          [34, 0.8125],
        ]}
      />,
    )
    const skeleton = screen.getByRole('status', { name: 'Loading' })
    expect(skeleton).toHaveAttribute('aria-busy', 'true')
    expect(skeleton).toHaveTextContent('')
    const bars = [...container.querySelectorAll<HTMLElement>('[role="status"] > span')]
    expect(bars.map((bar) => [bar.style.inlineSize, bar.style.blockSize])).toEqual([
      ['58%', '1rem'],
      ['34%', '0.8125rem'],
    ])
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

  it('is one sentence, one example marked as one, and one action', () => {
    draw(empty)
    expect(screen.getByText(words.sentence)).toBeVisible()
    expect(screen.getByText('Example')).toBeVisible()
    expect(screen.getByText(words.example)).toBeVisible()
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })

  it('draws its illustration as decoration at 100 % text', () => {
    rootFollowsScale()
    const { container } = draw(empty)
    expect(container.querySelector('svg[viewBox="0 0 200 140"]')).toHaveAttribute(
      'aria-hidden',
      'true',
    )
  })

  it('gives the illustration’s room to the sentence at 200 % text', () => {
    rootFollowsScale()
    window.localStorage.setItem(storageKey, JSON.stringify({ scale: '200' }))
    const { container } = draw(empty)
    expect(container.querySelector('svg')).toBeNull()
    expect(screen.getByText(words.sentence)).toBeVisible()
  })

  it('offers no action to a member who may not write, and frames no example it has none of', () => {
    draw(<EmptyState sentence={words.sentence} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByText('Example')).not.toBeInTheDocument()
  })
})
