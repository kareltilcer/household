// The controls' section of the primitives dev screen: every control in every state, and every
// overlay opened, held to the accessibility rules in both themes at a text scale of one and of
// two. Its words are fixtures, so a test finds what it presses by `testID`, as the end-to-end
// flow does.
import { afterEach, describe, expect, it, jest } from '@jest/globals'
import { createTranslator, pseudolocalize } from '@household/i18n'
import { screen, userEvent } from '@testing-library/react-native'
import { Platform } from 'react-native'
import { elementsOf, expectAccessible } from '../../../test/a11y.ts'
import { render } from '../../../test/render.tsx'
import * as announcer from '../../../ui/announce.ts'
import { outOfForm, words } from './fixtures.ts'
import { ControlsSection } from './index.tsx'

const t = createTranslator('en')
/** The stepper that stands at its least: its first button stays, and says it has nothing to do. */
const atBound = t('ui.stepper.decrease', { name: words.atLeast })
const themes = ['light', 'dark'] as const

const press = (testID: string) => userEvent.press(screen.getByTestId(testID))

afterEach(() => {
  jest.restoreAllMocks()
})

describe('the controls’ section', () => {
  it.each([1, 2])(
    'draws every control in both themes, accessibly, at a text scale of %i',
    async (scale) => {
      await render(<ControlsSection />, { scale })
      // Each control twice: once in each theme.
      expect(screen.getAllByLabelText(words.readingKept)).toHaveLength(2)
      expect(screen.getAllByRole('switch', { name: words.share })).toHaveLength(2)
      expect(screen.getAllByRole('link', { name: words.openNamed })).toHaveLength(2)
      // Nothing that takes nothing is drawn until it is asked for: the page is accessible whole.
      expectAccessible()
    },
  )

  it.each([1, 2])(
    'draws the controls that take nothing where its switch asks, each named as one out of its form, at a text scale of %i',
    async (scale) => {
      await render(<ControlsSection />, { scale })
      await press('controls:out-of-form')
      for (const name of outOfForm) {
        // A field's label is drawn and read as the field's name; a choice's is its words.
        expect(screen.getAllByText(name, { includeHiddenElements: true })).toHaveLength(2)
      }
      expect(screen.getAllByRole('button', { name: atBound })).toHaveLength(2)
      expectAccessible(screen.root, { outOfForm: [...outOfForm, atBound] })
    },
  )

  it.each(themes)(
    'opens a confirmation in the %s theme, which its choices close',
    async (theme) => {
      await render(<ControlsSection />, { scale: 2 })
      await press(`controls:${theme}:dialog:open`)
      expect(screen.getByRole('header', { name: words.deleteTitle })).toBeOnTheScreen()
      expectAccessible(screen.getByTestId(`controls:${theme}:dialog`))
      await press(`controls:${theme}:dialog:keep`)
      expect(screen.queryByTestId(`controls:${theme}:dialog:surface`)).toBeNull()
    },
  )

  it.each(themes)(
    'opens an editor in the %s theme, says a save in a toast inside it, and its close control closes it',
    async (theme) => {
      await render(<ControlsSection />, { scale: 2 })
      await press(`controls:${theme}:sheet:open`)
      const sheet = screen.getByTestId(`controls:${theme}:sheet`)
      await press(`controls:${theme}:sheet:save`)
      expect(elementsOf(sheet).filter((each) => each.props.testID === 'toast')).toHaveLength(1)
      expectAccessible(sheet)
      await press(`controls:${theme}:sheet:close`)
      expect(screen.queryByTestId(`controls:${theme}:sheet:surface`)).toBeNull()
      // The toast outlives the sheet it was raised in, on the screen.
      expect(screen.getByTestId('toast')).toBeOnTheScreen()
    },
  )

  it.each(themes)(
    'opens a menu in the %s theme, whose item that destroys asks first, once the menu has gone',
    async (theme) => {
      jest.replaceProperty(Platform, 'OS', 'android')
      jest.spyOn(announcer, 'focusOn').mockReturnValue(true)
      await render(<ControlsSection />)
      await press(`controls:${theme}:menu:open`)
      expect(screen.getByRole('button', { name: words.rename })).toBeOnTheScreen()
      expectAccessible()
      await userEvent.press(screen.getByRole('button', { name: words.remove }))
      expect(screen.queryByRole('button', { name: words.rename })).toBeNull()
      expect(screen.getByTestId(`controls:${theme}:dialog:surface`)).toBeOnTheScreen()
    },
  )

  it.each(themes)('raises a toast with an Undo and one without in the %s theme', async (theme) => {
    await render(<ControlsSection />, { scale: 2 })
    await press(`controls:${theme}:toast:undo`)
    await press(`controls:${theme}:toast:plain`)
    expect(screen.getAllByTestId('toast')).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: t('ui.toast.undo') })).toHaveLength(1)
    expectAccessible()
  })

  it('accents its fixtures under the pseudo-locale, a control’s own words with them', async () => {
    await render(<ControlsSection />, { locale: 'en-XA' })
    expect(screen.getByRole('header', { name: pseudolocalize(words.controls) })).toBeOnTheScreen()
    expect(screen.getAllByLabelText(pseudolocalize(words.readingKept))).toHaveLength(2)
    expect(screen.queryByText(words.readingHelp)).toBeNull()
    expect(
      screen.getAllByRole('switch', { name: createTranslator('en-XA')('ui.password.show') }),
    ).toHaveLength(2)
  })
})
