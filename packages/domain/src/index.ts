/**
 * @household/domain — pure functions with no I/O that both clients and the server compute:
 * money, tariff and allocation previews, recurrence, unit conversion. The server's twin
 * is cross-checked through @household/test-vectors (06-clients §1, D-37). v0 is money
 * (plan item 6) and the storage blocks a household is billed (item 19); the Utilities and
 * Finance engines arrive in items 55 and 61.
 */
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
  type StorageAllowance,
} from './storage.ts'
