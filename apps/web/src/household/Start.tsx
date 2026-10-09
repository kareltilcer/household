// *What brought you here?* (DD-6, 03-patterns §6): the third step of a first run, where the
// member who has just made a household picks the one module they came for and is taken straight
// to where it takes a first record, its capture surface (03-patterns §7). It is a question about
// where to begin and nothing more: no module is turned on or off by the answer, every one stays
// on, and the choice is made again simply by opening another. So it is worded as a question and
// never as a choice of modules, and skipping it is as plain a way on as answering it.
//
// It offers the modules that have such a surface in this build (modules/registry.ts), of those
// the member holds, in the product's order. Where none has one yet there is nothing to ask, and
// the screen passes on to the household's Home: a question whose every answer leads to the same
// place is no question. Each module's web item registers its surface as it lands.
//
// The answer is where the member goes, and nothing is kept of it here. The starting layout of
// the dashboard, which the same answer is to choose (FR-DB4), is the dashboard's own to ask for
// when it is built (plan items 36 and 37).
import { ModuleIcon } from '@household/icons/web'
import { Link, Navigate } from 'react-router'
import { inHousehold } from '../app/paths.ts'
import { usePageTitle } from '../app/title.ts'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { modules, type ModuleRegistry } from '../modules/registry.ts'
import styles from '../shell/Arrange.module.css'
import { NavLink } from '../shell/NavLink.tsx'
import { heldModules } from '../shell/navigation.ts'
import { useHousehold } from './HouseholdContext.tsx'
import type { Household, ModuleKey } from './households.ts'

/** A module to start at, and where it takes its first record. */
export interface Beginning {
  readonly module: ModuleKey
  readonly to: string
}

/** Where a member of `household` may begin, in a build with `registry`'s screens. */
export function beginnings(
  household: Pick<Household, 'id' | 'my_grants'>,
  registry: ModuleRegistry,
): Beginning[] {
  return heldModules(household).flatMap((module) => {
    const capture = registry[module]?.capture
    return capture === undefined ? [] : [{ module, to: capture(household.id) }]
  })
}

export interface StartAnswersProps {
  readonly household: Pick<Household, 'id'>
  readonly offered: readonly Beginning[]
}

/** The answers, under whatever asks: the screen's own title, or a dev page's. */
export function StartAnswers({ household, offered }: StartAnswersProps) {
  const t = useTranslate()
  return (
    <>
      <ul className={styles.links} role="list" aria-label={t('household.start.options')}>
        {offered.map(({ module, to }) => (
          <li key={module}>
            <NavLink to={to} icon={<ModuleIcon module={module} />}>
              {t(`module.${module}.name`)}
            </NavLink>
          </li>
        ))}
      </ul>
      <Link className={styles.skip} to={inHousehold.home(household.id)}>
        {t('household.start.skip')}
      </Link>
    </>
  )
}

/** The screen: the question, what it does and does not decide, and the answers. */
export function StartView(props: StartAnswersProps) {
  const t = useTranslate()
  usePageTitle(t('household.start.title'))
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{t('household.start.title')}</h1>
      <p className={styles.lede}>{t('household.start.lede')}</p>
      <StartAnswers {...props} />
    </div>
  )
}

export function Start() {
  const household = useHousehold()
  const offered = beginnings(household, modules)
  if (offered.length === 0) return <Navigate to={inHousehold.home(household.id)} replace />
  return <StartView household={household} offered={offered} />
}
