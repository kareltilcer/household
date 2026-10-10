// The parts a language's catalog is fetched in by a client that loads one language at a time
// (lazy.ts, D-159). A part is a set of first segments of a key: the app's own words, which such a
// client fetches before it draws one, and each other part with the screens that read it. The
// catalogs stay one file a language (catalogs/<locale>.json), which the server reads whole, and
// scripts/gen.ts writes each language's parts from them. This file is data, with no catalog
// imported.
import type { MessageKey } from './locales.ts'

/**
 * Each part, by the first segments of the keys it holds. A part no key is in yet is a part all
 * the same, and its file is empty. `billing` holds two messages that the server alone renders, an
 * invoice's lines: a first segment is in one row, so they ride with their part.
 */
export const parts = {
  app: [
    'a11y',
    'account',
    'app',
    'auth',
    'entitlement',
    'module',
    'nav',
    'push',
    'session',
    'shell',
    'sync',
    'ui',
  ],
  household: ['household'],
  billing: ['billing'],
  storage: ['storage'],
  // A household's data and a member's own are one part: the screens of both show an export.
  privacy: ['data', 'privacy'],
  health: ['health', 'clients'],
} as const satisfies Readonly<Record<string, readonly string[]>>

export type Part = keyof typeof parts

/** The parts by name, the app's own first. */
export const clientParts: readonly Part[] = Object.keys(parts) as Part[]

/**
 * The first segments of the keys that are the server's alone, in no part and fetched by no
 * client: it renders them itself, into an audit summary, an email or a notification.
 */
export const serverSegments = ['activity', 'admin', 'email', 'notification'] as const

/** Some of one language's messages, by key: a part of its catalog, or several parts together. */
export type CatalogPart = { readonly [K in MessageKey]?: string }

const partBySegment: ReadonlyMap<string, Part> = new Map(
  clientParts.flatMap((part) => parts[part].map((segment) => [segment, part] as const)),
)

/** The part that holds `key`, by its first segment, or undefined for one of the server's alone. */
export function partOf(key: string): Part | undefined {
  return partBySegment.get(key.split('.', 1)[0] ?? '')
}
