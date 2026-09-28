import { vectors } from '@household/test-vectors'
import { runVectors } from '@household/test-vectors/vitest'
import { describe, expect, it } from 'vitest'
import {
  add,
  convert,
  currencyCodes,
  exponent,
  money,
  MoneyError,
  multiply,
  roundHalfUp,
  split,
  subtract,
} from './money.ts'

describe('vectors/money.json', () => {
  runVectors(
    vectors.money,
    {
      exponent: (currency) => exponent(currency),
      money: ({ amount_minor, currency }) => money(amount_minor, currency),
      add: ({ a, b }) => add(a, b),
      subtract: ({ a, b }) => subtract(a, b),
      multiply: ({ amount, factor }) => multiply(amount, factor),
      convert: ({ amount, rate, to }) => convert(amount, rate, to),
      split: ({ total, participants, order, weights }) =>
        split(total, participants, order, weights ?? undefined).map((share) => [
          share.participant,
          share.amount.amount_minor,
        ]),
    },
    (error) => (error instanceof MoneyError ? error.code : undefined),
  )
})

describe('the currency table', () => {
  it('is ISO 4217 List One, codes with a minor unit only', () => {
    expect(currencyCodes).toHaveLength(165)
    expect(currencyCodes.every((code) => /^[A-Z]{3}$/.test(code))).toBe(true)
    expect(currencyCodes).toEqual(expect.arrayContaining(['CZK', 'EUR', 'GBP', 'PLN', 'CHF']))
  })

  it('does not answer for an inherited property', () => {
    expect(() => exponent('constructor')).toThrow(MoneyError)
  })
})

describe('rounding half-up', () => {
  it.each([
    [5n, 2n, 3n],
    [-5n, 2n, -3n],
    [4n, 3n, 1n],
    [-4n, 3n, -1n],
    [5n, 3n, 2n],
    [-5n, 3n, -2n],
    [0n, 7n, 0n],
  ])('%i / %i is %i', (n, d, want) => {
    expect(roundHalfUp(n, d)).toBe(want)
  })
})

describe('a split', () => {
  it('always sums to its total', () => {
    const order = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    for (let total = -500; total <= 500; total += 7) {
      for (let n = 1; n <= order.length; n++) {
        const participants = order.slice(0, n).reverse()
        const weights = participants.map((_, i) => (i % 3) + 1)
        const shares = split(money(total, 'EUR'), participants, order, weights)
        expect(shares.reduce((s, share) => s + share.amount.amount_minor, 0)).toBe(total)
      }
    }
  })
})
