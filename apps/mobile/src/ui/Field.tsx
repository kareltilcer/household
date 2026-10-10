// Input, password and textarea (02-components §1), at default, focus, filled, error, read-only
// and out of its form; the select and the stepper are fields too, in files of their own beside
// this one. Every one is labelled, and an error is stated in words beside the field with its
// glyph and read with the field by a screen reader, never carried by a red border alone
// (06-clients §4). The contract is the web's (apps/web/src/ui/Field.tsx), said in a device's
// terms: there is no `aria-describedby` to tie a sentence to a control, so the help and the
// error are the control's hint, which is read after its name and its value.
import {
  useCallback,
  useId,
  useState,
  type Component,
  type ReactNode,
  type Ref,
  type RefObject,
} from 'react'
import {
  Platform,
  Pressable,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native'
import { useTarget, useTheme, useType } from '../display/DisplayProvider.tsx'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { BaseIcon } from './Icon.tsx'
import { useRefusable } from './refusal.ts'
import { Text } from './Text.tsx'

export interface FieldProps {
  /** The field's name. Always shown: a placeholder is no label. */
  readonly label: string
  /** What to enter, or what the value is for. */
  readonly help?: string | undefined
  /** What is wrong with the value, in a sentence. Its presence is what marks the field invalid. */
  readonly error?: string | undefined
  /** Said in a word beside the label, not by an asterisk's colour. */
  readonly required?: boolean | undefined
}

/** What a control takes from its field: what it is called, and the sentences read with it. */
export interface Wiring {
  /** Its name to a screen reader: the label, and that it is required. */
  readonly name: string
  /** The drawn label's `nativeID`: what Android ties a text field to. */
  readonly labelId: string
  /** The help and the error, read with the control after its name and its value. */
  readonly hint: string | undefined
  readonly invalid: boolean
}

/** A text hidden from a screen reader on either platform: its words are said by another element. */
const unread = {
  accessibilityElementsHidden: true,
  importantForAccessibility: 'no-hide-descendants',
} as const

/**
 * A field's frame: its label above its control, its help and its error below.
 *
 * `typed` says the control is the platform's own text field. Android reads a filled one by its
 * text and not by its label, and ties it to the label that is drawn (`accessibilityLabelledBy`),
 * which a screen reader must then be able to read. Every other control is named itself, and
 * the drawn label is hidden from a screen reader, which would read it twice.
 */
export function Field({
  label,
  help,
  error,
  required,
  typed = false,
  children,
}: FieldProps & {
  readonly typed?: boolean
  readonly children: (wiring: Wiring) => ReactNode
}) {
  const t = useTranslate()
  const theme = useTheme()
  const labelId = useId()
  const word = t('ui.field.required')
  const said = [help, error].filter((part) => part !== undefined)
  return (
    <View style={{ gap: theme.space['space-05'], minWidth: 0 }}>
      <Text
        nativeID={labelId}
        step="caption"
        color="text-muted"
        {...(typed && Platform.OS === 'android' ? {} : unread)}
      >
        {label}
        {required === true ? <Text step="caption">{`  ${word}`}</Text> : null}
      </Text>
      {children({
        name: required === true ? `${label}, ${word}` : label,
        labelId,
        hint: said.length === 0 ? undefined : said.join(' '),
        invalid: error !== undefined,
      })}
      {help === undefined ? null : (
        <Text step="caption" color="text-muted">
          {help}
        </Text>
      )}
      {error === undefined ? null : (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: theme.space['space-05'],
          }}
        >
          <BaseIcon name="alert-circle" color="danger" />
          <Text step="caption" color="danger" style={{ flexShrink: 1 }}>
            {error}
          </Text>
        </View>
      )}
    </View>
  )
}

/** Why a control takes no typing: its value is shown and not changed here, or it is out of its form. */
export type Fixed = 'readOnly' | 'disabled' | undefined

/**
 * The box every field's control is drawn in. Read-only and out of its form are two treatments
 * (02-components §1): a read-only value is in the sunken ground in its own ink, to be read; one
 * out of its form is dimmed as well.
 */
export function useControlStyle({
  invalid,
  focused,
  fixed,
}: {
  readonly invalid: boolean
  readonly focused: boolean
  readonly fixed: Fixed
}): ViewStyle {
  const theme = useTheme()
  const edge =
    fixed === 'disabled'
      ? 'border-subtle'
      : invalid
        ? 'danger'
        : fixed === 'readOnly'
          ? 'border'
          : 'border-strong'
  return {
    minHeight: useTarget(),
    paddingHorizontal: theme.space['space-15'],
    paddingVertical: theme.space['space-1'],
    backgroundColor: theme.color[fixed === undefined ? 'input-bg' : 'surface-sunken'],
    borderWidth: 1,
    borderColor: theme.color[edge],
    borderRadius: theme.radii['radius-control'],
    ...(focused
      ? {
          outlineWidth: 2,
          outlineStyle: 'solid',
          outlineOffset: 2,
          outlineColor: theme.color.focus,
        }
      : {}),
  }
}

/**
 * One ref for a field's control: its field's own, which a refusal gives the focus to
 * (ui/refusal.ts), and its caller's, where the caller asks for the control.
 */
export function useAttached<Control extends Component>(
  own: RefObject<Component | null>,
  ref: Ref<Control> | undefined,
): (control: Control | null) => void {
  return useCallback(
    (control) => {
      own.current = control
      if (typeof ref === 'function') ref(control)
      else if (ref !== undefined && ref !== null) ref.current = control
    },
    [own, ref],
  )
}

type Native = Omit<
  TextInputProps,
  | 'style'
  | 'children'
  | 'allowFontScaling'
  | 'maxFontSizeMultiplier'
  | 'accessibilityLabel'
  | 'accessibilityLabelledBy'
  | 'accessibilityHint'
  | 'aria-label'
  | 'aria-labelledby'
  | 'placeholderTextColor'
  | 'editable'
  | 'readOnly'
  | 'multiline'
>

interface Held {
  /** Its value is shown and not changed here. A screen reader still reads it as a field's. */
  readonly readOnly?: boolean
  /** Out of its form: it takes no typing, and says so. A field that cannot act at all is absent. */
  readonly disabled?: boolean
  readonly ref?: Ref<TextInput>
}

export interface FieldInputProps extends Native, Held {
  readonly wiring: Wiring
  /** Set in the mono face with tabular figures: a reading, an amount, a registration. */
  readonly numeric?: boolean
  readonly multiline?: boolean
  /** Where it stands in its field's row: a password beside its *Show*, a count between its buttons. */
  readonly layout?: StyleProp<Pick<ViewStyle, 'flex' | 'flexGrow' | 'flexShrink' | 'minWidth'>>
  readonly align?: 'center'
}

/**
 * The platform's text field inside a `Field`, drawn in the app's own type at the reader's
 * scale, with the system's scaling off as `Text` has it: the two would multiply.
 */
export function FieldInput({
  wiring,
  numeric = false,
  multiline = false,
  readOnly = false,
  disabled = false,
  layout,
  align,
  ref,
  onFocus,
  onBlur,
  accessibilityState,
  ...rest
}: FieldInputProps) {
  const theme = useTheme()
  const [focused, setFocused] = useState(false)
  const fixed: Fixed = disabled ? 'disabled' : readOnly ? 'readOnly' : undefined
  const control = useControlStyle({ invalid: wiring.invalid, focused, fixed })
  // One line is centred by the platform in the height the control has. A line height of its
  // own moves it off the centre on iOS, so only several lines are given one.
  const { lineHeight, ...type } = useType(numeric ? 'num' : 'body')
  const several: TextStyle | null =
    multiline && lineHeight !== undefined
      ? {
          lineHeight,
          // Three lines to begin with, and as many more as are typed: nothing holds its height.
          minHeight: lineHeight * 3 + theme.space['space-1'] * 2 + 2,
          textAlignVertical: 'top',
        }
      : null
  // The field's own ref, which a refused form gives the focus to, and its caller's.
  const attach = useAttached(useRefusable(wiring.invalid), ref)
  return (
    <TextInput
      {...rest}
      ref={attach}
      allowFontScaling={false}
      // Android reads a filled field by its text and not by its label, and is told which drawn
      // text labels it. iOS reads the label and then the value.
      {...(Platform.OS === 'android'
        ? { accessibilityLabelledBy: wiring.labelId }
        : { accessibilityLabel: wiring.name })}
      {...(wiring.hint === undefined ? {} : { accessibilityHint: wiring.hint })}
      accessibilityState={{ ...accessibilityState, ...(disabled ? { disabled: true } : {}) }}
      editable={fixed === undefined}
      multiline={multiline}
      placeholderTextColor={theme.color['text-muted']}
      onFocus={(event) => {
        setFocused(true)
        onFocus?.(event)
      }}
      onBlur={(event) => {
        setFocused(false)
        onBlur?.(event)
      }}
      style={[
        control,
        type,
        several,
        { color: theme.color[disabled ? 'text-disabled' : 'text-primary'] },
        align === undefined ? null : { textAlign: align },
        layout,
      ]}
    />
  )
}

export interface TextFieldProps extends FieldProps, Native, Held {
  /** Set in the mono face with tabular figures: a reading, an amount, a registration. */
  readonly numeric?: boolean
}

export function TextField({ label, help, error, required, ...rest }: TextFieldProps) {
  return (
    <Field label={label} help={help} error={error} required={required} typed>
      {(wiring) => <FieldInput {...rest} wiring={wiring} />}
    </Field>
  )
}

export interface PasswordFieldProps extends FieldProps, Omit<Native, 'secureTextEntry'>, Held {}

/**
 * A password, with a control that shows what was typed: a password that cannot be read back is
 * typed twice or mistyped once. The control says what it does, in a word, and whether the
 * password is shown, to a screen reader: it is a switch, on while the password can be read.
 * Shown or not, the field is a password's to a password manager, by its `autoComplete`, which
 * its owner names.
 */
export function PasswordField({ label, help, error, required, ...rest }: PasswordFieldProps) {
  const t = useTranslate()
  const theme = useTheme()
  const target = useTarget()
  const [shown, setShown] = useState(false)
  return (
    <Field label={label} help={help} error={error} required={required} typed>
      {(wiring) => (
        <View style={{ flexDirection: 'row', alignItems: 'stretch', gap: theme.space['space-1'] }}>
          <FieldInput
            // What a keyboard would do to prose it does not do to a password that is shown.
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            {...rest}
            wiring={wiring}
            secureTextEntry={!shown}
            layout={{ flex: 1, minWidth: 0 }}
          />
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: shown }}
            onPress={() => {
              setShown((now) => !now)
            }}
            style={{
              minHeight: target,
              minWidth: target,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: theme.space['space-15'],
              borderWidth: 1,
              borderColor: theme.color['border-strong'],
              borderRadius: theme.radii['radius-control'],
              // On: the password is shown. Said by more than its ground, by its weight.
              backgroundColor: shown ? theme.color['surface-sunken'] : 'transparent',
            }}
          >
            <Text weight={shown ? 600 : 400}>{t('ui.password.show')}</Text>
          </Pressable>
        </View>
      )}
    </Field>
  )
}

export interface TextAreaProps extends FieldProps, Native, Held {}

export function TextArea({ label, help, error, required, ...rest }: TextAreaProps) {
  return (
    <Field label={label} help={help} error={error} required={required} typed>
      {(wiring) => <FieldInput {...rest} wiring={wiring} multiline />}
    </Field>
  )
}
