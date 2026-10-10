// The providers around every route: nothing is drawn until the device's own modes are read, and
// then every screen stands in them.
import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { catalogs } from '@household/i18n'
import { nativeThemes } from '@household/tokens/native'
import { act, render, screen, userEvent, waitFor } from '@testing-library/react-native'
import * as SplashScreen from 'expo-splash-screen'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import * as keep from '../display/keep.ts'
import { storageKey as displayKey, type DisplayPreferences } from '../display/modes.ts'
import { useDisplay, useTheme } from '../display/DisplayProvider.tsx'
import { useI18n } from '../i18n/I18nProvider.tsx'
import { storageKey as localeKey } from '../i18n/locale.ts'
import { expectAccessible } from '../test/a11y.ts'
import { Text } from '../ui/Text.tsx'
import { Providers, RouteError } from './Root.tsx'

jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(() => Promise.resolve(true)),
  hideAsync: jest.fn(() => Promise.resolve()),
}))

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
}

function Probe() {
  const { preferences } = useDisplay()
  const { locale } = useI18n()
  return (
    <Text testID="probe">{`${preferences.theme} ${preferences.motion} ${locale} ${useTheme().color.surface}`}</Text>
  )
}

beforeEach(async () => {
  await AsyncStorage.clear()
})

describe('the root layout', () => {
  it('holds the splash screen from the start', () => {
    expect(SplashScreen.preventAutoHideAsync).toHaveBeenCalledTimes(1)
  })

  it('draws nothing until what the device kept is read, then draws in it', async () => {
    await AsyncStorage.setItem(localeKey, 'pl')
    // The device answers when the test says: until then nothing is drawn, the splash is up.
    let answer: (preferences: DisplayPreferences) => void = () => undefined
    jest.spyOn(keep, 'readPreferences').mockReturnValue(
      new Promise((resolve) => {
        answer = resolve
      }),
    )
    await render(
      <Providers>
        <Probe />
      </Providers>,
    )
    expect(screen.queryByTestId('probe')).toBeNull()
    expect(SplashScreen.hideAsync).not.toHaveBeenCalled()
    await act(() => {
      answer({ theme: 'dark', motion: 'reduced' })
    })
    expect(screen.getByTestId('probe')).toHaveTextContent(
      `dark reduced pl ${nativeThemes.dark.color.surface}`,
    )
    jest.restoreAllMocks()
  })

  it('reads the modes the device kept', async () => {
    await AsyncStorage.setItem(displayKey, JSON.stringify({ theme: 'dark', motion: 'reduced' }))
    await render(
      <Providers>
        <Probe />
      </Providers>,
    )
    await waitFor(() => {
      expect(screen.getByTestId('probe')).toHaveTextContent(/^dark reduced /)
    })
  })

  it('draws in the defaults on a device that kept nothing: light, in the device’s language', async () => {
    await render(
      <Providers>
        <Probe />
      </Providers>,
    )
    await waitFor(() => {
      expect(screen.getByTestId('probe')).toHaveTextContent(/^light system (en|cs|sk|de|pl) /)
    })
  })
})

describe('a route that failed', () => {
  it('is named in words, with one way on, on providers of its own', async () => {
    const retry = jest.fn(() => Promise.resolve())
    await render(
      <SafeAreaProvider initialMetrics={metrics}>
        <RouteError retry={retry} error={new Error('a screen failed')} />
      </SafeAreaProvider>,
    )
    expect(screen.getByRole('header')).toHaveTextContent(catalogs.en['device.app.error.title'])
    expect(screen.getByText(catalogs.en['device.app.error.body'])).toBeOnTheScreen()
    await userEvent.press(screen.getByRole('button', { name: catalogs.en['ui.retry'] }))
    expect(retry).toHaveBeenCalledTimes(1)
    expectAccessible(screen.root, { scale: 1 })
  })
})
