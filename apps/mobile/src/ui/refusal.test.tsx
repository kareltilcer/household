// Where the focus goes when a form is refused (D-166's twin; the web's `useRefusedField`): to
// the first field the refusal marked, and a field's own sentence is announced by nobody.
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { act, screen } from '@testing-library/react-native'
import { useState } from 'react'
import { expectAccessible } from '../test/a11y.ts'
import { render } from '../test/render.tsx'
import * as announcer from './announce.ts'
import { sample, tariffs } from './controls.fixtures.ts'
import { TextField } from './Field.tsx'
import { RefusedFields, useRefusedField } from './refusal.ts'
import { Select } from './Select.tsx'
import { Stepper } from './Stepper.tsx'

type Mark = 'first' | 'second' | 'third'

interface Refusal {
  /** What the submission was refused with: a new value for each refusal. */
  readonly refused: unknown
  readonly marks: readonly Mark[]
  /** Whether the first field is drawn at all. */
  readonly withFirst?: boolean
}

/** The form's owner, as a test tells it what its last submission came to. */
let refuse: (next: Refusal) => void = () => undefined

function Form() {
  const [{ refused, marks, withFirst = true }, setRefusal] = useState<Refusal>({
    refused: undefined,
    marks: [],
  })
  refuse = setRefusal
  const fields = useRefusedField(refused)
  const error = (mark: Mark) => (marks.includes(mark) ? sample.low : undefined)
  return (
    <RefusedFields value={fields}>
      {withFirst ? <TextField label={sample.first} error={error('first')} /> : null}
      <Select
        label={sample.second}
        placeholder={sample.choose}
        options={tariffs}
        value={undefined}
        onChange={() => undefined}
        error={error('second')}
      />
      <Stepper
        label={sample.third}
        value={1}
        min={0}
        onChange={() => undefined}
        error={error('third')}
      />
    </RefusedFields>
  )
}

const focusOn = () => jest.spyOn(announcer, 'focusOn').mockReturnValue(true)

/** The name of what each call gave the focus to. */
function focused(spy: ReturnType<typeof focusOn>): (string | undefined)[] {
  return spy.mock.calls.map(([target]) => {
    const props: Readonly<Record<string, unknown>> = { ...target.current?.props }
    return typeof props.accessibilityLabel === 'string' ? props.accessibilityLabel : undefined
  })
}

beforeEach(() => {
  refuse = () => undefined
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('a refused form', () => {
  it('gives the focus to the first field the refusal marked, in the order they are drawn', async () => {
    const spy = focusOn()
    await render(<Form />)
    expect(spy).not.toHaveBeenCalled()
    await act(() => {
      refuse({ refused: {}, marks: ['third', 'second'] })
    })
    // The select before the stepper, whatever order the refusal named them in.
    expect(focused(spy)).toEqual([sample.second])
    expect(screen.getAllByText(sample.low)).toHaveLength(2)
    expectAccessible()
  })

  it('gives it again at each refusal, and not when the form is only drawn again', async () => {
    const spy = focusOn()
    await render(<Form />)
    const first = {}
    await act(() => {
      refuse({ refused: first, marks: ['third'] })
    })
    expect(focused(spy)).toEqual([sample.third])
    // Drawn again for the same refusal, a field's error put right as it is typed in: the focus
    // stays where its member has it.
    await act(() => {
      refuse({ refused: first, marks: [] })
    })
    expect(spy).toHaveBeenCalledTimes(1)
    await act(() => {
      refuse({ refused: {}, marks: ['first', 'third'] })
    })
    expect(focused(spy)).toEqual([sample.third, sample.first])
  })

  it('moves nothing for a refusal that marks no field: its banner is announced where it is drawn', async () => {
    const spy = focusOn()
    await render(<Form />)
    await act(() => {
      refuse({ refused: {}, marks: [] })
    })
    expect(spy).not.toHaveBeenCalled()
  })

  it('announces no field’s sentence: it is read with the field the focus is given to', async () => {
    focusOn()
    const politely = jest.spyOn(announcer, 'announce')
    const atOnce = jest.spyOn(announcer, 'announceNow')
    await render(<Form />)
    await act(() => {
      refuse({ refused: {}, marks: ['first', 'second', 'third'] })
    })
    expect(screen.getByLabelText(sample.first).props.accessibilityHint).toBe(sample.low)
    expect(politely).not.toHaveBeenCalled()
    expect(atOnce).not.toHaveBeenCalled()
  })

  it('passes over a field that is no longer drawn', async () => {
    const spy = focusOn()
    await render(<Form />)
    await act(() => {
      refuse({ refused: {}, marks: ['first', 'third'], withFirst: false })
    })
    expect(focused(spy)).toEqual([sample.third])
  })

  it('leaves a field that stands in no form alone', async () => {
    const spy = focusOn()
    await render(<TextField label={sample.first} error={sample.low} />)
    expect(spy).not.toHaveBeenCalled()
    expectAccessible()
  })
})
