// The pseudo-locale, en-XA: English with every letter accented, bracketed and padded by about
// 40 %, so a layout that only survives English breaks visibly, a string that escaped the
// catalogs stands out unaccented, and a cut-off end loses its bracket (PRD 03 §9, 06 §8). It
// is derived from English when it is asked for, so it cannot fall out of step.
import {
  isArgumentElement,
  isLiteralElement,
  isNumberElement,
  isPluralElement,
  isPoundElement,
  isSelectElement,
  type MessageFormatElement,
} from '@formatjs/icu-messageformat-parser'
import { parseMessage } from './message.ts'

/** The pseudo-locale's tag: a private-use region of English, as Android and FormatJS use. */
export const pseudoLocale = 'en-XA'

const accented: Readonly<Record<string, string>> = {
  a: 'á',
  b: 'ƀ',
  c: 'ç',
  d: 'ð',
  e: 'é',
  f: 'ƒ',
  g: 'ĝ',
  h: 'ĥ',
  i: 'í',
  j: 'ĵ',
  k: 'ķ',
  l: 'ľ',
  m: 'ɱ',
  n: 'ñ',
  o: 'ó',
  p: 'þ',
  q: 'ǫ',
  r: 'ŕ',
  s: 'š',
  t: 'ţ',
  u: 'ú',
  v: 'ṽ',
  w: 'ŵ',
  x: 'ẋ',
  y: 'ý',
  z: 'ž',
  A: 'Á',
  B: 'Ɓ',
  C: 'Ç',
  D: 'Ð',
  E: 'É',
  F: 'Ƒ',
  G: 'Ĝ',
  H: 'Ĥ',
  I: 'Í',
  J: 'Ĵ',
  K: 'Ķ',
  L: 'Ľ',
  M: 'Ṁ',
  N: 'Ñ',
  O: 'Ó',
  P: 'Þ',
  Q: 'Ǫ',
  R: 'Ŕ',
  S: 'Š',
  T: 'Ţ',
  U: 'Ú',
  V: 'Ṽ',
  W: 'Ŵ',
  X: 'Ẋ',
  Y: 'Ý',
  Z: 'Ž',
}

/**
 * `message`, pseudo-localised: its text accented, its arguments and syntax untouched. It is
 * printed here rather than by FormatJS's printAST, which turns a lone apostrophe between two
 * arguments into `'''` and so quotes the argument after it: `''{name}''` would show `{name}`.
 */
export function pseudolocalize(message: string): string {
  let letters = 0
  // inPlural: the elements are an option of a plural or selectordinal, where # is syntax.
  const print = (elements: readonly MessageFormatElement[], inPlural: boolean): string =>
    elements
      .map((el) => {
        if (isLiteralElement(el)) {
          letters += (el.value.match(/\p{L}/gu) ?? []).length
          return literal(
            el.value.replace(/[A-Za-z]/g, (ch) => accented[ch] ?? ch),
            inPlural,
          )
        }
        if (isPoundElement(el)) return '#'
        if (isArgumentElement(el)) return `{${el.value}}`
        if (isNumberElement(el)) return `{${el.value}, number}`
        if (isPluralElement(el) || isSelectElement(el)) {
          const type = isSelectElement(el)
            ? 'select'
            : el.pluralType === 'ordinal'
              ? 'selectordinal'
              : 'plural'
          const offset =
            isPluralElement(el) && el.offset !== 0 ? ` offset:${String(el.offset)}` : ''
          const options = Object.entries(el.options)
            .map(([key, option]) => ` ${key} {${print(option.value, type !== 'select')}}`)
            .join('')
          return `{${el.value}, ${type},${offset}${options}}`
        }
        // parseMessage admits nothing else: dates, times and tags are outside the subset.
        throw new TypeError(`pseudolocalize: element type ${String(el.type)} is not in the subset`)
      })
      .join('')
  const body = print(parseMessage(message), false)
  const padding = '·'.repeat(Math.ceil(letters * 0.4))
  return `⟦${body}${padding === '' ? '' : ` ${padding}`}⟧`
}

/**
 * `text` as ICU MessageFormat literal text: every apostrophe doubled, and the syntax
 * characters (`{`, `}`, and `#` directly inside a plural) quoted. The quote opens at the first
 * of them, since an apostrophe before anything else is itself, and runs to the end of the
 * text, so a doubled apostrophe can never be read as a quote closing and reopening.
 */
function literal(text: string, inPlural: boolean): string {
  const first = text.search(inPlural ? /[{}#]/ : /[{}]/)
  const doubled = (s: string) => s.replaceAll("'", "''")
  return first < 0
    ? doubled(text)
    : `${doubled(text.slice(0, first))}'${doubled(text.slice(first))}'`
}
