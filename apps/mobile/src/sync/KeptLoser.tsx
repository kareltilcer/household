// The kept loser (03-patterns §1, D-39, D-122): what a `merged` answer asks a member to see, as
// a banner. It is "here it is", and not a question: the row stands as the server holds it,
// nothing waits on the member, and the one thing to do is put it away (`resolve`). The web's is
// its twin (apps/web/src/sync/KeptLoser.tsx).
//
// A merge is the answer to a write that landed over a change its writer had not seen (D-122), so
// the banner speaks to that writer, and says one of two things (ADR 0019):
//
// - A field they set is not what the row now holds. What they entered is shown beside what is
//   saved, and it is kept on this device alone, so the banner says to take what is still needed
//   before putting it away.
// - Their write replaced the whole row of an entity that keeps its loser (`lww_row`: a note's
//   body). The version it replaced is the other author's, and the row's module keeps it, not the
//   answer: the banner says that it was kept, and leads to the row where its module gives the
//   address. For how long a module keeps a loser is the module's to say on its own screen.
//
// What is said aloud as it arrives is its title and its sentence. The two versions under them
// are met by whoever reads on: a banner's words are a string, and what else it holds is not.
import type { RecordedOutcome } from '@household/sync'
import { router } from 'expo-router'
import { useMemo } from 'react'
import { View } from 'react-native'
import { useTheme } from '../display/DisplayProvider.tsx'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { Banner } from '../ui/Banner.tsx'
import { Button } from '../ui/Button.tsx'
import { Text } from '../ui/Text.tsx'
import { TroubleBanner, useDecision } from './decide.tsx'
import { describers as appDescribers, read, type Describers } from './describe.ts'
import { useReplica } from './ReplicaProvider.tsx'
import type { Setting } from './setting.ts'
import { VersionBlock } from './Versions.tsx'
import { pairsOf, useWords } from './words.ts'

/** Whether a merge overrode a field its writer set, and so has something of theirs to show. */
export function overrode(outcome: RecordedOutcome): boolean {
  return outcome.overridden.length > 0
}

export interface KeptLoserProps {
  /** The `merged` answer it is about. */
  readonly outcome: RecordedOutcome
  readonly setting: Setting
  /** How a module describes its rows. Left out, the app's own; a test and the dev screen give theirs. */
  readonly describers?: Describers | undefined
  /** Whether it is announced as it appears: on a screen the answer arrived at while it was open. */
  readonly announce?: boolean
}

export function KeptLoser({ outcome, setting, describers, announce = false }: KeptLoserProps) {
  const t = useTranslate()
  const theme = useTheme()
  const replica = useReplica()
  const words = useWords(setting.timezone)
  const { busy, trouble, decide } = useDecision<'away'>()
  const known = describers ?? appDescribers
  const reading = useMemo(
    () =>
      replica === undefined
        ? undefined
        : read(outcome, replica.registry, known, words, setting.household),
    [outcome, replica, known, words, setting.household],
  )
  if (replica === undefined || reading === undefined) return null
  const { address } = reading
  const fields = overrode(outcome)
  return (
    <Banner
      tone="info"
      testID="sync:kept"
      title={t(fields ? 'sync.kept.overridden.title' : 'sync.kept.replaced.title')}
      announce={announce}
      detail={
        <View style={{ gap: theme.space['space-15'] }}>
          {fields ? (
            <>
              <VersionBlock
                headed={false}
                version={{ heading: t('sync.kept.mine'), pairs: pairsOf(reading.fields, 'mine') }}
              />
              <VersionBlock
                headed={false}
                version={{
                  heading: t('sync.kept.saved'),
                  pairs: pairsOf(reading.fields, 'theirs'),
                }}
              />
              <Text step="caption" color="text-muted">
                {t('sync.kept.hint')}
              </Text>
            </>
          ) : null}
          <TroubleBanner trouble={trouble} />
        </View>
      }
      actions={
        <>
          {address === undefined ? null : (
            <Button
              testID="sync:kept:open"
              onPress={() => {
                router.push(address)
              }}
            >
              {t('sync.row.open')}
            </Button>
          )}
          <Button
            testID="sync:kept:put-away"
            loading={busy === 'away'}
            onPress={() => {
              decide(
                'away',
                async () => {
                  await replica.resolve(outcome.mutation_id)
                  return true
                },
                // It leaves with the answer, which whoever drew it no longer holds.
                () => undefined,
              )
            }}
          >
            {t('sync.kept.put_away')}
          </Button>
        </>
      }
    >
      {t(fields ? 'sync.kept.overridden.text' : 'sync.kept.replaced.text')}
    </Banner>
  )
}
