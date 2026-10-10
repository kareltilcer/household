// Modal and sheet (02-components §1): focus taken, escapable, focus given back. A phone prefers
// a sheet for an editor and a modal only for a confirmation. Both are React Native's `Modal`,
// which the platform presents over everything else, keeps a screen reader inside of, and tells
// of the system's own way back; the contract is the web's (apps/web/src/ui/Dialog.tsx).
//
// The owner decides every close. The system's back, a screen reader's escape, a press on the
// ground behind it and the sheet's close control ask, by `onClose`, and nothing here closes it:
// one that keeps it open, a save under way or an editor that asks before it discards, has it
// open. No swipe closes one, so none is the only way to.
import { controls } from '@household/icons'
import { useCallback, useEffect, useRef, type ReactNode } from 'react'
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type ModalProps,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useDisplay, useTheme, useThemeName } from '../display/DisplayProvider.tsx'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { focusOn, type Focusable } from './announce.ts'
import { IconButton } from './Button.tsx'
import { BaseIcon } from './Icon.tsx'
import { Text } from './Text.tsx'
import { ToastHost } from './Toast.tsx'

export interface DialogProps {
  readonly open: boolean
  /**
   * Asked to close: the system's back, a screen reader's escape, the ground behind it, or the
   * sheet's close control. Its owner decides, and closes it by `open`.
   */
  readonly onClose: () => void
  /** Its name. A destructive confirmation's names the object it destroys (06-clients §3). */
  readonly title: string
  /** What will happen, in a plain sentence: what is lost, and what is kept. */
  readonly description?: string
  /**
   * What it holds, which scrolls where it is taller than the screen leaves it. A dialog over
   * it, a confirmation over an editor, is drawn in here: iOS presents a modal from the one it is
   * drawn in, and refuses a second from the screen beneath.
   */
  readonly children?: ReactNode
  /** The choices, the safe one first. */
  readonly actions?: ReactNode
  /**
   * What takes the accessibility focus as it opens, where that is not its title: an editor's
   * first field.
   */
  readonly initialFocus?: Focusable
  /**
   * The control it was opened from, which the accessibility focus is given back to when it has
   * gone. iOS gives it back by itself to whatever a screen reader was on as it opened; named,
   * it is given back on Android too, and wherever the opener was not what was focused.
   */
  readonly opener?: Focusable
  /**
   * Told once it has gone from the screen, after the focus was given back: what must not begin
   * while it is still leaving, as another modal must not (ui/Menu.tsx).
   */
  readonly onClosed?: () => void
  /**
   * The modal's own. What is drawn in it is found by it too: `<testID>:surface`, the ground
   * behind it as `<testID>:ground`, and a sheet's close control as `<testID>:close`.
   */
  readonly testID?: string
}

/** A phone is turned any way, and so is a tablet: iOS holds a modal upright unless it is told. */
const everyWay: NonNullable<ModalProps['supportedOrientations']> = [
  'portrait',
  'portrait-upside-down',
  'landscape',
  'landscape-left',
  'landscape-right',
]

/** Hidden from a screen reader on either platform. */
const unread = {
  accessible: false,
  accessibilityElementsHidden: true,
  importantForAccessibility: 'no-hide-descendants',
} as const

/** What `Dialog` and `Sheet` both are (ui/Sheet.tsx): this file's and that one's alone. */
export function Surface({
  open,
  onClose,
  title,
  description,
  children,
  actions,
  initialFocus,
  opener,
  onClosed,
  testID,
  sheet,
}: DialogProps & { readonly sheet: boolean }) {
  const t = useTranslate()
  const theme = useTheme()
  const dark = useThemeName() === 'dark'
  const { textScale, reducedMotion } = useDisplay()
  const insets = useSafeAreaInsets()
  const heading = useRef<View>(null)

  const gone = useCallback(() => {
    if (opener !== undefined) focusOn(opener)
    onClosed?.()
  }, [opener, onClosed])
  // iOS says when its modal has left the screen (`onDismiss`, below), which is some time after
  // it was asked to. Everywhere else it is gone as soon as it is no longer open.
  const was = useRef(open)
  useEffect(() => {
    if (was.current && !open && Platform.OS !== 'ios') gone()
    was.current = open
  }, [open, gone])

  return (
    <Modal
      testID={testID}
      visible={open}
      transparent
      // A transition is an instant change under reduced motion, never a slower one.
      animationType={reducedMotion ? 'none' : 'fade'}
      statusBarTranslucent
      navigationBarTranslucent
      supportedOrientations={everyWay}
      onRequestClose={onClose}
      onShow={() => {
        focusOn(initialFocus ?? heading)
      }}
      onDismiss={gone}
    >
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <View
          style={{ flex: 1 }}
          // What is behind is no part of what a screen reader walks while this is open.
          accessibilityViewIsModal
          onAccessibilityEscape={onClose}
        >
          <ToastHost>
            {/* The ground behind it: the screen under a veil of the theme's darkest surface,
                the inverse one in the light theme and the sunken one in the dark, as the web's
                is. No token is made for it. A press on it asks to close; a screen reader has
                the close control, the choices and its own escape, and is not shown a ground. */}
            <Pressable
              {...unread}
              testID={testID === undefined ? undefined : `${testID}:ground`}
              onPress={onClose}
              style={[
                StyleSheet.absoluteFill,
                {
                  backgroundColor: theme.color[dark ? 'surface-sunken' : 'surface-inverse'],
                  opacity: 0.45,
                },
              ]}
            />
            <View
              // Only what is drawn in it takes a press: around it, the press is the ground's.
              pointerEvents="box-none"
              style={{
                flex: 1,
                justifyContent: sheet ? 'flex-end' : 'center',
                paddingTop: insets.top + theme.space['space-4'],
                paddingLeft: sheet ? 0 : insets.left + theme.space['space-2'],
                paddingRight: sheet ? 0 : insets.right + theme.space['space-2'],
                paddingBottom: sheet ? 0 : insets.bottom + theme.space['space-2'],
              }}
            >
              <View
                testID={testID === undefined ? undefined : `${testID}:surface`}
                style={{
                  alignSelf: 'center',
                  width: '100%',
                  // 28 rem, and 30 for an editor, counted in the reader's text: on a tablet it
                  // is a sheet at the foot of the screen still, and not the screen's width.
                  maxWidth: (sheet ? 480 : 448) * textScale,
                  // As tall as what it holds, and no taller than the screen leaves it.
                  flexShrink: 1,
                  gap: theme.space['space-2'],
                  padding: theme.space['space-3'],
                  paddingBottom: theme.space['space-3'] + (sheet ? insets.bottom : 0),
                  backgroundColor: theme.color['surface-overlay'],
                  boxShadow: theme.shadows['shadow-2'],
                  borderTopLeftRadius: theme.radii['radius-sheet'],
                  borderTopRightRadius: theme.radii['radius-sheet'],
                  ...(sheet
                    ? {}
                    : {
                        borderBottomLeftRadius: theme.radii['radius-sheet'],
                        borderBottomRightRadius: theme.radii['radius-sheet'],
                      }),
                }}
              >
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: theme.space['space-2'],
                  }}
                >
                  {/* One element, which the focus is given to as it opens: its name is read,
                      and that it is a header. */}
                  <View
                    ref={heading}
                    accessible
                    accessibilityRole="header"
                    accessibilityLabel={title}
                    style={{ flex: 1 }}
                  >
                    <Text step="title-3">{title}</Text>
                  </View>
                  {sheet ? (
                    <IconButton
                      testID={testID === undefined ? undefined : `${testID}:close`}
                      label={t(controls.close_sheet.labelKey)}
                      icon={<BaseIcon name={controls.close_sheet.glyph.id} />}
                      onPress={() => {
                        onClose()
                      }}
                    />
                  ) : null}
                </View>
                {description === undefined && children === undefined ? null : (
                  <ScrollView
                    // A press on a control goes to the control, with a keyboard up as without.
                    keyboardShouldPersistTaps="handled"
                    style={{ flexShrink: 1 }}
                    contentContainerStyle={{ gap: theme.space['space-2'] }}
                  >
                    {description === undefined ? null : (
                      <Text color="text-muted">{description}</Text>
                    )}
                    {children}
                  </ScrollView>
                )}
                {actions === undefined ? null : (
                  <View
                    style={{
                      flexDirection: 'row',
                      flexWrap: 'wrap',
                      justifyContent: 'flex-end',
                      gap: theme.space['space-1'],
                    }}
                  >
                    {actions}
                  </View>
                )}
              </View>
            </View>
          </ToastHost>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

/** A modal, for a confirmation: it is closed by its choices. */
export function Dialog(props: DialogProps) {
  return <Surface {...props} sheet={false} />
}
