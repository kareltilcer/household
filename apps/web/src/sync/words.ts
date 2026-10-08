// What the sync UI's surfaces say alike (F-5 to F-7): who an author is, when a version was made,
// and a comparison's fields as the pairs a detail block draws. A time is the household's, in the
// member's format; an author is a name, *you* from another device, or *another member* where
// this browser cannot say (setting.ts).
import type { Translate } from '@household/i18n/lazy'
import { useMemo } from 'react'
import { useFormat, useTranslate } from '../i18n/I18nProvider.tsx'
import type { Pair } from '../ui/KeyValue.tsx'
import type { ComparedField, Words } from './describe.ts'
import type { Author } from './setting.ts'

/** What a describer writes with, in a household whose zone is `timezone`. */
export function useWords(timezone: string): Words {
  const t = useTranslate()
  const format = useFormat()
  return useMemo(() => ({ t, format, timezone }), [t, format, timezone])
}

/** An author in words: their name where this browser knows it. */
export function authorName(author: Author, t: Translate): string {
  switch (author.kind) {
    case 'me':
      return t('sync.author.me')
    case 'member':
      return author.name
    case 'unknown':
      return t('sync.author.unknown')
  }
}

/**
 * `at` as the household reads it, where it is an instant: a mutation's client time, a row's
 * `updated_at`. Undefined for anything else: a row that carries no time, or one that is no time.
 */
export function instantOf(at: unknown, words: Words): string | undefined {
  if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) return undefined
  return words.format.instant(at, words.timezone)
}

/** One side of a comparison as a detail block's pairs. A value that is none reads as none. */
export function pairsOf(fields: readonly ComparedField[], side: 'mine' | 'theirs'): Pair[] {
  return fields.map((field) => ({ key: field.label, value: field[side] }))
}
