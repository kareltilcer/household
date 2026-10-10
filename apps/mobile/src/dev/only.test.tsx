// A dev screen narrowed to one part of itself: what the controls do, on a screen of the
// test's own and on the two long pages that have no test of the kind beside them. The
// end-to-end flow presses these controls to reach a part without scrolling past the rest.
import { describe, expect, it, jest } from '@jest/globals'
import { screen, userEvent } from '@testing-library/react-native'
import { expectAccessible } from '../test/a11y.ts'
import { words } from '../test/fixtures.ts'
import { render } from '../test/render.tsx'
import { Text } from '../ui/Text.tsx'
import { DevScreen } from './DevScreen.tsx'
import { Shown } from './Only.tsx'
import Primitives from './Primitives.tsx'
import DevShell from './shell/index.tsx'

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), navigate: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useIsFocused: () => true,
}))

/** Whether something with this `testID` is drawn. */
const drawn = (id: string) => screen.queryAllByTestId(id).length > 0

describe('a dev screen that names its parts', () => {
  const parts = ['one', 'two']
  const page = (
    <DevScreen page="engine" title={words.title} parts={parts}>
      <Shown part="one">
        <Text testID="part:one">{words.title}</Text>
      </Shown>
      <Shown part="two">
        <Text testID="part:two">{words.sentence}</Text>
      </Shown>
    </DevScreen>
  )

  it('draws every part until one is chosen, and says which is', async () => {
    await render(page)
    expect([drawn('part:one'), drawn('part:two')]).toEqual([true, true])
    expect(screen.getByTestId('engine:only:all')).toBeSelected()
    expect(screen.getByTestId('engine:only:two')).not.toBeSelected()
    expectAccessible()
  })

  it('draws the one part chosen and no other, and every part again when asked', async () => {
    await render(page)
    await userEvent.press(screen.getByTestId('engine:only:two'))
    expect([drawn('part:one'), drawn('part:two')]).toEqual([false, true])
    expect(screen.getByTestId('engine:only:two')).toBeSelected()
    expect(screen.getByTestId('engine:only:all')).not.toBeSelected()

    await userEvent.press(screen.getByTestId('engine:only:all'))
    expect([drawn('part:one'), drawn('part:two')]).toEqual([true, true])
  })

  it('draws a part that stands in no such screen: a section drawn alone', async () => {
    await render(
      <Shown part="one">
        <Text testID="part:one">{words.title}</Text>
      </Shown>,
    )
    expect(drawn('part:one')).toBe(true)
  })

  it('has no controls where it names no part', async () => {
    await render(<DevScreen page="engine" title={words.title} />)
    expect(drawn('engine:only:all')).toBe(false)
  })
})

describe('the page of primitives, narrowed', () => {
  it('draws the overlays alone: the sheet’s opener with no field above it', async () => {
    await render(<Primitives />)
    expect(drawn('controls:light:field')).toBe(true)
    await userEvent.press(screen.getByTestId('primitives:only:overlays'))
    expect(drawn('controls:light:sheet:open')).toBe(true)
    expect(drawn('controls:light:menu:open')).toBe(true)
    expect(drawn('controls:light:field')).toBe(false)
    expect(drawn('status-section:hold:light')).toBe(false)
    expectAccessible()
  })

  it('draws the hold alone, in both themes', async () => {
    await render(<Primitives />)
    await userEvent.press(screen.getByTestId('primitives:only:hold'))
    expect(drawn('status-section:hold:light')).toBe(true)
    expect(drawn('status-section:hold:dark')).toBe(true)
    expect(screen.getAllByTestId('hold:idle')).toHaveLength(6)
    expect(drawn('status-section:statuses:light')).toBe(false)
    expect(drawn('controls:light:sheet:open')).toBe(false)
  })

  it('has a control for each part a section names, and each draws something', async () => {
    await render(<Primitives />)
    const controls = screen
      .getAllByRole('button')
      .map((button) => String(button.props.testID))
      .filter((id) => id.startsWith('primitives:only:') && id !== 'primitives:only:all')
    expect(controls).toEqual([
      'primitives:only:type',
      'primitives:only:button',
      'primitives:only:controls',
      'primitives:only:overlays',
      'primitives:only:statuses',
      'primitives:only:marks',
      'primitives:only:banners',
      'primitives:only:loading',
      'primitives:only:hold',
      'primitives:only:parts',
      'primitives:only:metric',
    ])
    // Narrowed to a part of the status section, that part's own ground is there.
    for (const part of ['statuses', 'marks', 'banners', 'loading', 'hold', 'parts', 'metric']) {
      await userEvent.press(screen.getByTestId(`primitives:only:${part}`))
      expect([part, drawn(`status-section:${part}:light`)]).toEqual([part, true])
    }
  })
})

describe('the shell’s dev screen, narrowed', () => {
  it('draws one part of itself: the bars, the lists to arrange, the panes, the neutral screen', async () => {
    await render(<DevShell />)
    await userEvent.press(screen.getByTestId('shell:only:bars'))
    expect(drawn('shell:bar:five:light:phone:1')).toBe(true)
    expect(drawn('shell:arrange')).toBe(false)

    await userEvent.press(screen.getByTestId('shell:only:arrange'))
    expect(drawn('shell:arrange')).toBe(true)
    expect(drawn('shell:bar:five:light:phone:1')).toBe(false)

    await userEvent.press(screen.getByTestId('shell:only:panes'))
    expect(drawn('shell:panes:phone:one')).toBe(true)
    expect(drawn('shell:arrange')).toBe(false)

    await userEvent.press(screen.getByTestId('shell:only:not-available'))
    expect(drawn('not-available:home')).toBe(true)
    expect(drawn('shell:panes:phone:one')).toBe(false)
    expectAccessible()
  })
})
