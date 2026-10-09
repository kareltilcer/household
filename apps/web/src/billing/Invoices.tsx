// The invoices (PRD 04 §6; D-135; A-28's invoice history): each with its number, the day it was
// issued and the days it is for, how it stands in words, its total and the tax in it, and every
// line it is made of, the base fee and a month's storage apart, so that a total is explained
// where it is read.
//
// An invoice is its payer's. The payer reads theirs, an owner who paid before handing billing on
// still reads theirs, and an owner who paid none is answered `403`, which is drawn as nothing: no
// heading, no reason. The days are UTC's, shown as they are written (D-109).
//
// The PDF is the processor's own file, at a link that is read as it is asked for and never kept
// (D-135): *Download* reads that one invoice and leaves for its link, which is in no query and
// in nothing this browser keeps. While the processor cannot be asked the invoice has no link,
// and the row says so.
//
// What the prototype said and this does not: that the first invoice arrives the day after the
// household subscribes, which is charged at once (D-131). The empty state says what an invoice
// will hold, and offers nothing: there is nothing to do about having none.
import type { BaseId } from '@household/icons'
import { BaseIcon } from '@household/icons/web'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { readState, useData } from '../account/common.ts'
import account from '../account/Settings.module.css'
import { useApi } from '../api/ApiProvider.tsx'
import { problemIn, unwrap } from '../api/problem.ts'
import { askedNow } from '../api/query.ts'
import { useHousehold } from '../household/HouseholdContext.tsx'
import { Section } from '../household/settings/Page.tsx'
import { useFormat, useTranslate } from '../i18n/I18nProvider.tsx'
import { Button, RowAction } from '../ui/Button.tsx'
import { EmptyState } from '../ui/EmptyState.tsx'
import { List } from '../ui/ListRow.tsx'
import { MoneyValue } from '../ui/MoneyValue.tsx'
import { useOnline } from '../ui/online.ts'
import { Skeleton } from '../ui/Skeleton.tsx'
import { StateFrame } from '../ui/StateFrame.tsx'
import styles from './Billing.module.css'
import { useInvoices, type Invoice } from './data.ts'
import { Refused, useRefusals } from './parts.tsx'
import { leaveFor } from './stripe.ts'

type Status = Invoice['status']
type LineKind = Invoice['lines'][number]['kind']

/** The glyph and the tone that stand beside each status's words. */
const marks: Readonly<Record<Status, { readonly tone: string; readonly glyph: BaseId }>> = {
  draft: { tone: 'muted', glyph: 'pencil' },
  open: { tone: 'warning', glyph: 'clock' },
  paid: { tone: 'positive', glyph: 'check' },
  uncollectible: { tone: 'danger', glyph: 'alert-circle' },
  void: { tone: 'muted', glyph: 'x' },
}

function Row({
  invoice,
  downloading,
  onDownload,
}: {
  readonly invoice: Invoice
  readonly downloading: boolean
  readonly onDownload: () => void
}) {
  const t = useTranslate()
  const format = useFormat()
  const asWritten = useData()
  const issued = format.day(invoice.issued_on)
  // The processor's own number for it, which is data and no word, as is what it wrote of a line.
  const number = invoice.number === null ? null : asWritten(invoice.number)
  // How it stands and what a line is, in words: the contract's own names are drawn nowhere.
  const stands = (status: Status): string => {
    switch (status) {
      case 'draft':
        return t('billing.invoices.status.draft')
      case 'open':
        return t('billing.invoices.status.open')
      case 'paid':
        return t('billing.invoices.status.paid')
      case 'uncollectible':
        return t('billing.invoices.status.uncollectible')
      case 'void':
        return t('billing.invoices.status.void')
    }
  }
  const kind = (line: LineKind): string => {
    switch (line) {
      case 'base':
        return t('billing.invoices.line.base')
      case 'storage_blocks':
        return t('billing.invoices.line.storage')
      case 'credit':
        return t('billing.invoices.line.credit')
      case 'adjustment':
        return t('billing.invoices.line.adjustment')
    }
  }
  const mark = marks[invoice.status]
  return (
    <li className={styles.invoice}>
      <div className={styles.about}>
        <span className={account.strong}>
          {number === null
            ? t('billing.invoices.unnumbered', { day: issued })
            : t('billing.invoices.numbered', { number })}
        </span>
        <p className={styles.status}>
          <span className={styles.statusGlyph} data-tone={mark.tone}>
            <BaseIcon name={mark.glyph} size={16} />
          </span>
          <span>{stands(invoice.status)}</span>
        </p>
        <p className={account.note}>
          {t('billing.invoices.issued', {
            day: issued,
            from: format.day(invoice.period_from),
            to: format.day(invoice.period_to),
          })}
        </p>
        <ul className={styles.lines} role="list">
          {invoice.lines.map((line, index) => (
            // A line is its place on its invoice: two may say the same thing.
            <li key={index} className={styles.line}>
              <span className={styles.lineAbout}>
                <span>{kind(line.kind)}</span>
                <span className={account.note}>{asWritten(line.description)}</span>
              </span>
              <MoneyValue amount={line.amount} />
            </li>
          ))}
          <li className={styles.line}>
            <span className={styles.lineAbout}>
              <span className={account.strong}>{t('billing.invoices.total')}</span>
              {invoice.tax.amount_minor === 0 ? null : (
                <span className={account.note}>
                  {t('billing.invoices.tax', { tax: format.money(invoice.tax) })}
                </span>
              )}
            </span>
            <MoneyValue amount={invoice.total} />
          </li>
        </ul>
      </div>
      <div className={account.actions}>
        <RowAction
          name={
            number === null
              ? t('billing.invoices.download.named_day', { day: issued })
              : t('billing.invoices.download.named', { number })
          }
          word={t('billing.invoices.download.word')}
          loading={downloading}
          onPress={onDownload}
        />
      </div>
    </li>
  )
}

export interface InvoicesProps {
  /** Whether the reader pays for the household now: the one who is told they have none yet. */
  readonly payer: boolean
}

export function Invoices({ payer }: InvoicesProps) {
  const t = useTranslate()
  const api = useApi()
  const online = useOnline()
  const household = useHousehold()
  const refusals = useRefusals(household.id)
  const read = useInvoices(household.id)
  const invoices = read.data?.pages.flatMap((page) => page.items)
  // The invoices being asked for, each row busy for as long as its own is on its way.
  const [asked, setAsked] = useState<readonly string[]>([])

  const download = useMutation({
    ...askedNow,
    mutationFn: async (invoice: string) =>
      unwrap(
        await api.GET('/households/{household_id}/billing/invoices/{invoice_id}', {
          params: { path: { household_id: household.id, invoice_id: invoice } },
        }),
      ),
    onSettled: (_answer, _error, invoice) => {
      setAsked((ids) => ids.filter((each) => each !== invoice))
    },
    onSuccess: (answer) => {
      // The processor could not be asked for the link, or gave one that is no address to follow.
      if (answer.pdf_url === null || !leaveFor(answer.pdf_url)) {
        refusals.say(t('billing.invoices.download.unavailable'))
      }
    },
    onError: (error) => {
      refusals.refuse(error)
    },
  })

  // Somebody who paid none: no invoice is theirs to read, and nothing says there would be any.
  const none = problemIn(read.error)?.status === 403
  if (none) return null
  // An owner who does not pay is drawn the invoices they paid once, and nothing until they are
  // read: for most there are none, and a skeleton would promise some.
  if (!payer && (invoices === undefined || invoices.length === 0)) return null

  return (
    <Section title={t('billing.invoices.title')}>
      <StateFrame
        state={readState(read, online, invoices?.length === 0)}
        skeleton={
          <Skeleton
            bars={[
              [40, 1.25],
              [70, 1],
              [90, 1],
              [40, 1.25],
              [70, 1],
            ]}
          />
        }
        empty={<EmptyState sentence={t('billing.invoices.empty')} />}
        texts={{
          error: {
            text: t('billing.invoices.error'),
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
        {() => (
          <>
            <Refused said={refusals.refused} />
            <List label={t('billing.invoices.title')}>
              {(invoices ?? []).map((invoice) => (
                <Row
                  key={invoice.id}
                  invoice={invoice}
                  downloading={asked.includes(invoice.id)}
                  onDownload={() => {
                    refusals.clear()
                    setAsked((ids) => [...ids, invoice.id])
                    download.mutate(invoice.id)
                  }}
                />
              ))}
            </List>
            {read.hasNextPage ? (
              <div className={account.actions}>
                <Button
                  loading={read.isFetchingNextPage}
                  onClick={() => {
                    void read.fetchNextPage()
                  }}
                >
                  {t('billing.invoices.more')}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </StateFrame>
    </Section>
  )
}
