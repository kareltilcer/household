import { vectors } from '@household/test-vectors'
import { runVectors } from '@household/test-vectors/vitest'
import { describe } from 'vitest'
import { matchLocale } from './locale.ts'
import { formatMessage, MessageError } from './message.ts'

describe('vectors/i18n.json', () => {
  runVectors(
    vectors.i18n,
    {
      format: ({ locale, message, args }) => formatMessage(locale, message, args),
      match: (preferences) => matchLocale(preferences),
    },
    (error) => (error instanceof MessageError ? error.code : undefined),
  )
})
