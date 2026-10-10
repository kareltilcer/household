// The shell's screens as a member meets them: Home, Today, More, arranging the modules, the app
// bar every one of them stands under, and the neutral screen. The web's `shell.test.tsx` is
// their twin; what a device changed is said in each case.
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { controls } from '@household/icons'
import { catalogs, createTranslator } from '@household/i18n'
import { act, fireEvent, screen, userEvent, waitFor, within } from '@testing-library/react-native'
import { router } from 'expo-router'
import { Platform, StyleSheet, type StyleProp, type ViewStyle } from 'react-native'
import { HouseholdNotAvailable, NotAvailable } from '../app/NotAvailable.tsx'
import { inHousehold, paths } from '../app/paths.ts'
import type { ModuleKey } from '../household/data.ts'
import { SessionFixture } from '../session/fixture.tsx'
import { SyncFixture, type Sync } from '../sync/ReplicaProvider.tsx'
import { standIn } from '../sync/standIn.ts'
import { conflict, overriddenMerge, registry as entities } from '../sync/sync.fixtures.ts'
import { expectAccessible } from '../test/a11y.ts'
import { fiveModules, householdOf, households, ids, words } from '../test/fixtures.ts'
import { render } from '../test/render.tsx'
import * as announcer from '../ui/announce.ts'
import { AppBar, HouseholdName } from './AppBar.tsx'
import { Arrange, ArrangeLists } from './Arrange.tsx'
import { HouseholdFixture } from './fixture.tsx'
import { HouseholdHome } from './Home.tsx'
import { useArrangement } from './HouseholdContext.tsx'
import { HouseholdScreen } from './HouseholdScreen.tsx'
import { More, MoreList } from './More.tsx'
import { noArrangement, type Arrangement } from './navigation.ts'
import { Panes } from './Panes.tsx'
import { SignOut } from './SignOut.tsx'
import { Today } from './Today.tsx'

// The router's own, which a screen asks to lead somewhere: a test reads where.
jest.mock('expo-router', () => ({
  router: {
    navigate: jest.fn(),
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: jest.fn(() => false),
  },
  useIsFocused: () => true,
}))

const en = catalogs.en
const t = createTranslator('en')

const household = householdOf({
  // Four modules held, Finance at none, and Chat, which the fixture's build cannot open.
  my_grants: {
    dashboard: 'view',
    tasks: 'contribute',
    shopping: 'contribute',
    finance: 'none',
    garden: 'manage',
    chat: 'view',
    admin: 'view',
  },
})

/** A build with screens for five modules, the household's own settings among them. */
const registry = fiveModules

const name = (module: ModuleKey) => en[`module.${module}.name`]

/** A household's replica that is still being opened: nothing is known to wait in it. */
const opening: Sync = { replica: { phase: 'opening' }, online: true, receiving: null }

/** `ui` as the household's frame draws a screen: under the household it read, and its replica. */
function inside(ui: React.ReactElement, arrangement?: Arrangement, sync: Sync = opening) {
  return (
    <SyncFixture value={sync}>
      <HouseholdFixture household={household} {...(arrangement ? { arrangement } : {})}>
        {ui}
      </HouseholdFixture>
    </SyncFixture>
  )
}

/** The arrange screen's lists over a build that has modules, kept as the fixture keeps them. */
function Lists() {
  const [arrangement, arrange] = useArrangement()
  return (
    <ArrangeLists
      household={household}
      registry={registry}
      arrangement={arrangement}
      onArrange={arrange}
    />
  )
}

/** The modules a section lists, in the order it draws them. */
function listed(section: 'pinned' | 'order' | 'hidden'): string[] {
  const found = screen.queryByTestId(`arrange:${section}`)
  if (found === null) return []
  return within(found)
    .queryAllByTestId(/^arrange:row:/)
    .map((row) => String(row.props.testID).replace('arrange:row:', ''))
}

/** What the focus was given to, by its `testID`. */
function testIDOf(target: announcer.Focusable | undefined): unknown {
  const props: Readonly<Record<string, unknown>> = { ...target?.current?.props }
  return props.testID
}

let said: jest.SpiedFunction<typeof announcer.announce>
let focus: jest.SpiedFunction<typeof announcer.focusOn>

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(router.canGoBack).mockReturnValue(false)
  said = jest.spyOn(announcer, 'announce').mockImplementation(() => undefined)
  focus = jest.spyOn(announcer, 'focusOn').mockReturnValue(true)
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('Home and Today', () => {
  it.each([
    [
      'Home',
      <HouseholdHome key="home" />,
      'route:household',
      en['nav.home'],
      en['shell.home.empty'],
    ],
    [
      'Today',
      <Today key="today" />,
      'route:today',
      en['nav.today'],
      en['device.shell.today.empty'],
    ],
  ])(
    '%s says what will be there in one sentence, and nothing else',
    async (_, ui, id, title, sentence) => {
      await render(inside(ui))
      expect(screen.getByTestId(id)).toBeOnTheScreen()
      // Its title is the screen's one header, under the household's name.
      expect(screen.getAllByRole('header')).toHaveLength(1)
      expect(screen.getByRole('header', { name: title })).toBeOnTheScreen()
      expect(screen.getByText(households.own.name)).toBeOnTheScreen()
      expect(within(screen.getByTestId('empty-state')).getByText(sentence)).toBeOnTheScreen()
      // No action that leads nowhere, and no way back from a tab's own screen.
      expect(screen.queryAllByRole('button')).toHaveLength(0)
      expect(screen.queryAllByRole('link')).toHaveLength(0)
      expectAccessible()
    },
  )

  it('survive the largest text', async () => {
    await render(inside(<Today />), { scale: 2, locale: 'de' })
    expectAccessible()
  })
})

describe('the app bar', () => {
  it('names the household first, as a label, and titles the screen', async () => {
    await render(<AppBar title={words.title} household={households.own.name} />)
    expect(screen.getByTestId('app-bar:household')).toHaveTextContent(households.own.name)
    expect(screen.getByRole('header', { name: words.title })).toBeOnTheScreen()
    // A label, and no control: with one membership there is nothing to switch to.
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expectAccessible()
  })

  // Item 29's seam: one prop, and the label is the switcher's control.
  it('makes the household’s name the switcher’s control where it is given one to open', async () => {
    const onSwitch = jest.fn()
    await render(<HouseholdName name={households.own.name} onSwitch={onSwitch} />)
    const control = screen.getByRole('button', {
      name: t(controls.switch_household.labelKey, { household: households.own.name }),
    })
    // The word that is drawn is in its name.
    expect(within(control).getByText(households.own.name)).toBeOnTheScreen()
    await userEvent.press(control)
    expect(onSwitch).toHaveBeenCalledTimes(1)
    expectAccessible()
  })

  it('draws the way back only where it is given one', async () => {
    const onBack = jest.fn()
    await render(<AppBar title={words.title} household={households.own.name} onBack={onBack} />)
    await userEvent.press(screen.getByRole('button', { name: en[controls.back.labelKey] }))
    expect(onBack).toHaveBeenCalledTimes(1)
    expectAccessible()
  })
})

describe('a household’s screen', () => {
  const back = () => screen.queryByRole('button', { name: en[controls.back.labelKey] })

  it('leads back where it was reached from another screen and there is one to go back to', async () => {
    jest.mocked(router.canGoBack).mockReturnValue(true)
    await render(inside(<HouseholdScreen title={words.title} back />))
    const control = back()
    expect(control).not.toBeNull()
    if (control !== null) await userEvent.press(control)
    expect(router.back).toHaveBeenCalledTimes(1)
  })

  // Opened by a link, with nothing behind it: the tab bar is the way on.
  it('draws no way back where there is nothing to go back to', async () => {
    await render(inside(<HouseholdScreen title={words.title} back />))
    expect(back()).toBeNull()
  })

  it('draws none on a tab’s own screen, whatever is behind it', async () => {
    jest.mocked(router.canGoBack).mockReturnValue(true)
    await render(inside(<HouseholdScreen title={words.title} />))
    expect(back()).toBeNull()
  })

  it('draws none beside its list in two panes: the list is still there', async () => {
    jest.mocked(router.canGoBack).mockReturnValue(true)
    const detail = <HouseholdScreen title={words.title} back />
    const view = await render(inside(<Panes list={null} detail={detail} width={834} />))
    expect(screen.getByTestId('panes:two')).toBeOnTheScreen()
    expect(back()).toBeNull()
    await view.unmount()
    // And has one where it took the list's place.
    await render(inside(<Panes list={null} detail={detail} width={390} />))
    expect(back()).not.toBeNull()
  })
})

describe('More', () => {
  const links = () => screen.queryAllByRole('link').map((link) => link.props.testID as string)

  // The build this item ships has no module's screens: the rows that are no module's remain.
  it('is the way out alone in a build with no module’s screens, and says nothing of the rest', async () => {
    await render(inside(<More />))
    expect(screen.getByTestId('route:more')).toBeOnTheScreen()
    expect(screen.getByRole('header', { name: en['device.nav.more'] })).toBeOnTheScreen()
    expect(links()).toEqual([])
    expect(screen.getByRole('button', { name: en['shell.sign_out.action'] })).toBeOnTheScreen()
    // Nothing to arrange, nothing waiting: neither is named.
    expect(screen.queryByText(en['shell.sidebar.arrange'])).toBeNull()
    expect(screen.queryByTestId('badge', { includeHiddenElements: true })).toBeNull()
    expectAccessible()
  })

  // The count is the replica's own: each answer of its that still asks for attention (F-5).
  it('counts what waits in the household’s replica, and leads to it, once that has been read', async () => {
    const stand = standIn({ registry: entities, entries: [conflict, overriddenMerge] })
    const open: Sync = {
      replica: { phase: 'open', ...stand.opened },
      online: true,
      receiving: true,
    }
    await render(inside(<More />, undefined, open))
    const row = await screen.findByRole('link', {
      name: t('shell.sidebar.attention', { count: 2 }),
    })
    expect(row.props.testID).toBe('more:sync')
    await userEvent.press(row)
    expect(jest.mocked(router.navigate).mock.calls).toEqual([[inHousehold.sync(ids.household)]])
    // And no longer once the member has answered one of them and seen the other.
    await act(async () => {
      await stand.opened.replica.discard(conflict.mutation_id)
      await stand.opened.replica.resolve(overriddenMerge.mutation_id)
    })
    await waitFor(() => {
      expect(links()).toEqual([])
    })
  })

  // A visitor has a way to the dev screens on the sign-in screen; a member's is here.
  it('leads to the dev screens in a build that holds them, and holds no trace of them in one that does not', async () => {
    const view = await render(inside(<More />))
    await userEvent.press(screen.getByTestId('more:dev'))
    expect(jest.mocked(router.push).mock.calls).toEqual([[paths.dev.path]])
    await view.unmount()
    // D-154: a dev-only screen is in no build a store serves, and neither is a way to one.
    Object.assign(globalThis, { __DEV__: false })
    try {
      await render(inside(<More />))
      expect(screen.getByTestId('route:more')).toBeOnTheScreen()
      expect(screen.queryByTestId('more:dev')).toBeNull()
      expect(screen.queryByText(paths.dev.path)).toBeNull()
    } finally {
      Object.assign(globalThis, { __DEV__: true })
    }
  })

  it('lists the modules the member holds that the build can open, and no other', async () => {
    await render(
      <MoreList
        household={household}
        registry={registry}
        arrangement={noArrangement}
        waiting={0}
      />,
    )
    expect(links()).toEqual([
      'more:module:tasks',
      'more:module:shopping',
      'more:module:garden',
      'more:module:admin',
      'more:arrange',
    ])
    // Absent, with no trace: one held at none, one the build cannot open, and the dashboard.
    for (const absent of ['finance', 'chat', 'dashboard'] as const) {
      expect(screen.queryByText(name(absent))).toBeNull()
    }
    expect(screen.getByRole('header', { name: en['shell.sidebar.modules'] })).toBeOnTheScreen()
    expect(screen.queryByText(en['shell.sidebar.pinned'])).toBeNull()
    expectAccessible()
  })

  it('draws them in the member’s own order, the pinned above, the hidden nowhere', async () => {
    await render(
      <MoreList
        household={household}
        registry={registry}
        arrangement={{ pinned: ['garden'], order: ['admin', 'shopping'], hidden: ['tasks'] }}
        waiting={0}
      />,
    )
    expect(links()).toEqual([
      'more:module:garden',
      'more:module:admin',
      'more:module:shopping',
      'more:arrange',
    ])
    expect(screen.getByRole('header', { name: en['shell.sidebar.pinned'] })).toBeOnTheScreen()
    expect(screen.queryByText(name('tasks'))).toBeNull()
  })

  it('leads to where each row opens', async () => {
    await render(
      <MoreList
        household={household}
        registry={registry}
        arrangement={noArrangement}
        waiting={1}
      />,
    )
    await userEvent.press(screen.getByRole('link', { name: name('garden') }))
    await userEvent.press(screen.getByRole('link', { name: en['shell.sidebar.arrange'] }))
    await userEvent.press(screen.getByTestId('more:sync'))
    expect(jest.mocked(router.navigate).mock.calls).toEqual([
      [inHousehold.module(ids.household, 'garden')],
      [inHousehold.arrange(ids.household)],
      [inHousehold.sync(ids.household)],
    ])
  })

  // In sync is the absence of an indicator: a row to an empty inbox would be one.
  it('names what waits only while something does, with its count in words and as a figure', async () => {
    const view = await render(
      <MoreList household={household} registry={{}} arrangement={noArrangement} waiting={0} />,
    )
    expect(links()).toEqual([])
    await view.unmount()
    await render(
      <MoreList household={household} registry={{}} arrangement={noArrangement} waiting={2} />,
    )
    const attention = t('shell.sidebar.attention', { count: 2 })
    const row = screen.getByRole('link', { name: attention })
    expect(row.props.testID).toBe('more:sync')
    expect(within(row).getByTestId('badge', { includeHiddenElements: true })).toHaveTextContent('2')
    // The figure is the row's own to say, once.
    expect(within(row).queryByTestId('badge')).toBeNull()
    expectAccessible()
  })

  it('survives the largest text', async () => {
    await render(
      <MoreList
        household={household}
        registry={registry}
        arrangement={noArrangement}
        waiting={3}
      />,
      { scale: 2, locale: 'de' },
    )
    expectAccessible()
  })
})

describe('signing out', () => {
  const control = () => screen.getByRole('button', { name: en['shell.sign_out.action'] })

  it('asks the session, and stays busy until the guard has led away', async () => {
    const signOut = jest.fn(() => Promise.resolve())
    await render(
      <SessionFixture signOut={signOut}>
        <SignOut />
      </SessionFixture>,
    )
    await userEvent.press(control())
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(control()).toBeBusy()
    // A second press starts nothing.
    await userEvent.press(control())
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('toast')).toBeNull()
    expectAccessible()
  })

  it('says so where the server could not be told: the member is still signed in', async () => {
    let refuse: (reason: Error) => void = () => undefined
    const signOut = jest.fn(
      () =>
        new Promise<void>((_, reject) => {
          refuse = reject
        }),
    )
    await render(
      <SessionFixture signOut={signOut}>
        <SignOut />
      </SessionFixture>,
    )
    await userEvent.press(control())
    expect(control()).toBeBusy()
    await act(async () => {
      refuse(new Error('no answer'))
      await Promise.resolve()
    })
    expect(control()).not.toBeBusy()
    expect(screen.getByTestId('toast')).toHaveTextContent(
      new RegExp(en['shell.sign_out.failed'].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    )
    // And is theirs again.
    await userEvent.press(control())
    expect(signOut).toHaveBeenCalledTimes(2)
  })
})

describe('arranging the modules', () => {
  const handle = (module: ModuleKey) =>
    screen.getByRole('adjustable', {
      name: t('device.shell.arrange.reorder', { name: name(module) }),
    })
  const position = (module: ModuleKey, at: number, count: number) =>
    t('shell.arrange.position', {
      name: name(module),
      position: String(at),
      count: String(count),
    })
  /** The element the focus was last given to, by its `testID`. */
  const focused = () => testIDOf(focus.mock.lastCall?.[0])

  /** Chooses `item` from the menu of `module`'s row. */
  async function choose(module: ModuleKey, item: string) {
    await userEvent.press(
      screen.getByRole('button', {
        name: t(controls.more_actions.labelKey, { name: name(module) }),
      }),
    )
    await userEvent.press(screen.getByRole('button', { name: item }))
  }

  beforeEach(() => {
    // Everywhere but on iOS a menu's sheet is gone as soon as it is closed, and its item acts.
    jest.replaceProperty(Platform, 'OS', 'android')
  })

  it('says what it is and where the order is kept, and that there is nothing to arrange yet', async () => {
    await render(inside(<Arrange />))
    expect(screen.getByTestId('route:arrange')).toBeOnTheScreen()
    expect(screen.getByRole('header', { name: en['shell.arrange.title'] })).toBeOnTheScreen()
    expect(screen.getByText(en['shell.arrange.lede'])).toBeOnTheScreen()
    // On this device, and not in "this browser": a phone and a browser order their lists apart.
    expect(screen.getByText(en['device.shell.arrange.kept_here'])).toBeOnTheScreen()
    // No build has a module's screens yet: the empty state, and no list.
    expect(screen.getByRole('header', { name: en['shell.arrange.empty.title'] })).toBeOnTheScreen()
    expect(
      within(screen.getByTestId('empty-state')).getByText(en['shell.arrange.empty.body']),
    ).toBeOnTheScreen()
    expect(screen.queryByTestId('arrange:hidden')).toBeNull()
    expectAccessible()
  })

  it('draws three sections, the pinned and the ordered only where they hold something', async () => {
    const view = await render(inside(<Lists />))
    expect(listed('order')).toEqual(['tasks', 'shopping', 'garden', 'admin'])
    expect(screen.queryByTestId('arrange:pinned')).toBeNull()
    // Hidden by me is always there, and says when it is empty: this is the one place it is named.
    expect(screen.getByRole('header', { name: en['shell.arrange.hidden'] })).toBeOnTheScreen()
    expect(screen.getByText(en['shell.arrange.hidden.none'])).toBeOnTheScreen()
    // A module the member does not hold is in no section, and is not mentioned.
    for (const absent of ['finance', 'chat', 'dashboard'] as const) {
      expect(screen.queryByText(name(absent))).toBeNull()
    }
    expectAccessible()
    await view.unmount()

    await render(
      inside(<Lists />, {
        pinned: ['garden', 'tasks', 'shopping', 'admin'],
        order: [],
        hidden: [],
      }),
    )
    expect(listed('pinned')).toEqual(['garden', 'tasks', 'shopping', 'admin'])
    expect(screen.queryByTestId('arrange:order')).toBeNull()
  })

  it('moves a row by its handle’s own actions, and says where it has come to', async () => {
    await render(inside(<Lists />))
    await fireEvent(handle('tasks'), 'accessibilityAction', {
      nativeEvent: { actionName: 'decrement' },
    })
    expect(listed('order')).toEqual(['shopping', 'tasks', 'garden', 'admin'])
    expect(said).toHaveBeenLastCalledWith(position('tasks', 2, 4))
    await fireEvent(handle('tasks'), 'accessibilityAction', {
      nativeEvent: { actionName: 'increment' },
    })
    expect(listed('order')).toEqual(['tasks', 'shopping', 'garden', 'admin'])
    expect(said).toHaveBeenLastCalledWith(position('tasks', 1, 4))
    // Held at the end of its list, and told that it is still there.
    await fireEvent(handle('tasks'), 'accessibilityAction', {
      nativeEvent: { actionName: 'increment' },
    })
    expect(listed('order')).toEqual(['tasks', 'shopping', 'garden', 'admin'])
    expect(said).toHaveBeenLastCalledWith(position('tasks', 1, 4))
    // A move within a list takes the focus nowhere: the handle moved with its row.
    expect(focus).not.toHaveBeenCalled()
  })

  it('names each of the handle’s moves, and offers none past an end of the list', async () => {
    await render(inside(<Lists />))
    const up = { name: 'increment', label: en['shell.arrange.move_up'] }
    const down = { name: 'decrement', label: en['shell.arrange.move_down'] }
    expect(handle('tasks').props.accessibilityActions).toEqual([down])
    expect(handle('shopping').props.accessibilityActions).toEqual([up, down])
    expect(handle('admin').props.accessibilityActions).toEqual([up])
    // A handle takes no press: nothing is dragged, and no tap moves a row.
    expect(handle('tasks').props.onClick).toBeUndefined()
  })

  it('moves a row from its menu, which has no move past an end of the list', async () => {
    await render(inside(<Lists />))
    await choose('tasks', en['shell.arrange.move_down'])
    expect(listed('order')).toEqual(['shopping', 'tasks', 'garden', 'admin'])
    expect(said).toHaveBeenLastCalledWith(position('tasks', 2, 4))

    await userEvent.press(
      screen.getByRole('button', {
        name: t(controls.more_actions.labelKey, { name: name('shopping') }),
      }),
    )
    // First of its list: absent, not disabled.
    expect(screen.queryByRole('button', { name: en['shell.arrange.move_up'] })).toBeNull()
    expect(screen.getByRole('button', { name: en['shell.arrange.move_down'] })).toBeOnTheScreen()
    expectAccessible()
  })

  it('pins a row above the rest: it is said, and the focus goes with the row', async () => {
    await render(inside(<Lists />))
    await choose('garden', en['shell.arrange.pin'])
    expect(listed('pinned')).toEqual(['garden'])
    expect(listed('order')).toEqual(['tasks', 'shopping', 'admin'])
    expect(said).toHaveBeenLastCalledWith(t('shell.arrange.said.pinned', { name: name('garden') }))
    // The one row of its list has no handle: the focus is on its name.
    expect(focused()).toBe('arrange:name:garden')

    await choose('admin', en['shell.arrange.pin'])
    expect(listed('pinned')).toEqual(['garden', 'admin'])
    expect(focused()).toBe('arrange:handle:admin')

    await choose('garden', en['shell.arrange.unpin'])
    expect(listed('pinned')).toEqual(['admin'])
    expect(listed('order')).toEqual(['garden', 'tasks', 'shopping'])
    expect(said).toHaveBeenLastCalledWith(
      t('shell.arrange.said.unpinned', { name: name('garden') }),
    )
    expect(focused()).toBe('arrange:handle:garden')
  })

  it('puts a row away and shows it again, each said, the focus going with the row', async () => {
    const kept: Arrangement[] = []
    await render(
      <HouseholdFixture
        household={household}
        onArrange={(next) => {
          kept.push(next)
        }}
      >
        <Lists />
      </HouseholdFixture>,
    )
    await choose('shopping', en['shell.arrange.hide'])
    expect(listed('order')).toEqual(['tasks', 'garden', 'admin'])
    expect(listed('hidden')).toEqual(['shopping'])
    expect(said).toHaveBeenLastCalledWith(
      t('shell.arrange.said.hidden', { name: name('shopping') }),
    )
    expect(focused()).toBe('arrange:name:shopping')
    expect(screen.queryByText(en['shell.arrange.hidden.none'])).toBeNull()
    expect(kept.at(-1)?.hidden).toEqual(['shopping'])

    // Drawn as one word, and named for what it shows.
    const show = screen.getByRole('button', {
      name: t('shell.arrange.show_named', { name: name('shopping') }),
    })
    expect(within(show).getByText(en['shell.arrange.show'])).toBeOnTheScreen()
    await userEvent.press(show)
    // Last of the list, where a member looks for it.
    expect(listed('order')).toEqual(['tasks', 'garden', 'admin', 'shopping'])
    expect(listed('hidden')).toEqual([])
    expect(said).toHaveBeenLastCalledWith(t('shell.arrange.said.shown', { name: name('shopping') }))
    expect(focused()).toBe('arrange:handle:shopping')
    expect(kept.at(-1)).toEqual({
      pinned: [],
      order: ['tasks', 'garden', 'admin', 'shopping'],
      hidden: [],
    })
  })

  it('follows a row that goes back and forth each time', async () => {
    await render(inside(<Lists />))
    await choose('tasks', en['shell.arrange.hide'])
    await userEvent.press(
      screen.getByRole('button', { name: t('shell.arrange.show_named', { name: name('tasks') }) }),
    )
    await choose('tasks', en['shell.arrange.hide'])
    // Between them the menu gave the focus back to its trigger, which has left with its row.
    const followed = focus.mock.calls.map(([target]) => testIDOf(target))
    expect(followed.filter((id) => id !== undefined)).toEqual([
      'arrange:name:tasks',
      'arrange:handle:tasks',
      'arrange:name:tasks',
    ])
    expect(focused()).toBe('arrange:name:tasks')
  })

  // Side by side on a tablet, one under another on a phone: by the room, counted in the text.
  it.each([1, 2])('gives each section room counted in the reader’s text (× %i)', async (scale) => {
    await render(inside(<Lists />, { pinned: ['garden'], order: [], hidden: ['tasks'] }), {
      scale,
    })
    for (const section of ['pinned', 'order', 'hidden'] as const) {
      const style = StyleSheet.flatten(
        screen.getByTestId(`arrange:${section}`).props.style as StyleProp<ViewStyle>,
      )
      expect(style).toMatchObject({ flexGrow: 1, flexBasis: 224 * scale })
    }
    expectAccessible()
  })
})

describe('not available', () => {
  const texts = () =>
    screen
      .getAllByText(/./)
      .map((text) => text.props.children as string)
      .sort()

  it('names nothing, gives no cause and offers no retry: one way out, to where the app opens', async () => {
    await render(<NotAvailable />)
    expect(screen.getByTestId('route:notFound')).toBeOnTheScreen()
    expect(screen.getByRole('header', { name: en['ui.not_available.title'] })).toBeOnTheScreen()
    // Its three sentences, and not a word more.
    expect(texts()).toEqual(
      [
        en['ui.not_available.title'],
        en['ui.not_available.body'],
        en['ui.not_available.home'],
      ].sort(),
    )
    expect(screen.getAllByRole('button')).toHaveLength(1)
    await userEvent.press(screen.getByRole('button', { name: en['ui.not_available.home'] }))
    // In the place of the address that opened nothing.
    expect(jest.mocked(router.replace).mock.calls).toEqual([[paths.home.path]])
    expectAccessible()
  })

  it('is drawn in the household’s frame inside one, with that household’s Home as the way out', async () => {
    await render(inside(<HouseholdNotAvailable />))
    expect(screen.getByTestId('route:householdNotFound')).toBeOnTheScreen()
    expect(screen.getByRole('header', { name: en['ui.not_available.title'] })).toBeOnTheScreen()
    // The household is the member's own, and is named as on any of its screens; what the
    // address was for is not.
    expect(texts()).toEqual(
      [
        households.own.name,
        en['ui.not_available.title'],
        en['ui.not_available.body'],
        en['ui.not_available.home'],
      ].sort(),
    )
    await userEvent.press(screen.getByRole('button', { name: en['ui.not_available.home'] }))
    expect(jest.mocked(router.replace).mock.calls).toEqual([[inHousehold.home(ids.household)]])
    expectAccessible()
  })

  it('survives the largest text', async () => {
    await render(<NotAvailable />, { scale: 2, locale: 'de' })
    expectAccessible()
  })
})
