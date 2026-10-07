// The twelve states (02-components §0) and the frame that applies one to a body.
import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { draw } from '../test/render.tsx'
import { Button } from './Button.tsx'
import { StateFrame, type BodyContext } from './StateFrame.tsx'
import { dataStates, treatments, type DataState, type Treatment } from './states.ts'

const words = {
  loading: 'the shape of the body',
  empty: 'No readings on this meter yet.',
  body: 'Electricity, cellar meter',
  open: 'Open',
  error: 'Could not load the readings.',
  again: 'Try again',
  rejected: 'That reading is lower than the one on 3 March.',
  refused: 'Not accepted',
  withdrawn: 'Utilities is no longer shared with you.',
  readonly: 'The subscription has lapsed. Everything is readable.',
} as const

describe('the twelve states', () => {
  it('are the twelve of 02-components §0, in its order', () => {
    expect(dataStates).toEqual([
      'loading',
      'empty',
      'populated',
      'error',
      'offline',
      'pending',
      'syncing',
      'conflicted',
      'rejected',
      'absent',
      'withdrawn',
      'readonly',
    ])
    expect(Object.keys(treatments)).toEqual([...dataStates])
  })

  it('each resolve to exactly one treatment', () => {
    const kinds = dataStates.map((state) => treatments[state].kind)
    expect(kinds).toEqual([
      'skeleton',
      'teach',
      'body',
      'message',
      'body',
      'body',
      'body',
      'body',
      'body',
      'absent',
      'message',
      'body',
    ])
  })

  it('draw no write affordance where access is absent, withdrawn or read-only', () => {
    expect(dataStates.filter((state) => !treatments[state].writes)).toEqual([
      'absent',
      'withdrawn',
      'readonly',
    ])
  })

  it('mark a row only for the four states of its own write, and never as synced', () => {
    const marked = dataStates.flatMap((state) => {
      const treatment: Treatment = treatments[state]
      return treatment.mark === undefined ? [] : [[state, treatment.mark]]
    })
    expect(marked).toEqual([
      ['pending', 'pending'],
      ['syncing', 'syncing'],
      ['conflicted', 'conflict'],
      ['rejected', 'rejected'],
    ])
  })

  it('put the offline bar up for the offline state alone', () => {
    expect(dataStates.filter((state) => treatments[state].offline)).toEqual(['offline'])
  })
})

function Framed({ state }: { state: DataState }) {
  return (
    <StateFrame
      state={state}
      skeleton={<p>{words.loading}</p>}
      empty={<p>{words.empty}</p>}
      texts={{
        error: { text: words.error, actions: <Button>{words.again}</Button> },
        rejected: { title: words.refused, text: words.rejected },
        withdrawn: { text: words.withdrawn },
        readonly: { text: words.readonly },
      }}
    >
      {({ mark, writes }: BodyContext) => (
        <div data-mark={mark ?? 'none'}>
          <p>{words.body}</p>
          {writes ? <Button>{words.open}</Button> : null}
        </div>
      )}
    </StateFrame>
  )
}

describe('the state frame', () => {
  it('draws the skeleton, the empty state or the body, and one of them only', () => {
    const { rerender } = draw(<Framed state="loading" />)
    expect(screen.getByText(words.loading)).toBeVisible()
    expect(screen.queryByText(words.body)).not.toBeInTheDocument()
    rerender(<Framed state="empty" />)
    expect(screen.getByText(words.empty)).toBeVisible()
    expect(screen.queryByText(words.body)).not.toBeInTheDocument()
    rerender(<Framed state="populated" />)
    expect(screen.getByText(words.body)).toBeVisible()
    expect(screen.queryByText(words.empty)).not.toBeInTheDocument()
  })

  it('draws nothing at all for a member who may not see the body', () => {
    const { container } = draw(<Framed state="absent" />)
    // Nothing of the frame's: only what the providers themselves keep in the page.
    expect(container).not.toHaveTextContent(/./)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('names an error in words, with its action, in the body’s place', () => {
    draw(<Framed state="error" />)
    expect(screen.getByText(words.error)).toBeVisible()
    expect(screen.getByRole('button', { name: words.again })).toBeVisible()
    expect(screen.queryByText(words.body)).not.toBeInTheDocument()
  })

  it('says a row was withdrawn in the body’s place, which is no error and no empty state', () => {
    const { container } = draw(<Framed state="withdrawn" />)
    expect(screen.getByText(words.withdrawn)).toBeVisible()
    expect(screen.queryByText(words.body)).not.toBeInTheDocument()
    expect(screen.queryByText(words.empty)).not.toBeInTheDocument()
    expect(container.innerHTML).toContain('neutral')
    expect(container.innerHTML).not.toContain('danger')
  })

  it('says why a write was rejected above the body, which stays and carries the mark', () => {
    const { container } = draw(<Framed state="rejected" />)
    expect(screen.getByText(words.refused)).toBeVisible()
    expect(screen.getByText(words.rejected)).toBeVisible()
    expect(screen.getByText(words.body)).toBeVisible()
    expect(container.querySelector('[data-mark]')).toHaveAttribute('data-mark', 'rejected')
  })

  it('keeps a read-only body readable, explains above it, and draws nothing that writes', () => {
    draw(<Framed state="readonly" />)
    expect(screen.getByText(words.readonly)).toBeVisible()
    expect(screen.getByText(words.body)).toBeVisible()
    expect(screen.queryByRole('button', { name: words.open })).not.toBeInTheDocument()
    expect(document.querySelector(':disabled, [aria-disabled="true"]')).toBeNull()
  })

  it('announces a failure that arrives while the member is here, at once', () => {
    // A screen opens on its skeleton, and the load fails: nothing moved the focus, so the
    // sentence is said as it arrives, or a member who does not see the screen is told nothing.
    const { rerender } = draw(<Framed state="loading" />)
    rerender(<Framed state="error" />)
    expect(screen.getByRole('alert')).toHaveTextContent(words.error)
    // A write refused under a body that was there: its reason, above the body.
    rerender(<Framed state="populated" />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    rerender(<Framed state="rejected" />)
    expect(screen.getByRole('alert')).toHaveTextContent(words.rejected)
  })

  it('announces what is no failure politely: a row withdrawn, a body gone read-only', async () => {
    const { rerender } = draw(<Framed state="populated" />)
    rerender(<Framed state="withdrawn" />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(words.withdrawn)
    })
    rerender(<Framed state="populated" />)
    rerender(<Framed state="readonly" />)
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(words.readonly)
    })
  })

  it.each(['error', 'rejected', 'withdrawn', 'readonly'] as const)(
    'announces no %s sentence that was there when the screen opened: it is read in its place',
    (state) => {
      draw(<Framed state={state} />)
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    },
  )

  it.each([
    ['populated', 'none'],
    ['offline', 'none'],
    ['pending', 'pending'],
    ['syncing', 'syncing'],
    ['conflicted', 'conflict'],
  ] as const)('hands the %s body its mark, %s, and its write affordances', (state, mark) => {
    const { container } = draw(<Framed state={state} />)
    expect(container.querySelector('[data-mark]')).toHaveAttribute('data-mark', mark)
    expect(screen.getByRole('button', { name: words.open })).toBeVisible()
    // An offline read is the online read: the frame adds nothing to it.
    expect(container.querySelectorAll('svg')).toHaveLength(0)
  })

  // The two sentences that stand in a body's place are not a frame's to leave out: its type asks
  // for both, so a failed load is never a blank screen. A strip's may be, and its body is bare.
  const inPlace = { error: { text: words.error }, withdrawn: { text: words.withdrawn } }

  it.each(['readonly', 'rejected'] as const)(
    'draws a %s body bare where its strip’s sentence was left out',
    (state) => {
      const { container } = draw(
        <StateFrame state={state} skeleton={null} empty={null} texts={inPlace}>
          {() => <p>{words.body}</p>}
        </StateFrame>,
      )
      expect(screen.getByText(words.body)).toBeVisible()
      expect(container.querySelectorAll('svg')).toHaveLength(0)
    },
  )

  it.each([
    ['error', words.error],
    ['withdrawn', words.withdrawn],
  ] as const)('says a %s body’s sentence with no title and no action given', (state, sentence) => {
    draw(
      <StateFrame state={state} skeleton={null} empty={null} texts={inPlace}>
        {() => <p>{words.body}</p>}
      </StateFrame>,
    )
    expect(screen.getByText(sentence)).toBeVisible()
    expect(screen.queryByText(words.body)).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
