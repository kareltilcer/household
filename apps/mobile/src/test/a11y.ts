// The accessibility rules a test runs over what it drew, since nothing like axe reads a React
// Native tree. They are the ones the design system states and a rendered tree can be held to
// (06-clients §4, 06-accessibility-and-i18n): a rule fails with the element it failed on.
//
// What they read is the host tree a test renders, and so what was declared and not what was
// laid out: Jest lays nothing out. A target's size is the least its style says it is, never
// what a device measured; whether a word is clipped, a colour's contrast (the tokens' own test
// holds the pairs) and the order a screen reader walks are not here. The end-to-end flow and a
// person with a screen reader hold those.
import { catalogs, locales, pseudolocalize, type MessageKey } from '@household/i18n'
import { controls } from '@household/icons'
import { isHiddenFromAccessibility, screen } from '@testing-library/react-native'
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native'
import type { TestInstance } from 'test-renderer'
import { drawn } from './render.tsx'

type Props = Readonly<Record<string, unknown>>

export interface Failure {
  readonly rule: string
  /** The element, as a reader can find it: its type, its `testID`, its role and its name. */
  readonly element: string
  readonly reason: string
}

export interface RuleContext {
  /** The least a target is high and wide: 44 pt at the scale the test drew at. */
  readonly target: number
  /** The `testID`s or names of the controls the test says are out of their form. */
  readonly outOfForm: readonly string[]
}

/** A rule: everything in `tree` that breaks it. */
export type Rule = (tree: TestInstance, context: RuleContext) => readonly Failure[]

export interface AccessibleOptions {
  /** The text scale the tree was drawn at. Left out, the last `render`'s. */
  readonly scale?: number
  /**
   * The controls that are `disabled` because they are out of their form, by `testID` or by
   * name: every other disabled control fails, since one that cannot act is absent.
   */
  readonly outOfForm?: readonly string[]
  /** The rules to hold the tree to. Left out, every one of `rules`. */
  readonly rules?: readonly Rule[]
}

const propsOf = (element: TestInstance): Props => element.props

/** Every host element under `tree`, itself among them, parents first. */
export function elementsOf(tree: TestInstance): TestInstance[] {
  return [
    tree,
    ...tree.children.flatMap((child) => (typeof child === 'string' ? [] : elementsOf(child))),
  ]
}

/** The words `element` holds that a screen reader reads, in order. */
export function textOf(element: TestInstance): string {
  return element.children
    .map((child) => {
      if (typeof child === 'string') return child
      return isHiddenFromAccessibility(child) ? '' : textOf(child)
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** What a screen reader calls `element`: its label, or the words it holds. */
export function nameOf(element: TestInstance): string {
  const props = propsOf(element)
  return text(props['aria-label']) || text(props.accessibilityLabel) || textOf(element)
}

export function roleOf(element: TestInstance): string {
  const props = propsOf(element)
  return text(props.role) || text(props.accessibilityRole)
}

function describe(element: TestInstance): string {
  const props = propsOf(element)
  const said = [
    ['testID', text(props.testID)],
    ['role', roleOf(element)],
    ['name', nameOf(element)],
  ]
    .filter(([, value]) => value !== '')
    .map(([key, value]) => `${String(key)}=${JSON.stringify(value)}`)
  return `<${[element.type, ...said].join(' ')}>`
}

/**
 * Whether `element` takes a press: what `Pressable` and the touchables render answers a click,
 * and so does a host control of the platform's own.
 */
export function takesPress(element: TestInstance): boolean {
  const props = propsOf(element)
  return typeof props.onClick === 'function' || element.type === 'RCTSwitch'
}

function failure(rule: string, element: TestInstance, reason: string): Failure {
  return { rule, element: describe(element), reason }
}

/** Every element that takes a press says what it is and what it is called. */
export const named: Rule = (tree) =>
  elementsOf(tree)
    .filter((element) => takesPress(element) && !isHiddenFromAccessibility(element))
    .flatMap((element) => [
      ...(roleOf(element) === ''
        ? [failure('named', element, 'takes a press and has no role')]
        : []),
      ...(nameOf(element) === ''
        ? [failure('named', element, 'takes a press and has no name')]
        : []),
    ])

/** A message as a pattern: each argument it takes may be anything, and the rest is as written. */
function pattern(message: string): RegExp {
  const literal = message
    .split(/\{[^{}]*\}/)
    .map((part) => part.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&'))
  return new RegExp(`^${literal.join('.+')}$`, 'u')
}

/** What the register's controls are called, in every language the app is drawn in. */
const registered: readonly RegExp[] = Object.values(controls).flatMap((control) => {
  const key: MessageKey = control.labelKey
  return [
    ...locales.map((locale) => pattern(catalogs[locale][key])),
    pattern(pseudolocalize(catalogs.en[key])),
  ]
})

/** What a hold-to-complete's `testID` starts with: `hold:idle`, `hold:completed`. */
export const holdPrefix = 'hold:'

/** Whether `element` is the control of a hold-to-complete: what the rules find one by. */
function isHold(element: TestInstance): boolean {
  return text(propsOf(element).testID).startsWith(holdPrefix)
}

/**
 * An icon-only control, one that holds no word of its own, is called what the register calls
 * it (@household/icons' `controls`) and nothing else: a name made up where the control is drawn
 * is a name in one language, or one a neighbouring control already has. A hold-to-complete is
 * no control of the register's: it is named for the one thing it completes, by the screen that
 * draws it, and the rule of its own below holds it to having that name.
 */
export const registeredName: Rule = (tree) =>
  elementsOf(tree)
    .filter(
      (element) =>
        takesPress(element) &&
        element.type !== 'RCTSwitch' &&
        !isHold(element) &&
        !isHiddenFromAccessibility(element) &&
        textOf(element) === '' &&
        nameOf(element) !== '',
    )
    .filter((element) => !registered.some((name) => name.test(nameOf(element))))
    .map((element) =>
      failure(
        'registered-name',
        element,
        'is icon-only, and its name is not one of the register’s',
      ),
    )

/** A length a style gives, or undefined for one it leaves to the layout. */
function length(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

/** How far a hit slop reaches past an element on the two sides of one axis. */
function slop(value: unknown, sides: readonly ['top' | 'left', 'bottom' | 'right']): number {
  if (typeof value === 'number') return value * 2
  if (typeof value !== 'object' || value === null) return 0
  const insets: Props = { ...value }
  return sides.reduce((sum, side) => sum + (length(insets[side]) ?? 0), 0)
}

/**
 * Every target is at least 44 by 44 at the reader's scale: by the least height and width its
 * style gives it, with its hit slop. A width its row gives it, by stretching or by a share of
 * the row, is taken as one: a row is wider than a finger.
 */
export const targetSize: Rule = (tree, { target }) =>
  elementsOf(tree)
    .filter((element) => takesPress(element) && !isHiddenFromAccessibility(element))
    .flatMap((element) => {
      const props = propsOf(element)
      const style: Props = { ...StyleSheet.flatten(props.style as StyleProp<ViewStyle>) }
      const high =
        (length(style.minHeight) ?? length(style.height) ?? 0) +
        slop(props.hitSlop, ['top', 'bottom'])
      const wide =
        (length(style.minWidth) ?? length(style.width) ?? 0) +
        slop(props.hitSlop, ['left', 'right'])
      const stretched =
        typeof style.width === 'string' ||
        style.alignSelf === 'stretch' ||
        (length(style.flex) ?? 0) > 0 ||
        (length(style.flexGrow) ?? 0) > 0
      return [
        ...(high < target
          ? [failure('target-size', element, `is ${String(high)} high, under ${String(target)}`)]
          : []),
        ...(wide < target && !stretched
          ? [failure('target-size', element, `is ${String(wide)} wide, under ${String(target)}`)]
          : []),
      ]
    })

/**
 * Nothing is disabled: a control that cannot act is absent, and one that is busy says so and
 * stays. The one exception is a control out of its form, which the test names.
 */
export const neverDisabled: Rule = (tree, { outOfForm }) =>
  elementsOf(tree)
    .filter((element) => {
      const props = propsOf(element)
      const state: Props =
        typeof props.accessibilityState === 'object' && props.accessibilityState !== null
          ? { ...props.accessibilityState }
          : {}
      return props.disabled === true || props['aria-disabled'] === true || state.disabled === true
    })
    .filter(
      (element) =>
        !outOfForm.includes(text(propsOf(element).testID)) && !outOfForm.includes(nameOf(element)),
    )
    .map((element) =>
      failure(
        'never-disabled',
        element,
        'is disabled, and the test names it as no control out of its form',
      ),
    )

/** The host elements that are a picture: an image, and a drawing of react-native-svg's. */
const pictures: readonly string[] = ['Image', 'RNSVGSvgView']

/** An image or a drawing is named, or hidden from a screen reader: never met as *image* alone. */
export const picturesNamedOrHidden: Rule = (tree) =>
  elementsOf(tree)
    .filter((element) => pictures.includes(element.type))
    .filter((element) => !isHiddenFromAccessibility(element))
    .filter((element) => {
      const props = propsOf(element)
      return (text(props['aria-label']) || text(props.accessibilityLabel) || text(props.alt)) === ''
    })
    .map((element) =>
      failure(
        'picture',
        element,
        'is a picture with no name, and is not hidden from a screen reader',
      ),
    )

/** What a status mark's `testID` starts with: `status:pending`, `status:conflict`. */
export const statusPrefix = 'status:'

/** The `testID` of the mark of `status`: what the rule below finds a mark by. */
export function statusTestID(status: string): string {
  return `${statusPrefix}${status}`
}

/**
 * A status is its colour, its glyph and its word together (N2): whatever is marked as a status
 * holds a drawing and a word a screen reader reads. The colour is the mark's own to spend; a
 * test of the mark holds it to its token.
 */
export const statusSaidThreeWays: Rule = (tree) =>
  elementsOf(tree)
    .filter((element) => text(propsOf(element).testID).startsWith(statusPrefix))
    .flatMap((element) => {
      const drawing = elementsOf(element).some((inner) => pictures.includes(inner.type))
      return [
        ...(drawing ? [] : [failure('status', element, 'is a status with no glyph')]),
        ...(nameOf(element) === '' ? [failure('status', element, 'is a status with no word')] : []),
      ]
    })

/**
 * Every text is the app's own `Text`, which scales with the reader and never with the system on
 * top of it: a text React Native drew by itself has the system's scaling on.
 */
export const ownText: Rule = (tree) =>
  elementsOf(tree)
    .filter((element) => element.type === 'Text' && propsOf(element).allowFontScaling !== false)
    .map((element) => failure('own-text', element, 'is a text drawn outside the app’s own `Text`'))

/**
 * A hold-to-complete is completed without the hold by whoever cannot hold (06-clients §3: a
 * gesture that is the only way to do something is an accessibility failure). Its control is
 * within a screen reader's reach, and answers each way a platform sends an activation that is
 * no touch: the `activate` action, which carries a label, since a platform that lists an
 * element's actions lists a bare one by its identifier, in English; the accessibility tap,
 * which is a screen reader's double tap where the platform asks the element itself; and a
 * click, which is a keyboard's Enter. A name and a role are every control's to have (`named`).
 */
export const holdNeedsNoHold: Rule = (tree) =>
  elementsOf(tree)
    .filter(isHold)
    .flatMap((element) => {
      const props = propsOf(element)
      const actions: readonly unknown[] = Array.isArray(props.accessibilityActions)
        ? props.accessibilityActions
        : []
      const activate = actions
        .map((action): Props =>
          typeof action === 'object' && action !== null ? { ...action } : {},
        )
        .find((action) => action.name === 'activate')
      const missing = [
        ...(isHiddenFromAccessibility(element) ? ['is hidden from a screen reader'] : []),
        ...(activate === undefined
          ? ['has no `activate` accessibility action']
          : text(activate.label) === ''
            ? ['has an `activate` action with no label']
            : []),
        ...(typeof props.onAccessibilityAction === 'function'
          ? []
          : ['does not answer an accessibility action']),
        ...(typeof props.onAccessibilityTap === 'function'
          ? []
          : ['does not answer an accessibility tap']),
        ...(takesPress(element) ? [] : ['does not answer a click']),
      ]
      return missing.map((reason) =>
        failure('hold', element, `is a hold-to-complete, and ${reason}`),
      )
    })

/**
 * No text is cut off: a row wraps and grows with its words, at 200 % as at 100 % (06-clients
 * §4). Jest lays nothing out, so what was clipped by its box is not seen here; what a text was
 * told to cut is.
 */
export const neverTruncated: Rule = (tree) =>
  elementsOf(tree)
    .filter((element) => element.type === 'Text')
    .filter((element) => {
      const lines = propsOf(element).numberOfLines
      return typeof lines === 'number' && lines > 0
    })
    .map((element) =>
      failure('truncated', element, 'is a text held to a number of lines, and cut off past them'),
    )

/** Every rule, in the order a failure is listed. A group that adds a rule adds it here. */
export const rules: readonly Rule[] = [
  named,
  registeredName,
  targetSize,
  neverDisabled,
  picturesNamedOrHidden,
  statusSaidThreeWays,
  ownText,
  holdNeedsNoHold,
  neverTruncated,
]

/** Everything in `tree` that breaks a rule. */
export function violations(
  tree: TestInstance,
  { scale = drawn.scale, outOfForm = [], rules: held = rules }: AccessibleOptions = {},
): readonly Failure[] {
  const context: RuleContext = { target: 44 * scale, outOfForm }
  return held.flatMap((rule) => rule(tree, context))
}

/**
 * Fails, naming each element and its rule, where what was drawn breaks one. `tree` is what the
 * rules are run over: left out, everything the test drew.
 */
export function expectAccessible(
  tree: TestInstance | null = screen.root,
  options?: AccessibleOptions,
): void {
  if (tree === null) throw new Error('expectAccessible: nothing is drawn')
  const found = violations(tree, options)
  if (found.length === 0) return
  throw new Error(
    [
      `${String(found.length)} accessibility rule${found.length === 1 ? '' : 's'} broken:`,
      ...found.map(({ rule, element, reason }) => `  [${rule}] ${element} ${reason}`),
    ].join('\n'),
  )
}
