// Identifiers. Clients generate the id of every entity they create, as a UUIDv7, and send it
// in the create's body: an offline create needs a stable identity at once, and an entity with
// a server id online and a client id offline is the dual identity D-23 exists to prevent.
import { v7 } from 'uuid'

/**
 * A new UUIDv7 (RFC 9562), which sorts by the time it was minted. It draws on
 * `crypto.getRandomValues`, which React Native's Hermes does not provide: the mobile app
 * installs a polyfill before its first import of this package (plan item 28).
 */
export function newId(): string {
  return v7()
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Whether `value` is a UUID in its canonical text form, as the contract's `Uuid` pattern. */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && uuid.test(value)
}
