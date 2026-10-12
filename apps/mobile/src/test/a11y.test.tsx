// The accessibility rules themselves: each with something that breaks it, and the same thing
// mended. A rule that never fails holds nothing.
import { afterEach, describe, expect, it, jest } from '@jest/globals'
import { controls } from '@household/icons'
import { catalogs } from '@household/i18n'
import { screen } from '@testing-library/react-native'
import { Image, Platform, Pressable, Text as NativeText, TextInput, View } from 'react-native'
import { Svg } from 'react-native-svg'
import { BaseIcon, StatusIcon } from '../ui/Icon.tsx'
import { Text } from '../ui/Text.tsx'
import { drawingsOf, expectAccessible, statusTestID, violations } from './a11y.ts'
import { words } from './fixtures.ts'
import { render } from './render.tsx'

const target = { minHeight: 44, minWidth: 44 }
const noop = () => undefined

/** The platforms a test runs as: Jest's own, and the one a test names where the two differ. */
const platforms = ['ios', 'android'] as const

afterEach(() => {
  jest.restoreAllMocks()
})

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

  // A drawing is another host element on each platform, and a rule that knew one of them would
  // pass every drawing of the other unread.
  it.each(platforms)(
    'want a picture named, or hidden from a screen reader, as %s draws one',
    async (os) => {
      jest.replaceProperty(Platform, 'OS', os)
      await render(
        <View>
          <View testID="bare">
            <Image source={{ uri: 'file:///picture.png' }} />
          </View>
          <View testID="named">
            <Image source={{ uri: 'file:///picture.png' }} accessibilityLabel={words.title} />
          </View>
          <View testID="bare-drawing">
            <Svg />
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
      expect(broken('bare-drawing')).toEqual(['picture'])
      // A glyph with no label is decoration, and hides itself.
      expect(broken('glyph')).toEqual([])
      expect(broken('named-glyph')).toEqual([])
      expect(drawingsOf(screen.getByTestId('named-glyph'))).toHaveLength(1)
    },
  )

  it.each(platforms)(
    'want a status said three ways: its colour, its glyph and its word, as %s draws one',
    async (os) => {
      jest.replaceProperty(Platform, 'OS', os)
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
    },
  )

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

  it('want every control within a screen reader’s reach: in no `accessible` view, and in no other control', async () => {
    await render(
      <View>
        <View testID="swallowed" accessible>
          <Text>{words.title}</Text>
          <Pressable accessibilityRole="button" style={target} onPress={noop}>
            <Text>{words.open}</Text>
          </Pressable>
        </View>
        <Pressable testID="nested" accessibilityRole="button" style={target} onPress={noop}>
          <Text>{words.title}</Text>
          <Pressable accessibilityRole="button" style={target} onPress={noop}>
            <Text>{words.open}</Text>
          </Pressable>
        </Pressable>
        <View testID="typed" accessible>
          <TextInput accessibilityLabel={words.title} allowFontScaling={false} />
        </View>
        <View testID="beside">
          <View accessible>
            <Text>{words.title}</Text>
          </View>
          <Pressable accessibilityRole="button" style={target} onPress={noop}>
            <Text>{words.open}</Text>
          </Pressable>
        </View>
        <View testID="hidden" accessible>
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={target}
          >
            <Pressable style={target} onPress={noop} />
          </View>
        </View>
      </View>,
    )
    expect(broken('swallowed')).toEqual(['reach'])
    expect(broken('nested')).toEqual(['reach'])
    expect(broken('typed')).toEqual(['reach'])
    // The words are one thing and the control beside them is another.
    expect(broken('beside')).toEqual([])
    // What is hidden from a screen reader on purpose is no control to it.
    expect(broken('hidden')).toEqual([])
    expect(() => {
      expectAccessible(screen.getByTestId('swallowed'))
    }).toThrow(/\[reach\] <View role="button" name="Open"> is inside <View testID="swallowed"/)
  })

  // The row as it stood until CI's tenth run (38131404522) showed it breaking no line on a
  // device: its words' room said by a `flexBasis`, which is computed once and kept.
  it('want an element’s room said by a `width`, and never by a `flexBasis`', async () => {
    const row = { flexDirection: 'row', flexWrap: 'wrap' } as const
    await render(
      <View>
        <View testID="as-it-stood" style={row}>
          <View style={{ flexGrow: 1, flexShrink: 1, flexBasis: 160 }}>
            <Text>{words.long}</Text>
          </View>
          <View style={{ flexShrink: 1 }}>
            <Text>{words.open}</Text>
          </View>
        </View>
        <View testID="by-width" style={row}>
          <View style={{ flexGrow: 1, flexShrink: 1, width: 160 }}>
            <Text>{words.long}</Text>
          </View>
          <View style={{ flexShrink: 1 }}>
            <Text>{words.open}</Text>
          </View>
        </View>
        <View testID="a-share" style={row}>
          <View style={{ flexBasis: '100%', flexGrow: 1 }}>
            <Text>{words.long}</Text>
          </View>
        </View>
        <View testID="the-rest" style={{ flexDirection: 'row' }}>
          <Text style={{ flex: 1 }}>{words.long}</Text>
          <View style={{ flexBasis: 'auto' }}>
            <Text>{words.open}</Text>
          </View>
          <View style={{ flexBasis: 0, flexGrow: 1 }}>
            <Text>{words.open}</Text>
          </View>
        </View>
      </View>,
    )
    expect(broken('as-it-stood')).toEqual(['room'])
    expect(broken('by-width')).toEqual([])
    // A share of the row is resolved once too, against the width the row then had.
    expect(broken('a-share')).toEqual(['room'])
    // `flex: n` and a basis of nothing are computed once too, and are passed: nothing is what
    // they give at any text size, to an element that had them from its first layout, and that
    // one was given them later is no part of a drawn tree (a11y.ts). `auto` asks for no room.
    expect(broken('the-rest')).toEqual([])
    expect(() => {
      expectAccessible(screen.getByTestId('as-it-stood'))
    }).toThrow(/\[room\] <View name=".*"> says its room by a `flexBasis`/)
  })

  it('want a row that wraps to break by the room its words ask for', async () => {
    const room = { flexGrow: 1, flexShrink: 1, width: 160 }
    const row = { flexDirection: 'row', flexWrap: 'wrap' } as const
    await render(
      <View>
        <View testID="squeezed" style={row}>
          <View style={room}>
            <Text>{words.long}</Text>
          </View>
          <Pressable accessibilityRole="button" style={target} onPress={noop}>
            <Text>{words.open}</Text>
          </Pressable>
        </View>
        <View testID="two-parts" style={row}>
          <View style={room}>
            <Text>{words.long}</Text>
          </View>
          <View style={{ flexShrink: 1 }}>
            <Pressable accessibilityRole="button" style={target} onPress={noop}>
              <Text>{words.open}</Text>
            </Pressable>
          </View>
        </View>
        <View testID="no-room-named" style={row}>
          <View style={{ flexGrow: 1, flexShrink: 1 }}>
            <Text>{words.long}</Text>
          </View>
          <Pressable accessibilityRole="button" style={target} onPress={noop}>
            <Text>{words.open}</Text>
          </Pressable>
        </View>
        <View testID="alone" style={row}>
          <View style={room}>
            <Text>{words.long}</Text>
          </View>
        </View>
        <View testID="the-rest" style={row}>
          <Text style={{ flex: 1 }}>{words.long}</Text>
          <Pressable accessibilityRole="button" style={target} onPress={noop}>
            <Text>{words.open}</Text>
          </Pressable>
        </View>
        <View testID="one-line" style={{ flexDirection: 'row' }}>
          <View style={room}>
            <Text>{words.long}</Text>
          </View>
          <Pressable accessibilityRole="button" style={target} onPress={noop}>
            <Text>{words.open}</Text>
          </Pressable>
        </View>
      </View>,
    )
    expect(broken('squeezed')).toEqual(['wrap'])
    // A second child that may shrink: the first's room is what the row breaks by.
    expect(broken('two-parts')).toEqual([])
    // With no room named it is counted as nothing wide just the same, where its words asked
    // for their own width.
    expect(broken('no-room-named')).toEqual(['wrap'])
    // With nothing beside it nothing takes its room.
    expect(broken('alone')).toEqual([])
    // A child that asks for no room of its own is given the rest, and asked for no more.
    expect(broken('the-rest')).toEqual([])
    // A row that does not wrap has no line to break.
    expect(broken('one-line')).toEqual([])
  })

  it('want a switch, a checkbox and a radio to say whether they are checked, and a tab whether it is selected', async () => {
    const roles = ['switch', 'checkbox', 'radio'] as const
    await render(
      <View>
        {roles.map((role) => (
          <View key={role}>
            <Pressable
              testID={`${role}:mute`}
              accessibilityRole={role}
              style={target}
              onPress={noop}
            >
              <Text>{words.open}</Text>
            </Pressable>
            <Pressable
              testID={`${role}:off`}
              accessibilityRole={role}
              accessibilityState={{ checked: false }}
              style={target}
              onPress={noop}
            >
              <Text>{words.open}</Text>
            </Pressable>
          </View>
        ))}
        <Pressable testID="tab:mute" accessibilityRole="tab" style={target} onPress={noop}>
          <Text>{words.title}</Text>
        </Pressable>
        <Pressable
          testID="tab:open"
          accessibilityRole="tab"
          accessibilityState={{ selected: true }}
          style={target}
          onPress={noop}
        >
          <Text>{words.title}</Text>
        </Pressable>
        <Pressable
          testID="checkbox:some"
          accessibilityRole="checkbox"
          accessibilityState={{ checked: 'mixed' }}
          style={target}
          onPress={noop}
        >
          <Text>{words.open}</Text>
        </Pressable>
      </View>,
    )
    for (const role of roles) {
      expect(broken(`${role}:mute`)).toEqual(['state'])
      // Off is a state, and is said.
      expect(broken(`${role}:off`)).toEqual([])
    }
    expect(broken('tab:mute')).toEqual(['state'])
    expect(broken('tab:open')).toEqual([])
    expect(broken('checkbox:some')).toEqual([])
    expect(() => {
      expectAccessible(screen.getByTestId('tab:mute'))
    }).toThrow(/\[state\] .* is a tab, and does not say whether it is selected/)
  })
})
