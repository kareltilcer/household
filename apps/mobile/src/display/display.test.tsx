// The display modes: what a member chooses, what the device says, and what a component is
// handed of both.
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { nativeThemes } from '@household/tokens/native'
import { act, render, screen, userEvent } from '@testing-library/react-native'
import * as announcer from '../ui/announce.ts'
import { Button } from '../ui/Button.tsx'
import { Text } from '../ui/Text.tsx'
import {
  DisplayProvider,
  ThemeScope,
  useDisplay,
  useTarget,
  useTheme,
  useThemeName,
  useType,
} from './DisplayProvider.tsx'
import { readPreferences } from './keep.ts'
import { defaults, parsePreferences, storageKey, textScaleOf } from './modes.ts'

/** What the device prefers, as React Native's hook says it: a test sets it before it draws. */
let mockScheme: 'light' | 'dark' = 'light'
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockScheme,
}))

beforeEach(async () => {
  await AsyncStorage.clear()
})

afterEach(() => {
  mockScheme = 'light'
  jest.restoreAllMocks()
})

/** What a component is handed, as words a test reads. */
function Probe() {
  const display = useDisplay()
  const theme = useTheme()
  const type = useType('body')
  const target = useTarget()
  return (
    <>
      <Text testID="modes">{`${display.preferences.theme} ${display.preferences.motion}`}</Text>
      <Text testID="theme">{`${useThemeName()} ${theme.color.surface}`}</Text>
      <Text testID="scale">{`${String(display.textScale)} ${String(type.fontSize)} ${String(target)}`}</Text>
      <Text testID="motion">{String(display.reducedMotion)}</Text>
      <Button
        testID="dark"
        onPress={() => {
          display.set({ theme: 'dark' })
        }}
      >
        {String(1)}
      </Button>
      <Button
        testID="system"
        onPress={() => {
          display.set({ theme: 'system', motion: 'reduced' })
        }}
      >
        {String(2)}
      </Button>
    </>
  )
}

describe('the modes a device keeps', () => {
  it('are light and the device’s own motion until a member chooses', () => {
    expect(defaults).toEqual({ theme: 'light', motion: 'system' })
    expect(parsePreferences(null)).toEqual(defaults)
  })

  it('are read whatever the device’s storage holds', async () => {
    expect(parsePreferences('{"theme":"dark","motion":"reduced"}')).toEqual({
      theme: 'dark',
      motion: 'reduced',
    })
    expect(parsePreferences('{"theme":"sepia","density":"compact"}')).toEqual(defaults)
    expect(parsePreferences('not json')).toEqual(defaults)
    expect(parsePreferences('[]')).toEqual(defaults)
    await AsyncStorage.setItem(storageKey, '{"theme":"system"}')
    expect(await readPreferences()).toEqual({ theme: 'system', motion: 'system' })
  })

  it('follow the device’s text size up to 200 % and hold it there', () => {
    expect(textScaleOf(1)).toBe(1)
    expect(textScaleOf(1.35)).toBe(1.35)
    expect(textScaleOf(3.1)).toBe(2)
    // Smaller than the scale was designed at is no smaller.
    expect(textScaleOf(0.85)).toBe(1)
    expect(textScaleOf(Number.NaN)).toBe(1)
  })
})

describe('the display', () => {
  it('is light whatever the device prefers, until a member chooses', async () => {
    mockScheme = 'dark'
    await render(
      <DisplayProvider>
        <Probe />
      </DisplayProvider>,
    )
    expect(screen.getByTestId('modes')).toHaveTextContent('light system')
    expect(screen.getByTestId('theme')).toHaveTextContent(
      `light ${nativeThemes.light.color.surface}`,
    )
  })

  it('takes a member’s choice at once and keeps it on the device', async () => {
    await render(
      <DisplayProvider>
        <Probe />
      </DisplayProvider>,
    )
    await userEvent.press(screen.getByTestId('dark'))
    expect(screen.getByTestId('theme')).toHaveTextContent(`dark ${nativeThemes.dark.color.surface}`)
    expect(await readPreferences()).toEqual({ theme: 'dark', motion: 'system' })
  })

  it('follows the device where a member chose `system`', async () => {
    mockScheme = 'dark'
    await render(
      <DisplayProvider preferences={{ theme: 'system', motion: 'system' }}>
        <Probe />
      </DisplayProvider>,
    )
    expect(screen.getByTestId('theme')).toHaveTextContent(`dark ${nativeThemes.dark.color.surface}`)
  })

  it('reduces motion where the member asks, or the device does', async () => {
    let tell: (reduced: boolean) => void = () => undefined
    jest.spyOn(announcer, 'watchReducedMotion').mockImplementation((listener) => {
      tell = listener
      return () => undefined
    })
    await render(
      <DisplayProvider>
        <Probe />
      </DisplayProvider>,
    )
    expect(screen.getByTestId('motion')).toHaveTextContent('false')
    await act(() => {
      tell(true)
    })
    expect(screen.getByTestId('motion')).toHaveTextContent('true')
    await act(() => {
      tell(false)
    })
    expect(screen.getByTestId('motion')).toHaveTextContent('false')
    await userEvent.press(screen.getByTestId('system'))
    expect(screen.getByTestId('motion')).toHaveTextContent('true')
  })

  it('draws a subtree in the theme its scope names', async () => {
    await render(
      <DisplayProvider>
        <ThemeScope theme="dark">
          <Probe />
        </ThemeScope>
      </DisplayProvider>,
    )
    expect(screen.getByTestId('theme')).toHaveTextContent(`dark ${nativeThemes.dark.color.surface}`)
    // The scope is where it is drawn, and no choice of the member's.
    expect(screen.getByTestId('modes')).toHaveTextContent('light system')
  })
})

describe('a held mode', () => {
  function Holder({ scale }: { readonly scale: number }) {
    const { hold } = useDisplay()
    return (
      <Button
        testID="hold"
        onPress={() => {
          hold({ scale, theme: 'dark' })
        }}
      >
        {String(3)}
      </Button>
    )
  }

  it('is over the member’s own, scales the type and the target, and is not kept', async () => {
    await render(
      <DisplayProvider>
        <Probe />
        <Holder scale={1.25} />
      </DisplayProvider>,
    )
    // Jest's device says its text is twice the size (React Native's own stand-in for one).
    expect(screen.getByTestId('scale')).toHaveTextContent('2 32 88')
    await userEvent.press(screen.getByTestId('hold'))
    expect(screen.getByTestId('scale')).toHaveTextContent('1.25 20 55')
    expect(screen.getByTestId('modes')).toHaveTextContent('dark system')
    expect(await AsyncStorage.getItem(storageKey)).toBeNull()
  })
})
