import { vectors } from '@household/test-vectors'
import { runVectors } from '@household/test-vectors/vitest'
import { describe, expect, it } from 'vitest'
import {
  accessLevels,
  grantCeiling,
  grantDefaults,
  grantModules,
  householdRoles,
  withinCeiling,
  type GrantModule,
  type HouseholdRole,
} from './grants.ts'

function role(value: string): HouseholdRole {
  const found = householdRoles.find((known) => known === value)
  if (found === undefined) throw new Error(`${value} is no role`)
  return found
}

function module(value: string): GrantModule {
  const found = grantModules.find((known) => known === value)
  if (found === undefined) throw new Error(`${value} is no module`)
  return found
}

describe('vectors/grants.json', () => {
  runVectors(
    vectors.grants,
    {
      defaults: (input) => grantDefaults(role(input)),
      ceiling: (input) => grantCeiling(role(input.role), module(input.module)),
    },
    () => undefined,
  )
})

describe('a role’s defaults', () => {
  it.each(householdRoles)('are within what %s may hold, on every module', (given) => {
    const defaults = grantDefaults(given)
    for (const name of grantModules) {
      expect(withinCeiling(defaults[name], grantCeiling(given, name)), name).toBe(true)
    }
  })

  it('draw the member’s line at money and possessions: nine open, three to read, five closed', () => {
    const counts = Object.fromEntries(accessLevels.map((level) => [level, 0]))
    for (const level of Object.values(grantDefaults('member'))) {
      counts[level] = (counts[level] ?? 0) + 1
    }
    expect(counts).toEqual({ none: 5, view: 3, contribute: 9, manage: 0 })
  })
})
