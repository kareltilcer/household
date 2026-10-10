// The rejected-mutation resolver (F-7, 06-clients §5): a change the server did not accept, with
// the actual reason in a sentence and what can be done about it, in a sheet. Nobody disagreed
// with anybody, so it is no comparison of authors: it shows what the member entered, which is
// kept on this device until they decide, and beside it the neighbouring entry where the change
// was refused for being out of order with one. The web's panel is its twin
// (apps/web/src/sync/RejectedResolver.tsx).
//
// Retry writes the change again (`retry`), where sending it again could be accepted
// (rejection.ts): a change held for a household that does not write is sent by the replica
// itself when it does, and one too large to send is the same size the second time. Edit leads to
// the row's own editor, where its module gives the address. Discard gives the change up
// (`discard`), after a confirmation that names it. Each is this device's own write (decide.tsx).
//
// In a household that does not write, sending a change again and editing it are absent
// (FR-BI2): either would be a write the household refuses. Discard stays. A change that was not
// accepted is this device's own, and giving it up asks nothing of the server; and a change held
// for a household that does not write is offered for replay, which its member must be able to
// decline before the replica sends it by itself, months later, once the household writes again.
// The sheet says so: what cannot be done now, what can, and that the rest waits. The comparison
// of a conflict is otherwise (ConflictResolver.tsx): there neither answer is drawn, since
// choosing either version is a write.
//
// The confirmation is drawn inside the sheet: iOS presents a modal from the one it stands in,
// and refuses a second from the screen beneath. And the sheet stays until the confirmation has
// gone from the screen, whatever its owner says meanwhile: told to leave while the modal it
// presented is still leaving, iOS may keep it where it is.
import { router } from 'expo-router'
import { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useTheme } from '../display/DisplayProvider.tsx'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { Banner } from '../ui/Banner.tsx'
import { Button } from '../ui/Button.tsx'
import { ModuleChip } from '../ui/Chip.tsx'
import { Dialog } from '../ui/Dialog.tsx'
import { Sheet } from '../ui/Sheet.tsx'
import { StatusMark } from '../ui/StatusMark.tsx'
import { Text } from '../ui/Text.tsx'
import { useToast } from '../ui/Toast.tsx'
import type { SheetProps } from './ConflictResolver.tsx'
import { TroubleBanner, useDecision } from './decide.tsx'
import { read } from './describe.ts'
import { rejectionOf } from './rejection.ts'
import { Versions, type Version } from './Versions.tsx'
import { instantOf, pairsOf, useWords } from './words.ts'

export function RejectedSheet({
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
  const { busy, trouble, decide } = useDecision<'retry' | 'discard'>()
  const [confirming, setConfirming] = useState(false)
  // Whether the confirmation is on the screen still: from when it is opened until the platform
  // says it has gone.
  const [covered, setCovered] = useState(false)
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
  // Sent again only where that could be accepted: by a household that writes, of a row this
  // device still holds. Absent, and not disabled, where it could not.
  const retries = rejection.retry && setting.writes && trouble !== 'nothing'
  const answers = (
    <>
      {retries ? (
        <Button
          testID="resolver:retry"
          variant="primary"
          loading={busy === 'retry'}
          onPress={() => {
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
      {address === undefined || !setting.writes ? null : (
        <Button
          testID="resolver:edit"
          onPress={() => {
            onClose()
            router.push(address)
          }}
        >
          {t('sync.rejected.edit')}
        </Button>
      )}
      <Button
        testID="resolver:discard"
        variant="ghost"
        idle={busy !== null}
        onPress={() => {
          setConfirming(true)
          setCovered(true)
        }}
      >
        {t('sync.rejected.discard')}
      </Button>
    </>
  )
  return (
    <Sheet
      testID="resolver"
      open={open || covered}
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
        <StatusMark status="rejected" />
      </View>
      <Text step="body-lg">{t(rejection.reason)}</Text>
      {/* A held change's own sentence says where it is kept, and that it goes by itself. */}
      {rejection.held ? null : (
        <Text step="caption" color="text-muted">
          {t('device.sync.rejected.kept')}
        </Text>
      )}
      {/* And of any other, what can be done with it now and what waits for a household that
          writes. */}
      {setting.writes || rejection.held ? null : (
        <Banner tone="warning">{t('sync.rejected.readonly')}</Banner>
      )}
      <Versions versions={versions} />
      <TroubleBanner trouble={trouble} />
      <Dialog
        testID="resolver:confirm"
        open={confirming}
        onClose={() => {
          setConfirming(false)
        }}
        onClosed={() => {
          setCovered(false)
        }}
        title={t('sync.discard.title', { name })}
        description={t('sync.discard.body')}
        actions={
          <>
            <Button
              testID="resolver:confirm:keep"
              onPress={() => {
                setConfirming(false)
              }}
            >
              {t('sync.discard.keep')}
            </Button>
            <Button
              testID="resolver:confirm:discard"
              variant="danger"
              loading={busy === 'discard'}
              onPress={() => {
                decide(
                  'discard',
                  async () => {
                    try {
                      await replica.discard(outcome.mutation_id)
                    } finally {
                      // What it came to is said in the sheet, which the confirmation would cover.
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
