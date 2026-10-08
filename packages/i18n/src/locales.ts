// The languages Household ships in, and what a catalog is, with no catalog imported: a client
// that loads one language at a time (lazy.ts) names them from here without holding all five.
import type { MessageArgs } from './generated/messages.ts'

/** The languages Household 1.0 ships in (PRD 03 §9), English first as the source. */
export const locales = ['en', 'cs', 'sk', 'de', 'pl'] as const

export type Locale = (typeof locales)[number]

/** The source language: every key is defined by its English message. */
export const sourceLocale = 'en' satisfies Locale

/** A key of every catalog. */
export type MessageKey = keyof MessageArgs

/** One language's messages, by key. */
export type Catalog = { readonly [K in MessageKey]: string }
