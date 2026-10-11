// The built-ins a device's engine is known not to have, and some newer ones it is known to
// have, in one list that is used twice. With no device, the sources a bundle is made of are read
// for a call of one it lacks (e2e/engine.test.ts): Jest runs on Node, which has them all, so
// such a call passes every test and ends the app on a device, as a list sorted with `toSorted`
// in a fixture did (run 38066536920). And on a device, the engine screen asks the engine itself
// whether the list is right (checks.ts), so that it is checked by a run and not only read.
//
// Read at what React Native 0.86 and Expo 57 ship. Read both again when either moves: a name
// the engine has gained leaves `lacking`, and the engine screen's line fails until it has.

export interface BuiltIn {
  /** As a reader names it. */
  readonly name: string
  /** Whether the engine this is asked on has it. */
  readonly has: () => boolean
  /** A call of it, as a source writes one. */
  readonly call: RegExp
}

/** Whether `owner` holds a function under `name`, whatever the compiler knows of it. */
function holds(owner: unknown, name: string): boolean {
  return (
    (typeof owner === 'object' || typeof owner === 'function') &&
    owner !== null &&
    typeof Reflect.get(owner, name) === 'function'
  )
}

const scope: unknown = globalThis

/** One of the engine's own, by its name in the global scope: `Array`, `AbortSignal`. */
function named(name: string): unknown {
  return typeof scope === 'object' && scope !== null ? Reflect.get(scope, name) : undefined
}

/**
 * What Hermes lacks (hermes-v250829098.0.17, the `hermes-compiler` a build compiles with). Each
 * is a method of its arrays, objects or maps, which it implements natively and names in one
 * list, `include/hermes/VM/PredefinedStrings.def`: these are in none, where `toReversed`,
 * `toSpliced`, `with` and `findLast` are. What it implements in JavaScript is `Promise` and the
 * asynchronous functions alone (`lib/InternalJavaScript`). The first was met on a device too.
 */
export const lacking: readonly BuiltIn[] = [
  {
    name: 'Array.prototype.toSorted',
    has: () => holds(Array.prototype, 'toSorted'),
    call: /\.toSorted\(/,
  },
  {
    name: 'Array.fromAsync',
    has: () => holds(Array, 'fromAsync'),
    call: /\bArray\.fromAsync\b/,
  },
  {
    name: 'Object.groupBy',
    has: () => holds(Object, 'groupBy'),
    call: /\bObject\.groupBy\b/,
  },
  { name: 'Map.groupBy', has: () => holds(Map, 'groupBy'), call: /\bMap\.groupBy\b/ },
]

/**
 * What a device has, though a reader might take it for missing: newer than most of the
 * language, and absent from React Native by itself or from an older Hermes. No source is read
 * for these; the engine screen says whether each is there.
 *
 * - `Promise.withResolvers`: Hermes's own `Promise`, `lib/InternalJavaScript/01-Promise.js` at
 *   the tag above, which React Native keeps where the engine provides one.
 * - `structuredClone`, `AbortSignal.timeout`, `AbortSignal.any`: installed as the app starts by
 *   Expo's runtime (`expo/src/winter/runtime.native.ts`: `installGlobal('structuredClone', …)`
 *   and `installAbortSignalPatch`, which adds the two where `AbortSignal` has none,
 *   `expo/src/winter/AbortSignal.ts`). Without Expo's runtime they would be absent.
 */
export const held: readonly BuiltIn[] = [
  {
    name: 'Promise.withResolvers',
    has: () => holds(Promise, 'withResolvers'),
    call: /\bPromise\.withResolvers\b/,
  },
  {
    name: 'structuredClone',
    has: () => typeof named('structuredClone') === 'function',
    call: /\bstructuredClone\(/,
  },
  {
    name: 'AbortSignal.timeout',
    has: () => holds(named('AbortSignal'), 'timeout'),
    call: /\bAbortSignal\.timeout\b/,
  },
  {
    name: 'AbortSignal.any',
    has: () => holds(named('AbortSignal'), 'any'),
    call: /\bAbortSignal\.any\b/,
  },
]
