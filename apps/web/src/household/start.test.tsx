import { screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { inHousehold } from '../app/paths.ts'
import type { ModuleRegistry } from '../modules/registry.ts'
import { draw } from '../test/render.tsx'
import type { ModuleKey } from './households.ts'
import { beginnings, StartView } from './Start.tsx'
import { accountOf, createServer, home, klara, open } from './testing.tsx'

const at = (module: ModuleKey) => ({
  home: (household: string) => inHousehold.module(household, module),
})
const capturing = (module: ModuleKey) => ({
  ...at(module),
  capture: (household: string) => inHousehold.module(household, module, 'new'),
})

/** A build in which Shopping, Tasks and Finance take a first record, and Garden only opens. */
const registry: ModuleRegistry = {
  tasks: capturing('tasks'),
  shopping: capturing('shopping'),
  finance: capturing('finance'),
  garden: at('garden'),
}

describe('where a first run may begin', () => {
  it('is each module the member holds that takes a first record, in the product’s order', () => {
    const household = {
      id: home,
      my_grants: { shopping: 'contribute', tasks: 'view', finance: 'none', garden: 'manage' },
    } as const
    expect(beginnings(household, registry)).toEqual([
      { module: 'tasks', to: inHousehold.module(home, 'tasks', 'new') },
      { module: 'shopping', to: inHousehold.module(home, 'shopping', 'new') },
    ])
  })

  it('is nowhere in a build where no module takes one', () => {
    expect(beginnings({ id: home, my_grants: { garden: 'manage' } }, registry)).toEqual([])
    expect(beginnings({ id: home, my_grants: { shopping: 'manage' } }, {})).toEqual([])
  })
})

describe('what brought you here?', () => {
  it('asks a question, offers where to begin, and says that nothing is switched off by it', () => {
    draw(
      <MemoryRouter>
        <StartView
          household={{ id: home }}
          offered={[{ module: 'shopping', to: inHousehold.module(home, 'shopping', 'new') }]}
        />
      </MemoryRouter>,
    )
    expect(
      screen.getByRole('heading', { level: 1, name: 'What brought you here?' }),
    ).toBeInTheDocument()
    expect(document.title).toBe('What brought you here? · Household')
    expect(screen.getByText(/Nothing is switched off by the answer/)).toBeInTheDocument()
    const answers = screen.getByRole('list', { name: 'Where to start' })
    expect(within(answers).getByRole('link', { name: 'Shopping' })).toHaveAttribute(
      'href',
      inHousehold.module(home, 'shopping', 'new'),
    )
    // Skipping is as plain a way on as answering, and lands on the household’s Home.
    expect(screen.getByRole('link', { name: 'Skip this, and go to Home' })).toHaveAttribute(
      'href',
      inHousehold.home(home),
    )
    // It is never worded as a choice of modules (DD-6).
    expect(document.body).not.toHaveTextContent(/choose your modules/i)
  })

  // No module of this build takes a first record yet: there is nothing to ask.
  it('passes on to the household’s Home where there is nothing to begin at', async () => {
    const { router } = open(inHousehold.start(home))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(inHousehold.home(home))
    })
  })

  it('passes on for a member who holds nothing of the household’s settings, too', async () => {
    const { router } = open(inHousehold.start(home), createServer(accountOf(klara)))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(inHousehold.home(home))
    })
  })
})
