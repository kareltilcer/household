// How a component test draws: inside what the app draws every screen inside (app/Root.tsx), in
// the same order, with the modes a test names instead of the device's. A test meets a component
// as a member does, by its role and its name (React Native Testing Library), and then runs the
// accessibility rules over what was drawn (`expectAccessible`, a11y.ts).
import type { DisplayLocale } from '@household/i18n'
import type { Theme } from '@household/tokens/native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render as draw, type RenderResult } from '@testing-library/react-native'
import { useEffect, useState, type ReactElement, type ReactNode } from 'react'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { DisplayProvider, useDisplay } from '../display/DisplayProvider.tsx'
import type { MotionPreference } from '../display/modes.ts'
import { I18nProvider } from '../i18n/I18nProvider.tsx'
import { SessionFixture } from '../session/fixture.tsx'
import { ToastProvider } from '../ui/Toast.tsx'

export interface DrawOptions {
  /** The language drawn in. Left out, English. */
  readonly locale?: DisplayLocale
  /** Left out, light. */
  readonly theme?: Theme
  /** The text scale, between 1 and 2. Left out, 1. */
  readonly scale?: number
  /** Left out, the device's, which under Jest asks for no less. */
  readonly motion?: MotionPreference
  /** The device's own languages, the preferred first. Left out, English. */
  readonly languages?: readonly string[]
}

/** What the last test was drawn at: the accessibility rules measure against it (a11y.ts). */
export const drawn: { scale: number; locale: DisplayLocale } = { scale: 1, locale: 'en' }

/** A phone's frame with no notch: the safe area's insets are all nothing. */
const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
}

/** Holds the text at `scale` for as long as it is drawn, and draws `children` once it is held. */
function Scaled({ scale, children }: { readonly scale: number; readonly children: ReactNode }) {
  const { hold } = useDisplay()
  const [held, setHeld] = useState(false)
  useEffect(() => {
    const release = hold({ scale })
    setHeld(true)
    return release
  }, [hold, scale])
  return held ? children : null
}

/** The providers a test's component stands in. */
export function TestProviders({
  children,
  locale = 'en',
  theme = 'light',
  scale = 1,
  motion = 'system',
  languages = ['en'],
}: DrawOptions & { readonly children: ReactNode }) {
  // A client of the test's own: nothing one test read is another's, and nothing is asked twice.
  const [queries] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } }),
  )
  return (
    <SafeAreaProvider initialMetrics={metrics}>
      <DisplayProvider preferences={{ theme, motion }}>
        <I18nProvider locale={locale} languages={languages}>
          <QueryClientProvider client={queries}>
            <SessionFixture>
              <ToastProvider>
                <Scaled scale={scale}>{children}</Scaled>
              </ToastProvider>
            </SessionFixture>
          </QueryClientProvider>
        </I18nProvider>
      </DisplayProvider>
    </SafeAreaProvider>
  )
}

/** Draws `ui` inside the app's providers, in the modes `options` names. */
export async function render(ui: ReactElement, options: DrawOptions = {}): Promise<RenderResult> {
  drawn.scale = options.scale ?? 1
  drawn.locale = options.locale ?? 'en'
  return draw(<TestProviders {...options}>{ui}</TestProviders>)
}
