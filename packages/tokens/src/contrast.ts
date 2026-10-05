/**
 * WCAG 2.1's contrast ratio between two colours, each `#RRGGBB`: the arithmetic the build gate on
 * the declared pairs runs (06-clients §4), ported from design/v1's `foundations.js`.
 */

const hex = /^#[0-9a-f]{6}$/i

function luminance(color: string): number {
  if (!hex.test(color)) throw new Error(`contrast: ${color} is not a #RRGGBB colour`)
  const [r, g, b] = [1, 3, 5].map((at) => {
    const channel = Number.parseInt(color.slice(at, at + 2), 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0)
}

/** The ratio of the lighter colour's relative luminance to the darker's, from 1 to 21. */
export function contrast(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)]
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}
