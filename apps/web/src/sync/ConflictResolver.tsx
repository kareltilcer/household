// The conflict resolver (F-6, 06-clients §5, D-39): two versions of one row, and the question of
// which is right, in a side panel. Both values, both authors, both times, and no jargon: the
// member's version is what their change set and when their device made it, the other is the row
// the server answered with, whose `updated_by` and `updated_at` say who and when. The PRD's
// example asks in one sentence, "You set the amount to 450. Petr set it to 500 at 18:40. Which is
// right?", which a sentence built from any field's label and any member's name cannot be in five
// languages: the panel asks which version is right, and the two versions say the rest, each
// under its author's name.
//
// *Keep mine* writes the member's change again against the row as it now stands (`retry`), and
// *Keep theirs* gives it up (`discard`): both are this browser's own writes (decide.tsx). There
// is no third control for a value that is neither. That is the row's own editor, which the panel
// leads to where the row's module gives its address. In a household that does not write, the
// member's version cannot be sent, so only the other can be kept, and the panel says why.
import type { RecordedOutcome, Replica } from '@household/sync'
import { useMemo } from 'react'
import { useNavigate } from 'react-router'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { Banner } from '../ui/Banner.tsx'
import { Button } from '../ui/Button.tsx'
import { ModuleChip } from '../ui/Chip.tsx'
import { Sheet } from '../ui/Dialog.tsx'
import { StatusMark } from '../ui/StatusMark.tsx'
import { useToast } from '../ui/Toast.tsx'
import { TroubleBanner, useDecision } from './decide.tsx'
import { describers as appDescribers, read, rowOf, type Describers } from './describe.ts'
import { useReplica } from './ReplicaProvider.tsx'
import type { Setting } from './setting.ts'
import styles from './Sync.module.css'
import { Versions, type Version } from './Versions.tsx'
import { authorName, instantOf, pairsOf, useWords } from './words.ts'

export interface ResolverProps {
  /** The answer it is about. Left out, it is closed. */
  readonly outcome: RecordedOutcome | undefined
  /** Asked to close: by the member, or by their decision once it is made. */
  readonly onClose: () => void
  readonly setting: Setting
  /** How a module describes its rows. Left out, the app's own; a test and the dev page give theirs. */
  readonly describers?: Describers | undefined
}

interface OpenProps {
  readonly outcome: RecordedOutcome
  readonly replica: Replica
  readonly onClose: () => void
  readonly setting: Setting
  readonly describers: Describers
}

/** The lines under a version's heading: that it is a deletion, and when it was made. */
function notes(deleted: boolean, when: string | undefined, deletedWord: string): string[] {
  return [...(deleted ? [deletedWord] : []), ...(when === undefined ? [] : [when])]
}

function ConflictSheet({ outcome, replica, onClose, setting, describers }: OpenProps) {
  const t = useTranslate()
  const toast = useToast()
  const navigate = useNavigate()
  const words = useWords(setting.timezone)
  const { busy, trouble, decide } = useDecision<'mine' | 'theirs'>()
  const reading = useMemo(
    () => read(outcome, replica.registry, describers, words, setting.household),
    [outcome, replica, describers, words, setting.household],
  )
  const row = rowOf(outcome)
  const deletedWord = t('sync.version.deleted')
  const mineDeleted = outcome.op === 'delete'
  const theirsDeleted = typeof row?.deleted_at === 'string'
  const versions: Version[] = [
    {
      heading: t('sync.conflict.mine'),
      notes: notes(mineDeleted, instantOf(outcome.mutation.client_time, words), deletedWord),
      pairs: mineDeleted ? [] : pairsOf(reading.fields, 'mine'),
    },
    {
      heading: authorName(setting.author(row?.updated_by), t),
      notes: notes(theirsDeleted, instantOf(row?.updated_at, words), deletedWord),
      pairs: theirsDeleted ? [] : pairsOf(reading.fields, 'theirs'),
    },
  ]
  const { address, name } = reading
  // The member's version is sent again only where it can be: by a household that writes, of a
  // row this browser still holds.
  const mine = setting.writes && trouble !== 'nothing'
  return (
    <Sheet
      open
      onClose={onClose}
      title={name}
      actions={
        <>
          {mine ? (
            <Button
              loading={busy === 'mine'}
              aria-disabled={busy === 'theirs'}
              onClick={() => {
                decide(
                  'mine',
                  () => replica.retry(outcome.mutation_id),
                  () => {
                    onClose()
                    toast({ message: t('sync.conflict.kept_mine', { name }) })
                  },
                )
              }}
            >
              {t('sync.conflict.keep_mine')}
            </Button>
          ) : null}
          <Button
            loading={busy === 'theirs'}
            aria-disabled={busy === 'mine'}
            onClick={() => {
              decide(
                'theirs',
                async () => {
                  await replica.discard(outcome.mutation_id)
                  return true
                },
                () => {
                  onClose()
                  toast({ message: t('sync.conflict.kept_theirs', { name }) })
                },
              )
            }}
          >
            {t('sync.conflict.keep_theirs')}
          </Button>
        </>
      }
    >
      <div className={styles.status}>
        {reading.module === undefined ? null : <ModuleChip module={reading.module} />}
        <StatusMark status="conflict" />
      </div>
      <p className={styles.sentence}>{t('sync.conflict.question')}</p>
      {setting.writes ? null : <Banner tone="warning">{t('sync.conflict.readonly')}</Banner>}
      <Versions versions={versions} />
      {address === undefined || !setting.writes ? null : (
        <div className={styles.stack}>
          <p className={styles.aside}>{t('sync.conflict.neither')}</p>
          <Button
            variant="ghost"
            onClick={() => {
              onClose()
              void navigate(address)
            }}
          >
            {t('sync.row.open')}
          </Button>
        </div>
      )}
      <TroubleBanner trouble={trouble} />
    </Sheet>
  )
}

export function ConflictResolver({ outcome, onClose, setting, describers }: ResolverProps) {
  const replica = useReplica()
  if (outcome === undefined || replica === undefined) return null
  return (
    // A panel of its own for each answer: what was decided about one says nothing of the next.
    <ConflictSheet
      key={outcome.mutation_id}
      outcome={outcome}
      replica={replica}
      onClose={onClose}
      setting={setting}
      describers={describers ?? appDescribers}
    />
  )
}
