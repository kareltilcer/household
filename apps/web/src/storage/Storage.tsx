// Storage (C-54, `/households/{id}/settings/storage`; PRD 17 §5, FR-HA14; PRD 03 §3, FR-ST3 and
// FR-ST4; PRD 04 §4, FR-BI3 and FR-BI4): what the household stores against its allowance, so
// that an invoice is never the first place it learns the number. The total against the base and
// the blocks in effect; to an owner the month so far, the average it is projected to end on, the
// blocks that will be billed and what they cost; the trend of the daily samples; the split by
// module and by member; the copies derived from the files, named and counted in each module's
// line; and the largest items with what removing each would free. The server's notices of an
// allowance neared or used up link here, and the screen says what they said.
//
// The picture is what *Can see* on household settings unlocks (FR-AC3, D-167): a member who
// holds less is drawn the neutral *not available* and the server is asked nothing. Money is an
// owner's (FR-BI5): the month as it will be billed and the plan's own figures are asked for an
// owner alone, and anybody else reads bytes, the allowance, and the blocks in effect that their
// household's own row carries. The picture itself leaves out what its reader could not open
// (D-108), and says so where its lines then do not add up.
//
// What the prototype drew and is not here. Its links into a module's clean-up view, and *Add a
// file* on the empty state: no module has screens on the web yet (modules/registry.ts), and each
// brings its own. Who a largest item is by: the contract names no owner of one. *Ours, not yours*
// of the derived copies: they are billed as the files are (FR-ST3). And its word that a read-only
// household may tidy up to drop a block: a delete is a write, which such a household refuses, so
// of a household that takes no writes or no uploads the screen says in one sentence what that
// means for storage, and nothing of cleaning up. Nor is the count of objects drawn, which no
// requirement asks for and whose ceiling no answer carries.
//
// It writes nothing: there is no control on it but the one that reads it again.
//
// C-54's states. *Loading* is a skeleton; *error* the picture that did not load, with the way to
// read it again, which a read that waits for a connection with nothing kept is too; *offline* is
// the picture as this browser kept it. *Empty* is a household that stores nothing and, as far as
// its samples reach, never did: what most households are, so it teaches what is counted, what is
// included and how blocks are worked out, to an owner with the plan's figures. *Populated* is the
// picture. *Absent* is the member who holds nothing on household settings; *withdrawn* is that
// level lowered while the screen was open, which the picture's `404` says. *Read-only* is the
// picture under the sentence of what the state means for storage. *Pending*, *syncing*,
// *conflicted* and *rejected* have nothing to be: usage is measured on the server from daily
// samples, and nothing is written from here.
import { useMemo } from 'react'
import { readState, together, useFocusKept } from '../account/common.ts'
import account from '../account/Settings.module.css'
import { NotAvailable } from '../app/NotAvailable.tsx'
import { inHousehold } from '../app/paths.ts'
import { notTheirs, useRereadWhereRefused, useSubscription, useUsage } from '../household/data.ts'
import { useHousehold } from '../household/HouseholdContext.tsx'
import { HouseholdSettingsPage, useEverHeld, useStanding } from '../household/settings/Page.tsx'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { Banner } from '../ui/Banner.tsx'
import { Button } from '../ui/Button.tsx'
import { EmptyState } from '../ui/EmptyState.tsx'
import { useOnline } from '../ui/online.ts'
import { Skeleton } from '../ui/Skeleton.tsx'
import { StateFrame } from '../ui/StateFrame.tsx'
import type { DataState } from '../ui/states.ts'
import { usePicture } from './data.ts'
import { Counted, Picture, ThisMonth, type Month } from './Picture.tsx'
import { named, storesNothing } from './picture.ts'
import styles from './Storage.module.css'

/**
 * What the household's state means for storage, in one sentence, or undefined for a household
 * that takes uploads. Why it is in that state and what ends it are the shell's banner's to say.
 */
function useStateSentence(): string | undefined {
  const t = useTranslate()
  const { entitlement } = useHousehold()
  if (entitlement?.can_write === false) {
    return entitlement.state === 'restricted'
      ? t('storage.state.restricted')
      : t('storage.state.read_only')
  }
  return entitlement?.can_upload === false ? t('storage.state.no_uploads') : undefined
}

function Stored() {
  const t = useTranslate()
  const household = useHousehold()
  const standing = useStanding()
  const online = useOnline()
  const sentence = useStateSentence()

  const picture = usePicture(household.id, { enabled: standing.storage })
  const usage = useUsage(household.id, { enabled: standing.owner })
  const plan = useSubscription(household.id, { enabled: standing.owner })

  // A read's own refusal says where its reader stands now, whatever the household said when it
  // was read: the picture's, that their level on household settings was lowered, and an owner's
  // two, that they are an owner no longer. The household alone is read again, which is what
  // tells the rest of the app; read again with it, each would only be refused again.
  const lowered = standing.storage && notTheirs(picture)
  const demoted = standing.owner && (notTheirs(usage) || notTheirs(plan))
  useRereadWhereRefused(household.id, lowered || demoted)
  const withdrawn = !standing.storage || lowered
  // Somebody the server no longer answers as an owner reads the picture as a member does.
  const owner = standing.owner && !demoted

  const answered = picture.data
  const report = useMemo(() => (answered === undefined ? undefined : named(answered)), [answered])
  const month: Month | undefined =
    owner && usage.data !== undefined && plan.data !== undefined
      ? { usage: usage.data, plan: plan.data }
      : undefined
  // An owner's picture is three answers drawn as one body: the charge is no afterthought of it.
  const reads = owner ? [picture, usage, plan] : [picture]
  const base = readState(together(reads), online, report !== undefined && storesNothing(report))
  const state: DataState = withdrawn
    ? 'withdrawn'
    : !standing.writes && (base === 'populated' || base === 'offline')
      ? 'readonly'
      : base
  // The screen's one control, *Try again*, leaves with the sentence it stands in as soon as the
  // picture is asked for again, and the focus it held would drop to the page: it is put on the
  // picture's own place, where the skeleton and then the picture are drawn.
  const view = useFocusKept(state === 'error', state)

  return (
    // Nothing here is a member's to change: the settings' own note of who may is left out, and
    // what the household's state means for storage is said in the screen's own words.
    <HouseholdSettingsPage
      title={t('household.settings.storage.title')}
      lead={t('storage.lead')}
      note={false}
    >
      {/* Not announced: it was so when the screen opened. */}
      {sentence === undefined || withdrawn ? null : <Banner tone="warning">{sentence}</Banner>}
      <div ref={view} tabIndex={-1} className={account.view}>
        <StateFrame
          state={state}
          skeleton={
            <Skeleton
              bars={[
                [30, 1.25],
                [100, 1],
                [100, 1],
                [100, 0.5],
                [30, 1.25],
                [100, 5],
                [30, 1.25],
                [100, 1],
                [100, 1],
              ]}
            />
          }
          empty={
            report === undefined ? null : (
              <div className={styles.stack}>
                <EmptyState
                  sentence={t('storage.empty.sentence')}
                  example={t('storage.empty.example')}
                />
                {month === undefined ? null : <ThisMonth month={month} />}
                <Counted report={report} month={month} />
              </div>
            )
          }
          texts={{
            error: {
              title: t('storage.error.title'),
              text: t('storage.error.body'),
              actions: (
                <Button
                  onClick={() => {
                    for (const read of reads) if (read.data === undefined) void read.refetch()
                  }}
                >
                  {t('ui.retry')}
                </Button>
              ),
            },
            withdrawn: { text: t('household.settings.withdrawn') },
          }}
        >
          {() => (report === undefined ? null : <Picture report={report} month={month} />)}
        </StateFrame>
      </div>
    </HouseholdSettingsPage>
  )
}

export function Storage() {
  const household = useHousehold()
  const held = useEverHeld(useStanding().storage)
  // Absent: no picture, no reason, and nothing asked of the server.
  if (!held) return <NotAvailable home={inHousehold.home(household.id)} />
  return <Stored />
}
