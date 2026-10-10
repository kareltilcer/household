// The controls' section of the primitives dev screen: every control in every state it has, and
// every overlay opened from a control of its own, in both themes side by side. Its words are
// fixtures (fixtures.ts); what the end-to-end flow presses and reads is a `testID`, each
// prefixed by the theme its half is drawn in: `controls:light:sheet:open`.
import { controls } from '@household/icons'
import type { Theme } from '@household/tokens/native'
import { useRef, useState, type ReactNode } from 'react'
import { View, type TextInput } from 'react-native'
import { inHousehold } from '../../../app/paths.ts'
import { ThemeScope, useTheme } from '../../../display/DisplayProvider.tsx'
import { useTranslate } from '../../../i18n/I18nProvider.tsx'
import { Button, IconButton } from '../../../ui/Button.tsx'
import { Checkbox, RadioGroup, Switch } from '../../../ui/Choice.tsx'
import { Dialog } from '../../../ui/Dialog.tsx'
import { PasswordField, TextArea, TextField } from '../../../ui/Field.tsx'
import { BaseIcon } from '../../../ui/Icon.tsx'
import { Menu } from '../../../ui/Menu.tsx'
import { RowAction } from '../../../ui/RowAction.tsx'
import { RowLink } from '../../../ui/RowLink.tsx'
import { Select } from '../../../ui/Select.tsx'
import { Sheet } from '../../../ui/Sheet.tsx'
import { Stepper } from '../../../ui/Stepper.tsx'
import { Text } from '../../../ui/Text.tsx'
import { useToast } from '../../../ui/Toast.tsx'
import { Shown as Narrowed } from '../../Only.tsx'
import { useSample } from '../../sample.ts'
import { words } from './fixtures.ts'

/** The section's two parts, which its page can be narrowed to (Only.tsx). */
export const controlsParts = ['controls', 'overlays'] as const

/** A half of the section: what stands in it paints its own ground, in the theme it is scoped to. */
function Panel({ children }: { readonly children: ReactNode }) {
  const theme = useTheme()
  return (
    <View
      style={{
        gap: theme.space['space-2'],
        padding: theme.space['space-2'],
        backgroundColor: theme.color.surface,
      }}
    >
      {children}
    </View>
  )
}

interface Shown {
  /**
   * Whether the controls that take nothing are drawn: one out of its form, and a stepper's
   * button at its bound. The accessibility rules take a disabled control for a fault until a
   * test names it (src/test/a11y.ts), and the page is held to them whole, so these are drawn
   * when the section's own switch asks for them.
   */
  readonly out: boolean
  /** The theme its half is drawn in: what its `testID`s begin with. */
  readonly theme: Theme
}

/** The household a link of the section leads to: no household's, an address of the app's own shape. */
const nowhere = '0198c0de-0000-7000-8000-00000000d001'

function Fields({ out, theme }: Shown) {
  const sample = useSample()
  const [reading, setReading] = useState('')
  const [password, setPassword] = useState('')
  const [note, setNote] = useState('')
  return (
    <>
      <TextField
        testID={`controls:${theme}:field`}
        label={sample(words.reading)}
        help={sample(words.readingHelp)}
        numeric
        inputMode="decimal"
        value={reading}
        onChangeText={setReading}
      />
      <TextField label={sample(words.meter)} required defaultValue="CZ-4471-0092" numeric />
      <TextField
        label={sample(words.reading)}
        help={sample(words.readingHelp)}
        error={sample(words.readingLow)}
        numeric
        defaultValue="18 002"
      />
      <TextField label={sample(words.readingKept)} readOnly numeric value="18 116,0" />
      {out ? <TextField label={sample(words.readingOut)} disabled numeric value="9 204,5" /> : null}
      <PasswordField
        testID={`controls:${theme}:password`}
        label={sample(words.password)}
        help={sample(words.passwordHelp)}
        autoComplete="new-password"
        value={password}
        onChangeText={setPassword}
      />
      <TextArea label={sample(words.note)} value={note} onChangeText={setNote} />
      <TextArea label={sample(words.note)} error={sample(words.noteMissing)} required />
    </>
  )
}

function Selects({ out, theme }: Shown) {
  const sample = useSample()
  const [tariff, setTariff] = useState<string | undefined>(undefined)
  const [second, setSecond] = useState<string | undefined>('night')
  const tariffs = [
    { value: 'day', label: sample(words.day) },
    { value: 'night', label: sample(words.night) },
    { value: 'weekend', label: sample(words.weekend) },
  ]
  return (
    <>
      <Select
        testID={`controls:${theme}:select`}
        label={sample(words.tariff)}
        placeholder={sample(words.choose)}
        options={tariffs}
        value={tariff}
        onChange={setTariff}
        required
        {...(tariff === undefined ? { error: sample(words.tariffMissing) } : {})}
      />
      <Select
        label={sample(words.tariffChosen)}
        placeholder={sample(words.choose)}
        options={tariffs}
        value={second}
        onChange={setSecond}
      />
      {out ? (
        <Select
          label={sample(words.tariffOut)}
          options={tariffs}
          value="day"
          onChange={() => undefined}
          disabled
        />
      ) : null}
    </>
  )
}

function Steppers({ out, theme }: Shown) {
  const sample = useSample()
  const [members, setMembers] = useState(3)
  const [least, setLeast] = useState(1)
  return (
    <>
      <Stepper
        testID={`controls:${theme}:stepper`}
        label={sample(words.members)}
        value={members}
        onChange={setMembers}
        min={1}
        max={12}
      />
      <Stepper label={sample(words.membersKept)} value={4} onChange={() => undefined} readOnly />
      {out ? (
        <>
          {/* At its least from the start: its first button is there, and says it has nothing to do. */}
          <Stepper
            label={sample(words.atLeast)}
            value={least}
            onChange={setLeast}
            min={1}
            max={12}
          />
          <Stepper label={sample(words.membersOut)} value={2} onChange={() => undefined} disabled />
        </>
      ) : null}
    </>
  )
}

function Choices({ out, theme }: Shown) {
  const sample = useSample()
  const [remind, setRemind] = useState(true)
  const [meters, setMeters] = useState(false)
  const [share, setShare] = useState(true)
  const [quiet, setQuiet] = useState(false)
  const [repeats, setRepeats] = useState<string | undefined>('monthly')
  return (
    <>
      <Checkbox
        testID={`controls:${theme}:checkbox`}
        label={sample(words.remind)}
        checked={remind}
        onChange={setRemind}
      />
      {/* Some of what it stands for is chosen, until it is pressed and all of it is. */}
      <Checkbox
        label={sample(words.everyMeter)}
        checked={meters}
        indeterminate={!meters}
        onChange={setMeters}
      />
      <Checkbox label={sample(words.shared)} checked={false} onChange={() => undefined} />
      {out ? (
        <Checkbox label={sample(words.removed)} checked disabled onChange={() => undefined} />
      ) : null}
      <Switch
        testID={`controls:${theme}:switch`}
        label={sample(words.share)}
        checked={share}
        onChange={setShare}
      />
      <Switch label={sample(words.quiet)} checked={quiet} onChange={setQuiet} />
      {out ? (
        <Switch label={sample(words.switchedOut)} checked disabled onChange={() => undefined} />
      ) : null}
      <RadioGroup
        testID={`controls:${theme}:radio`}
        label={sample(words.repeats)}
        value={repeats}
        onChange={setRepeats}
        options={[
          { value: 'weekly', label: sample(words.weekly) },
          { value: 'monthly', label: sample(words.monthly) },
          { value: 'never', label: sample(words.never) },
        ]}
      />
    </>
  )
}

function Rows() {
  const sample = useSample()
  const theme = useTheme()
  const [leaving, setLeaving] = useState(false)
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['space-1'] }}>
      <RowAction
        name={sample(words.signOutNamed)}
        word={sample(words.signOut)}
        loading={leaving}
        onPress={() => {
          setLeaving(true)
        }}
      />
      <RowAction
        name={sample(words.signOutNamed)}
        word={sample(words.signOut)}
        loading
        onPress={() => undefined}
      />
      <RowLink
        to={inHousehold.home(nowhere)}
        name={sample(words.openNamed)}
        word={sample(words.open)}
      />
    </View>
  )
}

/** Every overlay, each opened by a control of its own: a confirmation, an editor, a menu, toasts. */
function Overlays({ theme: name }: { readonly theme: Theme }) {
  const sample = useSample()
  const t = useTranslate()
  const theme = useTheme()
  const toast = useToast()
  const [asking, setAsking] = useState(false)
  const [editing, setEditing] = useState(false)
  const [reading, setReading] = useState('18 204,5')
  const field = useRef<TextInput>(null)
  const id = (part: string) => `controls:${name}:${part}`
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['space-1'] }}>
      <Button
        testID={id('dialog:open')}
        variant="danger"
        onPress={() => {
          setAsking(true)
        }}
      >
        {sample(words.askDelete)}
      </Button>
      <Dialog
        testID={id('dialog')}
        open={asking}
        onClose={() => {
          setAsking(false)
        }}
        title={sample(words.deleteTitle)}
        description={sample(words.deleteBody)}
        actions={
          <>
            <Button
              testID={id('dialog:keep')}
              onPress={() => {
                setAsking(false)
              }}
            >
              {sample(words.keep)}
            </Button>
            <Button
              testID={id('dialog:delete')}
              variant="danger"
              onPress={() => {
                setAsking(false)
                toast({ message: sample(words.deleted), undo: () => undefined })
              }}
            >
              {sample(words.deleteIt)}
            </Button>
          </>
        }
      />

      <Button
        testID={id('sheet:open')}
        onPress={() => {
          setEditing(true)
        }}
      >
        {sample(words.edit)}
      </Button>
      <Sheet
        testID={id('sheet')}
        open={editing}
        onClose={() => {
          setEditing(false)
        }}
        title={sample(words.edit)}
        initialFocus={field}
        actions={
          // Saved, the sheet stays, and says so in a toast, which is drawn inside it.
          <Button
            testID={id('sheet:save')}
            variant="primary"
            onPress={() => {
              toast({ message: sample(words.saved), undo: () => undefined })
            }}
          >
            {sample(words.save)}
          </Button>
        }
      >
        <TextField
          ref={field}
          testID={id('sheet:reading')}
          label={sample(words.reading)}
          help={sample(words.readingHelp)}
          numeric
          inputMode="decimal"
          value={reading}
          onChangeText={setReading}
        />
        <TextArea label={sample(words.note)} />
      </Sheet>

      <Menu
        trigger={
          <IconButton
            testID={id('menu:open')}
            variant="secondary"
            label={t(controls.more_actions.labelKey, { name: sample(words.moreFor) })}
            icon={<BaseIcon name={controls.more_actions.glyph.id} />}
          />
        }
        items={[
          {
            id: 'rename',
            testID: id('menu:rename'),
            label: sample(words.rename),
            icon: <BaseIcon name="pencil" />,
            onSelect: () => {
              toast({ message: sample(words.renamed) })
            },
          },
          {
            // What destroys asks first: the confirmation opens once the menu has gone.
            id: 'remove',
            testID: id('menu:remove'),
            label: sample(words.remove),
            icon: <BaseIcon name="trash-2" />,
            danger: true,
            onSelect: () => {
              setAsking(true)
            },
          },
        ]}
      />

      <Button
        testID={id('toast:undo')}
        onPress={() => {
          toast({ message: sample(words.cleared), undo: () => undefined })
        }}
      >
        {sample(words.raise)}
      </Button>
      <Button
        testID={id('toast:plain')}
        onPress={() => {
          toast({ message: sample(words.archived) })
        }}
      >
        {sample(words.plain)}
      </Button>
    </View>
  )
}

function Half({ theme, out }: Shown & { readonly theme: Theme }) {
  return (
    <ThemeScope theme={theme}>
      <Panel>
        <Fields out={out} theme={theme} />
        <Selects out={out} theme={theme} />
        <Steppers out={out} theme={theme} />
        <Choices out={out} theme={theme} />
        <Rows />
      </Panel>
    </ThemeScope>
  )
}

export function ControlsSection() {
  const sample = useSample()
  const [out, setOut] = useState(false)
  return (
    <>
      <Narrowed part="controls">
        <Text step="title-3" header>
          {sample(words.controls)}
        </Text>
        <Switch
          testID="controls:out-of-form"
          label={sample(words.showOut)}
          checked={out}
          onChange={setOut}
        />
        <Half theme="light" out={out} />
        <Half theme="dark" out={out} />
      </Narrowed>
      <Narrowed part="overlays">
        <Text step="title-3" header>
          {sample(words.overlays)}
        </Text>
        <ThemeScope theme="light">
          <Panel>
            <Overlays theme="light" />
          </Panel>
        </ThemeScope>
        <ThemeScope theme="dark">
          <Panel>
            <Overlays theme="dark" />
          </Panel>
        </ThemeScope>
      </Narrowed>
    </>
  )
}
