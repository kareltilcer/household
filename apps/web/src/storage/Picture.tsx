// The sections of the storage picture (C-54), which the screen draws once its answers are read
// (Storage.tsx): what is stored against the allowance, the month as it will be billed, the split
// by module and by member, the largest items, and how storage is counted. Each figure is one an
// answer carries: no allowance, block, price or ceiling is written here or in a message.
//
// Money is an owner's (FR-BI5). `month` is the two answers only an owner is given, the month's
// usage and the plan's own figures, and is undefined for anybody else: they read bytes, the
// allowance, and the blocks in effect that their household's own row carries.
//
// A share is drawn beside the figure that says it and is never the only carrier of it: the
// drawing is hidden from assistive technology, and at 200 % text the words take the room.
import { ModuleIcon } from '@household/icons/web'
import account from '../account/Settings.module.css'
import type { Subscription, UsageSummary } from '../household/data.ts'
import { useHousehold } from '../household/HouseholdContext.tsx'
import { Section } from '../household/settings/Page.tsx'
import { useFormat, useTranslate } from '../i18n/I18nProvider.tsx'
import { Banner } from '../ui/Banner.tsx'
import { KeyValue, type Pair } from '../ui/KeyValue.tsx'
import { List } from '../ui/ListRow.tsx'
import { MoneyValue } from '../ui/MoneyValue.tsx'
import type { StorageReport } from './data.ts'
import { derivedBytes, hasUnlisted, moduleBytes, standingOf, unattributedBytes } from './picture.ts'
import { useSize } from './sizes.ts'
import styles from './Storage.module.css'
import { Trend } from './Trend.tsx'

/** The month as it will be billed, and the plan's own figures: what an owner alone is answered. */
export interface Month {
  readonly usage: UsageSummary
  readonly plan: Subscription
}

export interface PictureProps {
  readonly report: StorageReport
  /** An owner's: undefined for a member, who reads no money. */
  readonly month: Month | undefined
}

/** The width a share is drawn in, and the height of its bar, in the drawing's own units. */
const whole = 100
const thick = 4

/**
 * `share` of a whole, 0 to 1, as a bar. Decoration: the figure it stands under says the same. A
 * share of nothing draws the empty well, and one past the whole fills it.
 */
function Share({ share }: { readonly share: number }) {
  const held = Math.min(1, Math.max(0, share)) * whole
  return (
    <svg
      className={styles.share}
      viewBox={`0 0 ${String(whole)} ${String(thick)}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <rect className={styles.well} width={whole} height={thick} />
      {held > 0 ? <rect className={styles.held} width={held} height={thick} /> : null}
    </svg>
  )
}

/**
 * Where what is stored stands against the allowance, to an owner, in the words the server's own
 * notice of it uses (FR-BI3): near it, at it, or at the most a household may store. Each is of
 * a household that takes uploads: for one that takes none the screen's own sentence says so, and
 * *uploads still work* would not be true beside it.
 */
function Threshold({
  report,
  month: { usage, plan },
}: {
  readonly report: StorageReport
  readonly month: Month
}) {
  const t = useTranslate()
  const size = useSize()
  const household = useHousehold()
  if (household.entitlement?.can_upload === false) return null
  switch (standingOf(report, usage)) {
    case 'under':
      return null
    case 'near':
      return (
        <Banner tone="info" title={t('storage.near.title')}>
          {usage.blocks_now >= plan.max_storage_blocks
            ? t('storage.near.body_last')
            : t('storage.near.body')}
        </Banner>
      )
    case 'reached':
      return (
        <Banner tone="warning" title={t('storage.reached.title')}>
          {t('storage.reached.body')}
        </Banner>
      )
    case 'ceiling':
      return (
        <Banner tone="warning" title={t('storage.ceiling.title')}>
          {t('storage.ceiling.body', { ceiling: size(usage.hard_ceiling_bytes) })}
        </Banner>
      )
  }
}

/** What is stored now against the allowance, the base and the blocks in effect. */
function Now({ report, month }: PictureProps) {
  const t = useTranslate()
  const format = useFormat()
  const size = useSize()
  const household = useHousehold()
  // An owner reads the blocks with the month they are worked out from, below. Anybody else
  // reads the ones in effect off the household as they read it.
  const blocks = month === undefined ? household.entitlement?.storage_blocks : undefined
  const share = report.included_bytes > 0 ? report.total_bytes / report.included_bytes : 0
  const pairs: Pair[] = [
    { key: t('storage.now.stored'), value: size(report.total_bytes), numeric: true },
    { key: t('storage.now.allowance'), value: size(report.included_bytes), numeric: true },
    ...(blocks === undefined
      ? []
      : [{ key: t('storage.now.blocks'), value: t('storage.blocks', { count: blocks }) }]),
  ]
  return (
    <Section title={t('storage.now.title')} note={t('storage.now.note')}>
      <KeyValue pairs={pairs} />
      <Share share={share} />
      <p className={account.text}>{t('storage.now.share', { share: format.percent(share) })}</p>
      {month === undefined ? null : <Threshold report={report} month={month} />}
    </Section>
  )
}

/**
 * The calendar month, UTC's, as it stands and as it will be billed (FR-BI4): the average of its
 * daily samples so far, the average it is projected to end on, the blocks each needs, what the
 * projected ones cost, and how far the average is from a block more and a block fewer. An owner's.
 */
export function ThisMonth({ month: { usage, plan } }: { readonly month: Month }) {
  const t = useTranslate()
  const format = useFormat()
  const size = useSize()
  const pairs: Pair[] = [
    { key: t('storage.month.average'), value: size(usage.mtd_average_bytes), numeric: true },
    { key: t('storage.month.blocks_now'), value: t('storage.blocks', { count: usage.blocks_now }) },
    {
      key: t('storage.month.projected'),
      value: size(usage.projected_average_bytes),
      numeric: true,
    },
    {
      key: t('storage.month.blocks_projected'),
      value: t('storage.blocks', { count: usage.blocks_projected }),
    },
    { key: t('storage.month.charge'), value: <MoneyValue amount={usage.projected_charge} /> },
    {
      key: t('storage.month.price'),
      value: t('storage.month.price_value', {
        price: format.money(plan.price_per_storage_block),
        size: size(plan.storage_block_bytes),
      }),
    },
  ]
  return (
    <Section
      title={t('storage.month.title')}
      note={t('storage.month.period', {
        from: format.day(usage.period_from),
        to: format.day(usage.period_to),
      })}
    >
      <KeyValue pairs={pairs} />
      <p className={account.text}>{t('storage.rule')}</p>
      <p className={account.text}>{t('storage.month.assumes')}</p>
      {/* A month is billed to a household whose subscription was its own before the month
          ended (PRD 04 §4): the charge above is what the blocks come to, and is said not to
          be owed where nothing would bill it. */}
      {plan.interval === null ? (
        <p className={account.text}>{t('storage.month.unsubscribed')}</p>
      ) : null}
      {usage.blocks_now >= plan.max_storage_blocks ? (
        <p className={account.text}>{t('storage.month.all_blocks')}</p>
      ) : usage.bytes_to_next_block > 0 ? (
        <p className={account.text}>
          {t('storage.month.next', { size: size(usage.bytes_to_next_block) })}
        </p>
      ) : null}
      {usage.bytes_to_drop_a_block == null || usage.bytes_to_drop_a_block <= 0 ? null : (
        <p className={account.text}>
          {t('storage.month.drop', { size: size(usage.bytes_to_drop_a_block) })}
        </p>
      )}
    </Section>
  )
}

/**
 * The split by module: a line for each module that keeps files and its reader can see, the
 * largest first as the server lists them, each saying how much of it is copies derived from the
 * files. A module the reader cannot see, or the household has off, has no line though the total
 * counts it (D-108), and where that is so the lines are said not to add up.
 */
function ByModule({ report }: { readonly report: StorageReport }) {
  const t = useTranslate()
  const size = useSize()
  const derived = derivedBytes(report)
  return (
    <Section title={t('storage.modules.title')}>
      {report.by_module.length === 0 ? (
        <p className={account.text}>{t('storage.modules.none')}</p>
      ) : (
        <>
          <List label={t('storage.modules.title')}>
            {report.by_module.map((line) => (
              <li key={line.module} className={styles.row}>
                <span className={styles.glyph}>
                  <ModuleIcon module={line.module} />
                </span>
                <div className={styles.about}>
                  <div className={styles.line}>
                    <span className={styles.name}>{t(`module.${line.module}.name`)}</span>
                    <span className={styles.figure}>{size(moduleBytes(line))}</span>
                  </div>
                  <Share share={moduleBytes(line) / report.total_bytes} />
                  {line.derived_bytes > 0 ? (
                    <p className={styles.detail}>
                      {t('storage.modules.split', {
                        files: size(line.bytes),
                        derived: size(line.derived_bytes),
                      })}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </List>
          {derived > 0 ? (
            <p className={account.text}>{t('storage.modules.derived', { size: size(derived) })}</p>
          ) : null}
          {hasUnlisted(report) ? <p className={account.note}>{t('storage.modules.rest')}</p> : null}
        </>
      )}
    </Section>
  )
}

/**
 * The split by member: whose the files are, the largest first, every byte that has an owner
 * whatever its reader sees. Somebody who has left is still named, and said to have left; an
 * account that was erased has no name left, and is a former member.
 */
function ByMember({ report }: { readonly report: StorageReport }) {
  const t = useTranslate()
  const size = useSize()
  const rest = unattributedBytes(report)
  return (
    <Section title={t('storage.members.title')} note={t('storage.members.note')}>
      {report.by_member.length === 0 ? null : (
        <List label={t('storage.members.title')}>
          {report.by_member.map((line, index) => {
            const name = line.user.label ?? ''
            return (
              <li key={line.user.user_id ?? index} className={styles.row}>
                <div className={styles.about}>
                  <div className={styles.line}>
                    <span className={styles.whom}>
                      <span className={styles.name}>
                        {name === '' ? t('storage.members.former') : name}
                      </span>
                      {name !== '' && line.user.is_former_member === true ? (
                        <span className={account.badge}>{t('storage.members.left')}</span>
                      ) : null}
                    </span>
                    <span className={styles.figure}>{size(line.bytes)}</span>
                  </div>
                  <Share share={line.bytes / report.total_bytes} />
                </div>
              </li>
            )
          })}
        </List>
      )}
      {rest > 0 ? (
        <p className={account.note}>{t('storage.members.rest', { size: size(rest) })}</p>
      ) : null}
    </Section>
  )
}

/**
 * The largest items the reader may open, by what removing each would free: its file and every
 * copy derived from it (FR-ST4). An item is named as its module names it, or by its file's name,
 * and by neither where it has none. Nothing here opens it: no module has screens on the web yet.
 */
function Largest({ report }: { readonly report: StorageReport }) {
  const t = useTranslate()
  const size = useSize()
  return (
    <Section title={t('storage.largest.title')} note={t('storage.largest.note')}>
      {report.largest.length === 0 ? (
        <p className={account.text}>{t('storage.largest.none')}</p>
      ) : (
        // In their order, which is what the list is of: a list by its role too (ui/ListRow).
        <ol className={styles.ranked} role="list" aria-label={t('storage.largest.title')}>
          {report.largest.map((item) => (
            <li key={`${item.module}/${item.entity_id}`} className={styles.row}>
              <div className={styles.about}>
                <span className={styles.name}>
                  {item.label === '' ? t('storage.largest.unnamed') : item.label}
                </span>
                <span>{t('storage.largest.frees', { size: size(item.recoverable_bytes) })}</span>
                <span className={styles.detail}>
                  {t('storage.largest.file', {
                    module: t(`module.${item.module}.name`),
                    size: size(item.bytes),
                  })}
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Section>
  )
}

/**
 * How storage is counted, to whoever reads the picture and wherever nothing is stored yet: what
 * counts, what the plan includes and how blocks are added. An owner is told the plan's own
 * figures; anybody else the allowance they are answered, and no price.
 */
export function Counted({ report, month }: PictureProps) {
  const t = useTranslate()
  const format = useFormat()
  const size = useSize()
  return (
    <Section title={t('storage.counted.title')}>
      <p className={account.text}>{t('storage.counted.what')}</p>
      {month === undefined ? (
        <>
          <p className={account.text}>
            {t('storage.counted.blocks', { allowance: size(report.included_bytes) })}
          </p>
          {/* An owner reads it with the month it is about. */}
          <p className={account.text}>{t('storage.rule')}</p>
        </>
      ) : (
        <p className={account.text}>
          {t('storage.counted.plan', {
            base: size(month.plan.included_storage_bytes),
            block: size(month.plan.storage_block_bytes),
            price: format.money(month.plan.price_per_storage_block),
            count: month.plan.max_storage_blocks,
            ceiling: size(month.usage.hard_ceiling_bytes),
          })}
        </p>
      )}
    </Section>
  )
}

/** The picture of a household that stores something, or did within its trend's reach. */
export function Picture({ report, month }: PictureProps) {
  // With nothing stored now there is nothing to split and no item to list: the trend says what
  // was stored, and an owner's month what it comes to.
  const stores = report.total_bytes > 0
  return (
    <div className={styles.stack}>
      <Now report={report} month={month} />
      {month === undefined ? null : <ThisMonth month={month} />}
      <Trend trend={report.trend} />
      {stores ? <ByModule report={report} /> : null}
      {stores ? <ByMember report={report} /> : null}
      {stores ? <Largest report={report} /> : null}
      <Counted report={report} month={month} />
    </div>
  )
}
