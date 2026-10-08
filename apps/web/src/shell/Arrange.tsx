// Arranging the modules (F-15, D-38, 04-navigation §5): a member's own order of their modules in
// this household, what they pinned above the rest, and what they put away. It is a preference
// and needs only `view`: every member has it, a child among them. *Hidden by me* is recoverable,
// and this screen is the one place it is named. A module the member does not hold is not in any
// list here, is not counted, and is mentioned nowhere: absent, with no trace.
//
// The handle is a button: the arrow keys move its row, and where the row has come to is said.
// The same moves are in the row's menu, for a pointer. A change is the member's at once, here
// and in the sidebar.
//
// The arrangement is kept in this browser (D-155, arrangement.ts), which decides this screen's
// states. It is read where it is written, so it is never loading, and never fails to load; it is
// written to no server, so a change is never pending, syncing, conflicted or rejected; with no
// connection it works as with one; and a household that is read-only holds none of it back, it
// being the member's and not the household's. A module withdrawn while the screen is open leaves
// its list with no word said beside it: this is not where a member learns of a change of access.
import { controls } from '@household/icons'
import { BaseIcon, ModuleIcon } from '@household/icons/web'
import { useId, useState, type KeyboardEvent } from 'react'
import styles from './Arrange.module.css'
import { usePageTitle } from '../app/title.ts'
import { useHousehold } from '../household/HouseholdContext.tsx'
import type { Household, ModuleKey } from '../household/households.ts'
import { useFormat, useTranslate } from '../i18n/I18nProvider.tsx'
import { modules, type ModuleRegistry } from '../modules/registry.ts'
import { useMe } from '../session/SessionProvider.tsx'
import a11y from '../ui/a11y.module.css'
import { Button, IconButton } from '../ui/Button.tsx'
import { Menu, type MenuItem } from '../ui/Menu.tsx'
import { useArrangement } from './arrangement.ts'
import { hidden, moved, navigationOf, pinned, shown, unpinned } from './navigation.ts'

export interface ArrangeListsProps {
  readonly household: Pick<Household, 'id' | 'my_grants'>
  /** The member whose arrangement it is. */
  readonly user: string
  /** The modules this build has screens for. */
  readonly registry: ModuleRegistry
}

/** The lists themselves, under whatever titles them: the screen's own title, or a dev page's. */
export function ArrangeLists({ household, user, registry }: ArrangeListsProps) {
  const t = useTranslate()
  const format = useFormat()
  const [arrangement, setArrangement] = useArrangement(user, household.id)
  const navigation = navigationOf(household, registry, arrangement)
  // Where the row last moved has come to, said once: the region is on the page from the first.
  const [said, setSaid] = useState('')
  const id = useId()
  const name = (module: ModuleKey) => t(`module.${module}.name`)

  const move = (module: ModuleKey, list: readonly ModuleKey[], by: number) => {
    const next = moved(arrangement, navigation, module, by)
    const at = Math.min(list.length - 1, Math.max(0, list.indexOf(module) + by))
    setArrangement(next)
    setSaid(
      t('shell.arrange.position', {
        name: name(module),
        position: format.number(at + 1),
        count: format.number(list.length),
      }),
    )
  }
  const byArrow =
    (module: ModuleKey, list: readonly ModuleKey[]) =>
    (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
      // The key is the row's, and not the page's to scroll by.
      event.preventDefault()
      move(module, list, event.key === 'ArrowUp' ? -1 : 1)
    }

  /** A row of a list that has an order: its handle, its name, and what else can be done to it. */
  const ordered = (module: ModuleKey, list: readonly ModuleKey[], more: readonly MenuItem[]) => {
    const at = list.indexOf(module)
    const items: MenuItem[] = [
      // A row at an end of its list has no move past it: the item is absent, not disabled.
      ...(at > 0
        ? [
            {
              id: 'up',
              label: t('shell.arrange.move_up'),
              onSelect: () => {
                move(module, list, -1)
              },
            },
          ]
        : []),
      ...(at < list.length - 1
        ? [
            {
              id: 'down',
              label: t('shell.arrange.move_down'),
              onSelect: () => {
                move(module, list, 1)
              },
            },
          ]
        : []),
      ...more,
    ]
    return (
      <li key={module} className={styles.row}>
        <IconButton
          label={t(controls.reorder.labelKey, { name: name(module) })}
          icon={<BaseIcon name={controls.reorder.glyph.id} />}
          onKeyDown={byArrow(module, list)}
        />
        <span className={styles.module}>
          <ModuleIcon module={module} />
          <span className={styles.name}>{name(module)}</span>
        </span>
        <Menu
          trigger={
            <IconButton
              label={t(controls.more_actions.labelKey, { name: name(module) })}
              icon={<BaseIcon name={controls.more_actions.glyph.id} />}
            />
          }
          items={items}
        />
      </li>
    )
  }

  const nothing =
    navigation.pinned.length + navigation.listed.length + navigation.hidden.length === 0
  return (
    <>
      <p className={a11y.visuallyHidden} role="status">
        {said}
      </p>
      {nothing ? (
        <div className={styles.section}>
          <h2 className={styles.heading}>{t('shell.arrange.empty.title')}</h2>
          <p className={styles.note}>{t('shell.arrange.empty.body')}</p>
        </div>
      ) : (
        <>
          {navigation.pinned.length === 0 ? null : (
            <section className={styles.section} aria-labelledby={`${id}-pinned`}>
              <h2 id={`${id}-pinned`} className={styles.heading}>
                {t('shell.sidebar.pinned')}
              </h2>
              <ul className={styles.list} role="list">
                {navigation.pinned.map((module) =>
                  ordered(module, navigation.pinned, [
                    {
                      id: 'unpin',
                      label: t('shell.arrange.unpin'),
                      onSelect: () => {
                        setArrangement(unpinned(arrangement, navigation, module))
                      },
                    },
                  ]),
                )}
              </ul>
            </section>
          )}
          {navigation.listed.length === 0 ? null : (
            <section className={styles.section} aria-labelledby={`${id}-order`}>
              <h2 id={`${id}-order`} className={styles.heading}>
                {t('shell.arrange.order')}
              </h2>
              <ul className={styles.list} role="list">
                {navigation.listed.map((module) =>
                  ordered(module, navigation.listed, [
                    {
                      id: 'pin',
                      label: t('shell.arrange.pin'),
                      onSelect: () => {
                        setArrangement(pinned(arrangement, navigation, module))
                      },
                    },
                    {
                      id: 'hide',
                      label: t('shell.arrange.hide'),
                      onSelect: () => {
                        setArrangement(hidden(arrangement, navigation, module))
                      },
                    },
                  ]),
                )}
              </ul>
            </section>
          )}
          <section className={styles.section} aria-labelledby={`${id}-hidden`}>
            <h2 id={`${id}-hidden`} className={styles.heading}>
              {t('shell.arrange.hidden')}
            </h2>
            {navigation.hidden.length === 0 ? (
              <p className={styles.note}>{t('shell.arrange.hidden.none')}</p>
            ) : (
              <ul className={styles.list} role="list">
                {navigation.hidden.map((module) => (
                  <li key={module} className={styles.row}>
                    <span className={styles.module}>
                      <ModuleIcon module={module} />
                      <span className={styles.name}>{name(module)}</span>
                    </span>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setArrangement(shown(arrangement, navigation, module))
                      }}
                    >
                      <span aria-hidden="true">{t('shell.arrange.show')}</span>
                      <span className={a11y.visuallyHidden}>
                        {t('shell.arrange.show_named', { name: name(module) })}
                      </span>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </>
  )
}

/** The screen: its title, what it is and where it is kept, and the lists. */
export function ArrangeView(props: ArrangeListsProps) {
  const t = useTranslate()
  usePageTitle(t('shell.arrange.title'))
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{t('shell.arrange.title')}</h1>
      <p className={styles.lede}>{t('shell.arrange.lede')}</p>
      <p className={styles.note}>{t('shell.arrange.kept_here')}</p>
      <ArrangeLists {...props} />
    </div>
  )
}

export function Arrange() {
  const me = useMe()
  const household = useHousehold()
  return <ArrangeView household={household} user={me.id} registry={modules} />
}
