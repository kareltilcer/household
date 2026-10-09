// The household code (C-49; PRD 02 §6, FR-CH1; 03-patterns §9): the eight characters by which a
// child profile says which household it is signing in to, having no address to say it with. It
// is drawn for whoever the server answers it to, which is the household's owners.
//
// It is an identifier and is presented as one, never as a secret to guard: it is drawn in full,
// in the two groups it is typed in, and never masked, and the screen says in words that it signs
// nobody in without a profile and that profile's PIN. It says who needs it, the household's
// child profiles by name, and tells a household that has none that it will never need it.
//
// Copying it is this browser's own doing and changes nothing, so every owner may, in a
// read-only household too. Making a new one is a change: it is asked about first, in a
// confirmation that names the code and says what stops and what stays (03-patterns §5), and
// then asked of the server at once (D-170).
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { copyText } from '../../account/common.ts'
import styles from '../../account/Settings.module.css'
import { useApi } from '../../api/ApiProvider.tsx'
import { unwrap } from '../../api/problem.ts'
import { useProblemText } from '../../api/problemText.ts'
import { askedNow } from '../../api/query.ts'
import { useFormat, useTranslate } from '../../i18n/I18nProvider.tsx'
import { Banner } from '../../ui/Banner.tsx'
import { Button } from '../../ui/Button.tsx'
import { Dialog } from '../../ui/Dialog.tsx'
import { KeyValue } from '../../ui/KeyValue.tsx'
import { useToast } from '../../ui/Toast.tsx'
import { useMembers, useReread } from '../data.ts'
import { useHousehold } from '../HouseholdContext.tsx'
import { householdKey } from '../households.ts'
import { useTimeZone } from '../timezone.ts'
import { Section } from './Page.tsx'
import { grouped, useGiven, useStandingRefusal, type AskedProps } from './profile.ts'

export interface HouseholdCodeProps {
  /** The code, as the server keeps it. */
  readonly code: string
  /** Asks for a new one, where its member may change the household: absent where they may not. */
  readonly onRenew?: (() => void) | undefined
}

export function HouseholdCode({ code, onRenew }: HouseholdCodeProps) {
  const t = useTranslate()
  const format = useFormat()
  const given = useGiven()
  const toast = useToast()
  const household = useHousehold()
  const members = useMembers(household.id)
  const shown = grouped(code)
  const children = members.data
    ?.filter((member) => member.role === 'child')
    .map((member) => member.display_name ?? '')
    .filter((name) => name !== '')
  return (
    <Section title={t('household.profile.code.title')} note={t('household.profile.code.note')}>
      <KeyValue
        pairs={[
          { key: t('household.profile.code.label'), value: given(shown), numeric: true },
          // Who needs it is read off the members: left out while they are unread.
          ...(children === undefined
            ? []
            : [
                {
                  key: t('household.profile.code.who'),
                  value:
                    children.length === 0
                      ? t('household.profile.code.nobody')
                      : t('household.profile.code.children', { names: format.list(children) }),
                },
              ]),
        ]}
      />
      <div className={styles.actions}>
        <Button
          onClick={() => {
            // What is copied is what is shown: nothing on the page changes, so it is said.
            copyText(shown).then(
              () => {
                toast({ message: t('household.profile.code.copied', { code: given(shown) }) })
              },
              () => {
                toast({ message: t('household.profile.code.copy_failed') })
              },
            )
          }}
        >
          {t('household.profile.code.copy')}
        </Button>
        {onRenew === undefined ? null : (
          <Button
            onClick={() => {
              onRenew()
            }}
          >
            {t('household.profile.code.renew.action')}
          </Button>
        )}
      </div>
    </Section>
  )
}

export interface RenewCodeProps extends AskedProps {
  /** The code a new one takes the place of. */
  readonly code: string
}

export function RenewCode({ code, onClose, onEnded }: RenewCodeProps) {
  const t = useTranslate()
  const api = useApi()
  const queries = useQueryClient()
  const given = useGiven()
  const toast = useToast()
  const say = useProblemText(useTimeZone())
  const standing = useStandingRefusal()
  const household = useHousehold()
  const reread = useReread(household.id)
  const old = given(grouped(code))
  const renew = useMutation({
    ...askedNow,
    mutationFn: async () =>
      unwrap(
        await api.POST('/households/{household_id}/join-code', {
          params: { path: { household_id: household.id } },
        }),
      ),
    onSuccess: (saved) => {
      queries.setQueryData(householdKey(household.id), saved)
      // The code on the page changes under a dialog that then closes: which one is good now,
      // and that the old one is not, is said.
      if (saved.join_code !== undefined) {
        toast({
          message: t('household.profile.code.renew.done', {
            code: given(grouped(saved.join_code)),
            old,
          }),
        })
      }
      void reread()
      onClose()
    },
    onError: (error) => {
      const ended = standing(error)
      if (ended !== undefined) onEnded(ended)
    },
  })
  const close = () => {
    if (!renew.isPending) onClose()
  }
  return (
    <Dialog
      open
      onClose={close}
      title={t('household.profile.code.renew.title')}
      description={t('household.profile.code.renew.body', { code: old })}
      actions={
        <>
          <Button onClick={close}>{t('household.profile.code.renew.keep')}</Button>
          <Button
            variant="danger"
            loading={renew.isPending}
            onClick={() => {
              renew.mutate()
            }}
          >
            {t('household.profile.code.renew.action')}
          </Button>
        </>
      }
    >
      {renew.isError && standing(renew.error) === undefined ? (
        <Banner key={renew.submittedAt} tone="danger" announce>
          {say(renew.error)}
        </Banner>
      ) : undefined}
    </Dialog>
  )
}
