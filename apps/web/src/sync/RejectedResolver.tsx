// The rejected-mutation resolver (F-7, 06-clients §5): a change the server did not accept, with
// the actual reason in a sentence and what can be done about it, in a side panel. Nobody
// disagreed with anybody, so it is no comparison of authors: it shows what the member entered,
// which is kept in this browser until they decide, and beside it the neighbouring entry where
// the change was refused for being out of order with one.
//
// Retry writes the change again (`retry`), where sending it again could be accepted
// (rejection.ts): a change held for a household that does not write is sent by the replica
// itself when it does, and one too large to send is the same size the second time. Edit leads to
// the row's own editor, where its module gives the address. Discard gives the change up
// (`discard`), after a confirmation that names it. Each is this browser's own write (decide.tsx).
//
// In a household that does not write the panel reads and does not answer (FR-BI2), as the
// comparison of a conflict does: no control is drawn, the change stays where it is kept, and the
// panel says that what to do with it is decided once the household writes again. A choice
// between sending a change again and giving it up, with the first taken away, is no choice.
import type { RecordedOutcome, Replica } from '@household/sync'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { Banner } from '../ui/Banner.tsx'
import { Button } from '../ui/Button.tsx'
import { ModuleChip } from '../ui/Chip.tsx'
import { Dialog, Sheet } from '../ui/Dialog.tsx'
import { StatusMark } from '../ui/StatusMark.tsx'
import { useToast } from '../ui/Toast.tsx'
import type { ResolverProps } from './ConflictResolver.tsx'
import { TroubleBanner, useDecision } from './decide.tsx'
import { describers as appDescribers, read, type Describers } from './describe.ts'
import { rejectionOf } from './rejection.ts'
import { useReplica } from './ReplicaProvider.tsx'
import type { Setting } from './setting.ts'
import styles from './Sync.module.css'
import { Versions, type Version } from './Versions.tsx'
import { instantOf, pairsOf, useWords } from './words.ts'

interface OpenProps {
  readonly outcome: RecordedOutcome
  readonly replica: Replica
  readonly onClose: () => void
  readonly setting: Setting
  readonly describers: Describers
}

function RejectedSheet({ outcome, replica, onClose, setting, describers }: OpenProps) {
  const t = useTranslate()
  const toast = useToast()
  const navigate = useNavigate()
  const words = useWords(setting.timezone)
  const { busy, trouble, decide } = useDecision<'retry' | 'discard'>()
  const [confirming, setConfirming] = useState(false)
  const rejection = rejectionOf(outcome.code)
  const reading = useMemo(
    () => read(outcome, replica.registry, describers, words, setting.household),
    [outcome, replica, describers, words, setting.household],
  )
  const { address, name } = reading
  const deleted = outcome.op === 'delete'
  const when = instantOf(outcome.mutation.client_time, words)
  const versions: Version[] = [
    {
      heading: t('sync.change.yours'),
      notes: [
        ...(deleted ? [t('sync.version.deleted')] : []),
        ...(when === undefined ? [] : [when]),
      ],
      pairs: deleted ? [] : pairsOf(reading.fields, 'mine'),
    },
  ]
  // The entry the change is out of order with, as far as the answer carried it: its own values
  // for the fields the member entered, and nothing said of a field it does not carry.
  const beside = reading.fields.filter((field) => field.theirs !== undefined)
  if (rejection.neighbour && beside.length > 0) {
    versions.push({ heading: t('sync.rejected.neighbour'), pairs: pairsOf(beside, 'theirs') })
  }
  // Sent again only where that could be accepted: of a row this browser still holds.
  const retries = rejection.retry && trouble !== 'nothing'
  // Absent, and not disabled, in a household that does not write: nothing is answered there.
  const answers = !setting.writes ? undefined : (
    <>
      {retries ? (
        <Button
          variant="primary"
          loading={busy === 'retry'}
          onClick={() => {
            decide(
              'retry',
              () => replica.retry(outcome.mutation_id),
              () => {
                onClose()
                toast({ message: t('sync.rejected.retried', { name }) })
              },
            )
          }}
        >
          {t('ui.retry')}
        </Button>
      ) : null}
      {address === undefined ? null : (
        <Button
          onClick={() => {
            onClose()
            void navigate(address)
          }}
        >
          {t('sync.rejected.edit')}
        </Button>
      )}
      <Button
        variant="ghost"
        aria-disabled={busy !== null}
        onClick={() => {
          setConfirming(true)
        }}
      >
        {t('sync.rejected.discard')}
      </Button>
    </>
  )
  return (
    <Sheet open onClose={onClose} title={name} actions={answers}>
      <div className={styles.status}>
        {reading.module === undefined ? null : <ModuleChip module={reading.module} />}
        <StatusMark status="rejected" />
      </div>
      <p className={styles.sentence}>{t(rejection.reason)}</p>
      {/* A held change's own sentence says where it is kept, and that it goes by itself. */}
      {rejection.held ? null : <p className={styles.aside}>{t('sync.rejected.kept')}</p>}
      {/* And what is decided of any other waits for a household that writes. */}
      {setting.writes || rejection.held ? null : (
        <Banner tone="warning">{t('sync.rejected.readonly')}</Banner>
      )}
      <Versions versions={versions} />
      <TroubleBanner trouble={trouble} />
      <Dialog
        // Put away with the control it was opened from, should the household stop writing.
        open={confirming && setting.writes}
        onClose={() => {
          setConfirming(false)
        }}
        title={t('sync.discard.title', { name })}
        description={t('sync.discard.body')}
        actions={
          <>
            <Button
              onClick={() => {
                setConfirming(false)
              }}
            >
              {t('sync.discard.keep')}
            </Button>
            <Button
              variant="danger"
              loading={busy === 'discard'}
              onClick={() => {
                decide(
                  'discard',
                  async () => {
                    try {
                      await replica.discard(outcome.mutation_id)
                    } finally {
                      // Its answer is said in the panel, which the confirmation would cover.
                      setConfirming(false)
                    }
                    return true
                  },
                  () => {
                    onClose()
                    toast({ message: t('sync.rejected.discarded', { name }) })
                  },
                )
              }}
            >
              {t('sync.discard.confirm')}
            </Button>
          </>
        }
      />
    </Sheet>
  )
}

export function RejectedResolver({ outcome, onClose, setting, describers }: ResolverProps) {
  const replica = useReplica()
  if (outcome === undefined || replica === undefined) return null
  return (
    // A panel of its own for each answer: what was decided about one says nothing of the next.
    <RejectedSheet
      key={outcome.mutation_id}
      outcome={outcome}
      replica={replica}
      onClose={onClose}
      setting={setting}
      describers={describers ?? appDescribers}
    />
  )
}
