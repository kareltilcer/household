// The exports their reader asked for, and the control that asks for another (PRD 05 §3, FR-PR2,
// D-139): the body of a household's export screen (A-35) and of the first right in the privacy
// centre (A-34), which differ in where they ask (exports.ts) and in their words, and in nothing
// else.
//
// What it says is what the server keeps of a job, and no more. A job has a state and no
// progress: it waits, it is being made, it is ready, it failed or it expired, each in words of
// the catalog's and never the contract's. No time left is drawn, there being none to read: one
// is "usually ready within a day". While one is on its way the control that asks is absent,
// since the server would answer the same job, and the list is asked for again every few
// seconds, which the browser holds back while the page is hidden; what the job then came to is
// said in a toast. The email that says an export is ready goes to a verified address alone, so
// an account without one is told to look here instead. One thing a ready job says is not the
// job's alone: until when it downloads is the earlier of its own last moment and the moment its
// household goes, a household's archives being removed with it.
//
// *Download* is no link kept on the page. An archive's link is good for minutes and each read of
// its job renews it, so the press reads the job again and hands the browser the link it then
// carries (leave.ts). One that is ready and carries none is a household's whose requester has
// been made a member since: only an owner downloads a household's export, which the row says,
// and the household is read again, by which the control that asks leaves too.
//
// Its states, for a list that is read and a request asked at once: *loading*, *populated* and
// *error* are the read's; *empty* teaches what an export is, with the control that asks for one
// where its reader may; *offline* is the list as this browser kept it, and a press that says it
// could not reach the server; *syncing* is an export on its way, its row saying which of the
// two it is; *absent* is the asking, for a reader who may not ask, with what its screen says in
// its place. *Pending* has nothing to be, an export being the server's work and never a change
// held here to be sent later; nor has *conflicted*, a snapshot disagreeing with nothing; nor
// *rejected*, a refused request being said where it was pressed; nor *withdrawn*, an export
// staying its requester's whatever they hold. *Read-only* changes nothing here: asking for an
// export is one of the writes the gate lets through (FR-BI1).
import type { BaseId } from '@household/icons'
import { BaseIcon } from '@household/icons/web'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, type ReactNode } from 'react'
import {
  readState,
  useData,
  usePartFocusKept,
  useNoWithdrawal,
  useSaid,
} from '../account/common.ts'
import account from '../account/Settings.module.css'
import { useProblemText } from '../api/problemText.ts'
import { askedNow } from '../api/query.ts'
import { notTheirs, useRereadWhereRefused } from '../household/data.ts'
import { useFormat, useTranslate } from '../i18n/I18nProvider.tsx'
import { useMe } from '../session/SessionProvider.tsx'
import a11y from '../ui/a11y.module.css'
import { Banner } from '../ui/Banner.tsx'
import { Button } from '../ui/Button.tsx'
import { cx } from '../ui/cx.ts'
import { EmptyState } from '../ui/EmptyState.tsx'
import { List } from '../ui/ListRow.tsx'
import { useOnline } from '../ui/online.ts'
import { Skeleton } from '../ui/Skeleton.tsx'
import { StateFrame } from '../ui/StateFrame.tsx'
import type { DataState } from '../ui/states.ts'
import { useToast } from '../ui/Toast.tsx'
import {
  entryOf,
  listed,
  statusOf,
  underWay,
  type ExportSource,
  type ExportStatus,
  type Listed,
} from './exports.ts'
import { leaveFor } from './leave.ts'
import styles from './Privacy.module.css'

/**
 * How often the list is asked for again while an export is on its way: nothing tells the page
 * that one is ready, so it asks.
 */
export const askAgainEvery = 5000

/** The glyph that stands beside each state's words: decoration, the words saying all of it. */
const glyphs: Readonly<Record<ExportStatus, BaseId>> = {
  queued: 'clock',
  running: 'archive',
  ready: 'check',
  failed: 'alert-circle',
  expired: 'calendar-days',
}

/** What an archive's entry is, in a line, where its name says. */
function useEntryLine(): (name: string) => string | undefined {
  const t = useTranslate()
  return (name) => {
    const entry = entryOf(name)
    switch (entry?.kind) {
      case undefined:
        return undefined
      case 'manifest':
        return t('data.exports.entry.manifest')
      case 'account':
        return t('data.exports.entry.account')
      case 'households':
        return t('data.exports.entry.households')
      case 'files':
        return t('data.exports.entry.files')
      case 'calendar':
        return t('data.exports.entry.calendar')
      case 'spreadsheet':
        return t('data.exports.entry.spreadsheet')
      case 'notes':
        return t('data.exports.entry.notes')
      case 'chat':
        return t('data.exports.entry.chat')
      case 'activity':
        return t('data.exports.entry.activity')
      case 'module':
        return t('data.exports.entry.module', { module: t(`module.${entry.module}.name`) })
    }
  }
}

function Row({
  job,
  zone,
  goes,
  unlinked,
  downloading,
  held,
  onDownload,
}: {
  readonly job: Listed
  readonly zone: string
  /** The moment its household goes, or null: for a job of no household's, or of one that stays. */
  readonly goes: string | null
  readonly unlinked: string | undefined
  /** Whether its own download is being asked for. */
  readonly downloading: boolean
  /** Whether another row's is: this one takes no press until that is answered. */
  readonly held: boolean
  readonly onDownload: () => void
}) {
  const t = useTranslate()
  const format = useFormat()
  const asWritten = useData()
  const line = useEntryLine()
  const status = statusOf(job)
  const when = job.requested_at === undefined ? '' : format.instant(job.requested_at, zone)
  const ends = job.expires_at ?? null
  // A household's archives are removed with the household, whatever last moment a job names for
  // itself: one that is ready can be downloaded until whichever of the two comes first.
  const last =
    status === 'ready' && goes !== null && (ends === null || Date.parse(goes) < Date.parse(ends))
      ? goes
      : ends
  // The moment, and not its day alone: an archive is gone at that time of the day, and on the
  // day itself *until* would be read as the whole of it.
  const until = last === null ? undefined : format.instant(last, zone)
  const contents = job.contents ?? []

  // How it stands, in words: the contract's own names for it are drawn nowhere.
  const stands = (): string => {
    switch (status) {
      case 'queued':
        return t('data.exports.status.queued')
      case 'running':
        return t('data.exports.status.running')
      case 'ready':
        return t('data.exports.status.ready')
      case 'failed':
        return t('data.exports.status.failed')
      case 'expired':
        return t('data.exports.status.expired')
    }
  }
  // What follows from it, where anything does that the server gave the day or the reason for.
  const follows = (): string | undefined => {
    switch (status) {
      case 'ready':
        if (!job.linked) return unlinked
        return until === undefined ? undefined : t('data.exports.detail.until', { day: until })
      case 'failed':
        return t('data.exports.detail.failed')
      case 'expired':
        return until === undefined ? undefined : t('data.exports.detail.expired', { day: until })
      case 'queued':
      case 'running':
        return undefined
    }
  }
  const detail = follows()
  const made = status === 'ready' || status === 'expired'

  return (
    <li className={styles.row}>
      <div className={styles.about}>
        <span className={styles.when}>{t('data.exports.asked_at', { when })}</span>
        <p className={styles.status}>
          <span className={styles.glyph}>
            <BaseIcon name={glyphs[status]} size={16} />
          </span>
          <span>{stands()}</span>
        </p>
        {detail === undefined ? null : <p className={styles.detail}>{detail}</p>}
        {made && typeof job.size_bytes === 'number' ? (
          <p className={styles.detail}>
            {t('data.exports.size', { size: format.bytes(job.size_bytes) })}
          </p>
        ) : null}
        {status === 'ready' && contents.length > 0 ? (
          <details className={styles.contents}>
            <summary>{t('data.exports.contents')}</summary>
            <ul className={styles.entries} role="list">
              {contents.map((name) => {
                const says = line(name)
                return (
                  <li key={name} className={styles.entry}>
                    {/* The archive's own name for it, which is data, and is shown. */}
                    <span className={styles.name}>{asWritten(name)}</span>
                    {says === undefined ? null : <span className={styles.detail}>{says}</span>}
                  </li>
                )
              })}
            </ul>
          </details>
        ) : null}
      </div>
      {status === 'ready' && job.linked ? (
        <div className={styles.actions}>
          {/* A row's own control, named for what it acts on and drawn as the one word, written
              out as `RowAction` writes it for the one thing that has not: it takes no press
              while another row's download is being asked for. */}
          <Button loading={downloading} aria-disabled={held} onClick={onDownload}>
            <span className={a11y.visuallyHidden}>
              {t('data.exports.download.named', { when })}
            </span>
            <span aria-hidden="true">{t('data.exports.download.word')}</span>
          </Button>
        </div>
      ) : null}
    </li>
  )
}

export interface ExportListProps {
  /** Where the list is read, asked for and read again: a household's, or the member's own. */
  readonly source: ExportSource
  /** The zone its instants are said in: the household's as its member reads it, or their own. */
  readonly zone: string
  /**
   * The moment the household whose exports these are goes, where they are a household's and it
   * has one: its archives go with it, so one that is ready names the earlier of this and its own
   * last moment. The account's own exports are no household's, and are given none.
   */
  readonly goes?: string | null
  /** Whether its reader may ask for an export. */
  readonly asks: boolean
  /** What the control that asks reads. */
  readonly ask: string
  /** The teaching empty state: what an export is, and one example of what is in it. */
  readonly teaches: { readonly sentence: string; readonly example: string }
  /** In the control's place, for a reader who may not ask: whose it is, and their own way on. */
  readonly instead?: ReactNode
  /**
   * What a ready export says that was handed no link: a household's, to a requester who has
   * been made a member since.
   */
  readonly unlinked?: string
  /**
   * The sentence for a refused request that is about where its reader stands, which whoever
   * gave this acts on too, or undefined for any other refusal.
   */
  readonly standing?: (error: unknown) => string | undefined
}

export function ExportList({
  source,
  zone,
  goes = null,
  asks,
  ask,
  teaches,
  instead,
  unlinked,
  standing,
}: ExportListProps) {
  const t = useTranslate()
  const me = useMe()
  const toast = useToast()
  const queries = useQueryClient()
  const online = useOnline()
  const say = useProblemText(zone)
  const withdrawn = useNoWithdrawal()

  const read = useQuery({
    queryKey: source.key,
    queryFn: async ({ signal }) => (await source.list(signal)).map(listed),
    // While one is on its way nothing tells the page what became of it: the list is asked for
    // again, until none is. The query client holds it back while the page is hidden. And it is
    // asked for no more once it is answered as not its reader's, a member taken out of the
    // household meanwhile: what was kept would have it asked for every few seconds for nothing.
    refetchInterval: (query) =>
      query.state.data?.some(underWay) === true && !notTheirs(query.state) ? askAgainEvery : false,
  })
  const list = read.data
  const making = list?.some(underWay) === true
  // A household's list answered as not its reader's says they are in the household no longer.
  // The household alone is read again, which is what tells the rest of the app and takes this
  // screen away: read again with it (`source.reread`), the list would only be refused again.
  useRereadWhereRefused(source.household ?? '', source.household !== undefined && notTheirs(read))

  // What the last press was refused with: a banner of its own for each, so that a second
  // refusal is said as the first was.
  const [refused, refuse] = useSaid()

  // The exports this visit saw on their way: what each then came to arrived with nobody
  // pressing anything, and is said.
  const watched = useRef(new Set<string>())
  useEffect(() => {
    for (const job of list ?? []) {
      if (underWay(job)) watched.current.add(job.id)
      else if (watched.current.delete(job.id)) {
        const status = statusOf(job)
        // Ready to download only for whoever is handed its link: a requester made a member since
        // reads how it stands on its row.
        if (status === 'ready' && job.linked) toast({ message: t('data.exports.ready') })
        if (status === 'failed') toast({ message: t('data.exports.failed') })
      }
    }
  }, [list, toast, t])

  const base = readState(read, online, list?.length === 0)
  // A control of the list's leaves with what it stood in, and the focus it held would drop to
  // the page: the control that asks once an export is on its way, a row's own where the job read
  // at its press carries no link or is gone, and *Try again* as soon as the list is asked for
  // again. Each is looked for after every drawing of the list, and the focus is put on the
  // list's own place only where what held it was a control of the list's that is on the page no
  // longer (account/common.ts): a download that went through leaves its control, and the focus
  // on it, and a focus that fell to the page from another part of it is that part's to keep.
  const view = usePartFocusKept()

  const asking = useMutation({
    ...askedNow,
    mutationFn: () => source.ask(),
    onSuccess: (job) => {
      // Listed at once, first, as the server lists it: the answer may be one already listed.
      queries.setQueryData<Listed[]>(source.key, (was) => [
        listed(job),
        ...(was ?? []).filter((each) => each.id !== job.id),
      ])
      toast({ message: t('data.exports.asked') })
      void source.reread()
    },
    onError: (error) => {
      refuse(standing?.(error) ?? say(error))
    },
  })
  const download = useMutation({
    ...askedNow,
    // The link a list would keep is good for minutes: it is read as it is needed.
    mutationFn: (id: string) => source.read(id),
    onSuccess: (job) => {
      const link = job.download_url
      const linked = typeof link === 'string' && link !== ''
      queries.setQueryData<Listed[]>(source.key, (was) =>
        was?.map((each) => (each.id === job.id ? listed(job) : each)),
      )
      if (linked) {
        leaveFor(link)
        toast({ message: t('data.exports.download.started') })
        return
      }
      // Read again, it carries no link: its row says how it stands now, and so is it said.
      const made = statusOf(job) === 'ready'
      refuse(made && unlinked !== undefined ? unlinked : t('data.exports.download.gone'))
      // Ready and handed no link is the server's word that its requester owns the household no
      // longer: where they stand there is read again, and the control that asks leaves with it.
      if (made) void source.reread()
    },
    onError: (error) => {
      if (!notTheirs({ error })) {
        refuse(say(error))
        return
      }
      // Its row was kept thirty days and is gone: the list is read again without it.
      refuse(t('data.exports.download.gone'))
      void source.reread()
    },
  })

  const verified = me.email_verified && typeof me.email === 'string' && me.email !== ''
  const controls = asks ? (
    <div className={account.group}>
      {making ? (
        // No control that would only be answered with the one on its way.
        <p className={account.text}>{t('data.exports.under_way')}</p>
      ) : (
        <div className={account.actions}>
          <Button
            variant="primary"
            loading={asking.isPending}
            onClick={() => {
              refuse(null)
              asking.mutate()
            }}
          >
            {ask}
          </Button>
        </div>
      )}
      <p className={account.note}>
        {verified ? t('data.exports.expect.email') : t('data.exports.expect.no_email')}
      </p>
    </div>
  ) : (
    (instead ?? null)
  )

  const state: DataState = making && base === 'populated' ? 'syncing' : base

  return (
    <div ref={view} tabIndex={-1} className={cx(account.view, styles.stack)}>
      {refused === null ? null : (
        <Banner key={refused.id} tone="danger" announce>
          {refused.text}
        </Banner>
      )}
      <StateFrame
        state={state}
        skeleton={
          <Skeleton
            bars={[
              [45, 1.25],
              [30, 1],
              [60, 1],
            ]}
          />
        }
        empty={
          asks ? (
            <EmptyState sentence={teaches.sentence} example={teaches.example} action={controls} />
          ) : (
            controls
          )
        }
        texts={{
          error: {
            title: t('data.exports.error.title'),
            text: t('data.exports.error.body'),
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
          withdrawn,
        }}
      >
        {() => (
          <>
            {controls}
            <List label={t('data.exports.list')}>
              {(list ?? []).map((job) => (
                <Row
                  key={job.id}
                  job={job}
                  zone={zone}
                  goes={goes}
                  unlinked={unlinked}
                  downloading={download.isPending && download.variables === job.id}
                  held={download.isPending && download.variables !== job.id}
                  onDownload={() => {
                    refuse(null)
                    download.mutate(job.id)
                  }}
                />
              ))}
            </List>
          </>
        )}
      </StateFrame>
    </div>
  )
}
