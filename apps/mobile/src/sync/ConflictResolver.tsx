// The conflict resolver (F-6, 06-clients §5, D-39): two versions of one row, and the question of
// which is right, in a sheet. Both values, both authors, both times, and no jargon: the member's
// version is what their change set and when their device made it, the other is the row the
// server answered with, whose `updated_by` and `updated_at` say who and when. The PRD's example
// asks in one sentence, "You set the amount to 450. Petr set it to 500 at 18:40. Which is
// right?", which a sentence built from any field's label and any member's name cannot be in five
// languages: the sheet asks which version is right, and the two versions say the rest, each
// under its author's name. The web's panel is its twin (apps/web/src/sync/ConflictResolver.tsx).
//
// *Keep mine* writes the member's change again against the row as it now stands (`retry`), and
// *Keep theirs* gives it up (`discard`): both are this device's own writes (decide.tsx). There
// is no third control for a value that is neither. That is the row's own editor, which the sheet
// leads to where the row's module gives its address. In a household that does not write the
// sheet reads and does not answer (FR-BI2): the member's version could not be sent, and a
// question with one of its two answers taken away is no question, so neither control is drawn,
// the sheet says why, and the conflict waits as it is until the household writes again.
import type { RecordedOutcome, Replica } from '@household/sync'
import { router } from 'expo-router'
import { useMemo } from 'react'
import { View } from 'react-native'
import { useTheme } from '../display/DisplayProvider.tsx'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import type { Focusable } from '../ui/announce.ts'
import { Banner } from '../ui/Banner.tsx'
import { Button } from '../ui/Button.tsx'
import { ModuleChip } from '../ui/Chip.tsx'
import { Sheet } from '../ui/Sheet.tsx'
import { StatusMark } from '../ui/StatusMark.tsx'
import { Text } from '../ui/Text.tsx'
import { useToast } from '../ui/Toast.tsx'
import { TroubleBanner, useDecision } from './decide.tsx'
import { read, rowOf, type Describers } from './describe.ts'
import type { Setting } from './setting.ts'
import { Versions, type Version } from './Versions.tsx'
import { authorName, instantOf, pairsOf, useWords } from './words.ts'

export interface ResolverProps {
  /** The answer it is about. Left out, it is closed. */
  readonly outcome: RecordedOutcome | undefined
  /** Asked to close: by the member, or by their decision once it is made. */
  readonly onClose: () => void
  /** Told once it has gone from the screen: what must not begin while it is still leaving. */
  readonly onClosed?: (() => void) | undefined
  readonly setting: Setting
  /** How a module describes its rows. Left out, the app's own; a test and the dev screen give theirs. */
  readonly describers?: Describers | undefined
  /** The control it was opened from, which the focus is given back to where it is still there. */
  readonly opener?: Focusable | undefined
}

/** What a resolver's sheet is handed once there is an answer to show and a replica to answer in. */
export interface SheetProps {
  readonly outcome: RecordedOutcome
  /** Whether it is open. It is drawn closed while it leaves, and says when it has gone. */
  readonly open: boolean
  readonly replica: Replica
  readonly onClose: () => void
  readonly onClosed: () => void
  readonly setting: Setting
  readonly describers: Describers
  readonly opener: Focusable | undefined
}

/** The lines under a version's heading: that it is a deletion, and when it was made. */
function notes(deleted: boolean, when: string | undefined, deletedWord: string): string[] {
  return [...(deleted ? [deletedWord] : []), ...(when === undefined ? [] : [when])]
}

export function ConflictSheet({
  outcome,
  open,
  replica,
  onClose,
  onClosed,
  setting,
  describers,
  opener,
}: SheetProps) {
  const t = useTranslate()
  const theme = useTheme()
  const toast = useToast()
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
  // The member's version is sent again only where it can be: of a row this device still holds.
  const mine = trouble !== 'nothing'
  // Absent, and not disabled, in a household that does not write: nothing is answered there.
  const answers = !setting.writes ? undefined : (
    <>
      {mine ? (
        <Button
          testID="resolver:keep-mine"
          loading={busy === 'mine'}
          idle={busy === 'theirs'}
          onPress={() => {
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
        testID="resolver:keep-theirs"
        loading={busy === 'theirs'}
        idle={busy === 'mine'}
        onPress={() => {
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
  )
  return (
    <Sheet
      testID="resolver"
      open={open}
      onClose={onClose}
      onClosed={onClosed}
      title={name}
      actions={answers}
      {...(opener === undefined ? {} : { opener })}
    >
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          columnGap: theme.space['space-15'],
          rowGap: theme.space['space-1'],
        }}
      >
        {reading.module === undefined ? null : <ModuleChip module={reading.module} />}
        <StatusMark status="conflict" />
      </View>
      <Text step="body-lg">{t('sync.conflict.question')}</Text>
      {setting.writes ? null : <Banner tone="warning">{t('device.sync.conflict.readonly')}</Banner>}
      <Versions versions={versions} />
      {address === undefined || !setting.writes ? null : (
        <View style={{ alignItems: 'flex-start', gap: theme.space['space-1'] }}>
          <Text step="caption" color="text-muted">
            {t('sync.conflict.neither')}
          </Text>
          <Button
            testID="resolver:open"
            variant="ghost"
            onPress={() => {
              onClose()
              router.push(address)
            }}
          >
            {t('sync.row.open')}
          </Button>
        </View>
      )}
      <TroubleBanner trouble={trouble} />
    </Sheet>
  )
}
