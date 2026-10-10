// What billing's screens share that draws nothing: who pays, what a plan costs, and the form's
// look as the page's tokens give it. That every write of theirs is asked at once is held beside
// the query client (api/api.test.ts), and that a control drawn as one word holds that word in
// its name by the catalogs' own test (packages/i18n).
import { resolve, type ColorName, type Theme } from '@household/tokens'
import { describe, expect, it } from 'vitest'
import { ApiProblemError } from '../api/problem.ts'
import { appearanceAt, isLightInk } from './appearance.ts'
import { isMoved, isPayer, monthOf, priceOf } from './data.ts'
import { eur, janaPays, subscription } from './testing.tsx'

describe('who pays', () => {
  it('is whoever the subscription names, whatever the case of an id', () => {
    const jana = janaPays.user_id
    expect(isPayer(subscription(), jana)).toBe(true)
    expect(isPayer(subscription(), jana.toUpperCase())).toBe(true)
    expect(isPayer(subscription(), '0190a000-0000-7000-8000-000000000005')).toBe(false)
    // Nobody, once the payer's account is gone.
    expect(isPayer(subscription({ payer: null }), jana)).toBe(false)
  })
})

describe('what a plan costs', () => {
  it('is the subscription’s own price for each way of paying', () => {
    expect(priceOf(subscription(), 'year')).toEqual(eur(5988))
    expect(priceOf(subscription(), 'month')).toEqual(eur(599))
    expect(priceOf(subscription({ plans: [] }), 'year')).toBeUndefined()
  })

  it('comes to a month’s share only where the year divides into twelve whole amounts', () => {
    expect(monthOf(eur(5988))).toEqual(eur(499))
    expect(monthOf({ amount_minor: 5388, currency: 'GBP' })).toEqual({
      amount_minor: 449,
      currency: 'GBP',
    })
    // A share that would have to be rounded is a price nobody is charged.
    expect(monthOf(eur(5990))).toBeUndefined()
  })
})

describe('a refusal that says the page is no longer how billing stands', () => {
  const refusal = (status: number, code: string) =>
    new ApiProblemError({ type: 'about:blank', title: code, status, code } as never)

  it('is the payer’s, the owner’s and the subscription’s having begun or ended', () => {
    expect(isMoved(refusal(403, 'forbidden'))).toBe(true)
    expect(isMoved(refusal(404, 'not_found'))).toBe(true)
    expect(isMoved(refusal(409, 'not_subscribed'))).toBe(true)
    expect(isMoved(refusal(409, 'already_subscribed'))).toBe(true)
  })

  it('is no other', () => {
    expect(isMoved(refusal(503, 'billing_unavailable'))).toBe(false)
    expect(isMoved(refusal(403, 'account_unverified'))).toBe(false)
    expect(isMoved(new TypeError('offline'))).toBe(false)
  })
})

describe('the payment form’s look', () => {
  const read = ['accent', 'input-bg', 'text-primary', 'text-muted', 'danger'] as const

  /**
   * A place on the page in `theme`: the tokens the form's look is made of, set as the theme's
   * stylesheet sets them (@household/tokens), its ink the theme's own, and a face and a size.
   */
  function standing(theme: Theme, tokens: readonly ColorName[] = read): HTMLElement {
    const host = document.createElement('div')
    document.body.append(host)
    host.style.color = resolve('text-primary', theme)
    host.style.fontFamily = 'Plex, sans-serif'
    host.style.fontSize = '18px'
    host.style.setProperty('--radius-control', '8px')
    for (const name of tokens) host.style.setProperty(`--${name}`, resolve(name, theme))
    return host
  }

  it('is the page’s tokens as they are computed where the form stands', () => {
    const host = standing('light')
    expect(appearanceAt(host)).toEqual({
      theme: 'stripe',
      variables: {
        colorPrimary: resolve('accent', 'light'),
        colorBackground: resolve('input-bg', 'light'),
        colorText: resolve('text-primary', 'light'),
        colorTextSecondary: resolve('text-muted', 'light'),
        colorTextPlaceholder: resolve('text-muted', 'light'),
        colorDanger: resolve('danger', 'light'),
        borderRadius: '8px',
        fontFamily: 'Plex, sans-serif',
        fontSizeBase: '18px',
      },
    })
    host.remove()
  })

  it('takes the processor’s dark base on a page whose ink is light, and leaves an unset token to it', () => {
    const host = standing('dark', ['accent'])
    const { theme, variables } = appearanceAt(host)
    expect(theme).toBe('night')
    expect(variables).toMatchObject({ colorPrimary: resolve('accent', 'dark') })
    expect(variables).not.toHaveProperty('colorBackground')
    expect(variables).not.toHaveProperty('colorDanger')
    host.remove()
  })

  it('reads an ink by its channels, and takes one it cannot read for a dark one', () => {
    /** A colour as the platform computes one: the function's name, and its channels. */
    const computed = (name: string, channels: string) => `${name}(${channels})`
    expect(isLightInk(computed('rgb', '230, 232, 236'))).toBe(true)
    expect(isLightInk(computed('rgba', '230, 232, 236, 0.9'))).toBe(true)
    expect(isLightInk(computed('rgb', '230 232 236'))).toBe(true)
    expect(isLightInk(computed('rgb', '44, 46, 56'))).toBe(false)
    expect(isLightInk('')).toBe(false)
    expect(isLightInk('canvastext')).toBe(false)
  })
})
