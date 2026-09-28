// The pseudo-locale, en-XA: English with every letter accented, bracketed and padded by about
// 40 %, so a layout that only survives English breaks visibly, a string that escaped the
// catalogs stands out unaccented, and a cut-off end loses its bracket (PRD 03 §9, 06 §8). It
// is derived from English when it is asked for, so it cannot fall out of step.
import {
  createLiteralElement,
  isLiteralElement,
  isPluralElement,
  isSelectElement,
  type MessageFormatElement,
} from '@formatjs/icu-messageformat-parser'
import { printAST } from '@formatjs/icu-messageformat-parser/printer.js'
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

/** `message`, pseudo-localised: its text accented, its arguments and syntax untouched. */
export function pseudolocalize(message: string): string {
  let letters = 0
  const accent = (elements: MessageFormatElement[]): MessageFormatElement[] =>
    elements.map((el) => {
      if (isLiteralElement(el)) {
        letters += (el.value.match(/\p{L}/gu) ?? []).length
        return { ...el, value: el.value.replace(/[A-Za-z]/g, (ch) => accented[ch] ?? ch) }
      }
      if (isPluralElement(el) || isSelectElement(el)) {
        const options = Object.fromEntries(
          Object.entries(el.options).map(([key, option]) => [
            key,
            { ...option, value: accent(option.value) },
          ]),
        )
        return { ...el, options }
      }
      return el
    })
  const body = accent(parseMessage(message))
  const padding = '·'.repeat(Math.ceil(letters * 0.4))
  return printAST([
    createLiteralElement('⟦'),
    ...body,
    createLiteralElement(`${padding === '' ? '' : ` ${padding}`}⟧`),
  ])
}
