// The grant matrix (02-components §4.5): seventeen modules by four levels, for one member. It is
// drawn two ways. `GrantMatrix` is the one an owner fills in: a row a module, each a choice among
// the levels the role may hold, with what the chosen level comes to said under it, so that the
// matrix reads without a legend, at a phone's width as at a desk's. `GrantSummary` is what
// everybody else reads, and what a matrix comes to once it is settled: the modules gathered
// under each level, highest first, each level with its own sentence.
//
// A level the role cannot hold is not among a row's choices. A child profile is never offered
// *Can set it up*, nor more than *Can see* on Finance: the cap is said by construction, and not
// by a save the server refuses (03-patterns §9). An owner holds everything and has no matrix to
// fill in, which the screen that would draw one says in its place.
//
// Household settings is the one row whose levels do not mean what the others' mean (grants.ts,
// D-167): no level takes its screens out of a member's app, and none above *Can see* adds
// anything. Its row says so in sentences of its own, and a summary draws it apart from the
// levels' groups, whose sentences would be untrue of it.
import { accessLevels } from '@household/domain'
import { ModuleIcon } from '@household/icons/web'
import { useFormat, useTranslate } from '../i18n/I18nProvider.tsx'
import { Select } from '../ui/Field.tsx'
import {
  levelsDown,
  matrixOrder,
  offeredLevels,
  settingsModule,
  useLevelWords,
  type Levels,
  type Whose,
} from './grants.ts'
import styles from './Grants.module.css'
import type { AccessLevel, HouseholdRole, ModuleKey } from './households.ts'

export interface GrantMatrixProps {
  /** What is being decided, and for whom: the matrix's name. */
  readonly label: string
  /** The role the levels are chosen for: it bounds what each row offers. */
  readonly role: HouseholdRole
  readonly levels: Levels
  /**
   * What each row is held against, and said to have changed from where it differs: the role's
   * defaults in the composer, what is saved on a member's own page.
   */
  readonly from: Levels
  /** The modules the household has off: a level on one holds for when it is turned on. */
  readonly off?: ReadonlySet<ModuleKey>
  /** What the server refused a row for, by module. */
  readonly errors?: ReadonlyMap<ModuleKey, string>
  readonly onChange: (module: ModuleKey, level: AccessLevel) => void
}

export function GrantMatrix({
  label,
  role,
  levels,
  from,
  off,
  errors,
  onChange,
}: GrantMatrixProps) {
  const t = useTranslate()
  const words = useLevelWords()
  return (
    <ul className={styles.matrix} role="list" aria-label={label}>
      {matrixOrder.map((module) => {
        const level = levels[module]
        const offered = offeredLevels(role, module)
        // What is held stays a choice though the role may not be given it: nothing is changed
        // by a matrix that was only opened.
        const choices = offered.includes(level) ? offered : [...offered, level]
        const says = [
          words.says(level, 'theirs', module),
          ...(from[module] === level
            ? []
            : [t('household.grant.changed_from', { level: words.name(from[module]) })]),
          ...(off?.has(module) === true ? [t('household.grant.module_off')] : []),
        ]
        return (
          <li key={module} className={styles.row}>
            <span className={styles.glyph}>
              <ModuleIcon module={module} />
            </span>
            <Select
              label={t(`module.${module}.name`)}
              help={says.join(' ')}
              error={errors?.get(module)}
              value={level}
              options={choices.map((choice) => ({ value: choice, label: words.name(choice) }))}
              onChange={(event) => {
                const chosen = accessLevels.find((known) => known === event.currentTarget.value)
                if (chosen !== undefined) onChange(module, chosen)
              }}
            />
          </li>
        )
      })}
    </ul>
  )
}

interface Summarised {
  /** What somebody holds. A module it does not name is not drawn. */
  readonly grants: Readonly<Record<string, AccessLevel>> | undefined
  /** Whose app the sentences speak of. */
  readonly whose: Whose
}

export type GrantSummaryProps = Summarised &
  (
    | {
        /**
         * A row of a list of members: each level with its modules on one line, the levels'
         * sentences left out, and what is off counted and not named. The comparison is across
         * rows, and no sentence is drawn to be untrue of a module.
         */
        readonly compact: true
      }
    | {
        readonly compact?: false
        /**
         * The role the levels are held under. An owner holds and may change everything, and
         * household settings is gathered with the rest. For a member or a child profile it is
         * a group of its own, last, with the sentence that is true of its level there.
         */
        readonly role: HouseholdRole
      }
  )

export function GrantSummary(props: GrantSummaryProps) {
  const { grants, whose } = props
  const t = useTranslate()
  const format = useFormat()
  const words = useLevelWords()
  /** Household settings' own level, where it is drawn apart from the levels' groups. */
  const settings =
    props.compact === true || props.role === 'owner' ? undefined : grants?.[settingsModule]
  const held = levelsDown
    .map((level) => ({
      level,
      modules: matrixOrder.filter(
        (module) =>
          grants?.[module] === level && (settings === undefined || module !== settingsModule),
      ),
    }))
    .filter((group) => group.modules.length > 0)
  const named = (modules: readonly ModuleKey[]) =>
    format.list(modules.map((module) => t(`module.${module}.name`)))

  if (props.compact === true) {
    return (
      <ul className={styles.lines} role="list">
        {held.map(({ level, modules }) => (
          <li key={level} className={styles.line}>
            {level === 'none'
              ? t('household.grant.line_off', { count: modules.length })
              : t('household.grant.line', { level: words.name(level), modules: named(modules) })}
          </li>
        ))}
      </ul>
    )
  }
  return (
    <dl className={styles.summary}>
      {held.map(({ level, modules }) => (
        <div key={level} className={styles.group}>
          <dt className={styles.level}>
            {t('household.grant.group', {
              level: words.name(level),
              count: format.number(modules.length),
            })}
          </dt>
          <dd className={styles.held}>
            <span className={styles.says}>{words.says(level, whose)}</span>
            <span className={styles.names}>{named(modules)}</span>
          </dd>
        </div>
      ))}
      {settings === undefined ? null : (
        <div className={styles.group}>
          <dt className={styles.level}>{t(`module.${settingsModule}.name`)}</dt>
          <dd className={styles.held}>
            <span className={styles.says}>{words.says(settings, whose, settingsModule)}</span>
          </dd>
        </div>
      )}
    </dl>
  )
}
