// `crypto.getRandomValues`, which every identifier is drawn from (D-23: @household/api's `newId`
// and the replica's own, both uuid's v7) and which Hermes does not provide. expo-crypto's is the
// operating system's generator, asked synchronously as the web's is, so it is installed under
// the web's name where the engine has none.
import { getRandomValues } from 'expo-crypto'

const host = globalThis as { crypto?: { getRandomValues?: unknown } }

if (typeof host.crypto?.getRandomValues !== 'function') {
  host.crypto = { ...host.crypto, getRandomValues }
}
