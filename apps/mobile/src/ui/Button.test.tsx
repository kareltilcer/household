// The button's contract (02-components; the web's `controls.test.tsx` is its twin): what it is
// called, what a press does, and what becomes of both while its write is on its way.
import { describe, expect, it, jest } from '@jest/globals'
import { controls } from '@household/icons'
import { catalogs } from '@household/i18n'
import { nativeThemes } from '@household/tokens/native'
import { screen, userEvent } from '@testing-library/react-native'
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native'
import { expectAccessible, violations } from '../test/a11y.ts'
import { words } from '../test/fixtures.ts'
import { render } from '../test/render.tsx'
import { Button, IconButton, type ButtonVariant } from './Button.tsx'
import { BaseIcon } from './Icon.tsx'

const close = catalogs.en[controls.close_sheet.labelKey]

/** The style a pressable draws with when it is not pressed. */
function styleOf(testID: string): ViewStyle {
  return StyleSheet.flatten(screen.getByTestId(testID).props.style as StyleProp<ViewStyle>)
}

describe('Button', () => {
  it('is a button named by its words, and a press is heard once', async () => {
    const onPress = jest.fn()
    await render(<Button onPress={onPress}>{words.save}</Button>)
    await userEvent.press(screen.getByRole('button', { name: words.save }))
    expect(onPress).toHaveBeenCalledTimes(1)
    expectAccessible()
  })

  it.each<ButtonVariant>(['primary', 'secondary', 'ghost', 'danger'])(
    'draws the %s variant in its own tokens, in either theme',
    async (variant) => {
      const grounds = {
        primary: 'button-primary-bg',
        secondary: 'surface-raised',
        ghost: null,
        danger: 'button-danger-bg',
      } as const
      for (const theme of ['light', 'dark'] as const) {
        const view = await render(
          <Button testID="it" variant={variant}>
            {words.save}
          </Button>,
          { theme },
        )
        const ground = grounds[variant]
        expect(styleOf('it').backgroundColor).toBe(
          ground === null ? 'transparent' : nativeThemes[theme].color[ground],
        )
        expectAccessible()
        await view.unmount()
      }
    },
  )

  it('is 44 pt at the least, and grows with the reader’s text', async () => {
    const view = await render(<Button testID="it">{words.long}</Button>)
    expect(styleOf('it')).toMatchObject({ minHeight: 44, minWidth: 44 })
    await view.unmount()
    await render(<Button testID="it">{words.long}</Button>, { scale: 2 })
    expect(styleOf('it')).toMatchObject({ minHeight: 88, minWidth: 88 })
    // Nothing holds the words to one line: the label wraps and the control grows.
    expect(screen.getByText(words.long).props.numberOfLines).toBeUndefined()
    expectAccessible()
  })

  it('stays where it is while busy: named, focusable, said to be busy, and deaf to a press', async () => {
    const onPress = jest.fn()
    const onLongPress = jest.fn()
    await render(
      <Button loading onPress={onPress} onLongPress={onLongPress} icon={<BaseIcon name="plus" />}>
        {words.save}
      </Button>,
    )
    const button = screen.getByRole('button', { name: words.save })
    expect(button).toBeBusy()
    // Busy is not disabled: a screen reader's focus stays on it, and it is not dimmed away.
    expect(button).toBeEnabled()
    expect(button.props.accessible).toBe(true)
    await userEvent.press(button)
    await userEvent.longPress(button)
    expect(onPress).not.toHaveBeenCalled()
    expect(onLongPress).not.toHaveBeenCalled()
    expectAccessible()
  })

  it('takes no press while another control’s write is on its way, and says so', async () => {
    const onPress = jest.fn()
    await render(
      <Button idle onPress={onPress}>
        {words.remove}
      </Button>,
    )
    const button = screen.getByRole('button', { name: words.remove })
    expect(button).not.toBeBusy()
    expect(button).toBeDisabled()
    await userEvent.press(button)
    expect(onPress).not.toHaveBeenCalled()
    // The rules take it for a disabled control until the test says which one it is.
    expect(violations(button).map(({ rule }) => rule)).toEqual(['never-disabled'])
    expectAccessible(button, { outOfForm: [words.remove] })
  })

  it('draws its glyph as decoration: the words alone are its name', async () => {
    await render(<Button icon={<BaseIcon name="plus" />}>{words.open}</Button>)
    expect(screen.getByRole('button').props.accessibilityLabel).toBeUndefined()
    expect(screen.getByRole('button', { name: words.open })).toBeOnTheScreen()
    expectAccessible()
  })
})

describe('IconButton', () => {
  it('is named from the register of icon-only controls, and by nothing it draws', async () => {
    const onPress = jest.fn()
    await render(<IconButton label={close} icon={<BaseIcon name="x" />} onPress={onPress} />)
    await userEvent.press(screen.getByRole('button', { name: close }))
    expect(onPress).toHaveBeenCalledTimes(1)
    expectAccessible()
  })

  it('fails the rules under a name the register has not', async () => {
    await render(<IconButton label={words.open} icon={<BaseIcon name="x" />} />)
    expect(violations(screen.getByRole('button')).map(({ rule }) => rule)).toEqual([
      'registered-name',
    ])
  })

  it('is as large as any other target, and busy as any other', async () => {
    await render(<IconButton testID="it" loading label={close} icon={<BaseIcon name="x" />} />, {
      scale: 2,
    })
    expect(styleOf('it')).toMatchObject({ minHeight: 88, minWidth: 88 })
    expect(screen.getByRole('button', { name: close })).toBeBusy()
    expectAccessible()
  })
})
