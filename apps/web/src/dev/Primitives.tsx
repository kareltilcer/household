// The primitives that carry no household data (02-components §1), each in its own states, on one
// dev-only page: buttons, inputs, dialogs and sheets, menus, toasts, banners, the sync marks and
// hold-to-complete. The twelve states are not theirs; they have their own, and the end-to-end
// suite drives them here: the focus a dialog traps and gives back, a menu under the arrow keys, a
// confirmation opened from a menu, a toast's undo, a menu and a toast raised from inside a side
// panel, a side panel that asks before it closes, a hold released early and a hold kept. Its
// words are fixtures, as the harness's are (harness/model.ts).
import { controls, statusGlyphs, type StatusId } from '@household/icons'
import { BaseIcon } from '@household/icons/web'
import { useRef, useState, type ReactNode } from 'react'
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
  const [removing, setRemoving] = useState(false)
  const [noting, setNoting] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [abandoning, setAbandoning] = useState(false)
  const meterName = useRef<HTMLInputElement>(null)
  const noteText = useRef<HTMLTextAreaElement>(null)
  const [reading, setReading] = useState('18 402,4')
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
          {/* Nothing says what is chosen, so nothing is: it reads its placeholder. */}
          <Select
            label={sample('Register')}
            placeholder={sample('Choose')}
            options={[
              { value: 'day', label: sample('Day tariff') },
              { value: 'night', label: sample('Night tariff') },
            ]}
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
          <Button
            onClick={() => {
              setNoting(true)
            }}
          >
            {sample('Add a note')}
          </Button>
          <Button
            onClick={() => {
              setRenaming(true)
            }}
          >
            {sample('Rename the cellar meter')}
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
          // An editor opens on its first field, and not on the control that closes it.
          initialFocus={meterName}
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
          <TextField label={sample('Name')} defaultValue={sample('Cellar meter')} ref={meterName} />
          <TextField
            label={sample('Serial number')}
            numeric
            error={sample('A serial number has no spaces.')}
            defaultValue="44 81 20"
          />
          {/* A menu and a toast raised from inside a modal, which makes the page outside it
              inert: both are drawn inside the panel, or neither could be reached. */}
          <div className={styles.row}>
            <Menu
              trigger={
                <IconButton
                  label={t(controls.more_actions.labelKey, { name: sample('Serial number') })}
                  icon={<BaseIcon name={controls.more_actions.glyph.id} />}
                />
              }
              items={[
                {
                  id: 'clear',
                  label: sample('Clear the serial number'),
                  onSelect: () => {
                    toast({
                      message: sample('Serial number cleared from Cellar meter'),
                      undo: () => {
                        setUndone((current) => current + 1)
                      },
                    })
                  },
                },
                {
                  id: 'copy',
                  label: sample('Copy the serial number'),
                  onSelect: () => undefined,
                },
              ]}
            />
          </div>
        </Sheet>
        {/* An editor that asks before it discards: asked to close, it stays, and opens a
            confirmation inside itself. A browser lets a page refuse Escape only so many times
            in a row and then closes the dialog whatever the page says: the panel is shown
            again, what was typed still in it, and its question over it. */}
        <Sheet
          open={noting}
          onClose={() => {
            setDiscarding(true)
          }}
          title={sample('Note on the cellar meter')}
          initialFocus={noteText}
          actions={
            <Button
              variant="primary"
              onClick={() => {
                setNoting(false)
              }}
            >
              {sample('Save the note')}
            </Button>
          }
        >
          <TextArea label={sample('What to remember')} ref={noteText} />
          <Dialog
            open={discarding}
            onClose={() => {
              setDiscarding(false)
            }}
            title={sample('Discard the note?')}
            description={sample('What you typed is saved nowhere yet, and is lost.')}
            actions={
              <>
                <Button
                  onClick={() => {
                    setDiscarding(false)
                  }}
                >
                  {sample('Keep writing')}
                </Button>
                <Button
                  variant="danger"
                  onClick={() => {
                    setDiscarding(false)
                    setNoting(false)
                  }}
                >
                  {sample('Discard the note')}
                </Button>
              </>
            }
          />
        </Sheet>
        {/* A panel drawn only while it is open, as a screen draws the editor of the row it has
            chosen, and its question only while it is asked. Taken away open, the two at once,
            they give the focus back as the ones above do, which are closed by their `open`. */}
        {renaming ? (
          <Sheet
            open
            onClose={() => {
              setAbandoning(true)
            }}
            title={sample('Rename the cellar meter')}
            actions={
              <Button
                variant="primary"
                onClick={() => {
                  setRenaming(false)
                }}
              >
                {sample('Save the name')}
              </Button>
            }
          >
            <TextField label={sample('New name')} />
            {abandoning ? (
              <Dialog
                open
                onClose={() => {
                  setAbandoning(false)
                }}
                title={sample('Discard the name?')}
                actions={
                  <>
                    <Button
                      onClick={() => {
                        setAbandoning(false)
                      }}
                    >
                      {sample('Keep renaming')}
                    </Button>
                    <Button
                      variant="danger"
                      onClick={() => {
                        setAbandoning(false)
                        setRenaming(false)
                      }}
                    >
                      {sample('Discard the name')}
                    </Button>
                  </>
                }
              />
            ) : null}
          </Sheet>
        ) : null}
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
                // A confirmation opened from a menu: closed, it gives the focus back to the
                // menu's trigger, the item that opened it being gone.
                onSelect: () => {
                  setChosen(sample('Delete the cellar meter'))
                  setRemoving(true)
                },
              },
            ]}
          />
          <p role="status" data-chosen="">
            {chosen}
          </p>
        </div>
        <Dialog
          open={removing}
          onClose={() => {
            setRemoving(false)
          }}
          title={sample('Delete the cellar meter?')}
          description={sample(
            'The meter and its 38 readings are deleted for everyone in the household. Bills already settled stay in Finance.',
          )}
          actions={
            <>
              <Button
                onClick={() => {
                  setRemoving(false)
                }}
              >
                {sample('Keep the meter')}
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  setRemoving(false)
                }}
              >
                {sample('Delete the cellar meter')}
              </Button>
            </>
          }
        />
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
