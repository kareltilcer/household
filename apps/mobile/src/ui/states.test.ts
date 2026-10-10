// The twelve states (02-components §0), as the web's own test holds them: the table is one
// design's, drawn by two clients. The frame that applies a state to a body has a test of its
// own beside it.
import { describe, expect, it } from '@jest/globals'
import { dataStates, treatments, type Treatment } from './states.ts'

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

  it('say in words what stands in a body’s place, and in which tone', () => {
    const toned = dataStates.flatMap((state) => {
      const treatment: Treatment = treatments[state]
      return treatment.message === undefined && treatment.banner === undefined
        ? []
        : [[state, treatment.message ?? null, treatment.banner ?? null]]
    })
    expect(toned).toEqual([
      ['error', 'danger', null],
      ['rejected', null, 'danger'],
      ['withdrawn', 'neutral', null],
      ['readonly', null, 'warning'],
    ])
  })
})
