// This month's storage as it will be billed (FR-BI4; A-28's *what this month is made of*): what
// the household stores now, the month's average so far and where it is heading, what the plan
// includes, and the blocks and the charge that comes to. An owner's to read, before any invoice
// says it: "why was it this much" is answered here, without opening a PDF.
//
// Every figure is the server's (`getBillingUsage`): the page works out no block and no charge.
// The month is the calendar month, UTC's (D-130), and its days are shown as they are written.
// What the prototype added up and this does not is the month's total: storage is billed after
// its month, apart from a plan paid by the year, so no one sum is charged. The picture of what
// takes the room is Storage's (C-54), which this leads to.
//
// A household with no subscription is billed no storage, a month on trial or after a lapse
// among them: the charge its blocks would come to is nobody's to pay, so neither it nor when
// storage is billed is said there.
import { Link } from 'react-router'
import { readState } from '../account/common.ts'
import account from '../account/Settings.module.css'
import { inHousehold } from '../app/paths.ts'
import { useUsage, type Subscription } from '../household/data.ts'
import { useHousehold } from '../household/HouseholdContext.tsx'
import { Section } from '../household/settings/Page.tsx'
import { useFormat, useTranslate } from '../i18n/I18nProvider.tsx'
import { Button } from '../ui/Button.tsx'
import { KeyValue } from '../ui/KeyValue.tsx'
import { MoneyValue } from '../ui/MoneyValue.tsx'
import { useOnline } from '../ui/online.ts'
import { Skeleton } from '../ui/Skeleton.tsx'
import { StateFrame } from '../ui/StateFrame.tsx'
import styles from './Billing.module.css'
import { useFocusKept } from './parts.tsx'

export function Usage({ subscription }: { readonly subscription: Subscription }) {
  const t = useTranslate()
  const format = useFormat()
  const online = useOnline()
  const household = useHousehold()
  const read = useUsage(household.id)
  const usage = read.data
  // Whether storage is billed at all: only a household with a subscription is charged for it.
  const billed = subscription.interval !== null
  // *Try again* gives its place to the skeleton as it is pressed, with the focus on it: it goes
  // to the section's own place. The screen's does not see it, not being drawn again for this read.
  const place = useFocusKept()
  return (
    <Section title={t('billing.usage.title')}>
      <div ref={place} tabIndex={-1} className={styles.place}>
        <StateFrame
          state={readState(read, online)}
          skeleton={
            <Skeleton
              bars={[
                [70, 1],
                [55, 1],
                [60, 1],
                [45, 1],
              ]}
            />
          }
          // A month always has its figures: nothing is listed that could be none.
          empty={null}
          texts={{
            error: {
              text: t('billing.usage.error'),
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
            withdrawn: { text: t('household.settings.withdrawn') },
          }}
        >
          {() =>
            usage === undefined ? null : (
              <>
                <KeyValue
                  pairs={[
                    {
                      key: t('billing.usage.month'),
                      value: t('billing.usage.period', {
                        from: format.day(usage.period_from),
                        to: format.day(usage.period_to),
                      }),
                    },
                    {
                      key: t('billing.usage.now'),
                      value: format.bytes(usage.current_bytes),
                      numeric: true,
                    },
                    {
                      key: t('billing.usage.average'),
                      value: format.bytes(usage.mtd_average_bytes),
                      numeric: true,
                    },
                    {
                      key: t('billing.usage.projected'),
                      value: format.bytes(usage.projected_average_bytes),
                      numeric: true,
                    },
                    {
                      key: t('billing.usage.included'),
                      value: format.bytes(usage.included_bytes_base),
                      numeric: true,
                    },
                    {
                      key: t('billing.usage.blocks'),
                      value:
                        usage.blocks_projected === 0
                          ? t('billing.usage.blocks_none')
                          : t('billing.usage.blocks_count', {
                              count: usage.blocks_projected,
                              size: format.bytes(subscription.storage_block_bytes),
                            }),
                    },
                    ...(billed
                      ? [
                          {
                            key: t('billing.usage.charge'),
                            value: <MoneyValue amount={usage.projected_charge} />,
                          },
                        ]
                      : []),
                  ]}
                />
                {billed ? <p className={account.note}>{t('billing.usage.note')}</p> : null}
                <Link className={account.link} to={inHousehold.storage(household.id)}>
                  {t('household.settings.storage.title')}
                </Link>
              </>
            )
          }
        </StateFrame>
      </div>
    </Section>
  )
}
