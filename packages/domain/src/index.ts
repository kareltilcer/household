/**
 * @household/domain — pure functions with no I/O that both clients and the server compute:
 * money, tariff and allocation previews, recurrence, unit conversion. The server's twin
 * is cross-checked through @household/test-vectors (06-clients §1, D-37). v0 is money
 * (plan item 6), the storage blocks a household is billed (item 19) and the levels a role
 * starts with and may hold (item 26); the Utilities and Finance engines arrive in items 55
 * and 61.
 */
export {
  accessLevels,
  grantCeiling,
  grantDefaults,
  grantModules,
  householdRoles,
  withinCeiling,
  type AccessLevel,
  type GrantModule,
  type Grants,
  type HouseholdRole,
} from './grants.ts'
export {
  add,
  convert,
  currencyCodes,
  exponent,
  maxMinor,
  money,
  MoneyError,
  multiply,
  roundHalfUp,
  split,
  subtract,
  type Money,
  type MoneyErrorCode,
  type Share,
} from './money.ts'
export {
  averageBytes,
  gigabyte,
  projectedAverageBytes,
  storageAllowance,
  storageBlocks,
  storageCharge,
  storageWarns,
  type StorageAllowance,
} from './storage.ts'
