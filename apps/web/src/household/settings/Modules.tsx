// Which modules the household has on (C-51, `/households/{id}/settings/modules`; PRD 17 §3,
// FR-HA8; 03-patterns §2 and §5): sixteen rows, each a module that is on or off for everybody,
// with how many of the household's members hold it. Every member reads it, whatever they hold on
// household settings (D-167); an owner, in a household that takes writes, turns a module on or
// off, and what stands above the list says which of the two its reader is (Page.tsx).
//
// The one thing people ask is answered first, and again where it is asked: turning a module off
// keeps its data. Turning one on is done at once. Turning one off is asked about, in a
// confirmation that names the module and says for how many people its screens go, that nothing
// is deleted, and that all of it comes back. After either the row stays where it was and its
// control becomes its opposite under the focus, so what the press came to is said in a toast.
//
// Household settings itself is no row: it is granted and never turned off, which the server
// refuses, and the foot of the list says so, a member's access counting seventeen. A module's
// setup is not run again from here yet (FR-HA9): no module has one on the web, and each adds its
// entry with its own screens. Whether a module holds anything is not said: the contract's
// `entity_count` is never set.
//
// C-51's states. *Loading*, *error* and *offline* are the list's read: a skeleton, the list that
// did not load with the way to read it again, and the list as this browser kept it. The members
// are read beside it for the count alone, which is left out while they are unread. *Populated*
// is the sixteen rows. There is no *empty*, the list being the same sixteen in every household,
// and no *absent*, every member being let read it. *Pending* has nothing to be: a module is
// turned on or off on the server or not at all (PRD 17, Sync; D-170), and the prototype's switch
// that saves on the phone is not built. *Syncing* is a row's own change under way, its control
// busy and every other still to be pressed. *Conflicted* has nothing to be: a module is on or it
// is off, and asking for what it is already changes nothing. *Rejected* is a refusal, said in a
// banner. *Withdrawn* is an owner made a member while the screen was open: the controls leave
// when the household is read again, and a change pressed before then is answered `403`, which
// is said. *Read-only* draws no control, and the note above the list says why.
import { ModuleIcon } from '@household/icons/web'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { readState } from '../../account/common.ts'
import styles from '../../account/Settings.module.css'
import { useApi } from '../../api/ApiProvider.tsx'
import { unwrap } from '../../api/problem.ts'
import { useProblemText } from '../../api/problemText.ts'
import { askedNow } from '../../api/query.ts'
import { useFormat, useTranslate } from '../../i18n/I18nProvider.tsx'
import a11y from '../../ui/a11y.module.css'
import { Banner } from '../../ui/Banner.tsx'
import { Button } from '../../ui/Button.tsx'
import { Dialog } from '../../ui/Dialog.tsx'
import { List, ListRow } from '../../ui/ListRow.tsx'
import { useOnline } from '../../ui/online.ts'
import { Skeleton } from '../../ui/Skeleton.tsx'
import { StateFrame } from '../../ui/StateFrame.tsx'
import { useToast } from '../../ui/Toast.tsx'
import { useMembers, useModuleStates, useReread, type ModuleState } from '../data.ts'
import { matrixOrder } from '../grants.ts'
import grants from '../Grants.module.css'
import { useHousehold } from '../HouseholdContext.tsx'
import { moduleStatesKey, type ModuleKey } from '../households.ts'
import { useTimeZone } from '../timezone.ts'
import { HouseholdSettingsPage, useStanding } from './Page.tsx'
import { useFocusKept, useSaid, useStandingRefusal, type AskedProps } from './profile.ts'

/** The modules a household turns on and off, in the matrix's order: every one but its settings. */
const switched = matrixOrder.filter((module) => module !== 'admin')

/**
 * Turns a module on or off for the household, and keeps the answer in the list this screen
 * reads, so that the row says what is so before anything is read again. Then the household is
 * read again with what is filed under it: the member's own levels change with what is on, and
 * what lists their modules follows them.
 */
function useSwitch() {
  const api = useApi()
  const queries = useQueryClient()
  const household = useHousehold()
  const reread = useReread(household.id)
  return useMutation({
    ...askedNow,
    mutationFn: async ({ module, enabled }: { module: ModuleKey; enabled: boolean }) =>
      unwrap(
        await api.PATCH('/households/{household_id}/modules/{module}', {
          params: { path: { household_id: household.id, module } },
          body: { enabled },
        }),
      ),
    onSuccess: (saved, { module }) => {
      queries.setQueryData<ModuleState[]>(moduleStatesKey(household.id), (was) =>
        was?.map((each) => (each.module === module ? { ...each, ...saved } : each)),
      )
      void reread()
    },
  })
}

interface RowProps {
  readonly module: ModuleKey
  readonly enabled: boolean
  /** How many of the household's members hold it, of how many: undefined while they are unread. */
  readonly held: number | undefined
  readonly members: number
  /** Whether its control is drawn: for an owner, in a household that takes writes. */
  readonly changes: boolean
  /** Its control was pressed: what an earlier press came to is said no longer. */
  readonly onPress: () => void
  /** Asked to be turned off, which is asked about first. */
  readonly onTurnOff: () => void
  /** Turning it on was refused, or failed. */
  readonly onRefused: (error: unknown) => void
}

function ModuleRow({
  module,
  enabled,
  held,
  members,
  changes,
  onPress,
  onTurnOff,
  onRefused,
}: RowProps) {
  const t = useTranslate()
  const format = useFormat()
  const toast = useToast()
  // The row's own, so that one row's change under way keeps no other from being pressed.
  const turnOn = useSwitch()
  const name = t(`module.${module}.name`)
  return (
    <ListRow
      avatar={
        <span className={grants.glyph}>
          <ModuleIcon module={module} />
        </span>
      }
      title={name}
      secondary={
        enabled
          ? held === undefined
            ? undefined
            : t('household.modules.row.held', { held: format.number(held), count: members })
          : t('household.modules.row.off')
      }
      trailing={
        <>
          <span className={styles.badge}>
            {enabled ? t('household.modules.state.on') : t('household.modules.state.off')}
          </span>
          {changes ? (
            // One control, which says what it will do and is named for its module. It stays
            // where it is when the module is turned on or off, and the focus with it.
            <Button
              loading={turnOn.isPending}
              onClick={() => {
                onPress()
                if (enabled) {
                  onTurnOff()
                  return
                }
                turnOn.mutate(
                  { module, enabled: true },
                  {
                    onSuccess: () => {
                      toast({ message: t('household.modules.turn_on.done', { module: name }) })
                    },
                    onError: onRefused,
                  },
                )
              }}
            >
              <span className={a11y.visuallyHidden}>
                {enabled
                  ? t('household.modules.turn_off.named', { module: name })
                  : t('household.modules.turn_on.named', { module: name })}
              </span>
              <span aria-hidden="true">
                {enabled
                  ? t('household.modules.turn_off.word')
                  : t('household.modules.turn_on.word')}
              </span>
            </Button>
          ) : null}
        </>
      }
    />
  )
}

interface TurnOffProps extends AskedProps {
  readonly module: ModuleKey
  /** How many of the household's members hold it: undefined while they are unread. */
  readonly held: number | undefined
}

/** The confirmation: retention is no footnote of it, but all it says (FR-HA8). */
function TurnOff({ module, held, onClose, onEnded }: TurnOffProps) {
  const t = useTranslate()
  const toast = useToast()
  const say = useProblemText(useTimeZone())
  const standing = useStandingRefusal()
  const turnOff = useSwitch()
  const name = t(`module.${module}.name`)
  const close = () => {
    if (!turnOff.isPending) onClose()
  }
  return (
    <Dialog
      open
      onClose={close}
      title={t('household.modules.turn_off.title', { module: name })}
      description={`${
        held === undefined
          ? t('household.modules.turn_off.goes_unread')
          : t('household.modules.turn_off.goes', { count: held })
      } ${t('household.modules.turn_off.kept', { module: name })}`}
      actions={
        <>
          <Button onClick={close}>{t('account.cancel')}</Button>
          <Button
            variant="danger"
            loading={turnOff.isPending}
            onClick={() => {
              turnOff.mutate(
                { module, enabled: false },
                {
                  onSuccess: () => {
                    toast({ message: t('household.modules.turn_off.done', { module: name }) })
                    onClose()
                  },
                  onError: (error) => {
                    const ended = standing(error)
                    if (ended !== undefined) onEnded(ended)
                  },
                },
              )
            }}
          >
            {t('household.modules.turn_off.confirm', { module: name })}
          </Button>
        </>
      }
    >
      {turnOff.isError && standing(turnOff.error) === undefined ? (
        <Banner key={turnOff.submittedAt} tone="danger" announce>
          {say(turnOff.error)}
        </Banner>
      ) : undefined}
    </Dialog>
  )
}

export function Modules() {
  const t = useTranslate()
  const household = useHousehold()
  const { changes } = useStanding()
  const online = useOnline()
  const sayProblem = useProblemText(useTimeZone())
  const standing = useStandingRefusal()
  const read = useModuleStates(household.id)
  const people = useMembers(household.id).data
  const reread = useReread(household.id)
  const [confirming, setConfirming] = useState<ModuleKey | null>(null)
  const [said, say] = useSaid()
  const view = useFocusKept(changes, confirming)

  const enabled = new Set(
    (read.data ?? []).filter((each) => each.enabled === true).map((each) => each.module),
  )
  const listed = new Set((read.data ?? []).map((each) => each.module))
  /** How many members hold `module` above nothing, whatever the household has on. */
  const heldBy = (module: ModuleKey) =>
    people?.filter((member) => (member.grants?.[module] ?? 'none') !== 'none').length

  // Refused for where the member now stands: said, and the household read again, which then
  // draws no control for them. Any other failure is said, and changed nothing.
  const ended = (text: string) => {
    setConfirming(null)
    say(text)
    void reread()
  }
  const refused = (error: unknown) => {
    const text = standing(error)
    if (text === undefined) say(sayProblem(error))
    else ended(text)
  }

  return (
    <HouseholdSettingsPage
      title={t('household.settings.modules.title')}
      lead={t('household.modules.lead')}
    >
      <Banner tone="info" title={t('household.modules.kept.title')}>
        {t('household.modules.kept.body')}
      </Banner>
      {said === null ? null : (
        <Banner key={said.id} tone="danger" announce>
          {said.text}
        </Banner>
      )}
      {/* Where the focus goes when the controls that held it have left (profile.ts). */}
      <div ref={view} tabIndex={-1} className={styles.view}>
        <StateFrame
          state={readState(read, online)}
          skeleton={
            <Skeleton
              bars={[
                [40, 1.25],
                [60, 1],
                [45, 1.25],
                [60, 1],
                [35, 1.25],
                [60, 1],
              ]}
            />
          }
          // The same sixteen in every household: there is no list of none.
          empty={null}
          texts={{
            error: {
              title: t('household.modules.error.title'),
              text: t('household.modules.error.body'),
              actions: (
                <Button
                  onClick={() => {
                    void read.refetch()
                  }}
                >
                  {t('ui.retry')}
                </Button>
              ),
            },
            // Every member reads the list: it is taken back from nobody, and never drawn.
            withdrawn: { text: t('household.settings.withdrawn') },
          }}
        >
          {() => (
            <>
              <List label={t('household.settings.modules.title')}>
                {switched
                  .filter((module) => listed.has(module))
                  .map((module) => (
                    <ModuleRow
                      key={module}
                      module={module}
                      enabled={enabled.has(module)}
                      held={heldBy(module)}
                      members={people?.length ?? 0}
                      changes={changes}
                      onPress={() => {
                        say(null)
                      }}
                      onTurnOff={() => {
                        setConfirming(module)
                      }}
                      onRefused={refused}
                    />
                  ))}
              </List>
              <p className={styles.note}>
                {t('household.modules.sixteen', { module: t('module.admin.name') })}
              </p>
            </>
          )}
        </StateFrame>
      </div>

      {confirming === null ? null : (
        <TurnOff
          module={confirming}
          held={heldBy(confirming)}
          onClose={() => {
            setConfirming(null)
          }}
          onEnded={ended}
        />
      )}
    </HouseholdSettingsPage>
  )
}
