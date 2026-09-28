// One ICU MessageFormat message: parsed within the subset both renderers support, and
// formatted. The clients format with intl-messageformat; the server's Go renderer
// (internal/platform/i18n) implements the same subset, and vectors/i18n.json holds the two to
// the same output for the same message (D-37).
//
// The subset: text with apostrophe quoting; `{arg}`; `{arg, number}` with no style;
// `{arg, plural, …}` and `{arg, selectordinal, …}` with an optional offset, `=N` and the CLDR
// keywords, and `#`; `{arg, select, …}`. Every plural or select has `other`. Dates, times,
// number styles and skeletons, and rich-text tags are outside it: a caller formats a date
// itself and passes the string, and `<` is text.
import {
  isArgumentElement,
  isDateElement,
  isLiteralElement,
  isNumberElement,
  isPluralElement,
  isPoundElement,
  isSelectElement,
  isTagElement,
  isTimeElement,
  parse,
  type MessageFormatElement,
} from '@formatjs/icu-messageformat-parser'
import { IntlMessageFormat } from 'intl-messageformat'

/** Why a message could not be parsed or formatted. The Go renderer uses the same codes. */
export type MessageErrorCode =
  'malformed_message' | 'unsupported_syntax' | 'missing_argument' | 'not_a_number'

export class MessageError extends Error {
  override readonly name = 'MessageError'
  readonly code: MessageErrorCode

  constructor(code: MessageErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

/**
 * How a message uses an argument: `number` where a plural, selectordinal or number format
 * needs a number, `value` where a string or a number will do.
 */
export type ArgumentKind = 'number' | 'value'

/** A message's arguments, by name. */
export type Signature = ReadonlyMap<string, ArgumentKind>

/** The values a message is formatted with. */
export type Arguments = Readonly<Record<string, string | number>>

const pluralKeywords = new Set(['zero', 'one', 'two', 'few', 'many', 'other'])
const exact = /^=(0|[1-9][0-9]*)$/
const name = /^[A-Za-z_][A-Za-z0-9_]*$/
const selectKey = /^[A-Za-z0-9_]+$/

/** `message` parsed, or a MessageError naming why it is outside the subset. */
export function parseMessage(message: string): MessageFormatElement[] {
  let ast: MessageFormatElement[]
  try {
    ast = parse(message, { ignoreTag: true, requiresOtherClause: true })
  } catch (error) {
    throw new MessageError('malformed_message', `${JSON.stringify(message)}: ${String(error)}`)
  }
  check(ast, message)
  return ast
}

function check(elements: readonly MessageFormatElement[], message: string): void {
  const outside = (what: string) =>
    new MessageError('unsupported_syntax', `${JSON.stringify(message)}: ${what}`)
  for (const el of elements) {
    if (isLiteralElement(el) || isPoundElement(el)) continue
    if (isDateElement(el) || isTimeElement(el)) throw outside(`{${el.value}} formats a date`)
    if (isTagElement(el)) throw outside(`<${el.value}> is a tag`)
    if (!name.test(el.value)) throw outside(`${JSON.stringify(el.value)} is not an argument name`)
    if (isNumberElement(el) && el.style != null) throw outside(`{${el.value}} has a number style`)
    if (isPluralElement(el)) {
      for (const [key, option] of Object.entries(el.options)) {
        if (!pluralKeywords.has(key) && !exact.test(key)) {
          throw outside(`${JSON.stringify(key)} is not a plural keyword`)
        }
        check(option.value, message)
      }
    }
    if (isSelectElement(el)) {
      for (const [key, option] of Object.entries(el.options)) {
        if (!selectKey.test(key)) throw outside(`${JSON.stringify(key)} is not a select key`)
        check(option.value, message)
      }
    }
  }
}

/** The arguments `elements` use, and how. */
export function signature(elements: readonly MessageFormatElement[]): Signature {
  const found = new Map<string, ArgumentKind>()
  const walk = (els: readonly MessageFormatElement[]) => {
    for (const el of els) {
      if (isPluralElement(el) || isNumberElement(el)) found.set(el.value, 'number')
      else if ((isArgumentElement(el) || isSelectElement(el)) && !found.has(el.value)) {
        found.set(el.value, 'value')
      }
      if (isPluralElement(el) || isSelectElement(el)) {
        for (const option of Object.values(el.options)) walk(option.value)
      }
    }
  }
  walk(elements)
  return found
}

/** A message parsed once and formatted as often as needed. */
export interface CompiledMessage {
  readonly signature: Signature
  format(args?: Arguments): string
}

/**
 * `message` compiled for `locale`. Formatting refuses a missing argument, and one a plural or
 * number format needs as a number that is not a finite number, rather than rendering
 * "NaN" as intl-messageformat would.
 */
export function compileMessage(locale: string, message: string): CompiledMessage {
  const ast = parseMessage(message)
  const sig = signature(ast)
  const format = new IntlMessageFormat(ast, locale, undefined, { ignoreTag: true })
  return {
    signature: sig,
    format(args = {}) {
      for (const [arg, kind] of sig) {
        const value = Object.hasOwn(args, arg) ? args[arg] : undefined
        if (value === undefined) {
          throw new MessageError('missing_argument', `${JSON.stringify(message)} needs {${arg}}`)
        }
        if (kind === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) {
          throw new MessageError(
            'not_a_number',
            `{${arg}} is ${JSON.stringify(value)}, not a number`,
          )
        }
      }
      const out = format.format(args)
      if (typeof out !== 'string') throw new TypeError('a message formatted to parts')
      return out
    },
  }
}

/** `message` formatted once, in `locale`, with `args`. */
export function formatMessage(locale: string, message: string, args?: Arguments): string {
  return compileMessage(locale, message).format(args)
}
