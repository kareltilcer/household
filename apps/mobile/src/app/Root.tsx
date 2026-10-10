// The root layout: what stands around every route, in the order each needs what is above it.
//
//   display → i18n → [the session group's: problem hub and query client → session → please
//   update] → [the controls group's: toasts] → the router's stack
//
// The display modes and the language are read from the device before anything is drawn, and the
// splash screen stays up until they are: a first screen drawn in the default theme and then in
// the member's own is a flash a dark room notices. The two groups whose providers stand here
// each fill a file of their own (session/Providers.tsx, ui/Toast.tsx), so this one is not
// edited for them.
import type { DisplayLocale } from '@household/i18n'
import { Stack, type ErrorBoundaryProps } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import * as SystemUI from 'expo-system-ui'
import { useEffect, useState, type ReactNode } from 'react'
import { View } from 'react-native'
import { DisplayProvider, useDisplay, useTheme } from '../display/DisplayProvider.tsx'
import { readPreferences } from '../display/keep.ts'
import type { DisplayPreferences } from '../display/modes.ts'
import { I18nProvider, useTranslate } from '../i18n/I18nProvider.tsx'
import { readLocale } from '../i18n/locale.ts'
import { SessionProviders } from '../session/Providers.tsx'
import { Button } from '../ui/Button.tsx'
import { Screen } from '../ui/Screen.tsx'
import { Text } from '../ui/Text.tsx'
import { ToastProvider } from '../ui/Toast.tsx'

// Asked as the bundle is evaluated, before a component is: the splash screen is otherwise put
// away as soon as the first frame is drawn, which is an empty one.
SplashScreen.preventAutoHideAsync().catch(() => undefined)

/** What this device kept of how the app is shown. */
interface Kept {
  readonly preferences: DisplayPreferences
  readonly locale: DisplayLocale
}

/** The device's own chrome, in step with the theme: the status bar's ink and the ground behind every screen. */
function Chrome({ children }: { readonly children: ReactNode }) {
  const { theme: name } = useDisplay()
  const theme = useTheme()
  const ground = theme.color.surface
  useEffect(() => {
    // What shows behind a screen as it moves, and behind the keyboard.
    SystemUI.setBackgroundColorAsync(ground).catch(() => undefined)
  }, [ground])
  return (
    <View
      style={{ flex: 1, backgroundColor: ground }}
      onLayout={() => {
        // The first screen has a place: whatever is drawn from here on is the app's.
        SplashScreen.hideAsync().catch(() => undefined)
      }}
    >
      <StatusBar style={name === 'dark' ? 'light' : 'dark'} />
      {children}
    </View>
  )
}

/** The providers, around `children`: nothing is drawn until the device's own modes are read. */
export function Providers({ children }: { readonly children: ReactNode }) {
  const [kept, setKept] = useState<Kept | null>(null)
  useEffect(() => {
    let wanted = true
    // Neither read fails: a device that gives nothing back gives the defaults.
    void Promise.all([readPreferences(), readLocale()]).then(([preferences, locale]) => {
      if (wanted) setKept({ preferences, locale })
    })
    return () => {
      wanted = false
    }
  }, [])
  if (kept === null) return null
  return (
    <DisplayProvider preferences={kept.preferences}>
      <I18nProvider locale={kept.locale}>
        <Chrome>
          <SessionProviders>
            <ToastProvider>{children}</ToastProvider>
          </SessionProviders>
        </Chrome>
      </I18nProvider>
    </DisplayProvider>
  )
}

export function Root() {
  return (
    <Providers>
      {/* Each screen draws its own title, or the shell's bar does: the navigator draws none. */}
      <Stack screenOptions={{ headerShown: false }} />
    </Providers>
  )
}

/**
 * What stands in the app's place when drawing a route failed: named, in words, with one way on.
 * expo-router draws it instead of the layout that failed, so it stands on providers of its own:
 * the device's language and the default theme, which is all it can know.
 */
export function RouteError(props: ErrorBoundaryProps) {
  return (
    <DisplayProvider>
      <I18nProvider>
        <Failed {...props} />
      </I18nProvider>
    </DisplayProvider>
  )
}

function Failed({ retry }: ErrorBoundaryProps) {
  const t = useTranslate()
  return (
    <Screen title={t('device.app.error.title')} testID="route-error">
      <Text color="text-muted">{t('device.app.error.body')}</Text>
      <Button
        variant="primary"
        onPress={() => {
          void retry()
        }}
      >
        {t('ui.retry')}
      </Button>
    </Screen>
  )
}
