// The focus ring every control draws (focus.ts): nothing until a keyboard's focus, or a
// switch's, is on the control, then one outline in the focus token, and nothing again once it
// has left. A field's and the hold's own tests hold theirs; this holds the ring itself, and
// that a control which is given the focus draws it.
import { describe, expect, it } from '@jest/globals'
import { nativeThemes, type Theme } from '@household/tokens/native'
import { fireEvent, screen } from '@testing-library/react-native'
import { Pressable } from 'react-native'
import { words } from '../test/fixtures.ts'
import { render, styleOf } from '../test/render.tsx'
import { Button } from './Button.tsx'
import { useFocusRing } from './focus.ts'
import { Text } from './Text.tsx'

function Ringed({ place }: { readonly place?: 'outside' | 'inside' }) {
  const focus = useFocusRing(place)
  return (
    <Pressable
      testID="ringed"
      accessibilityRole="button"
      onFocus={focus.onFocus}
      onBlur={focus.onBlur}
      style={{ minHeight: 44, minWidth: 44, ...focus.ring }}
    >
      <Text>{words.open}</Text>
    </Pressable>
  )
}

describe('the focus ring', () => {
  it.each(['light', 'dark'] as const)(
    'is drawn while the focus is on its control, in the %s theme’s focus token, and not before or after',
    async (theme: Theme) => {
      await render(<Ringed />, { theme })
      expect(styleOf('ringed').outlineWidth).toBeUndefined()
      await fireEvent(screen.getByTestId('ringed'), 'focus')
      expect(styleOf('ringed')).toMatchObject({
        outlineWidth: 2,
        outlineStyle: 'solid',
        outlineOffset: 2,
        outlineColor: nativeThemes[theme].color.focus,
      })
      await fireEvent(screen.getByTestId('ringed'), 'blur')
      expect(styleOf('ringed').outlineWidth).toBeUndefined()
    },
  )

  // A control that fills its row has no room outside it: what stands beside it would cut the ring.
  it('is drawn inside a control that says so', async () => {
    await render(<Ringed place="inside" />)
    await fireEvent(screen.getByTestId('ringed'), 'focus')
    expect(styleOf('ringed')).toMatchObject({ outlineWidth: 2, outlineOffset: -2 })
  })

  it('is what a button draws when the focus is on it, and its owner still hears of the focus', async () => {
    const heard: string[] = []
    await render(
      <Button testID="save" onFocus={() => heard.push('focus')} onBlur={() => heard.push('blur')}>
        {words.save}
      </Button>,
    )
    await fireEvent(screen.getByTestId('save'), 'focus')
    expect(styleOf('save')).toMatchObject({
      outlineWidth: 2,
      outlineColor: nativeThemes.light.color.focus,
    })
    await fireEvent(screen.getByTestId('save'), 'blur')
    expect(styleOf('save').outlineWidth).toBeUndefined()
    expect(heard).toEqual(['focus', 'blur'])
  })
})
