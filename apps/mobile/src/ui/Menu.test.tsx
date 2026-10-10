// The menu's contract (02-components §1; the web's `overlays.test.tsx`, "a menu", is its
// twin): what opens it, what it lists, and when the chosen item acts.
import { afterEach, describe, expect, it, jest } from '@jest/globals'
import { controls } from '@household/icons'
import { catalogs, createTranslator } from '@household/i18n'
import { nativeThemes } from '@household/tokens/native'
import { act, screen, userEvent } from '@testing-library/react-native'
import { Platform, StyleSheet, type StyleProp, type TextStyle } from 'react-native'
import type { TestInstance } from 'test-renderer'
import { expectAccessible } from '../test/a11y.ts'
import { render } from '../test/render.tsx'
import * as announcer from './announce.ts'
import { Button, IconButton } from './Button.tsx'
import { sample } from './controls.fixtures.ts'
import { BaseIcon } from './Icon.tsx'
import { Menu, type MenuItem } from './Menu.tsx'

const more = createTranslator('en')(controls.more_actions.labelKey, { name: sample.value })
const close = catalogs.en[controls.close_sheet.labelKey]

function items(act: (id: string) => void = () => undefined): MenuItem[] {
  return [
    {
      id: 'rename',
      label: sample.rename,
      icon: <BaseIcon name="pencil" />,
      onSelect: () => {
        act('rename')
      },
    },
    {
      id: 'archive',
      label: sample.archive,
      danger: true,
      onSelect: () => {
        act('archive')
      },
    },
  ]
}

function Actions({
  act: chosen,
  loading = false,
}: {
  act?: (id: string) => void
  loading?: boolean
}) {
  return (
    <Menu
      trigger={
        <IconButton
          label={more}
          icon={<BaseIcon name={controls.more_actions.glyph.id} />}
          loading={loading}
        />
      }
      items={items(chosen)}
    />
  )
}

const trigger = () => screen.getByRole('button', { name: more })

afterEach(() => {
  jest.restoreAllMocks()
})

describe('a menu', () => {
  it('opens from its trigger, which says whether it is open, as a sheet named as the trigger is', async () => {
    await render(<Actions />)
    expect(trigger()).toBeCollapsed()
    expect(screen.queryByRole('button', { name: sample.rename })).toBeNull()
    await userEvent.press(trigger())
    expect(trigger()).toBeExpanded()
    expect(screen.getByRole('header', { name: more })).toBeOnTheScreen()
    expect(screen.getByRole('button', { name: sample.rename })).toBeOnTheScreen()
    expect(screen.getByRole('button', { name: sample.archive })).toBeOnTheScreen()
    expectAccessible()
  })

  it('does what the chosen item does, once, when its sheet has gone and the focus is back on the trigger', async () => {
    // Everywhere but on iOS the sheet is gone as soon as it is closed.
    jest.replaceProperty(Platform, 'OS', 'android')
    const order: string[] = []
    const focus = jest.spyOn(announcer, 'focusOn').mockImplementation(() => {
      order.push('focus')
      return true
    })
    await render(
      <Actions
        act={(id) => {
          order.push(id)
        }}
      />,
    )
    await userEvent.press(trigger())
    await userEvent.press(screen.getByRole('button', { name: sample.archive }))
    expect(screen.queryByRole('button', { name: sample.archive })).toBeNull()
    // The focus first: what the item opens takes the trigger for what opened it.
    expect(order).toEqual(['focus', 'archive'])
    // The trigger itself, by the ref the menu gave it.
    expect({ ...focus.mock.lastCall?.[0].current?.props }).toMatchObject({
      accessibilityLabel: more,
    })
    expect(trigger()).toBeCollapsed()
  })

  it('waits on iOS until the platform says the sheet has gone: a modal the item opens is refused before', async () => {
    jest.spyOn(announcer, 'focusOn').mockReturnValue(true)
    const chosen = jest.fn()
    await render(<Actions act={chosen} />)
    await userEvent.press(trigger())
    // The sheet's own modal, around its title.
    let sheet: TestInstance | null = screen.getByRole('header', { name: more })
    while (sheet !== null && sheet.type !== 'Modal') sheet = sheet.parent
    const { onDismiss } = { ...sheet?.props } as { onDismiss: () => void }
    await userEvent.press(screen.getByRole('button', { name: sample.rename }))
    expect(chosen).not.toHaveBeenCalled()
    await act(() => {
      onDismiss()
    })
    expect(chosen.mock.calls).toEqual([['rename']])
    // Said again by the platform, nothing is done twice.
    await act(() => {
      onDismiss()
    })
    expect(chosen).toHaveBeenCalledTimes(1)
  })

  it('does nothing when it is closed with nothing chosen', async () => {
    jest.replaceProperty(Platform, 'OS', 'android')
    jest.spyOn(announcer, 'focusOn').mockReturnValue(true)
    const chosen = jest.fn()
    await render(<Actions act={chosen} />)
    await userEvent.press(trigger())
    await userEvent.press(screen.getByRole('button', { name: close }))
    expect(screen.queryByRole('button', { name: sample.rename })).toBeNull()
    expect(chosen).not.toHaveBeenCalled()
  })

  it('opens from a trigger that is words, too, and is named by them', async () => {
    await render(<Menu trigger={<Button>{sample.edit}</Button>} items={items()} />)
    await userEvent.press(screen.getByRole('button', { name: sample.edit }))
    expect(screen.getByRole('header', { name: sample.edit })).toBeOnTheScreen()
  })

  it('opens nothing from a trigger that is busy', async () => {
    await render(<Actions loading />)
    await userEvent.press(trigger())
    expect(trigger()).toBeBusy()
    expect(screen.queryByRole('button', { name: sample.rename })).toBeNull()
  })

  it('is not drawn where it has no item: a control that cannot act is absent', async () => {
    await render(
      <Menu
        trigger={<IconButton label={more} icon={<BaseIcon name="more-horizontal" />} />}
        items={[]}
      />,
    )
    expect(screen.queryByRole('button')).toBeNull()
  })

  it.each([1, 2])(
    'draws an item that destroys in the danger token, under words that name what, at a text scale of %i',
    async (scale) => {
      await render(<Actions />, { scale })
      await userEvent.press(trigger())
      const words = screen.getByText(sample.archive)
      expect(StyleSheet.flatten(words.props.style as StyleProp<TextStyle>).color).toBe(
        nativeThemes.light.color.danger,
      )
      expectAccessible()
    },
  )
})
