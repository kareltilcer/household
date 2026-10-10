// The accessibility rules themselves: each with something that breaks it, and the same thing
// mended. A rule that never fails holds nothing.
import { describe, expect, it } from '@jest/globals'
import { controls } from '@household/icons'
import { catalogs } from '@household/i18n'
import { screen } from '@testing-library/react-native'
import { Image, Pressable, Text as NativeText, TextInput, View } from 'react-native'
import { BaseIcon, StatusIcon } from '../ui/Icon.tsx'
import { Text } from '../ui/Text.tsx'
import { expectAccessible, statusTestID, violations } from './a11y.ts'
import { words } from './fixtures.ts'
import { render } from './render.tsx'

const target = { minHeight: 44, minWidth: 44 }
const noop = () => undefined

/** The rules `testID` breaks, by name. */
function broken(testID: string, options?: Parameters<typeof violations>[1]): string[] {
  return violations(screen.getByTestId(testID), options).map(({ rule }) => rule)
}

describe('the accessibility rules', () => {
  it('pass what breaks none, and name the element and its rule where one is broken', async () => {
    await render(
      <View>
        <Pressable testID="good" accessibilityRole="button" style={target} onPress={noop}>
          <Text>{words.save}</Text>
        </Pressable>
        <Pressable testID="bad" style={target} onPress={noop}>
          <Text>{words.open}</Text>
        </Pressable>
      </View>,
    )
    expectAccessible(screen.getByTestId('good'))
    expect(() => {
      expectAccessible()
    }).toThrow(/\[named\] <View testID="bad" name="Open"> takes a press and has no role/)
  })

  it('want a role and a name of whatever takes a press', async () => {
    await render(
      <View>
        <Pressable testID="nameless" accessibilityRole="button" style={target} onPress={noop} />
        <Pressable testID="roleless" style={target} onPress={noop}>
          <Text>{words.save}</Text>
        </Pressable>
        <Pressable
          testID="labelled"
          accessibilityRole="button"
          accessibilityLabel={catalogs.en[controls.back.labelKey]}
          style={target}
          onPress={noop}
        />
      </View>,
    )
    expect(broken('nameless')).toEqual(['named'])
    expect(broken('roleless')).toEqual(['named'])
    expect(broken('labelled')).toEqual([])
  })

  it('want an icon-only control named from the register, in the language drawn', async () => {
    await render(
      <View>
        <Pressable
          testID="invented"
          accessibilityRole="button"
          accessibilityLabel={words.open}
          style={target}
          onPress={noop}
        >
          <BaseIcon name="x" />
        </Pressable>
        <Pressable
          testID="registered"
          accessibilityRole="button"
          accessibilityLabel={catalogs.de[controls.close_sheet.labelKey]}
          style={target}
          onPress={noop}
        >
          <BaseIcon name="x" />
        </Pressable>
        <Pressable
          testID="with-argument"
          accessibilityRole="button"
          accessibilityLabel={catalogs.cs[controls.edit.labelKey].replace('{name}', words.title)}
          style={target}
          onPress={noop}
        />
      </View>,
    )
    expect(broken('invented')).toEqual(['registered-name'])
    expect(broken('registered')).toEqual([])
    expect(broken('with-argument')).toEqual([])
  })

  it('want 44 by 44 of every target, at the scale drawn', async () => {
    const view = await render(
      <View>
        <Pressable
          testID="small"
          accessibilityRole="button"
          style={{ minHeight: 32 }}
          onPress={noop}
        >
          <Text>{words.save}</Text>
        </Pressable>
        <Pressable
          testID="slop"
          accessibilityRole="button"
          style={{ height: 28, width: 28 }}
          hitSlop={8}
          onPress={noop}
        >
          <Text>{words.save}</Text>
        </Pressable>
        <Pressable
          testID="row"
          accessibilityRole="button"
          style={{ minHeight: 44, alignSelf: 'stretch' }}
          onPress={noop}
        >
          <Text>{words.save}</Text>
        </Pressable>
      </View>,
    )
    expect(broken('small')).toEqual(['target-size', 'target-size'])
    expect(broken('slop')).toEqual([])
    expect(broken('row')).toEqual([])
    // What is large enough at the scale's own size is not at twice it.
    expect(broken('row', { scale: 2 })).toEqual(['target-size'])
    await view.unmount()
  })

  it('want nothing disabled, but a control the test says is out of its form', async () => {
    await render(
      <View>
        <Pressable testID="off" accessibilityRole="button" disabled style={target} onPress={noop}>
          <Text>{words.save}</Text>
        </Pressable>
        <Pressable
          testID="said-off"
          accessibilityRole="button"
          accessibilityState={{ disabled: true }}
          style={target}
          onPress={noop}
        >
          <Text>{words.open}</Text>
        </Pressable>
      </View>,
    )
    expect(broken('off')).toEqual(['never-disabled'])
    expect(broken('said-off')).toEqual(['never-disabled'])
    expect(broken('off', { outOfForm: ['off'] })).toEqual([])
    expect(broken('said-off', { outOfForm: [words.open] })).toEqual([])
  })

  it('want a picture named, or hidden from a screen reader', async () => {
    await render(
      <View>
        <View testID="bare">
          <Image source={{ uri: 'file:///picture.png' }} />
        </View>
        <View testID="named">
          <Image source={{ uri: 'file:///picture.png' }} accessibilityLabel={words.title} />
        </View>
        <View testID="glyph">
          <BaseIcon name="x" />
        </View>
        <View testID="named-glyph">
          <BaseIcon name="x" label={words.title} />
        </View>
      </View>,
    )
    expect(broken('bare')).toEqual(['picture'])
    expect(broken('named')).toEqual([])
    // A glyph with no label is decoration, and hides itself.
    expect(broken('glyph')).toEqual([])
    expect(broken('named-glyph')).toEqual([])
  })

  it('want a status said three ways: its colour, its glyph and its word', async () => {
    await render(
      <View>
        <View testID={statusTestID('pending')}>
          <StatusIcon status="pending" />
          <Text color="status-pending">{catalogs.en['a11y.status.pending']}</Text>
        </View>
        <View testID={statusTestID('conflict')}>
          <Text color="status-conflict">{catalogs.en['a11y.status.conflict']}</Text>
        </View>
        <View testID={statusTestID('rejected')}>
          <StatusIcon status="rejected" />
        </View>
      </View>,
    )
    expect(broken(statusTestID('pending'))).toEqual([])
    expect(broken(statusTestID('conflict'))).toEqual(['status'])
    expect(broken(statusTestID('rejected'))).toEqual(['status'])
  })

  it('want a hold-to-complete completed with no hold: the action, the tap and the click', async () => {
    const activate = [{ name: 'activate', label: words.remove }]
    await render(
      <View>
        <Pressable
          testID="hold:whole"
          accessibilityRole="button"
          accessibilityLabel={words.remove}
          accessibilityActions={activate}
          onAccessibilityAction={noop}
          onAccessibilityTap={noop}
          style={target}
          onPress={noop}
        />
        <Pressable
          testID="hold:gesture"
          accessibilityRole="button"
          accessibilityLabel={words.remove}
          style={target}
          onPress={noop}
        />
        <Pressable
          testID="hold:bare"
          accessibilityRole="button"
          accessibilityLabel={words.remove}
          accessibilityActions={[{ name: 'activate' }]}
          onAccessibilityAction={noop}
          onAccessibilityTap={noop}
          style={target}
          onPress={noop}
        />
        <View
          testID="hold:deaf"
          accessible
          accessibilityLabel={words.remove}
          accessibilityActions={activate}
          onAccessibilityAction={noop}
          onAccessibilityTap={noop}
        />
        <Pressable
          testID="plain"
          accessibilityRole="button"
          accessibilityLabel={words.remove}
          style={target}
          onPress={noop}
        />
      </View>,
    )
    // Named for what it completes by whoever draws it, which no register has: and held to
    // the rest.
    expect(broken('hold:whole')).toEqual([])
    expect(broken('hold:gesture')).toEqual(['hold', 'hold', 'hold'])
    expect(broken('hold:bare')).toEqual(['hold'])
    expect(broken('hold:deaf')).toEqual(['hold'])
    // Any other control with no word of its own is still the register's to name.
    expect(broken('plain')).toEqual(['registered-name'])
    expect(() => {
      expectAccessible(screen.getByTestId('hold:bare'))
    }).toThrow(/\[hold\] .* is a hold-to-complete, and has an `activate` action with no label/)
  })

  it('want no text cut off at a number of lines', async () => {
    await render(
      <View>
        <View testID="cut">
          <Text numberOfLines={1}>{words.long}</Text>
        </View>
        <View testID="whole">
          <Text>{words.long}</Text>
        </View>
      </View>,
    )
    expect(broken('cut')).toEqual(['truncated'])
    expect(broken('whole')).toEqual([])
  })

  it('want every text drawn by the app’s own `Text`', async () => {
    await render(
      <View>
        <View testID="native">
          <NativeText>{words.sentence}</NativeText>
        </View>
        <View testID="own">
          <Text>{words.sentence}</Text>
        </View>
      </View>,
    )
    expect(broken('native')).toEqual(['own-text'])
    expect(broken('own')).toEqual([])
  })

  it('want a field that is typed in named, by a label or by a text that is drawn, in the app’s own type', async () => {
    await render(
      <View>
        <View testID="bare">
          <TextInput placeholder={words.title} />
        </View>
        <View testID="named">
          <TextInput accessibilityLabel={words.title} allowFontScaling={false} />
        </View>
        <View testID="tied">
          <Text nativeID="its-label">{words.title}</Text>
          <TextInput accessibilityLabelledBy="its-label" allowFontScaling={false} />
        </View>
        <View testID="tied-to-nothing">
          <TextInput accessibilityLabelledBy="no-such-label" allowFontScaling={false} />
        </View>
      </View>,
    )
    // A placeholder is no label, and the platform's own field is scaled by the system.
    expect(broken('bare')).toEqual(['field', 'field'])
    expect(broken('named')).toEqual([])
    expect(broken('tied')).toEqual([])
    expect(broken('tied-to-nothing')).toEqual(['field'])
  })
})
