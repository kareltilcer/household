// The two fields several of these screens share, an address and a new password, with what is
// wrong with each said in a sentence beside it, and how a `422` names them (docs/api: `errors[]`,
// each a JSON Pointer into the body and the check that failed).
//
// A value is checked here before it is sent only for what the server would certainly refuse:
// the requests behind these screens are counted against a limit (PRD 02 §9), and a registration
// spent on an empty field is one of five an hour. The server's own answer is still the one that
// holds: a `422` is read back onto the field it names.
import { useEffect, useRef, type RefObject } from 'react'
import { problemIn } from '../api/problem.ts'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { Banner } from '../ui/Banner.tsx'
import { PasswordField, TextField } from '../ui/Field.tsx'

/**
 * The fields a `422` names, each with the first check it failed: `/password` → `invalid`. Empty
 * for any other failure.
 */
export function fieldCodes(error: unknown): ReadonlyMap<string, string> {
  const named = new Map<string, string>()
  const problem = problemIn(error)
  if (problem?.code !== 'validation_failed') return named
  for (const { field, code } of problem.errors) {
    if (!named.has(field)) named.set(field, code)
  }
  return named
}

/**
 * Whether `error` is the server's answer to a create it has made already: a `422` that names the
 * id the client made for it (D-23), and no field beside it. The first request for it took
 * effect, and its answer never came: what was made is read, or said to be there to look for.
 */
export function isMadeAlready(error: unknown): boolean {
  const named = fieldCodes(error)
  return named.size === 1 && named.has('/id')
}

/**
 * Where the focus goes when a form is refused: to the first field the refusal marked, whose
 * sentence is then read with the field. A sentence that arrives beside a field the focus is not
 * on is said to nobody who cannot see it (WCAG 2.1, 4.1.3). `refused` is what the last
 * submission was refused with, a new value for each refusal; one that marks no field moves
 * nothing, and its banner is announced where it is drawn. The form takes the ref this answers.
 */
export function useRefusedField(refused: unknown): RefObject<HTMLFormElement | null> {
  const form = useRef<HTMLFormElement>(null)
  useEffect(() => {
    if (refused === undefined || refused === null) return
    form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [refused])
  return form
}

export type EmailFault = 'required' | 'invalid'

/** What is wrong with `email` as typed, where anything plainly is: the server judges the rest. */
export function checkEmail(email: string): EmailFault | undefined {
  if (email === '') return 'required'
  return /^[^\s@]+@[^\s@]+$/.test(email) ? undefined : 'invalid'
}

/** What a `422` refused the address at `pointer` for. */
export function refusedEmail(error: unknown, pointer = '/email'): EmailFault | undefined {
  const code = fieldCodes(error).get(pointer)
  if (code === undefined) return undefined
  return code === 'required' ? 'required' : 'invalid'
}

export interface EmailFieldProps {
  readonly value: string
  readonly onChange: (value: string) => void
  readonly fault: EmailFault | undefined
  /** `username` where the address signs in beside a password, for a password manager. */
  readonly autoComplete?: 'email' | 'username'
}

export function EmailField({ value, onChange, fault, autoComplete = 'email' }: EmailFieldProps) {
  const t = useTranslate()
  return (
    <TextField
      label={t('auth.email.label')}
      type="email"
      inputMode="email"
      autoComplete={autoComplete}
      autoCapitalize="none"
      spellCheck={false}
      // The contract's longest address.
      maxLength={254}
      value={value}
      onChange={(event) => {
        onChange(event.currentTarget.value)
      }}
      error={
        fault === undefined
          ? undefined
          : fault === 'required'
            ? t('auth.email.required')
            : t('auth.email.invalid')
      }
    />
  )
}

/**
 * What a new password is refused for: too short for the contract's twelve characters, found in
 * the breached-password screen, or something this build has no sentence for.
 */
export type PasswordFault = 'short' | 'breached' | 'invalid'

/** The contract's minimum for a new password, in characters (FR-ID1; the prototype says ten). */
export const passwordMinimum = 12

/** What is wrong with a new password as typed, before it is sent: its length alone. */
export function checkNewPassword(password: string): PasswordFault | undefined {
  // Counted in characters, as the contract counts them, and not in UTF-16 units.
  return Array.from(password).length < passwordMinimum ? 'short' : undefined
}

/**
 * What a `422` refused the new password for. `/password` with the code `invalid` is the
 * breached-password screen's refusal (FR-ID1, D-12): the one refusal no keyword of the schema
 * names.
 */
export function refusedPassword(error: unknown): PasswordFault | undefined {
  const code = fieldCodes(error).get('/password')
  if (code === undefined) return undefined
  if (code === 'invalid') return 'breached'
  return code === 'min_length' || code === 'required' ? 'short' : 'invalid'
}

export interface NewPasswordFieldProps {
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly fault: PasswordFault | undefined
}

/** A password being chosen: a password manager offers to make one, and the minimum is said. */
export function NewPasswordField({ label, value, onChange, fault }: NewPasswordFieldProps) {
  const t = useTranslate()
  return (
    <PasswordField
      label={label}
      autoComplete="new-password"
      help={t('auth.password.help')}
      value={value}
      onChange={(event) => {
        onChange(event.currentTarget.value)
      }}
      error={
        fault === undefined
          ? undefined
          : fault === 'short'
            ? t('auth.password.short')
            : fault === 'breached'
              ? t('auth.password.breached.field')
              : t('auth.field.invalid')
      }
    />
  )
}

/**
 * The breached-password refusal (A-2, auth.js `password.breached`): a refusal, not a warning,
 * that describes the list rather than the password, so that it reads as information and not as
 * judgement. It says what the check is as the server makes it: the password is screened against
 * a list the server keeps (D-12, ADR 0009), and goes to nobody else. The prototype's sentence,
 * that only a fingerprint's first characters leave the device, describes a check nothing makes.
 */
export function Breached() {
  const t = useTranslate()
  return (
    <Banner tone="danger" announce title={t('auth.password.breached.title')}>
      {t('auth.password.breached.body')}
    </Banner>
  )
}
