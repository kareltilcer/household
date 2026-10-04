// 06-clients §3 and §8 (D-152): no raw colour and no primitive token in application code. Two
// lints hold it: ESLint's `household/semantic-tokens` over the clients' TypeScript, and
// stylesheets.ts over their stylesheets. Each case here is linted as a file of an app, the
// TypeScript through the repository's own ESLint configuration, so the test fails if a lint
// stops detecting a violation or stops being applied to an app. The ESLint probes are JavaScript,
// as literal-strings.test.ts's are and for its reason; workspace.test.ts holds every TypeScript
// file of each app to the rule at `error`.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ramps } from '@household/tokens/primitives'
import { ESLint } from 'eslint'
import { beforeAll, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { ramps as linted } from '../colours.js'
import { lintStylesheet } from './stylesheets.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const eslint = new ESLint({ cwd: root })

beforeAll(async () => {
  await eslint.calculateConfigForFile(join(root, 'apps', 'web', 'src', 'probe.jsx'))
}, 60_000)

/** The rule's reports on a file of an app, by message. */
async function script(app: string, code: string, dir = 'apps'): Promise<string[]> {
  const [result] = await eslint.lintText(`${code}\n`, {
    filePath: join(root, dir, app, 'src', 'probe.jsx'),
  })
  const fatal = (result?.messages ?? []).filter((m) => m.fatal === true)
  if (fatal.length > 0) throw new Error(fatal.map((m) => m.message).join('\n'))
  return (result?.messages ?? [])
    .filter((m) => m.ruleId === 'household/semantic-tokens')
    .map((m) => m.messageId ?? '')
}

/** The stylesheet check's reports on a stylesheet of the web app, by rule. */
function sheet(code: string): string[] {
  return lintStylesheet(`${code}\n`, 'apps/web/src/probe.module.css').map((f) => f.rule)
}

describe('the lints’ ramps', () => {
  it('are @household/tokens’', () => {
    expect(linted).toEqual(ramps)
  })
})

describe.each(['web', 'mobile'])('apps/%s', (app) => {
  it.each([
    ['a hex colour', "export const a = { color: '#fff' }"],
    ['a hex colour of six digits', "export const a = { backgroundColor: '#1A1B22' }"],
    ['a hex colour with alpha', "export const a = '#1a1b22cc'"],
    ['a hex colour in a prop', 'export const a = <Path fill="#333" />'],
    ['a hex colour in a shorthand', "export const a = { border: '1px solid #ccc' }"],
    ['a hex colour in a template', 'export const a = { border: `${String(n)}px solid #ccc` }'],
    ['a hex colour in a shadow', "export const a = '0 1px 2px #0003'"],
    ['hex colours in an array prop', "export const a = <Gradient colors={['#fff', '#eee']} />"],
    ['rgb()', "export const a = { color: 'rgb(0, 0, 0)' }"],
    ['rgba()', "export const a = { shadowColor: 'rgba(0,0,0,.5)' }"],
    ['hsl()', "export const a = 'hsl(210 50% 40%)'"],
    ['oklch()', "export const a = 'oklch(60% 0.1 240)'"],
    ['color()', "export const a = 'color(display-p3 1 0 0)'"],
    ['a colour function in a gradient', "export const a = 'linear-gradient(rgb(0 0 0), #fff)'"],
    ['a named colour', "export const a = { color: 'red' }"],
    ['a named colour as a background', "export const a = { backgroundColor: 'white' }"],
    ['a named colour in a style prop', "export const a = <Text style={{ color: 'black' }} />"],
    ['a named colour in a prop', 'export const a = <Path stroke="black" />'],
    ['a named colour in a shorthand', "export const a = { border: '1px solid black' }"],
    ['a named colour in a tint', 'export const a = <Icon tintColor="rebeccapurple" />'],
    // A colour chosen or built is the value of its property as one written out is.
    ['a named colour behind a condition', "export const a = { color: n > 1 ? 'red' : 'black' }"],
    [
      'a named colour behind a condition in a prop',
      "export const a = <Text color={n > 1 ? 'red' : 'black'} />",
    ],
    ['a named colour as a fallback', "export const a = { backgroundColor: n.tone ?? 'white' }"],
    ['a named colour after a guard', "export const a = { backgroundColor: n > 1 && 'white' }"],
    [
      'a named colour interpolated',
      'export const a = { border: `1px solid ${n > 1 ? "black" : ""}` }',
    ],
    ['a named colour concatenated', "export const a = { border: String(n) + 'px solid black' }"],
    ['named colours in an array prop', "export const a = <Gradient colors={['white', 'black']} />"],
    [
      'a named colour for one state of a prop',
      "export const a = <Switch trackColor={{ false: 'grey', true: 'green' }} />",
    ],
    ['a named colour as a prop’s default', "export const A = ({ color = 'black' }) => color"],
    ['a named colour under a hyphenated name', "export const a = { 'background-color': 'white' }"],
    ['a named colour in a custom property', "export const a = { '--row-rule': 'white' }"],
    [
      'named colours in a gradient',
      "export const a = { backgroundImage: 'linear-gradient(white, black)' }",
    ],
    ['a named colour on a logical side', "export const a = { borderBlockEnd: '1px solid black' }"],
    ['a named colour in a decoration', "export const a = { textDecoration: 'underline red' }"],
    // `to`, `name` and `key` name or link in an element, and anything at all in an object.
    ['a hex colour an object calls `to`', "export const a = { to: '#fff' }"],
    ['a hex colour an object calls `name`', "export const a = { name: '#1a1b22' }"],
    ['a hex colour an object calls `key`', "export const a = { key: '#abc' }"],
    ['a hex colour beside an element’s reference', "export const a = 'url(#fade) #fff'"],
  ])('fails %s as a raw colour', async (_, code) => {
    expect(await script(app, `const n = 1\n${code}`)).toContain('raw')
  })

  it.each([
    ['a primitive as a custom property', "export const a = { color: 'var(--neutral-200)' }"],
    ['a hue step as a custom property', "export const a = 'var(--indigo-600)'"],
    ['a primitive declared', "export const a = { '--moss-400': 'var(--accent)' }"],
    ['an import of the primitives', "import { neutral } from '@household/tokens/primitives'"],
    ['an import of them for nothing', "import '@household/tokens/primitives'"],
    ['a dynamic import of them', "export const a = import('@household/tokens/primitives')"],
    ['a re-export of them', "export { hues } from '@household/tokens/primitives'"],
    ['a re-export of all of them', "export * from '@household/tokens/primitives'"],
    ['a require of them', "export const a = require('@household/tokens/primitives')"],
  ])('fails %s as a primitive', async (_, code) => {
    expect(await script(app, code)).toContain('primitive')
  })

  it.each([
    ['a semantic token', "export const a = { color: 'var(--text-primary)' }"],
    ['a status token', "export const a = { color: 'var(--status-conflict)' }"],
    ['a module accent', "export const a = { color: 'var(--accent-garden)' }"],
    ['a token named through cssVar', "export const a = { color: cssVar('accent') }"],
    ['a theme’s value', "export const a = { color: theme.color['text-primary'] }"],
    ['the tokens', "import { tokens, cssVar } from '@household/tokens'"],
    ['the native theme', "import { nativeThemes } from '@household/tokens/native'"],
    ['a keyword that is no colour', "export const a = { color: 'transparent', fill: 'none' }"],
    ['the current colour', 'export const a = <Path stroke="currentColor" color={\'inherit\'} />'],
    ['a mix of tokens', "export const a = 'color-mix(in srgb, var(--accent) 12%, transparent)'"],
    ['a fragment link', 'export const a = <a href="#add" />'],
    ['a router fragment', "export const a = <Link to={'#decade'} />"],
    [
      'an element’s id and what points to it',
      'export const a = <i id="cafe" aria-controls="#face" />',
    ],
    ['a test id', 'export const a = <View testID="#beef" />'],
    ['a fragment chosen by a condition', "export const a = <Link to={n > 1 ? '#add' : '#bad'} />"],
    ['a location’s fragment', "export const a = <Link to={{ pathname: '/x', hash: '#add' }} />"],
    ['a link’s address in an object', "export const a = { href: '#facade', label: n }"],
    [
      'an element drawn by reference',
      'export const a = <Path fill="url(#fade)" clipPath="url(\'#c0de\')" />',
    ],
    ['a mask drawn by reference', "export const a = { mask: 'url( #add )' }"],
    ['a word that is a colour’s name where no colour goes', "export const a = { variant: 'tan' }"],
    [
      'such a word behind a condition',
      "export const a = { variant: n > 1 ? 'tan' : 'plum', filter: 'gold' }",
    ],
    [
      'a colour’s name a condition tests',
      "export const a = { color: n === 'red' ? cssVar('danger') : cssVar('accent') }",
    ],
    ['a colour’s name in a computed key’s value', "export const a = { [n]: 'red' }"],
    ['a named colour in text', "export const a = t('status.red')"],
    ['a number sign before two digits', "export const a = '#12'"],
    ['a number sign before seven', "export const a = '#1234567'"],
    ['a private name', 'export class A { #fff = 1 }'],
    ['the space scale', "export const a = { padding: 'var(--space-2)' }"],
    [
      'the radius and motion scales',
      "export const a = { borderRadius: 'var(--radius-card)', transition: 'opacity var(--dur-fast)' }",
    ],
    ['a shadow token', "export const a = { boxShadow: 'var(--shadow-1)' }"],
    ['a module of another name', "import x from '@household/tokens/primitive-like'"],
  ])('passes %s', async (_, code) => {
    expect(await script(app, `const t = String\n${code}`)).toEqual([])
  })

  it.each(ramps)('fails the %s ramp', async (ramp) => {
    expect(await script(app, `export const a = 'var(--${ramp}-600)'`)).toEqual(['primitive'])
  })
})

describe('packages', () => {
  it('are not held to it: the tokens and the icons are where the values are written', async () => {
    expect(await script('tokens', "export const a = { color: '#fff' }", 'packages')).toEqual([])
    expect(
      await script('icons', "import { neutral } from '@household/tokens/primitives'", 'packages'),
    ).toEqual([])
  })
})

describe('a stylesheet of an app', () => {
  it.each([
    ['a hex colour', '.a { color: #fff }'],
    ['a hex colour with alpha', '.a { color: #1a1b22cc }'],
    ['a hex colour in a shorthand', '.a { border: 1px solid #cccccc }'],
    ['a named colour', '.a { color: red }'],
    ['a named colour in capitals', '.a { color: White }'],
    ['a named colour in a shorthand', '.a { background: white url(a.png) }'],
    ['rgb()', '.a { background: rgb(0 0 0 / 50%) }'],
    ['rgba() in a shadow', '.a { box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2) }'],
    ['hsl()', '.a { color: hsl(0 0% 0%) }'],
    ['oklch()', '.a { color: oklch(60% 0.1 240) }'],
    ['color()', '.a { color: color(display-p3 1 0 0) }'],
    ['a raw colour in a gradient', '.a { background: linear-gradient(#fff, var(--surface)) }'],
    ['a raw colour mixed with a token', '.a { color: color-mix(in srgb, var(--accent), #fff) }'],
    ['a raw colour as a fallback', '.a { color: var(--text-primary, #222) }'],
    ['a raw colour in a custom property', '.a { --row-rule: #dcdee6 }'],
    ['a raw colour inside a media query', '@media (min-width: 40em) { .a { color: #fff } }'],
    ['a raw colour in a registered property', '@property --x { initial-value: #fff }'],
  ])('fails %s as a raw colour', (_, code) => {
    expect(sheet(code)).toEqual(['raw'])
  })

  it.each([
    ['a primitive', '.a { color: var(--neutral-200) }'],
    ['a primitive as a fallback', '.a { color: var(--accent, var(--indigo-600)) }'],
    ['a primitive declared', '.a { --moss-400: var(--accent) }'],
  ])('fails %s as a primitive', (_, code) => {
    expect(sheet(code)).toEqual(['primitive'])
  })

  it.each([
    ['semantic tokens', '.a { color: var(--text-primary); background: var(--surface-raised) }'],
    [
      'a status token and an accent',
      '.a { color: var(--status-stale); fill: var(--accent-finance) }',
    ],
    [
      'keywords that are no colour',
      '.a { color: currentColor; background: transparent; fill: none }',
    ],
    ['a mix of tokens', '.a { background: color-mix(in srgb, var(--accent) 12%, transparent) }'],
    ['a shadow token', '.a { box-shadow: var(--shadow-2) }'],
    [
      'the space and radius scales',
      '.a { padding: var(--space-2); border-radius: var(--radius-card) }',
    ],
    ['the motion scale', '.a { transition: opacity var(--dur-fast) var(--ease-exit) }'],
    [
      'a type step',
      '.a { font-family: var(--type-body-family); font-size: var(--type-body-size) }',
    ],
    ['a property of the screen’s own over a token', '.a { --row-rule: var(--dens-rule) }'],
    ['a class composed from another module', '.a { composes: red from "./list.module.css" }'],
    ['an id selector that spells a colour', '#fff { color: var(--text-primary) }'],
    ['a class that spells one', '.red { color: var(--danger) }'],
    ['a grid area that spells one', '.a { grid-area: tan }'],
    ['an animation that spells one', '.a { animation: plum var(--dur-slow) }'],
    ['a face that spells one', '.a { font-family: "Linen", Snow, sans-serif }'],
    ['an address with a fragment', '.a { mask: url(sprite.svg#fff) }'],
    ['a quoted string', '.a::before { content: "red #fff" }'],
    ['a length that is no colour', '.a { margin: 0 auto; z-index: 100 }'],
  ])('passes %s', (_, code) => {
    expect(sheet(code)).toEqual([])
  })

  it.each(ramps)('fails the %s ramp, read or declared', (ramp) => {
    expect(sheet(`.a { color: var(--${ramp}-600) }`)).toEqual(['primitive'])
    expect(sheet(`.a { --${ramp}-400: var(--accent) }`)).toEqual(['primitive'])
  })

  it('says where each finding is', () => {
    const [finding] = lintStylesheet(
      '.a {\n  color: var(--text-primary);\n  fill: #fff;\n}\n',
      'a.css',
    )
    expect(finding).toEqual({ file: 'a.css', line: 3, column: 3, rule: 'raw', text: 'fill: #fff' })
  })

  it('would fail the tokens’ own stylesheet, where the values are written', () => {
    const tokens = readFileSync(join(root, 'packages/tokens/tokens.css'), 'utf8')
    expect(lintStylesheet(tokens, 'tokens.css').length).toBeGreaterThan(100)
  })

  it('throws on one that does not parse, with its position', () => {
    expect(() => lintStylesheet('.a { color: ', 'a.css')).toThrow('a.css:1')
  })
})

describe('pnpm run lint:css', () => {
  /** The script, over the repository or over a directory that stands for it. */
  function run(over?: string): { readonly status: number; readonly output: string } {
    try {
      const output = execFileSync(
        process.execPath,
        [join(root, 'tooling/src/lint-css.ts'), ...(over === undefined ? [] : [over])],
        { cwd: root, encoding: 'utf8', stdio: 'pipe' },
      )
      return { status: 0, output }
    } catch (error) {
      const { status, stdout, stderr } = error as {
        status?: number
        stdout?: string
        stderr?: string
      }
      return { status: status ?? -1, output: `${stdout ?? ''}${stderr ?? ''}` }
    }
  }

  it('runs with the rest of the lint, locally and in CI', () => {
    const scripts: unknown = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    const { lint, 'lint:css': css } = (scripts as { scripts: Record<string, string> }).scripts
    expect(css).toBe('node tooling/src/lint-css.ts')
    expect(lint?.split(' && ')).toContain('pnpm run lint:css')
    const ci: unknown = parse(readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8'))
    const steps = (ci as { jobs: { typescript: { steps: { run?: string }[] } } }).jobs.typescript
      .steps
    expect(steps.map((step) => step.run)).toContain('pnpm run lint:css')
  })

  it('passes the apps as they are', () => {
    const { status, output } = run()
    expect(output).toMatch(/lint:css: \d+ stylesheets, 0 raw colours or primitives/)
    expect(status).toBe(0)
  })

  it('fails an app’s own stylesheet, and passes over a dependency’s and a build’s', () => {
    const stand = mkdtempSync(join(tmpdir(), 'household-lint-css-'))
    try {
      const write = (file: string, css: string) => {
        mkdirSync(dirname(join(stand, file)), { recursive: true })
        writeFileSync(join(stand, file), css)
      }
      write('apps/web/src/list.module.css', '.a { color: var(--text-primary) }\n')
      write('apps/web/dist/assets/index.css', '.a { color: #fff }\n')
      write('apps/web/node_modules/dependency/style.css', '.a { color: #fff }\n')
      const passed = run(stand)
      expect(passed.output).toContain('lint:css: 1 stylesheets, 0 raw colours or primitives')
      expect(passed.status).toBe(0)

      write('apps/web/src/screens/row.module.css', '.a {\n  color: #fff;\n}\n')
      const failed = run(stand)
      expect(failed.status).toBe(1)
      expect(failed.output).toContain('apps/web/src/screens/row.module.css:2:3  color: #fff')
      expect(failed.output).toContain('lint:css: 2 stylesheets, 1 raw colours or primitives')
      expect(failed.output).not.toContain('dist/')
      expect(failed.output).not.toContain('node_modules/')
    } finally {
      rmSync(stand, { recursive: true, force: true })
    }
  })
})
