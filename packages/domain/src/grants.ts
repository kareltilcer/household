// Module grants (PRD 02 §4 and §5): the level a new member of each role starts with on every
// module, and the highest a role may hold on one. A client draws both before the server is
// asked, in the invitation composer, where a child profile is made and in a member's matrix,
// where a level a role cannot hold is not offered at all; the server writes the first and
// refuses above the second (internal/platform/household, internal/platform/access). Both sides
// run vectors/grants.json.

/** The four levels, lowest first (FR-AC1). `none` is absent, not hidden. */
export const accessLevels = ['none', 'view', 'contribute', 'manage'] as const

export type AccessLevel = (typeof accessLevels)[number]

/** The three roles (PRD 02 §4). */
export const householdRoles = ['owner', 'member', 'child'] as const

export type HouseholdRole = (typeof householdRoles)[number]

/**
 * The seventeen modules, in the contract's order (`ModuleKeyValue`): every one is listed, since
 * a module missing from the defaults is a module whose default nobody decided (FR-AC3).
 */
export const grantModules = [
  'dashboard',
  'tasks',
  'reminders',
  'calendar',
  'shopping',
  'chores',
  'notes',
  'documents',
  'finance',
  'utilities',
  'garden',
  'property',
  'vehicles',
  'pets',
  'chat',
  'activity',
  'admin',
] as const

export type GrantModule = (typeof grantModules)[number]

export type Grants = Readonly<Record<GrantModule, AccessLevel>>

function levels(of: Partial<Record<GrantModule, AccessLevel>>, rest: AccessLevel): Grants {
  const out: Partial<Record<GrantModule, AccessLevel>> = {}
  for (const module of grantModules) out[module] = of[module] ?? rest
  return out as Grants
}

/**
 * A new member's levels (FR-AC3): open on what a household does together, closed on what it
 * owns and spends.
 */
const memberDefaults = levels(
  {
    dashboard: 'contribute',
    tasks: 'contribute',
    reminders: 'contribute',
    calendar: 'contribute',
    shopping: 'contribute',
    chores: 'contribute',
    notes: 'contribute',
    chat: 'contribute',
    pets: 'contribute',
    documents: 'view',
    activity: 'view',
    admin: 'view',
  },
  'none',
)

/** A new child profile's levels (FR-AC4): Finance, Chat and the activity log among the closed. */
const childDefaults = levels(
  {
    chores: 'contribute',
    shopping: 'contribute',
    calendar: 'contribute',
    tasks: 'contribute',
    pets: 'contribute',
    reminders: 'view',
    dashboard: 'view',
  },
  'none',
)

const ownerDefaults = levels({}, 'manage')

/** The levels a new member with `role` starts with, on every module. */
export function grantDefaults(role: HouseholdRole): Grants {
  switch (role) {
    case 'owner':
      return ownerDefaults
    case 'member':
      return memberDefaults
    case 'child':
      return childDefaults
  }
}

/**
 * The highest level `role` may hold on `module`: `manage` for an owner and a member, and for a
 * child `contribute`, which is `view` on Finance (FR-AC4).
 */
export function grantCeiling(role: HouseholdRole, module: GrantModule): AccessLevel {
  if (role !== 'child') return 'manage'
  return module === 'finance' ? 'view' : 'contribute'
}

/** Whether `level` is no higher than `ceiling`. */
export function withinCeiling(level: AccessLevel, ceiling: AccessLevel): boolean {
  return accessLevels.indexOf(level) <= accessLevels.indexOf(ceiling)
}
