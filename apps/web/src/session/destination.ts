// The address a visitor opened before they had signed in (04-navigation §8, the cold start): it is
// held while they sign in, through a second step or a provider's pages and back, and opened once
// they are in. Kept in this tab's own storage, so that it survives the provider's redirect and
// belongs to no other tab; a browser that refuses storage holds it for the page's life.
import { isOwnPath } from '../app/paths.ts'

const key = 'household.destination'

let inMemory: string | null = null

/**
 * What the payment processor adds to the address it sends somebody back to that is a secret, of
 * the payment or the method that was confirmed. It is no part of where they were going: billing
 * believes nothing a return carried and reads none of it (billing/Billing.tsx). An address held
 * across a sign-in is held without them, since storage is read by every script of the origin
 * for as long as the tab lives.
 */
const secrets = ['payment_intent_client_secret', 'setup_intent_client_secret'] as const

/** `path` without the processor's secrets in its query: everything else of it as it is written. */
function withoutSecrets(path: string): string {
  const mark = path.indexOf('?')
  if (mark === -1) return path
  const end = path.indexOf('#', mark)
  const query = new URLSearchParams(path.slice(mark + 1, end === -1 ? undefined : end))
  if (!secrets.some((name) => query.has(name))) return path
  for (const name of secrets) query.delete(name)
  const kept = query.toString()
  return `${path.slice(0, mark)}${kept === '' ? '' : `?${kept}`}${end === -1 ? '' : path.slice(end)}`
}

/** Holds `path`, the address to open after signing in. Anything but a path of the app's is not held. */
export function holdDestination(address: string): void {
  if (!isOwnPath(address)) return
  const path = withoutSecrets(address)
  inMemory = path
  try {
    window.sessionStorage.setItem(key, path)
  } catch {
    // Held for this page alone.
  }
}

/** The address held, or null where none is. */
export function heldDestination(): string | null {
  try {
    const stored = window.sessionStorage.getItem(key)
    if (stored !== null && isOwnPath(stored)) return stored
  } catch {
    // What this page holds itself is all there is.
  }
  return inMemory
}

/** The address held, which is held no longer: it is opened once. */
export function takeDestination(): string | null {
  const held = heldDestination()
  inMemory = null
  try {
    window.sessionStorage.removeItem(key)
  } catch {
    // Nothing was kept there.
  }
  return held
}
