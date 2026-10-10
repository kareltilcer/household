// The eight bodies, each drawn from the app's own components with sample household content
// (model.ts says why that content is a fixture and no part of the catalogs). A body is told the
// sync mark its affected row carries and whether the affordances that write are drawn, and draws
// nothing else of a state: the frame around it does the rest.
import { money } from '@household/domain'
import type { ReactNode } from 'react'
import { View } from 'react-native'
import { useTheme } from '../../display/DisplayProvider.tsx'
import type { Formatters } from '../../i18n/format.ts'
import { useFormat } from '../../i18n/I18nProvider.tsx'
import { Button } from '../../ui/Button.tsx'
import { Composition, Flow, TimeSeries } from '../../ui/charts/Charts.tsx'
import { Avatar, ModuleChip } from '../../ui/Chip.tsx'
import { KeyValue } from '../../ui/KeyValue.tsx'
import { List, ListRow } from '../../ui/ListRow.tsx'
import { MetricTile } from '../../ui/MetricTile.tsx'
import { MoneyValue } from '../../ui/MoneyValue.tsx'
import { SearchResultRow } from '../../ui/SearchResultRow.tsx'
import type { BodyContext } from '../../ui/StateFrame.tsx'
import { SyncMark } from '../../ui/StatusMark.tsx'
import type { Sample } from '../sample.ts'
import type { BodyId, VariantId } from './model.ts'

interface BodyProps extends BodyContext {
  readonly sample: Sample
  readonly variant?: VariantId | undefined
}

/**
 * The mark of a body that has no rows to carry one: beside the body, as a control where the
 * state is one a member opens (a conflict's comparison), and as words where it is not.
 */
function Marked({ mark, children }: Pick<BodyContext, 'mark'> & { readonly children: ReactNode }) {
  const theme = useTheme()
  return (
    <View style={{ alignItems: 'stretch', gap: theme.space['space-1'] }}>
      {mark === undefined ? null : (
        <View style={{ alignItems: 'flex-start' }}>
          <SyncMark state={mark} {...(mark === 'conflict' ? { onOpen: () => undefined } : {})} />
        </View>
      )}
      {children}
    </View>
  )
}

function ListBody({ mark, writes, sample }: BodyProps) {
  const open = writes ? <Button variant="ghost">{sample('Open')}</Button> : undefined
  return (
    <List label={sample('Meters')}>
      <ListRow
        title={sample('Electricity, cellar meter')}
        secondary={sample('18 402 kWh · read 3 March by Petr')}
        avatar={<Avatar initials="P" tone={2} />}
        chip={<ModuleChip module="utilities" />}
        mark={mark}
        onOpenMark={mark === 'conflict' ? () => undefined : undefined}
        trailing={open}
      />
      <ListRow
        title={sample('Gas, hallway meter')}
        secondary={sample('4 118 m³ · read 3 March by Petr')}
        avatar={<Avatar initials="P" tone={2} />}
        trailing={open}
      />
      <ListRow
        title={sample('Water, garden tap')}
        secondary={sample('No reading this period')}
        avatar={<Avatar initials="M" tone={5} />}
        trailing={open}
      />
    </List>
  )
}

function distance(format: Formatters, kilometres: number): string {
  return format.number(kilometres, { style: 'unit', unit: 'kilometer' })
}

/** A car's plate, as its record holds it: letters and figures, and no word of any language. */
const plate = '5AZ 4471'

function KeyValueBody({ mark, sample }: BodyProps) {
  const format = useFormat()
  return (
    <Marked mark={mark}>
      <KeyValue
        pairs={[
          { key: sample('Registration'), value: plate, numeric: true },
          { key: sample('Next STK'), value: format.day('2027-05-14', 'long') },
          { key: sample('Insurance'), value: sample('Kooperativa · notice 6 weeks') },
          { key: sample('Odometer'), value: distance(format, 148320), numeric: true },
          { key: sample('Tyres changed') },
        ]}
      />
    </Marked>
  )
}

function MoneyBody({ mark, variant }: BodyProps) {
  return (
    <Marked mark={mark}>
      {variant === 'money-negative' ? (
        <MoneyValue amount={money(-34000, 'CZK')} large />
      ) : (
        <MoneyValue
          amount={money(124000, 'CZK')}
          conversion={{ original: money(4860, 'EUR'), rate: '25.52', day: '2026-03-02' }}
          large
        />
      )}
    </Marked>
  )
}

/** The meter's own unit, as its record names it: a symbol, and no word of any language. */
const kilowattHours = 'kWh'

function MetricBody({ mark, writes, sample, variant }: BodyProps) {
  const format = useFormat()
  return (
    <Marked mark={mark}>
      {variant === 'metric-none' ? (
        <MetricTile
          label={sample('Electricity, this period')}
          missing={sample('Two readings on the same meter produce the first figure.')}
          action={writes ? <Button>{sample('Add a reading')}</Button> : undefined}
        />
      ) : (
        <MetricTile
          label={sample('Electricity, this period')}
          value={format.number(412)}
          unit={kilowattHours}
          trend={{ direction: 'up', text: sample('6 % more than last period') }}
        />
      )}
    </Marked>
  )
}

const consumption = [
  { month: 'Oct', kwh: 46 },
  { month: 'Nov', kwh: 58 },
  { month: 'Dec', kwh: 74 },
  { month: 'Jan', kwh: 88 },
  { month: 'Feb', kwh: 79, estimated: true },
  { month: 'Mar', kwh: 62 },
] as const

function SeriesBody({ mark, sample }: BodyProps) {
  const format = useFormat()
  return (
    <Marked mark={mark}>
      <TimeSeries
        caption={sample('kWh per month')}
        approximate
        points={consumption.map((point) => ({
          label: sample(point.month),
          value: point.kwh,
          text: `${format.number(point.kwh)} ${kilowattHours}`,
          estimated: 'estimated' in point,
        }))}
      />
    </Marked>
  )
}

function CompositionBody({ mark, sample }: BodyProps) {
  const format = useFormat()
  const megabyte = 1_000_000
  return (
    <Marked mark={mark}>
      <Composition
        caption={sample('Storage by module')}
        total={sample('4.1 GB of 10 GB')}
        segments={[
          { label: sample('Documents'), share: 0.44, text: format.bytes(1800 * megabyte) },
          { label: sample('Chat'), share: 0.24, text: format.bytes(980 * megabyte) },
          { label: sample('Garden photos'), share: 0.18, text: format.bytes(740 * megabyte) },
          { label: sample('Overhead (derived)'), share: 0.14, text: format.bytes(560 * megabyte) },
        ]}
      />
    </Marked>
  )
}

function FlowBody({ mark, sample }: BodyProps) {
  const format = useFormat()
  const crowns = (amount: number) => format.money(money(amount * 100, 'CZK'))
  return (
    <Marked mark={mark}>
      <Flow
        caption={sample('March, in and out')}
        total={`${crowns(73000)} · ${crowns(73000)}`}
        sourcesLabel={sample('Income')}
        sources={[
          { label: sample('Jana, salary'), text: crowns(42000) },
          { label: sample('Petr, salary'), text: crowns(31000) },
        ]}
        targetsLabel={sample('Accounts')}
        targets={[
          { label: sample('Household account'), text: crowns(48000) },
          { label: sample('Savings'), text: crowns(15000) },
          { label: sample('Personal, remainder'), text: crowns(10000) },
        ]}
      />
    </Marked>
  )
}

function SearchBody({ mark, sample, variant }: BodyProps) {
  return (
    <Marked mark={mark}>
      <SearchResultRow
        module="documents"
        entityType={sample('Document')}
        title={sample('Insurance, house contents 2026')}
        snippet={
          variant === 'search-bare'
            ? null
            : sample('…policy number CZ-448 201, renewal 1 June, notice period six weeks…')
        }
        path={variant === 'search-unfiled' ? null : sample('Documents / House / Insurance')}
        updatedAt="2026-03-04T09:12:00+01:00"
        timeZone="Europe/Prague"
      />
    </Marked>
  )
}

const components: Readonly<Record<BodyId, (props: BodyProps) => ReactNode>> = {
  list: ListBody,
  kv: KeyValueBody,
  money: MoneyBody,
  metric: MetricBody,
  series: SeriesBody,
  composition: CompositionBody,
  flow: FlowBody,
  search: SearchBody,
}

/** One body, as a state's treatment leaves it. */
export function BodyOf({ body, ...props }: BodyProps & { readonly body: BodyId }) {
  const Component = components[body]
  return (
    <View testID={`body:${body}`}>
      <Component {...props} />
    </View>
  )
}
