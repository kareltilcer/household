// Architecture test 7 (PRD 01 §10): a user-visible string literal in client code fails the
// lint. Each case is linted as a file of each app, through the repository's own ESLint
// configuration, so the test fails if the rule stops detecting a violation or stops being
// applied to either app. The probes are JavaScript: the type-aware parser that lints the
// apps' TypeScript reads only files on disk, and the rule reads syntax, not types.
// workspace.test.ts holds every TypeScript file of each app to the rule at `error`.
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import { beforeAll, describe, expect, it } from 'vitest'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const eslint = new ESLint({ cwd: root })

beforeAll(async () => {
  await eslint.calculateConfigForFile(join(root, 'apps', 'web', 'src', 'probe.jsx'))
}, 60_000)

async function literals(app: string, code: string): Promise<number> {
  const [result] = await eslint.lintText(code, {
    filePath: join(root, 'apps', app, 'src', 'probe.jsx'),
  })
  const fatal = (result?.messages ?? []).filter((m) => m.fatal === true)
  if (fatal.length > 0) throw new Error(fatal.map((m) => m.message).join('\n'))
  return (result?.messages ?? []).filter((m) => m.ruleId === 'household/no-literal-strings').length
}

const t = 'declare const t: (key: string) => string\ndeclare const n: number\n'

describe.each(['web', 'mobile'])('apps/%s', (app) => {
  it.each([
    ['JSX text', 'export const a = <p>Shopping</p>'],
    ['JSX text beside a key', "export const a = <p>{t('module.shopping.name')} list</p>"],
    ['a string child', "export const a = <p>{'Shopping'}</p>"],
    ['a template child', 'export const a = <p>{`${String(n)} items`}</p>'],
    ['a branch of a conditional child', "export const a = <p>{n > 1 ? t('a.b') : 'one item'}</p>"],
    ['the fallback of a logical child', "export const a = <p>{t('a.b') || 'Nothing here'}</p>"],
    ['a title', 'export const a = <img title="Garden" />'],
    ['an alt text', "export const a = <img alt={'The garden'} />"],
    ['an aria-label', 'export const a = <button aria-label="Close" />'],
    ['a React Native accessibility label', 'export const a = <View accessibilityLabel="Close" />'],
    ['a placeholder', 'export const a = <input placeholder="Search" />'],
    ['a prop that reads as text', 'export const a = <List emptyText="No lists yet" />'],
    ['a header title', 'export const a = <Screen headerTitle="Tasks" />'],
    ['a text prop', 'export const a = <Button text="Save" />'],
    [
      "a navigator's options title",
      "export const a = <Stack.Screen options={{ title: 'Tasks' }} />",
    ],
    ['a native dialog', "export function f() { alert('Saved') }"],
    [
      "React Native's Alert",
      "export function f() { Alert.alert('Delete?', 'This cannot be undone') }",
    ],
    [
      "a React Native Alert's button",
      "export function f() { Alert.alert(t('a.b'), t('a.c'), [{ text: 'Delete', style: 'destructive' }]) }",
    ],
  ])('fails %s', async (_, code) => {
    expect(await literals(app, t + code)).toBeGreaterThan(0)
  })

  it.each([
    ['a translated child', "export const a = <p>{t('module.shopping.name')}</p>"],
    ['a number', 'export const a = <p>{n}</p>'],
    ['punctuation and space', "export const a = <p>{n} · {' '} — %</p>"],
    ['a class name', 'export const a = <p className="list-header" />'],
    ['an enum prop', 'export const a = <Button variant="primary" size="lg" />'],
    ['a test id', 'export const a = <View testID="shopping-list" />'],
    ['a route', 'export const a = <Link href="/households" to={\'/lists\'} />'],
    ['a translation key', "export const k = t('module.shopping.name')"],
    ['a string outside JSX', "export const path = '/api/v1/households'"],
    ['a translated title', "export const a = <img title={t('module.garden.name')} />"],
    ['an enter key hint, which is enumerated', 'export const a = <input enterKeyHint="next" />'],
    [
      'a style object',
      "export const a = <View style={{ textAlign: 'center', fontFamily: 'Inter' }} />",
    ],
    [
      "a React Native Alert's enumerated arguments",
      "export function f() { Alert.prompt(t('a.b'), t('a.c'), [{ text: t('a.d'), style: 'cancel' }], 'secure-text') }",
    ],
  ])('passes %s', async (_, code) => {
    expect(await literals(app, t + code)).toBe(0)
  })
})

describe('packages', () => {
  it('are not held to it: they render nothing a member reads (D-36)', async () => {
    const [result] = await eslint.lintText(`${t}export const a = <p>Shopping</p>\n`, {
      filePath: join(root, 'packages', 'i18n', 'src', 'probe.jsx'),
    })
    expect(
      (result?.messages ?? []).filter((m) => m.ruleId === 'household/no-literal-strings'),
    ).toEqual([])
  })
})
