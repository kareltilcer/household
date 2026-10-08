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

// A link opened in a tab that is on its page already: the browser changes the fragment under
// the document, adds an entry for it, and loads nothing.
describe('what arrives where its page is drawn already', () => {
  it('is read as the page’s own, and taken out of the entry the browser gave it', async () => {
    const user = userEvent.setup()
    const backend = serve()
    backend.on('POST /auth/password-reset/confirm', () => empty(204))
    openInBrowser(paths.resetSet.path, { backend })
    await screen.findByRole('heading', { level: 1, name: 'This link doesn’t open anything' })
    const entries = window.history.length

    window.location.hash = 'token=r2'
    await screen.findByRole('heading', { level: 1, name: 'Choose a new password' })
    await waitFor(() => {
      expect(window.location.hash).toBe('')
    })
    // The entry is the browser's doing, and the token is in it no longer: Back finds none.
    expect(window.history.length).toBe(entries + 1)
    expect(window.location.pathname).toBe(paths.resetSet.path)

    await user.type(screen.getByLabelText('New password'), 'a long enough password')
    await user.click(screen.getByRole('button', { name: 'Set password and sign out everywhere' }))
    await waitFor(() => {
      expect(backend.to('POST /auth/password-reset/confirm')).toHaveLength(1)
    })
    expect(backend.to('POST /auth/password-reset/confirm')[0]?.body).toMatchObject({ token: 'r2' })
  })

  it('is kept nowhere but in the page: no storage holds it, before or after it is read', async () => {
    openInBrowser(paths.graduate.path)
    await screen.findByRole('heading', { level: 1, name: 'This link doesn’t open anything' })
    window.location.hash = 'token=g-arrived'
    await screen.findByRole('heading', { level: 1, name: 'Choose your password' })
    await waitFor(() => {
      expect(window.location.hash).toBe('')
    })
    const stored = [window.localStorage, window.sessionStorage].flatMap((storage) =>
      Array.from({ length: storage.length }, (_, at) => {
        const key = storage.key(at) ?? ''
        return `${key}=${storage.getItem(key) ?? ''}`
      }),
    )
    expect(stored.join('\n')).not.toContain('g-arrived')
    expect(document.cookie).not.toContain('g-arrived')
  })

  it('begins nothing again for a fragment that names a place on the page, and leaves none in the address', async () => {
    const user = userEvent.setup()
    const backend = serve()
    backend.on('POST /auth/password-reset/confirm', () => empty(204))
    openInBrowser(`${paths.resetSet.path}#token=r1`, { backend })
    await user.type(await screen.findByLabelText('New password'), 'a long enough password')

    window.location.hash = 'main'
    await waitFor(() => {
      expect(window.location.hash).toBe('')
    })
    // The page is the one that was drawn: what was typed is in it, and the link it was opened with.
    expect(screen.getByLabelText('New password')).toHaveValue('a long enough password')
    await user.click(screen.getByRole('button', { name: 'Set password and sign out everywhere' }))
    await waitFor(() => {
      expect(backend.to('POST /auth/password-reset/confirm')).toHaveLength(1)
    })
    expect(backend.to('POST /auth/password-reset/confirm')[0]?.body).toMatchObject({ token: 'r1' })
  })
})
