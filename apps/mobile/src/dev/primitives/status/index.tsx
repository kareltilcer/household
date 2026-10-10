// The status section of the primitives dev screen: what says a state and what shows a household's
// data, each in every drawing it has, in both themes. The twelve states of each data body are the
// harness's; here stand the marks, the banners, the hold and the small parts a row is made of.
// Its words are fixtures (D-154); what a component says itself is the catalogs'.
import { statusGlyphs, type StatusId } from '@household/icons'
import type { Theme } from '@household/tokens/native'
import { useState, type ReactNode } from 'react'
import { View } from 'react-native'
import { ThemeScope, useTheme } from '../../../display/DisplayProvider.tsx'
import { Badge } from '../../../ui/Badge.tsx'
import { Banner, type BannerTone } from '../../../ui/Banner.tsx'
import { Button } from '../../../ui/Button.tsx'
import { Avatar, ModuleChip, Portrait } from '../../../ui/Chip.tsx'
import { EmptyState } from '../../../ui/EmptyState.tsx'
import { HoldToComplete } from '../../../ui/HoldToComplete.tsx'
import { List, ListRow } from '../../../ui/ListRow.tsx'
import { MetricTile } from '../../../ui/MetricTile.tsx'
import { OfflineBar } from '../../../ui/OfflineBar.tsx'
import { Skeleton } from '../../../ui/Skeleton.tsx'
import { StatusMark, SyncMark, syncStates } from '../../../ui/StatusMark.tsx'
import { Text } from '../../../ui/Text.tsx'
import { useSample } from '../../sample.ts'

const statuses = Object.keys(statusGlyphs) as StatusId[]
const tones: readonly BannerTone[] = ['neutral', 'info', 'warning', 'danger']
const themes: readonly Theme[] = ['light', 'dark']

/** A part of the section in one theme, on that theme's own ground. */
function Ground({ part, children }: { readonly part: string; readonly children: ReactNode }) {
  const theme = useTheme()
  return (
    <View
      testID={part}
      style={{
        gap: theme.space['space-15'],
        padding: theme.space['space-2'],
        backgroundColor: theme.color.surface,
      }}
    >
      {children}
    </View>
  )
}

/** A part of the section under its heading, drawn once in each theme. */
function Part({
  id,
  name,
  children,
}: {
  readonly id: string
  readonly name: string
  readonly children: ReactNode
}) {
  return (
    <>
      <Text step="title-3" header>
        {name}
      </Text>
      {themes.map((theme) => (
        <ThemeScope key={theme} theme={theme}>
          <Ground part={`status-section:${id}:${theme}`}>{children}</Ground>
        </ThemeScope>
      ))}
    </>
  )
}

function Row({ children }: { readonly children: ReactNode }) {
  const theme = useTheme()
  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: theme.space['space-15'],
      }}
    >
      {children}
    </View>
  )
}

/**
 * A row to be completed, and the way to have it to complete again: completed, a hold stays so,
 * and its row draws a fresh one by a key of its own.
 */
function Chore({
  title,
  onComplete,
}: {
  readonly title: string
  readonly onComplete: () => unknown
}) {
  const sample = useSample()
  const [round, setRound] = useState(0)
  return (
    <ListRow
      title={title}
      trailing={
        <Row>
          <HoldToComplete
            key={round}
            label={`${sample('Complete')} ${title}`}
            onComplete={onComplete}
          />
          <Button
            variant="ghost"
            onPress={() => {
              setRound((was) => was + 1)
            }}
          >
            {sample('Again')}
          </Button>
        </Row>
      }
    />
  )
}

/** A completion that takes as long as a slow write does. */
function slowly(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 1500)
  })
}

/** A completion the server refused. */
function refused(): Promise<void> {
  return Promise.reject(new Error('refused'))
}

export function StatusSection() {
  const sample = useSample()
  // A banner that may be put away is put away, and stays away until the screen is opened again.
  const [dismissed, setDismissed] = useState(false)
  return (
    <>
      <Part id="statuses" name={sample('Status')}>
        <Row>
          {statuses.map((status) => (
            <StatusMark key={status} status={status} />
          ))}
        </Row>
        <Row>
          {statuses.map((status) => (
            <StatusMark key={status} status={status} words="hidden" />
          ))}
        </Row>
      </Part>

      <Part id="marks" name={sample('Sync mark')}>
        <Row>
          {syncStates.map((state) => (
            <SyncMark key={state} state={state} />
          ))}
        </Row>
        <Row>
          <SyncMark
            state="conflict"
            name={sample('Electricity, cellar meter')}
            onOpen={() => undefined}
          />
          <SyncMark state="rejected" onOpen={() => undefined} />
          <SyncMark state="conflict" words="hidden" onOpen={() => undefined} />
        </Row>
      </Part>

      <Part id="banners" name={sample('Banner')}>
        {tones.map((tone) => (
          <Banner key={tone} tone={tone}>
            {sample('The trial ends in nine days.')}
          </Banner>
        ))}
        <Banner
          tone="danger"
          title={sample('Not accepted')}
          actions={
            <>
              <Button>{sample('Retry')}</Button>
              <Button>{sample('Edit')}</Button>
              <Button variant="ghost">{sample('Discard')}</Button>
            </>
          }
        >
          {sample('That reading is lower than the one on 3 March. Is it a rollover, or a typo?')}
        </Banner>
        {dismissed ? null : (
          <Banner
            tone="info"
            onDismiss={() => {
              setDismissed(true)
            }}
          >
            {sample('Your dashboard was reset to the household’s default.')}
          </Banner>
        )}
        <OfflineBar announce={false} />
        <OfflineBar
          announce={false}
          testID="offline-bar:not-receiving"
          sentence={sample('Changes made elsewhere are not arriving. Yours are kept.')}
        />
      </Part>

      <Part id="loading" name={sample('Skeleton and empty state')}>
        <Skeleton
          bars={[
            [58, 1],
            [34, 0.8125],
            [70, 1],
          ]}
        />
        <EmptyState
          composition="utilities.not_enough"
          sentence={sample('No readings on this meter yet.')}
          example={sample('Petr reads the cellar meter on the first of each month.')}
          action={<Button variant="primary">{sample('Add a reading')}</Button>}
        />
      </Part>

      <Part id="hold" name={sample('Hold to complete')}>
        <List label={sample('Chores')}>
          <Chore title={sample('Take out the bins')} onComplete={() => undefined} />
          <Chore title={sample('Water the tomatoes')} onComplete={slowly} />
          <Chore title={sample('Feed the cat')} onComplete={refused} />
        </List>
      </Part>

      <Part id="parts" name={sample('Chip, avatar and badge')}>
        <Row>
          <ModuleChip module="utilities" />
          <ModuleChip module="finance" />
          <ModuleChip module="garden" />
        </Row>
        <Row>
          <Avatar initials="P" tone={2} name={sample('Petr')} />
          <Avatar initials="JT" tone={5} name={sample('Jana Tilcerová')} />
          <Portrait address={null} name={sample('Marie Nováková')} tone={7} />
          <Badge count={3} label={sample('3 changes need your attention')} />
        </Row>
      </Part>

      <Part id="metric" name={sample('Not enough information')}>
        <MetricTile
          label={sample('Electricity, this period')}
          missing={sample('Two readings on the same meter produce the first figure.')}
          action={<Button>{sample('Add a reading')}</Button>}
        />
        <MetricTile label={sample('Gas, this period')} value="0" unit="m³" />
      </Part>
    </>
  )
}
