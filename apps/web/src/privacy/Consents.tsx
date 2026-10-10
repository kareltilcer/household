// The two consents an account keeps (PRD 05 §9 FR-PR9, D-142; the right to object, §3): usage
// statistics, and news of the product by email. Both are off until their member turns one on,
// each is a switch that saves as it is changed, and declining is as easy as agreeing: it is the
// same switch.
//
// The server replaces both with whatever it is sent, and one left out is withdrawn (D-142), so
// each change sends both as the screen holds them. A switch takes another change while one is
// on its way, sent beside it: which of two the server took last is not the order their answers
// come in, so only the answer to the change made last is drawn, and once every one of them is
// answered, and not before, what the server holds is read: read after the last one made but
// before an earlier one landed, it would be drawn over by nothing when that one did. A change
// that was refused is put back and said where it was the last one made, and only there. An
// earlier one's refusal leaves what the later one chose and says nothing: the later one sent
// its value too, so whether it is saved is that one's answer to give, and what the server came
// to hold is what the read then settles.
//
// The switch for statistics says what they would hold and what they never would, and claims no
// more than is so: the web app collects none yet, and the switch records the choice. A child
// profile is asked nothing and consents to nothing (§7): it is drawn no control, the server
// refusing it one, and is told so.
import type { components } from '@household/api'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useRef, useState } from 'react'
import { readState, usePartFocusKept, useNoWithdrawal, useOwnZone } from '../account/common.ts'
import account from '../account/Settings.module.css'
import { useApi } from '../api/ApiProvider.tsx'
import { unwrap } from '../api/problem.ts'
import { useProblemText } from '../api/problemText.ts'
import { askedNow } from '../api/query.ts'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { useMe } from '../session/SessionProvider.tsx'
import { Button } from '../ui/Button.tsx'
import { Switch } from '../ui/Choice.tsx'
import { cx } from '../ui/cx.ts'
import { useOnline } from '../ui/online.ts'
import { Skeleton } from '../ui/Skeleton.tsx'
import { StateFrame } from '../ui/StateFrame.tsx'
import { SyncMark } from '../ui/StatusMark.tsx'
import styles from './Privacy.module.css'

type Kept = components['schemas']['Consents']

/** The two, as they are sent: always both. */
interface Both {
  readonly analytics: boolean
  readonly marketing_email: boolean
}

/** The account's consents, under the account's key: gone with its session. */
export const consentsKey = ['me', 'consents'] as const

function Choices() {
  const t = useTranslate()
  const api = useApi()
  const queries = useQueryClient()
  const online = useOnline()
  const say = useProblemText(useOwnZone())
  const withdrawn = useNoWithdrawal()
  const ids = useId()

  const read = useQuery({
    queryKey: consentsKey,
    queryFn: async ({ signal }) => unwrap(await api.GET('/me/consents', { signal })),
  })
  // Why the last change was not saved, until the next one or until it is put away.
  const [refusal, setRefusal] = useState<string | null>(null)
  // How many changes this screen has sent: the one made last is the one whose answer is drawn.
  const sent = useRef(0)
  // How many of them are still on their way: what the server holds is read once none is.
  const flying = useRef(0)
  const save = useMutation({
    ...askedNow,
    mutationFn: async (next: Both) => unwrap(await api.PUT('/me/consents', { body: next })),
    onMutate: async (next: Both) => {
      setRefusal(null)
      sent.current += 1
      flying.current += 1
      const turn = sent.current
      // A read on its way was asked before this change: its answer would be drawn over it.
      await queries.cancelQueries({ queryKey: consentsKey, exact: true })
      const before = queries.getQueryData<Kept>(consentsKey)
      // Shown as chosen while it is asked: a switch that waited for the answer would feel stuck.
      queries.setQueryData<Kept>(consentsKey, (was) =>
        was === undefined ? was : { ...was, ...next },
      )
      return { before, turn }
    },
    onSuccess: (saved, _next, context) => {
      if (context.turn === sent.current) queries.setQueryData(consentsKey, saved)
    },
    onError: (error, _next, context) => {
      // Put back and said, where no change was made after it: what the screen shows is what the
      // server holds. Under a later change it is that one's choice that stands until the read,
      // and nothing is said of this one: the later one carried its value, and where the server
      // took that, *not saved* would be said over two switches that are both as it holds them.
      if (context?.turn !== sent.current) return
      if (context.before !== undefined) queries.setQueryData(consentsKey, context.before)
      setRefusal(say(error))
    },
    onSettled: () => {
      // Every one of them is answered: what the server holds now is read, whichever of two
      // sent side by side it took last.
      flying.current -= 1
      if (flying.current > 0) return
      void queries.invalidateQueries({ queryKey: consentsKey, exact: true })
    },
  })

  const consents = read.data
  const state = save.isPending
    ? 'syncing'
    : refusal !== null && consents !== undefined
      ? 'rejected'
      : readState(read, online)
  // A control that leaves with the sentence it stands in takes the focus it held to the page:
  // *Try again* as soon as the consents are asked for again, and *Dismiss* with the refusal it
  // puts away. The focus is put on this body's own place, where the switches are, and no other
  // body's of the page it stands on (account/common.ts).
  const view = usePartFocusKept()

  return (
    <div ref={view} tabIndex={-1} className={cx(account.view, styles.stack)}>
      <StateFrame
        state={state}
        skeleton={
          <Skeleton
            bars={[
              [60, 1.5],
              [90, 1],
              [55, 1.5],
              [80, 1],
            ]}
          />
        }
        // Two consents, always both: there is no empty state to teach.
        empty={null}
        texts={{
          error: {
            text: t('privacy.consent.error'),
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
          rejected: {
            title: t('privacy.consent.not_saved'),
            text: refusal ?? '',
            actions: (
              <Button
                onClick={() => {
                  setRefusal(null)
                }}
              >
                {t('ui.dismiss')}
              </Button>
            ),
          },
        }}
      >
        {({ mark }) => {
          if (consents === undefined) return null
          const both: Both = {
            analytics: consents.analytics,
            marketing_email: consents.marketing_email,
          }
          return (
            <div className={account.group}>
              <div className={account.group}>
                <Switch
                  label={t('privacy.consent.analytics.label')}
                  checked={both.analytics}
                  aria-describedby={`${ids}-analytics`}
                  onChange={(event) => {
                    save.mutate({ ...both, analytics: event.currentTarget.checked })
                  }}
                />
                <div id={`${ids}-analytics`} className={account.group}>
                  <p className={account.note}>{t('privacy.consent.analytics.says')}</p>
                  <p className={account.note}>{t('privacy.consent.analytics.now')}</p>
                </div>
              </div>
              <div className={account.group}>
                <Switch
                  label={t('privacy.consent.marketing.label')}
                  checked={both.marketing_email}
                  aria-describedby={`${ids}-marketing`}
                  onChange={(event) => {
                    save.mutate({ ...both, marketing_email: event.currentTarget.checked })
                  }}
                />
                <p id={`${ids}-marketing`} className={account.note}>
                  {t('privacy.consent.marketing.says')}
                </p>
              </div>
              {/* After everything else, so that nothing above it moves when it comes and goes. */}
              {mark === 'syncing' ? <SyncMark state="syncing" /> : null}
            </div>
          )
        }}
      </StateFrame>
    </div>
  )
}

export function Consents() {
  const t = useTranslate()
  const me = useMe()
  // Absent: a child profile is asked nothing, and is told that nothing is collected from it.
  if (me.is_child === true) return <p className={account.text}>{t('privacy.consent.child')}</p>
  return <Choices />
}
