// The dev screens' own sign-in: an address and a password to the contract's device sign-in
// (`postAuthLogin` with `client_type: 'mobile'`, PRD 02 FR-ID3), so that a build with no sign-in
// screen of its own yet can be signed in, by a developer and by the end-to-end flow. Plan item
// 29 builds the screens a member signs in on; this one is in no build a store serves, and its
// words are fixtures, in no catalog (D-154).
//
// It signs in as any screen will: the request is asked at once (`askedNow`), it names its
// device as the session describes it, and the answer is handed to the session (`signedIn`),
// which keeps the pair and removes what the device kept of anybody else. A refusal that marks a
// field moves the accessibility focus to it; any other is said in a banner, and announced.
import { useMutation } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useState } from 'react'
import { useApi } from '../../api/ApiProvider.tsx'
import { ApiProblemError, problemIn, unwrap } from '../../api/problem.ts'
import { useProblemText } from '../../api/problemText.ts'
import { askedNow } from '../../api/query.ts'
import { paths } from '../../app/paths.ts'
import { useSession } from '../../session/context.ts'
import { Banner } from '../../ui/Banner.tsx'
import { Button } from '../../ui/Button.tsx'
import { PasswordField, TextField } from '../../ui/Field.tsx'
import { RefusedFields, useRefusedField } from '../../ui/refusal.ts'
import { DevScreen } from '../DevScreen.tsx'
import { useSample } from '../sample.ts'
import { words } from './fixtures.ts'

/** What was typed. */
interface Typed {
  readonly email: string
  readonly password: string
}

/**
 * The account asks for a second step: the server's `409`, whose body is a challenge and no
 * problem document. This form answers none.
 */
class SecondStep extends Error {}

/** Whether a `409`'s body is the second step's challenge (the contract's `MfaChallenge`). */
function isChallenge(body: unknown): boolean {
  return (
    typeof body === 'object' && body !== null && 'error' in body && body.error === 'mfa_required'
  )
}

/**
 * The checks a `422` says each field of the body failed, by its pointer: `/email` → `format`.
 * Empty for any other failure.
 */
function refusedFields(error: unknown): ReadonlyMap<string, string> {
  const named = new Map<string, string>()
  const problem = problemIn(error)
  if (problem?.code !== 'validation_failed') return named
  for (const { field, code } of problem.errors) {
    if (!named.has(field)) named.set(field, code)
  }
  return named
}

export default function DevSignIn() {
  const sample = useSample()
  const api = useApi()
  const { device, signedIn } = useSession()
  const problemText = useProblemText()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  // How many times the form was sent: what tells one refusal from the one before it.
  const [presses, setPresses] = useState(0)

  const signIn = useMutation({
    ...askedNow,
    mutationFn: async (typed: Typed) => {
      const answer = await api.POST('/auth/login', {
        body: { ...typed, client_type: 'mobile', device: await device() },
      })
      if (answer.response.status === 409 && isChallenge(answer.error)) throw new SecondStep()
      const { user, tokens } = unwrap(answer)
      if (user === undefined || tokens === undefined || tokens === null) {
        throw new Error('the sign-in was answered with no account or no pair')
      }
      await signedIn({ user, tokens })
    },
  })

  const fields = useRefusedField(signIn.error)
  const refused = refusedFields(signIn.error)
  const marks = (pointer: string, sentence: string) =>
    refused.has(pointer) ? sample(sentence) : undefined
  // A refusal that names no field of this form is said above it.
  const elsewhere =
    signIn.error !== null && !refused.has('/email') && !refused.has('/password')
      ? signIn.error
      : null
  const sentence = (error: unknown): string => {
    if (error instanceof SecondStep) return sample(words.secondStep)
    if (error instanceof ApiProblemError && error.problem.code === 'invalid_credentials') {
      return sample(words.nobody)
    }
    if (error instanceof ApiProblemError && error.problem.code === 'validation_failed') {
      return sample(words.refusedAsSent)
    }
    // Whatever else: the server could not be reached, refused for now, or failed.
    return problemText(error)
  }
  // Busy from the press until the screen it leads to has come: idle after an answer, it would
  // take a second press that signs in a second time.
  const busy = signIn.isPending || signIn.isSuccess

  return (
    <DevScreen page="sign-in" title={sample(words.title)}>
      {/* A banner of its own for each press's refusal: a second one in the same words is a
          second refusal, and is said again. */}
      {elsewhere === null ? null : (
        <Banner key={presses} tone="danger" announce testID="dev-sign-in:refused">
          {sentence(elsewhere)}
        </Banner>
      )}
      <RefusedFields value={fields}>
        <TextField
          label={sample(words.email)}
          testID="dev-sign-in:email"
          value={email}
          onChangeText={setEmail}
          error={marks('/email', words.emailRefused)}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username"
          inputMode="email"
          textContentType="username"
        />
        <PasswordField
          label={sample(words.password)}
          testID="dev-sign-in:password"
          value={password}
          onChangeText={setPassword}
          error={marks('/password', words.passwordRefused)}
          autoComplete="current-password"
          textContentType="password"
        />
      </RefusedFields>
      <Button
        variant="primary"
        testID="dev-sign-in:submit"
        loading={busy}
        onPress={() => {
          setPresses((count) => count + 1)
          signIn.mutate(
            { email, password },
            {
              // From the press's own callback: it is dropped with this screen, and leads nobody
              // away from wherever they had gone meanwhile.
              onSuccess: () => {
                router.replace(paths.home.path)
              },
            },
          )
        }}
      >
        {sample(words.submit)}
      </Button>
    </DevScreen>
  )
}
