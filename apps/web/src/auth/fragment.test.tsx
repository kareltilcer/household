import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { paths } from '../app/paths.ts'
import { empty, openInBrowser, serve } from './testing.tsx'

// The screens' own tests read the router's address. These read the browser's: the bar a link
// is copied from, and the history Back goes through.
describe('what an address carries for the page it opens', () => {
  it('is taken out of the browser’s address at once, in the entry it was opened in', async () => {
    const user = userEvent.setup()
    const backend = serve()
    backend.on('POST /auth/password-reset/confirm', () => empty(204))
    const entries = window.history.length
    openInBrowser(`${paths.resetSet.path}#token=r1`, { backend })
    await screen.findByRole('heading', { level: 1, name: 'Choose a new password' })
    await waitFor(() => {
      expect(window.location.hash).toBe('')
    })
    expect(window.location.pathname).toBe(paths.resetSet.path)
    // Replaced, and not added to: no entry is left for Back to return to with the token in it.
    expect(window.history.length).toBe(entries)

    // The page read it once, and still holds it for the one request it is for.
    await user.type(screen.getByLabelText('New password'), 'a long enough password')
    await user.click(screen.getByRole('button', { name: 'Set password and sign out everywhere' }))
    await waitFor(() => {
      expect(backend.to('POST /auth/password-reset/confirm')).toHaveLength(1)
    })
    expect(backend.to('POST /auth/password-reset/confirm')[0]?.body).toMatchObject({ token: 'r1' })
  })

  it('leaves a query alone where the page reads the fragment only', async () => {
    openInBrowser(`${paths.graduate.path}?from=mail#token=g1`)
    await screen.findByRole('heading', { level: 1, name: 'Choose your password' })
    await waitFor(() => {
      expect(window.location.hash).toBe('')
    })
    expect(window.location.search).toBe('?from=mail')
  })

  it('leaves neither the query nor the fragment a provider returned with', async () => {
    const entries = window.history.length
    openInBrowser('/sign-in/google?code=c1&state=s1')
    await screen.findByRole('heading', { level: 1, name: 'That sign-in didn’t finish' })
    await waitFor(() => {
      expect(window.location.search).toBe('')
    })
    expect(window.location.href).not.toContain('c1')
    expect(window.history.length).toBe(entries)
  })
})
