// What a member holds (PRD 17 FR-HA3, FR-HA5; PRD 02 §5; 02-components §4.5), on their own page.
//
// Everybody reads it, gathered by level, in the words of whose app it is. An owner looking at a
// member or a child profile fills it in instead: the matrix as a form, begun from what is saved.
// An owner holds everything by being one, so there is no matrix to fill in for an owner, their
// own page included: the sentence in its place says what narrows it, to the owner who could.
//
// A change is said before it is saved (D-78): how many levels go up and down, that a lowering is
// told to its member as it happens, and which modules leave their app, and their devices,
// altogether. Household settings is not among those, whatever it is lowered to (D-167): lowered
// to *Off* it has a line of its own, which says what does go, the household's invitations. It is one summary and not a sentence a row, and it is the save's own description,
// read with the button that would do it. What is sent is the changed modules alone, against the
// version the page read. A change somebody else made meanwhile is not merged with this one: the
// form is put back to what the server holds, and says so.
//
// What is changed and not saved is this page's alone. Leaving the page drops it, and nothing
// asks first: a level is one press to choose again.
import { entityTag } from '@household/api'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useId, useMemo, useRef, useState } from 'react'
import styles from '../../account/Settings.module.css'
import { useApi } from '../../api/ApiProvider.tsx'
import { unwrap } from '../../api/problem.ts'
import { askedNow } from '../../api/query.ts'
import { fieldCodes, useRefusedField } from '../../auth/fields.tsx'
import { useFormat, useTranslate } from '../../i18n/I18nProvider.tsx'
import { Banner } from '../../ui/Banner.tsx'
import { Button } from '../../ui/Button.tsx'
import { cx } from '../../ui/cx.ts'
import { useToast } from '../../ui/Toast.tsx'
import { useOff, useReread } from '../data.ts'
import { GrantMatrix, GrantSummary } from '../GrantMatrix.tsx'
import { levelsOf, matrixOrder, type Levels } from '../grants.ts'
import { useHousehold } from '../HouseholdContext.tsx'
import type { AccessLevel, ModuleKey } from '../households.ts'
import {
  grantChange,
  memberKey,
  useFocusHandedOn,
  useRefusals,
  type Refusals,
  type Subject,
} from './member.ts'
import own from './Member.module.css'
import { Refused } from './MemberRefused.tsx'
import { Section, useStanding } from './Page.tsx'

interface Asked {
  /** The changed modules alone, each with its new level. */
  readonly grants: Readonly<Record<string, AccessLevel>>
}

function GrantsForm({
  subject,
  label,
  off,
  refusals,
}: {
  readonly subject: Subject
  readonly label: string
  readonly off: ReadonlySet<ModuleKey>
  readonly refusals: Refusals
}) {
  const t = useTranslate()
  const format = useFormat()
  const api = useApi()
  const queries = useQueryClient()
  const toast = useToast()
  const household = useHousehold()
  const reread = useReread(household.id)
  const { name } = subject

  const saved = useMemo(() => levelsOf(subject.membership.grants), [subject.membership.grants])
  // What the owner chose, over what is saved: a row somebody else changed meanwhile is drawn as
  // it now stands, and is no change of this owner's to be sent back as it was.
  const [edits, setEdits] = useState<Partial<Record<ModuleKey, AccessLevel>>>({})
  const levels = useMemo<Levels>(() => ({ ...saved, ...edits }), [saved, edits])
  const change = grantChange(saved, levels)
  const changed = [...change.raised, ...change.lowered]
  const dirty = changed.length > 0

  const save = useMutation({
    ...askedNow,
    mutationFn: async ({ grants }: Asked) =>
      unwrap(
        await api.PATCH('/households/{household_id}/members/{user_id}', {
          params: {
            path: { household_id: household.id, user_id: subject.id },
            header: { 'If-Match': entityTag(subject.version) },
          },
          body: { grants },
        }),
      ),
    onSuccess: (answer, asked) => {
      queries.setQueryData(memberKey(household.id, subject.id), answer)
      // What was sent is saved, and no change any more. A row chosen while the save was on its
      // way was not sent, and is still a change to save.
      setEdits((last) =>
        Object.fromEntries(
          Object.entries(last).filter(([module, level]) => asked.grants[module] !== level),
        ),
      )
      toast({ message: t('household.member.holds.saved', { name }) })
      void reread()
    },
    onError: (error) => {
      // A level the server will not give is its row's own to say, beside the row.
      if ([...fieldCodes(error).keys()].some((field) => field.startsWith('/grants/'))) return
      // The page is not how things stand: the rows are put back to what the server holds now,
      // which the refusal says, and nothing of this change is kept to be laid over it.
      if (refusals.refuse(error)) setEdits({})
    },
  })
  const refused = fieldCodes(save.error)
  const errors = new Map<ModuleKey, string>(
    matrixOrder.flatMap((module) =>
      refused.has(`/grants/${module}`)
        ? [[module, t('household.member.holds.refused_level')] as const]
        : [],
    ),
  )
  const form = useRefusedField(save.error)

  // The two buttons are drawn only while something is changed, and go when the change is saved,
  // put back or refused as stale. The focus one of them held goes to the matrix they stood under.
  const matrix = useRef<HTMLDivElement>(null)
  useFocusHandedOn(dirty, matrix)
  const consequences = useId()
  const named = (modules: readonly ModuleKey[]) =>
    format.list(modules.map((module) => t(`module.${module}.name`)))

  return (
    <form
      ref={form}
      className={styles.form}
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        if (!dirty) return
        refusals.clear()
        save.mutate({
          grants: Object.fromEntries(changed.map((module) => [module, levels[module]])),
        })
      }}
    >
      <div
        ref={matrix}
        tabIndex={-1}
        role="group"
        aria-label={label}
        className={cx(styles.view, styles.form)}
      >
        {subject.role === 'child' ? (
          <p className={styles.note}>{t('household.grant.child_note')}</p>
        ) : null}
        <GrantMatrix
          label={label}
          role={subject.role}
          levels={levels}
          from={saved}
          off={off}
          errors={errors}
          onChange={(module, level) => {
            // What the last save was refused with is said no longer. A save on its way is left
            // to arrive: put away, its button would take a second press and *Put back* a first,
            // each over a change that is still being made.
            if (!save.isPending) save.reset()
            refusals.clear()
            // A row put back to what is saved is no change of this owner's any more. Kept as
            // one, it would be a change again as soon as somebody else changed that row, and be
            // sent back over theirs with the next save.
            setEdits((last) =>
              level === saved[module]
                ? Object.fromEntries(Object.entries(last).filter(([each]) => each !== module))
                : { ...last, [module]: level },
            )
          }}
        />
      </div>
      {dirty ? (
        // What the change comes to, before it is saved: the save's own description.
        <div id={consequences}>
          <Banner tone={change.lowered.length > 0 ? 'warning' : 'info'}>
            <ul className={own.points} role="list">
              {change.raised.length > 0 ? (
                <li>
                  {t('household.member.holds.change.raised', { count: change.raised.length })}
                </li>
              ) : null}
              {change.lowered.length > 0 ? (
                <li>
                  {t('household.member.holds.change.lowered', { count: change.lowered.length })}
                </li>
              ) : null}
              {change.off.length > 0 ? (
                <li>
                  {t('household.member.holds.change.off', {
                    count: change.off.length,
                    modules: named(change.off),
                    name,
                  })}
                </li>
              ) : null}
              {/* Household settings leaves nobody's app: what goes with it is the invitations. */}
              {change.settingsOff ? (
                <li>{t('household.member.holds.change.admin_off', { name })}</li>
              ) : null}
              {/* A member is told of any change to what they hold, a raise among them (D-78). */}
              <li>{t('household.member.holds.change.told', { name })}</li>
            </ul>
          </Banner>
        </div>
      ) : null}
      <Refused refusal={refusals.refusal} />
      {dirty ? (
        <div className={styles.actions}>
          <Button
            type="submit"
            variant="primary"
            loading={save.isPending}
            aria-describedby={consequences}
          >
            {t('household.member.holds.save')}
          </Button>
          <Button
            onClick={() => {
              if (save.isPending) return
              save.reset()
              refusals.clear()
              setEdits({})
              // The buttons go with the change, and nothing else says what the press came to.
              toast({ message: t('household.member.holds.put_back_said') })
            }}
          >
            {t('household.member.holds.put_back')}
          </Button>
        </div>
      ) : null}
    </form>
  )
}

export function MemberGrants({ subject }: { readonly subject: Subject }) {
  const t = useTranslate()
  const format = useFormat()
  const household = useHousehold()
  const standing = useStanding()
  const off = useOff(household.id)
  // Kept here, above the form: a refusal that takes the reader's ownership with it takes the
  // form too, and is still to be said where the form stood.
  const refusals = useRefusals(household.id)
  const { name } = subject
  const title = subject.own
    ? t('household.member.holds.title_you')
    : t('household.member.holds.title', { name })
  const owner = subject.role === 'owner'

  if (standing.changes && !owner) {
    return (
      <Section title={title}>
        <GrantsForm subject={subject} label={title} off={off} refusals={refusals} />
      </Section>
    )
  }
  const held = levelsOf(subject.membership.grants)
  const offNames = matrixOrder
    .filter((module) => off.has(module) && held[module] !== 'none')
    .map((module) => t(`module.${module}.name`))
  return (
    <Section title={title}>
      {owner ? (
        <p className={styles.text}>
          {subject.own
            ? t('household.member.holds.owner_you')
            : standing.changes
              ? t('household.grant.owner_note', { name })
              : t('household.member.holds.owner')}
        </p>
      ) : null}
      <GrantSummary grants={held} whose={subject.own ? 'yours' : 'theirs'} role={subject.role} />
      {offNames.length > 0 ? (
        <p className={styles.note}>
          {t('household.member.holds.off', { modules: format.list(offNames) })}
        </p>
      ) : null}
      <Refused refusal={refusals.refusal} />
    </Section>
  )
}
