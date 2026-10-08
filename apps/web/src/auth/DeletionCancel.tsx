// What the link in an account deletion's email opens (FR-ID8, D-136): the page that cancels it.
// An account scheduled for deletion signs nobody in, whatever its password, so it is cancelled
// signed out, with the token its email carried. The prototype's *signing in cancels it* is not
// what the server does, and the screen says so where it knows a deletion is pending.
//
// The token is in the fragment, read once and taken out of the address (fragment.ts). It is
// spent on the press of the one control, not as the page opens: keeping an account somebody
// asked to delete is a decision, and the page says what it does before it is made.
//
// The account screen sends a member here straight after scheduling, with the token the server
// handed it and, as `at`, the instant the account closes. The page then says the day first: the
// account is switched off now, and that day it is gone. The day is said in the device's zone,
// since nobody is signed in to name another.
import { useMutation } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useApi } from '../api/ApiProvider.tsx'
import { problemIn, unwrap } from '../api/problem.ts'
import { deviceTimeZone, useProblemText } from '../api/problemText.ts'
import { paths } from '../app/paths.ts'
import { useFormat, useTranslate } from '../i18n/I18nProvider.tsx'
import { Banner } from '../ui/Banner.tsx'
import { Button } from '../ui/Button.tsx'
import { fieldCodes } from './fields.tsx'
import { useFragment } from './fragment.ts'
import { Line, Screen, Way, Ways } from './Screen.tsx'

const instant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i

/**
 * `at` as the instant it names, or undefined for anything else: the fragment is whatever the
 * address held. An offset's `+` written bare into a fragment is read back as a space.
 */
export function closingAt(at: string | null): Date | undefined {
  if (at === null) return undefined
  const written = at.trim().replaceAll(' ', '+')
  if (!instant.test(written)) return undefined
  const read = new Date(written)
  return Number.isNaN(read.getTime()) ? undefined : read
}

export function DeletionCancel() {
  const t = useTranslate()
  const format = useFormat()
  const api = useApi()
  const problemText = useProblemText()
  const fragment = useFragment()
  const token = fragment.get('token') ?? ''
  const closes = closingAt(fragment.get('at'))

  const keep = useMutation({
    mutationFn: async () => {
      unwrap(await api.POST('/auth/deletion/cancel', { body: { token } }))
    },
  })

  const toSignIn = <Way to={paths.signIn.path}>{t('auth.way.sign_in')}</Way>
  const problem = problemIn(keep.error)
  let said: { readonly title: string; readonly lede?: string; readonly rest: ReactNode }
  if (keep.isSuccess) {
    said = {
      title: t('auth.deletion.done.title'),
      lede: t('auth.deletion.done.body'),
      rest: <Ways>{toSignIn}</Ways>,
    }
  } else if (token === '' || problem?.status === 404 || fieldCodes(keep.error).has('/token')) {
    // A link nobody issued, one cut short in copying, and one a newer link replaced read the
    // same. Asking for a password reset at the account's address sends the link again.
    said = {
      title: t('auth.deletion.nothing.title'),
      lede: t('auth.deletion.nothing.body'),
      rest: (
        <Ways>
          <Way to={paths.reset.path}>{t('auth.deletion.new_link')}</Way>
          {toSignIn}
        </Ways>
      ),
    }
  } else if (problem?.code === 'token_already_used') {
    said = {
      title: t('auth.link.used.title'),
      lede: t('auth.deletion.used.body'),
      rest: <Ways>{toSignIn}</Ways>,
    }
  } else if (problem?.status === 410) {
    // The thirty days have passed: the account is gone, and the address is free to start again.
    said = {
      title: t('auth.link.expired.title'),
      lede: t('auth.deletion.expired.body'),
      rest: (
        <Ways>
          <Way to={paths.register.path}>{t('auth.sign_in.register')}</Way>
        </Ways>
      ),
    }
  } else {
    said = {
      title: t('auth.deletion.title'),
      rest: (
        <>
          {closes === undefined ? null : (
            <Line>
              {t('auth.deletion.scheduled', {
                day: format.dayOf(closes, deviceTimeZone(), 'long'),
              })}
            </Line>
          )}
          <Line>{t('auth.deletion.body')}</Line>
          {keep.error === null ? null : (
            <Banner tone="danger" announce>
              {problemText(keep.error)}
            </Banner>
          )}
          <Button
            variant="primary"
            loading={keep.isPending}
            onClick={() => {
              keep.mutate()
            }}
          >
            {t('auth.deletion.submit')}
          </Button>
        </>
      ),
    }
  }
  return (
    <Screen live title={said.title} lede={said.lede}>
      {said.rest}
    </Screen>
  )
}
