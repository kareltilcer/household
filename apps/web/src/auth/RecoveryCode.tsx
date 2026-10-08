// A recovery code in the second step's place (A-8, FR-ID5): one of the ten the account was
// given when the second step was turned on, each spent once. It is the way in when the
// authenticator is gone, and the only one while the authenticator is locked.
//
// The count is shown before the code is spent, not after, where the challenge carries it; and
// every code spent is emailed, since the legitimate case and the stolen notebook look the same
// from here (auth.js). The prototype's *at two we will ask you to make a new set* is not said:
// nothing asks. Used and wrong are one sentence, the next action being the same for both.
import { useState } from 'react'
import { Navigate } from 'react-router'
import { useProblemText } from '../api/problemText.ts'
import { paths } from '../app/paths.ts'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { Banner } from '../ui/Banner.tsx'
import { Button } from '../ui/Button.tsx'
import { TextField } from '../ui/Field.tsx'
import { endingIn, isWrongCode, useAnswer } from './answer.ts'
import { heldChallenge, type Challenge } from './challenge.ts'
import { Destination } from './Destination.tsx'
import { Form, Notices, Screen, Way, Ways } from './Screen.tsx'

/** The contract's longest code. A recovery code is eight characters and a dash. */
const longest = 16

export function RecoveryCode() {
  // Read once, as the screen opens: it answers the challenge it was opened with (challenge.ts).
  const [challenge] = useState(heldChallenge)
  if (challenge === null) return <Navigate to={paths.signIn.path} replace />
  return <Recovery challenge={challenge} />
}

function Recovery({ challenge }: { readonly challenge: Challenge }) {
  const t = useTranslate()
  const problemText = useProblemText()
  const answer = useAnswer(challenge)
  const [code, setCode] = useState('')
  // What was typed that is not sent, set anew each time: nothing, or more than any code is.
  const [unsent, setUnsent] = useState<{ readonly fault: 'required' | 'wrong' }>()

  const submit = () => {
    // Case, spaces and the dash do not matter to the server; the spaces are dropped here so
    // that a code pasted with one either side is not longer than a code may be.
    const typed = code.replace(/\s/g, '')
    if (typed === '' || typed.length > longest) {
      answer.reset()
      setUnsent({ fault: typed === '' ? 'required' : 'wrong' })
      return
    }
    setUnsent(undefined)
    // A browser is trusted from the code's screen alone: this one is for when the app is gone.
    answer.mutate({ code: typed, trust: false })
  }

  const wrong = unsent?.fault === 'wrong' || isWrongCode(answer.error)
  const other =
    answer.error !== null && !isWrongCode(answer.error) && endingIn(answer.error) === undefined
  const left = challenge.recoveryCodesLeft
  return (
    <Screen title={t('auth.recovery.title')} lede={t('auth.recovery.lede')}>
      <Notices>
        <Destination />
        <Banner tone="info">
          {left === undefined
            ? t('auth.recovery.uses_one')
            : t('auth.recovery.left', { count: left })}
        </Banner>
        {other ? (
          <Banner tone="danger" announce>
            {problemText(answer.error)}
          </Banner>
        ) : null}
      </Notices>
      <Form onSubmit={submit} busy={answer.isPending} refused={unsent ?? answer.error}>
        <TextField
          label={t('auth.recovery.code')}
          numeric
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          value={code}
          onChange={(event) => {
            setCode(event.currentTarget.value)
          }}
          error={
            unsent?.fault === 'required'
              ? t('auth.recovery.required')
              : wrong
                ? t('auth.recovery.bad')
                : undefined
          }
        />
        <Button type="submit" variant="primary" loading={answer.isPending}>
          {t('auth.continue')}
        </Button>
      </Form>
      {challenge.methods.includes('totp') ? (
        <Ways>
          <Way to={paths.secondStep.path}>{t('auth.recovery.back')}</Way>
        </Ways>
      ) : null}
    </Screen>
  )
}
