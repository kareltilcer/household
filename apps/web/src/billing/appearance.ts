// How the payment form is made to look like the page it stands in. The form is the processor's
// frame, which no stylesheet of the app's reaches, so its look is handed to it as values
// (Stripe's `appearance`): the values the app's own semantic tokens come to where the form
// stands, read off the page as it is drawn. No colour is written here (D-152): a token that
// changes, a theme that is chosen, changes the form with the page.
import type { Appearance } from './stripe.ts'

/** The part of a colour as the platform computes one, `rgb(44, 46, 56)`, that is its channels. */
const channels = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/

/**
 * Whether `colour`, an ink as the platform computed it, is a light one: the ink of a dark page.
 * One that cannot be read is taken for a dark ink, which is the page's own before a theme is
 * chosen.
 */
export function isLightInk(colour: string): boolean {
  const read = channels.exec(colour.trim())
  if (read === null) return false
  const [red, green, blue] = [Number(read[1]), Number(read[2]), Number(read[3])]
  // The eye's own weights of the three (ITU-R BT.601), against the middle of their range.
  return 0.299 * red + 0.587 * green + 0.114 * blue > 127.5
}

/**
 * The form's look where `host` stands: the processor's own base for a light page or a dark one,
 * with the page's ground, ink, accent, danger, face, size and corner over it. A token that is
 * not set where the form stands is left to the base.
 */
export function appearanceAt(host: Element): Appearance {
  const style = window.getComputedStyle(host)
  const token = (name: string) => style.getPropertyValue(name).trim()
  const given = (name: keyof NonNullable<Appearance['variables']>, value: string) =>
    value === '' ? {} : { [name]: value }
  return {
    theme: isLightInk(style.color) ? 'night' : 'stripe',
    variables: {
      ...given('colorPrimary', token('--accent')),
      ...given('colorBackground', token('--input-bg')),
      ...given('colorText', token('--text-primary')),
      ...given('colorTextSecondary', token('--text-muted')),
      ...given('colorTextPlaceholder', token('--text-muted')),
      ...given('colorDanger', token('--danger')),
      ...given('borderRadius', token('--radius-control')),
      ...given('fontFamily', style.fontFamily),
      ...given('fontSizeBase', style.fontSize),
    },
  }
}
