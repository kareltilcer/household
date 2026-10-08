/**
 * @household/i18n — the ICU MessageFormat catalogs for en, cs, sk, de and pl, with typed
 * keys, shared by both clients and the server's render path (06-clients §1, 03 §9).
 *
 * - catalogs/<locale>.json: flat, sorted keys; English is the source (D-29).
 * - review/<locale>.json: the drafted translations awaiting native review, each with the
 *   English it translates (PL-9). Native review clears them before GA (plan item 95).
 * - The server reads the same files through this directory's Go module (catalogs.go) and
 *   renders them with internal/platform/i18n, which implements message.ts's subset.
 * - lazy.ts (`@household/i18n/lazy`) is the entry for a client that loads one language at a
 *   time: this one holds all five.
 */
export {
  catalogs,
  defineCatalogs,
  isMessageKey,
  locales,
  sourceLocale,
  type Catalog,
  type Locale,
  type MessageKey,
} from './catalogs.ts'
export type { MessageArgs } from './generated/messages.ts'
export { matchLocale } from './locale.ts'
export {
  compileMessage,
  formatMessage,
  MessageError,
  parseMessage,
  signature,
  type ArgumentKind,
  type Arguments,
  type CompiledMessage,
  type MessageErrorCode,
  type Signature,
} from './message.ts'
export { pseudoLocale, pseudolocalize } from './pseudo.ts'
export { createTranslator, type DisplayLocale, type Translate } from './translator.ts'
