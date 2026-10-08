// The second step of a sign-in (A-7, FR-ID5): six digits from the authenticator, for the
// challenge the sign-in was answered with (challenge.ts). With no challenge, after a reload or
// at an address opened cold, there is nothing to answer, and the sign-in begins again.
//
// The screen does not say the browser *hasn't signed in before*, as the prototype's does: a
// browser is challenged whenever it is not trusted, which is every sign-in until the box below
// is ticked, and thirty days after (D-100). Trust is opt-in and dated, never the default.
//
// A code is checked for its shape before it is sent. A wrong code counts against the account,
// five in five minutes and ten to a locked authenticator (PRD 02 §9), and five digits typed in
// a hurry should not spend one.
import { useState } from 'react'
import { Navigate } from 'react-router'
import { useProblemText } from '../api/problemText.ts'
import { paths } from '../app/paths.ts'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { Banner } from '../ui/Banner.tsx'
import { Button } from '../ui/Button.tsx'
import { Checkbox } from '../ui/Choice.tsx'
import { TextField } from '../ui/Field.tsx'
import { endingIn, isWrongCode, useAnswer } from './answer.ts'
import { heldChallenge, type Challenge } from './challenge.ts'
import { Destination } from './Destination.tsx'
import { Form, Notices, Screen, Way, Ways } from './Screen.tsx'

export function SecondStep() {
  // Read once, as the screen opens: it answers the challenge it was opened with (challenge.ts).
  const [challenge] = useState(heldChallenge)
  if (challenge === null) return <Navigate to={paths.signIn.path} replace />
  // A locked authenticator takes only a recovery code.
  if (!challenge.methods.includes('totp')) {
    return <Navigate to={paths.recoveryCode.path} replace />
  }
  return <Code challenge={challenge} />
}

function Code({ challenge }: { readonly challenge: Challenge }) {
  const t = useTranslate()
  const problemText = useProblemText()
  const answer = useAnswer(challenge)
  const [code, setCode] = useState('')
  const [trust, setTrust] = useState(false)
  // Set, anew, each time what was typed is no six digits: it is not sent.
  const [malformed, setMalformed] = useState<object>()

  const submit = () => {
    // An authenticator shows its code in two groups, and it is typed as it is read.
    const digits = code.replace(/\s/g, '')
    if (!/^\d{6}$/.test(digits)) {
      answer.reset()
      setMalformed({})
      return
    }
    setMalformed(undefined)
    answer.mutate({ code: digits, trust })
  }

  const wrong = isWrongCode(answer.error)
  // A refusal that is neither a wrong code nor the challenge's end, which leads away from here.
  const other = answer.error !== null && !wrong && endingIn(answer.error) === undefined
  return (
    <Screen title={t('auth.second_step.title')} lede={t('auth.second_step.lede')}>
      <Notices>
        <Destination />
        {other ? (
          <Banner tone="danger" announce>
            {problemText(answer.error)}
          </Banner>
        ) : null}
      </Notices>
      <Form onSubmit={submit} busy={answer.isPending} refused={malformed ?? answer.error}>
        <TextField
          label={t('auth.second_step.code')}
          numeric
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          onChange={(event) => {
            setCode(event.currentTarget.value)
          }}
          error={
            malformed !== undefined
              ? t('auth.second_step.shape')
              : wrong
                ? t('auth.second_step.bad')
                : undefined
          }
        />
        <Checkbox
          label={t('auth.second_step.trust')}
          checked={trust}
          onChange={(event) => {
            setTrust(event.currentTarget.checked)
          }}
        />
        <Button type="submit" variant="primary" loading={answer.isPending}>
          {t('auth.continue')}
        </Button>
      </Form>
      {challenge.methods.includes('recovery_code') ? (
        <Ways>
          <Way to={paths.recoveryCode.path}>{t('auth.second_step.recovery')}</Way>
        </Ways>
      ) : null}
    </Screen>
  )
}
