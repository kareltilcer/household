// The primitives that carry no household data (02-components §1), each in its own states, on one
// dev-only page: buttons, inputs, dialogs and sheets, menus, toasts, banners, the sync marks and
// hold-to-complete. The twelve states are not theirs; they have their own, and the end-to-end
// suite drives them here: the focus a dialog traps and gives back, a menu under the arrow keys, a
// toast's undo, a hold released early and a hold kept. Its words are fixtures, as the harness's
// are (harness/model.ts).
import { controls, statusGlyphs, type StatusId } from '@household/icons'
import { BaseIcon } from '@household/icons/web'
import { useState, type ReactNode } from 'react'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { Banner, OfflineBar } from '../ui/Banner.tsx'
import { Button, IconButton, type ButtonVariant } from '../ui/Button.tsx'
import { Checkbox, RadioGroup, Switch } from '../ui/Choice.tsx'
import { Dialog, Sheet } from '../ui/Dialog.tsx'
import { Select, Stepper, TextArea, TextField } from '../ui/Field.tsx'
import { HoldToComplete } from '../ui/HoldToComplete.tsx'
import { Menu } from '../ui/Menu.tsx'
import { StatusMark, SyncMark, syncStates } from '../ui/StatusMark.tsx'
import { useToast } from '../ui/Toast.tsx'
import { DevToolbar } from './DevToolbar.tsx'
import { useSample } from './sample.ts'
import styles from './Primitives.module.css'

const variants: readonly ButtonVariant[] = ['primary', 'secondary', 'ghost', 'danger']

function Section({ name, children }: { readonly name: string; readonly children: ReactNode }) {
  const sample = useSample()
  return (
    <section className={styles.section}>
      <h2 className={styles.name}>{sample(name)}</h2>
      <div className={styles.samples}>{children}</div>
    </section>
  )
}

export function Primitives() {
  const sample = useSample()
  const t = useTranslate()
  const toast = useToast()
  const [confirm, setConfirm] = useState(false)
  const [editor, setEditor] = useState(false)
  const [reading, setReading] = useState('18 402,4')
  const [register, setRegister] = useState('')
  const [count, setCount] = useState(2)
  const [repeat, setRepeat] = useState<string>('month')
  const [chosen, setChosen] = useState<string>(sample('Nothing chosen yet'))
  const [completions, setCompletions] = useState(0)
  const [undone, setUndone] = useState(0)

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{sample('Primitives')}</h1>
        <DevToolbar />
      </header>

      <Section name="Buttons">
        {variants.map((variant) => (
          <div key={variant} className={styles.row}>
            <Button variant={variant}>{sample('Save reading')}</Button>
            <Button variant={variant} loading>
              {sample('Saving')}
            </Button>
            <Button variant={variant} disabled>
              {sample('Unavailable')}
            </Button>
          </div>
        ))}
        <div className={styles.row}>
          <IconButton
            label={t(controls.edit.labelKey, { name: sample('Cellar meter') })}
            icon={<BaseIcon name={controls.edit.glyph.id} />}
          />
          <IconButton
            variant="secondary"
            label={t(controls.share.labelKey, { name: sample('Cellar meter') })}
            icon={<BaseIcon name={controls.share.glyph.id} />}
          />
          <IconButton
            variant="danger"
            label={t(controls.delete.labelKey, { name: sample('Cellar meter') })}
            icon={<BaseIcon name={controls.delete.glyph.id} />}
          />
        </div>
      </Section>

      <Section name="Inputs">
        <div className={styles.fields}>
          <TextField
            label={sample('Value, kWh')}
            help={sample('The reading on the dial, decimals included.')}
            numeric
            required
            value={reading}
            onChange={(event) => {
              setReading(event.currentTarget.value)
            }}
          />
          <TextField
            label={sample('Value, kWh')}
            numeric
            defaultValue="18 016,4"
            error={sample(
              'That is lower than the reading on 3 February. Is it a rollover, or a typo?',
            )}
          />
          <TextField
            label={sample('Value, kWh')}
            numeric
            readOnly
            defaultValue="18 116,0"
            help={sample('Read by Petr on 3 February. Corrections are an online edit.')}
          />
          <TextField
            label={sample('Value, kWh')}
            numeric
            disabled
            help={sample('Choose a register first.')}
          />
          <TextArea label={sample('Note')} help={sample('Optional.')} />
          <Select
            label={sample('Register')}
            placeholder={sample('Choose')}
            options={[
              { value: 'day', label: sample('Day tariff') },
              { value: 'night', label: sample('Night tariff') },
            ]}
            value={register}
            onChange={(event) => {
              setRegister(event.currentTarget.value)
            }}
          />
          <Stepper label={sample('Members')} value={count} onChange={setCount} min={1} max={12} />
        </div>
        <div className={styles.fields}>
          <Checkbox label={sample('Remind me a week before')} defaultChecked />
          <Checkbox label={sample('Some of these lists')} indeterminate />
          <Switch label={sample('Share this list with the household')} />
          <RadioGroup
            label={sample('Repeats')}
            value={repeat}
            onChange={setRepeat}
            options={[
              { value: 'week', label: sample('Every week') },
              { value: 'month', label: sample('Every month') },
              { value: 'never', label: sample('Never'), disabled: true },
            ]}
          />
        </div>
      </Section>

      <Section name="Dialogs and sheets">
        <div className={styles.row}>
          <Button
            variant="danger"
            onClick={() => {
              setConfirm(true)
            }}
          >
            {sample('Delete Weekly shop')}
          </Button>
          <Button
            onClick={() => {
              setEditor(true)
            }}
          >
            {sample('Edit the cellar meter')}
          </Button>
        </div>
        <Dialog
          open={confirm}
          onClose={() => {
            setConfirm(false)
          }}
          title={sample('Delete Weekly shop?')}
          description={sample(
            'The list and its 14 items are deleted for everyone in the household. Recorded trips stay in Finance.',
          )}
          actions={
            <>
              <Button
                onClick={() => {
                  setConfirm(false)
                }}
              >
                {sample('Keep the list')}
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  setConfirm(false)
                }}
              >
                {sample('Delete Weekly shop')}
              </Button>
            </>
          }
        />
        <Sheet
          open={editor}
          onClose={() => {
            setEditor(false)
          }}
          title={sample('Cellar meter')}
          actions={
            <Button
              variant="primary"
              onClick={() => {
                setEditor(false)
              }}
            >
              {sample('Save')}
            </Button>
          }
        >
          <TextField label={sample('Name')} defaultValue={sample('Cellar meter')} />
          <TextField
            label={sample('Serial number')}
            numeric
            error={sample('A serial number has no spaces.')}
            defaultValue="44 81 20"
          />
        </Sheet>
      </Section>

      <Section name="Menus">
        <div className={styles.row}>
          <Menu
            trigger={
              <IconButton
                label={t(controls.more_actions.labelKey, { name: sample('Cellar meter') })}
                icon={<BaseIcon name={controls.more_actions.glyph.id} />}
              />
            }
            items={[
              {
                id: 'rename',
                label: sample('Rename'),
                onSelect: () => {
                  setChosen(sample('Rename'))
                },
              },
              {
                id: 'archive',
                label: sample('Archive'),
                icon: <BaseIcon name="archive" />,
                onSelect: () => {
                  setChosen(sample('Archive'))
                },
              },
              {
                id: 'delete',
                label: sample('Delete the cellar meter'),
                danger: true,
                onSelect: () => {
                  setChosen(sample('Delete the cellar meter'))
                },
              },
            ]}
          />
          <p role="status" data-chosen="">
            {chosen}
          </p>
        </div>
      </Section>

      <Section name="Toasts">
        <div className={styles.row}>
          <Button
            onClick={() => {
              toast({
                message: sample('7 checked items cleared from Weekly shop'),
                undo: () => {
                  setUndone((current) => current + 1)
                },
              })
            }}
          >
            {sample('Clear checked items')}
          </Button>
          <Button
            onClick={() => {
              toast({
                message: sample('Saved on this device. It will sync when you are back online.'),
              })
            }}
          >
            {sample('Save offline')}
          </Button>
          <p role="status" data-undone={undone}>
            {sample('Undone')} {undone}
          </p>
        </div>
      </Section>

      <Section name="Hold to complete">
        <div className={styles.row}>
          <HoldToComplete
            label={sample('Complete Take out the bins')}
            onComplete={() => {
              setCompletions((current) => current + 1)
            }}
          />
          <HoldToComplete
            label={sample('Complete Water the tomatoes')}
            onComplete={() => Promise.reject(new Error('held'))}
          />
          <p role="status" data-completions={completions}>
            {sample('Completed')} {completions}
          </p>
        </div>
      </Section>

      <Section name="Banners">
        <OfflineBar />
        <Banner tone="info">{sample('The trial ends in nine days.')}</Banner>
        <Banner
          tone="warning"
          title={sample('Read-only')}
          actions={<Button>{sample('See plans')}</Button>}
          onDismiss={() => undefined}
        >
          {sample('The subscription has lapsed. Everything is readable.')}
        </Banner>
        <Banner tone="danger" actions={<Button>{sample('Try again')}</Button>}>
          {sample('Could not load the readings. Nothing was lost.')}
        </Banner>
        <Banner tone="neutral">
          {sample('Utilities is no longer shared with you, so these readings were removed.')}
        </Banner>
      </Section>

      <Section name="Status and sync marks">
        <div className={styles.row}>
          {(Object.keys(statusGlyphs) as StatusId[]).map((status) => (
            <StatusMark key={status} status={status} />
          ))}
        </div>
        <div className={styles.row}>
          {syncStates.map((state) => (
            <SyncMark
              key={state}
              state={state}
              name={sample('Electricity advance')}
              onOpen={() => undefined}
            />
          ))}
        </div>
      </Section>
    </div>
  )
}
