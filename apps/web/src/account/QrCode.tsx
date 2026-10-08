// The square an authenticator app scans (A-5): the enrolment's `otpauth_uri` as a QR code, drawn
// as SVG rectangles through React. Nothing is injected and no image is made of it: the policy
// admits no `data:` URL and no inline style (ADR 0025), and a square of rectangles needs neither.
// It is named for what it is for, and the key it carries is offered beside it, at the same
// level, by whoever draws it: a member setting this up on the only phone they own cannot scan
// the screen they are reading.
import qrcode from 'qrcode-generator'
import { useMemo } from 'react'
import styles from './Settings.module.css'

/** A run of dark modules in one row: where it starts, and how many it is. */
interface Bar {
  readonly x: number
  readonly y: number
  readonly width: number
}

/** The clear margin a reader needs around the square, in modules (ISO/IEC 18004). */
const quiet = 4

/** `value` as a QR code: how many modules a side it is, and its dark runs, row by row. */
export function squares(value: string): { readonly size: number; readonly bars: readonly Bar[] } {
  // The smallest version that holds it, at the level that survives a smudged or glaring screen.
  const code = qrcode(0, 'M')
  code.addData(value)
  code.make()
  const size = code.getModuleCount()
  const bars: Bar[] = []
  for (let y = 0; y < size; y += 1) {
    let start = -1
    for (let x = 0; x <= size; x += 1) {
      const dark = x < size && code.isDark(y, x)
      if (dark && start === -1) start = x
      if (!dark && start !== -1) {
        bars.push({ x: start, y, width: x - start })
        start = -1
      }
    }
  }
  return { size, bars }
}

export interface QrCodeProps {
  /** What the square carries. */
  readonly value: string
  /** What it is for, translated: its name to assistive technology. */
  readonly label: string
}

export function QrCode({ value, label }: QrCodeProps) {
  const { size, bars } = useMemo(() => squares(value), [value])
  const side = size + 2 * quiet
  return (
    // A light scope of its own (ADR 0024): dark on light in either theme, as a reader expects.
    <div className={styles.qr} data-theme="light">
      <svg
        role="img"
        aria-label={label}
        viewBox={`${String(-quiet)} ${String(-quiet)} ${String(side)} ${String(side)}`}
        shapeRendering="crispEdges"
      >
        {bars.map((bar) => (
          <rect
            key={`${String(bar.x)}-${String(bar.y)}`}
            x={bar.x}
            y={bar.y}
            width={bar.width}
            height={1}
          />
        ))}
      </svg>
    </div>
  )
}
