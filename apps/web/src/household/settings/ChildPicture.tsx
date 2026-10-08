// A child profile's picture, as an owner sets it (PRD 02 §6 FR-CH1; ADR 0012, ADR 0015; D-107):
// chosen, changed and removed as a member does their own (account/Account.tsx), since a child
// profile has nobody else to do it. The picture is the profile's account's and counts against no
// household's storage; setting it is still an upload, which a household in grace takes none of
// (PRD 04 §3): the control that would choose one is then absent, and one that is there is still
// removed.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'
import styles from '../../account/Settings.module.css'
import { useApi } from '../../api/ApiProvider.tsx'
import { problemIn, unwrap } from '../../api/problem.ts'
import { askedNow } from '../../api/query.ts'
import { useTranslate } from '../../i18n/I18nProvider.tsx'
import { Button } from '../../ui/Button.tsx'
import { Portrait } from '../../ui/Chip.tsx'
import { cx } from '../../ui/cx.ts'
import { useToast } from '../../ui/Toast.tsx'
import { useReread, type Membership } from '../data.ts'
import { useHousehold } from '../HouseholdContext.tsx'
import { memberKey, type Refusals, type Subject } from './member.ts'

/** The images the server makes a picture of (`putChildrenByUserIdAvatar`). */
const pictures = 'image/jpeg,image/png,image/gif,image/webp'

export function ChildPicture({
  subject,
  refusals,
}: {
  readonly subject: Subject
  /** Where a refusal of either write is said: the profile's own place for one. */
  readonly refusals: Refusals
}) {
  const t = useTranslate()
  const api = useApi()
  const queries = useQueryClient()
  const toast = useToast()
  const household = useHousehold()
  const reread = useReread(household.id)
  const chooser = useRef<HTMLInputElement>(null)
  const choose = useRef<HTMLButtonElement>(null)
  const group = useRef<HTMLDivElement>(null)
  const { name } = subject
  const path = { household_id: household.id, user_id: subject.id }
  const address = subject.membership.avatar_url ?? null
  const has = address !== null
  // A household in grace writes and takes no upload: there is nothing to choose a picture with.
  const uploads = household.entitlement?.can_upload !== false

  const kept = (saved: Membership) => {
    queries.setQueryData(memberKey(household.id, subject.id), saved)
    void reread()
  }
  const upload = useMutation({
    ...askedNow,
    mutationFn: async (file: File) =>
      unwrap(
        await api.PUT('/households/{household_id}/children/{user_id}/avatar', {
          params: { path },
          // The contract's multipart body, one part named `file`: the file itself is the part.
          body: { file: file.name },
          bodySerializer: () => {
            const form = new FormData()
            form.set('file', file)
            return form
          },
        }),
      ),
    onSuccess: (saved) => {
      kept(saved)
      // The picture is drawn for the eye alone: that it was saved is said.
      toast({ message: t('household.child.picture.saved', { name }) })
    },
    onError: (error) => {
      const status = problemIn(error)?.status
      refusals.refuse(
        error,
        status === 413
          ? t('household.child.picture.too_large')
          : status === 415 || status === 422
            ? t('household.child.picture.unreadable')
            : status === 402
              ? t('household.child.picture.no_uploads')
              : undefined,
      )
    },
  })
  const remove = useMutation({
    ...askedNow,
    mutationFn: async () =>
      unwrap(
        await api.DELETE('/households/{household_id}/children/{user_id}/avatar', {
          params: { path },
        }),
      ),
    onError: (error) => {
      refusals.refuse(error)
    },
  })

  return (
    <div ref={group} tabIndex={-1} className={cx(styles.group, styles.view)}>
      <p className={styles.strong}>{t('household.child.picture.label')}</p>
      <div className={styles.picture}>
        <Portrait address={address} name={name} className={styles.portrait} />
        <div className={styles.actions}>
          {uploads ? (
            <>
              <input
                ref={chooser}
                type="file"
                hidden
                accept={pictures}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0]
                  // Chosen again, the same file is a change again.
                  event.currentTarget.value = ''
                  refusals.clear()
                  if (file !== undefined) upload.mutate(file)
                }}
              />
              <Button
                ref={choose}
                loading={upload.isPending}
                onClick={() => {
                  chooser.current?.click()
                }}
              >
                {has ? t('household.child.picture.change') : t('household.child.picture.choose')}
              </Button>
            </>
          ) : null}
          {has ? (
            <Button
              variant="ghost"
              loading={remove.isPending}
              onClick={(event) => {
                const pressed = event.currentTarget
                refusals.clear()
                remove.mutate(undefined, {
                  onSuccess: (saved) => {
                    kept(saved)
                    // The control that removed it goes with the picture, and nothing else says
                    // it went: the focus it still holds goes to the one that stays, which then
                    // offers to choose a picture where it offered to change one, or to the
                    // picture's own place where the household takes no upload to choose.
                    const stays = choose.current ?? group.current
                    if (document.activeElement === pressed) stays?.focus()
                  },
                })
              }}
            >
              {t('household.child.picture.remove')}
            </Button>
          ) : null}
        </div>
      </div>
      {uploads ? <p className={styles.note}>{t('household.child.picture.help')}</p> : null}
    </div>
  )
}
