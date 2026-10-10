import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { inHousehold } from '../../app/paths.ts'
import {
  accountOf,
  createServer,
  home,
  klara,
  memberOf,
  open,
  petr,
  readBy,
  tilcerovi,
} from '../testing.tsx'

/** The settings' own navigation, above the title. */
async function sections(): Promise<HTMLElement> {
  return screen.findByRole('navigation', { name: 'Household settings' })
}

describe('what every screen of household settings is set in', () => {
  it('leads between the settings’ screens, and says which one is open', async () => {
    open(inHousehold.members(home))
    const navigation = await sections()
    expect(
      within(navigation)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual([
      'Household',
      'Members',
      'Invitations',
      'Modules',
      'Storage',
      'Billing',
      'Data',
      'Sync health',
      'Apps and versions',
    ])
    expect(within(navigation).getByRole('link', { name: 'Members' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(within(navigation).getByRole('link', { name: 'Household' })).toHaveAttribute(
      'href',
      inHousehold.settings(home),
    )
    // The profile is open at its own address alone, and not at every one under it.
    expect(within(navigation).getByRole('link', { name: 'Household' })).not.toHaveAttribute(
      'aria-current',
    )
  })

  it('titles the page for the screen it shows', async () => {
    open(inHousehold.modules(home))
    expect(await screen.findByRole('heading', { level: 1, name: 'Modules' })).toBeInTheDocument()
    await waitFor(() => {
      expect(document.title).toBe('Modules · Household')
    })
  })

  it('says nothing of where an owner stands, who may change what is here', async () => {
    open(inHousehold.settings(home))
    await sections()
    expect(screen.queryByText(/Changing it is for an owner/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Read-only/)).not.toBeInTheDocument()
  })

  it('tells a member that they read here and an owner changes, and names the owners', async () => {
    open(inHousehold.settings(home), createServer(accountOf(petr)))
    expect(
      await screen.findByText(
        'You can read everything here. Changing it is for an owner: Jana Tilcerová.',
      ),
    ).toBeInTheDocument()
  })

  // What `view` on household settings unlocks is the invitations (FR-AC3): held at none, the
  // rest is still every member's to read, and the way to the invitations is absent.
  it('draws the settings for a member who holds none on them, without the way to the invitations', async () => {
    open(inHousehold.settings(home), createServer(accountOf(klara)))
    const navigation = await sections()
    expect(
      within(navigation)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Household', 'Members', 'Modules', 'Data', 'Sync health'])
  })

  it('lists the storage picture for a member who holds view on them, and neither billing nor the clients, which are an owner’s', async () => {
    open(inHousehold.settings(home), createServer(accountOf(petr)))
    const navigation = await sections()
    expect(
      within(navigation)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Household', 'Members', 'Invitations', 'Modules', 'Storage', 'Data', 'Sync health'])
  })

  // That a household takes no writes is the banner's to say, above every screen of it
  // (shell/EntitlementBanner.tsx): the settings' own frame says it no second time, and not over
  // the screens that still take a write, billing and the household's data among them.
  it('says nothing of a household that takes no writes, to its owner', async () => {
    const server = createServer()
    server.household = {
      ...tilcerovi,
      entitlement: { state: 'read_only', can_write: false, can_upload: false },
    }
    open(inHousehold.settings(home), server)
    await sections()
    expect(await screen.findByRole('heading', { level: 1, name: 'Household' })).toBeInTheDocument()
    expect(screen.queryByText(/read-only|restricted/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Changing it is for an owner/)).not.toBeInTheDocument()
  })

  it('tells a member of such a household what it tells one of any: that changing is an owner’s', async () => {
    const server = createServer(accountOf(petr))
    server.household = {
      ...readBy(memberOf(petr)),
      entitlement: { state: 'restricted', can_write: false, can_upload: false },
    }
    open(inHousehold.settings(home), server)
    expect(
      await screen.findByText(
        'You can read everything here. Changing it is for an owner: Jana Tilcerová.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/read-only|restricted/i)).not.toBeInTheDocument()
  })
})
