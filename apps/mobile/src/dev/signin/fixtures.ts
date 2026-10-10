// The words the dev sign-in form draws: fixtures, in English and in no catalog (D-154), each
// drawn through `useSample`, which accents them under the pseudo-locale. Its test reads them
// from here.
export const words = {
  title: 'Sign in',
  email: 'Email',
  password: 'Password',
  submit: 'Sign in',
  /** Beside the address, where the server refused it. */
  emailRefused: 'Enter an email address.',
  /** Beside the password, where the server refused it. */
  passwordRefused: 'Enter the password.',
  /** `401 invalid_credentials`. */
  nobody: 'That address and password sign nobody in.',
  /** The server's `409`: the account has a second step, which only a sign-in screen answers. */
  secondStep: 'This account asks for a second step, which this form does not answer.',
  /** A `422` that names no field of this form. */
  refusedAsSent: 'The sign-in was refused as it was sent.',
} as const
