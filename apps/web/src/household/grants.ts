// What a member holds (PRD 02 §5, 02-components §4.5): one of four levels on each of the
// seventeen modules, in the words a member reads it in. A level is never shown by the name the
// contract gives it: *Off*, *Can see*, *Can add and edit* and *Can set it up*, each with the
// sentence that says what it comes to, so that a matrix reads without a legend.
//
// A role's defaults and the most it may hold are the shared rule both sides compute
// (@household/domain, vectors/grants.json): the composer shows the defaults before the server is
// asked, and a level a child cannot hold is not offered at all, which is the cap said by
// construction and not by a refused save (03-patterns §9).
import { accessLevels, grantCeiling, grantDefaults, withinCeiling } from '@household/domain'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { everyModule, type AccessLevel, type HouseholdRole, type ModuleKey } from './households.ts'

/** A level on every module. */
export type Levels = Readonly<Record<ModuleKey, AccessLevel>>

/**
 * The order a matrix lists the modules in, which is the order of FR-AC3's own table: what a
 * household does together, then what it reads, then what it owns and spends. A member's
 * defaults draw their one line between the last two groups.
 */
export const matrixOrder = everyModule([
  'dashboard',
  'tasks',
  'reminders',
  'calendar',
  'shopping',
  'chores',
  'notes',
  'chat',
  'pets',
  'documents',
  'activity',
  'admin',
  'finance',
  'utilities',
  'garden',
  'property',
  'vehicles',
])

/** The levels, highest first: the order a summary of what somebody holds is read in. */
export const levelsDown: readonly AccessLevel[] = [...accessLevels].reverse()

/** The levels a new member with `role` starts with (FR-AC3, FR-AC4). */
export function defaultsFor(role: HouseholdRole): Levels {
  return grantDefaults(role)
}

/** The levels `role` may be given on `module`, lowest first: every one up to its ceiling. */
export function offeredLevels(role: HouseholdRole, module: ModuleKey): AccessLevel[] {
  const ceiling = grantCeiling(role, module)
  return accessLevels.filter((level) => withinCeiling(level, ceiling))
}

/**
 * `given` as a level on every module: a module it does not name is held at `none`, as the
 * server holds one it was never told of.
 */
export function levelsOf(given: Readonly<Record<string, AccessLevel>> | undefined): Levels {
  const out: Partial<Record<ModuleKey, AccessLevel>> = {}
  for (const module of matrixOrder) out[module] = given?.[module] ?? 'none'
  return out as Levels
}

/** The modules on which `next` differs from `from`, in the matrix's order. */
export function changedModules(from: Levels, next: Levels): ModuleKey[] {
  return matrixOrder.filter((module) => from[module] !== next[module])
}

/** Whether `next` is lower than `from`: the change a member is told of as it happens (D-78). */
export function isLowered(from: AccessLevel, next: AccessLevel): boolean {
  return accessLevels.indexOf(next) < accessLevels.indexOf(from)
}

/** Whose app a level's sentence speaks of: somebody else's, or the reader's own. */
export type Whose = 'theirs' | 'yours'

export interface LevelWords {
  /** The level in two or three words: *Can add and edit*. */
  readonly name: (level: AccessLevel) => string
  /** What the level comes to, in a sentence. */
  readonly says: (level: AccessLevel, whose?: Whose) => string
}

/** The words for the four levels. */
export function useLevelWords(): LevelWords {
  const t = useTranslate()
  return {
    name: (level) => {
      switch (level) {
        case 'none':
          return t('household.grant.level.none')
        case 'view':
          return t('household.grant.level.view')
        case 'contribute':
          return t('household.grant.level.contribute')
        case 'manage':
          return t('household.grant.level.manage')
      }
    },
    says: (level, whose = 'theirs') => {
      switch (level) {
        case 'none':
          return whose === 'yours'
            ? t('household.grant.says.none_yours')
            : t('household.grant.says.none')
        case 'view':
          return t('household.grant.says.view')
        case 'contribute':
          return t('household.grant.says.contribute')
        case 'manage':
          return t('household.grant.says.manage')
      }
    },
  }
}
