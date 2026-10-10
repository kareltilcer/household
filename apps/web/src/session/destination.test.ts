// The address held across a sign-in: what is held of it, and what is not.
import { afterEach, describe, expect, it } from 'vitest'
import { heldDestination, holdDestination, takeDestination } from './destination.ts'

afterEach(() => {
  takeDestination()
})

describe('the address held across a sign-in', () => {
  it('is held as it was opened, and is held once', () => {
    holdDestination('/account/security?from=email#top')
    expect(heldDestination()).toBe('/account/security?from=email#top')
    expect(takeDestination()).toBe('/account/security?from=email#top')
    expect(heldDestination()).toBeNull()
  })

  it('is no address but the app’s own', () => {
    holdDestination('https://elsewhere.test/households')
    expect(heldDestination()).toBeNull()
  })

  // A bank's page sends a payer back to billing with the processor's names for what was
  // confirmed, its secret among them. Returned to a browser whose session has ended, the address
  // is held while they sign in: without the secret, in storage and in memory alike.
  it('is held without the secret a payment processor’s return carried', () => {
    const billing = '/households/0190a000-0000-7000-8000-000000000001/settings/billing'
    holdDestination(
      `${billing}?payment_intent=pi_1&payment_intent_client_secret=pi_1_secret_2&redirect_status=succeeded`,
    )
    expect(heldDestination()).toBe(`${billing}?payment_intent=pi_1&redirect_status=succeeded`)
    expect(window.sessionStorage.getItem('household.destination')).not.toContain('secret')

    holdDestination(`${billing}?setup_intent_client_secret=seti_1_secret_2#method`)
    expect(heldDestination()).toBe(`${billing}#method`)
  })
})
