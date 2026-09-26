// Guards for the workspace itself: the strictness 06-clients requires of every TypeScript
// package, and the pins that must agree between a developer machine and CI. Each of these
// is a setting one package can quietly relax, and none of them fails anything on its own
// when it is relaxed, which is why they are asserted here rather than left to review.
import { existsSync, globSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import ts from 'typescript'
import { beforeAll, describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

type Json = Record<string, unknown>

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readRecord(path: string): Json {
  const text = readFileSync(join(root, path), 'utf8')
  const value: unknown = path.endsWith('.json') ? JSON.parse(text) : parse(text)
  if (!isRecord(value)) throw new Error(`${path} is not an object`)
  return value
}

function field(value: unknown, ...path: string[]): unknown {
  let current = value
  for (const key of path) current = isRecord(current) ? current[key] : undefined
  return current
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

const workspace = readRecord('pnpm-workspace.yaml')
const eslint = new ESLint({ cwd: root })

// Loading typescript-eslint dominates the first config lookup (seconds on a cold runner),
// so it happens once here, under its own timeout, rather than inside whichever test
// happens to run first.
beforeAll(async () => {
  await eslint.calculateConfigForFile(join(root, 'tooling', 'src', 'workspace.test.ts'))
}, 60_000)

/** Every workspace package, as a path relative to the repository root with `/` separators. */
const packages = strings(workspace.packages)
  .flatMap((pattern) => globSync(pattern, { cwd: root }))
  .filter((dir) => existsSync(join(root, dir, 'package.json')))
  .map((dir) => dir.split('\\').join('/'))
  .sort()

// Where the lint guard asks ESLint for its settings, in every TypeScript extension: sources
// (src/; app/, where expo-router keeps its routes; the Expo template's top-level
// components/, hooks/ and constants/), a config file at the package root (vite.config.ts,
// playwright.config.ts), and the unit, component and end-to-end test files the clients add
// (items 24 and 28). A `files` override that relaxes a rule for tests relaxes it as surely
// as one on src/.
const lintProbes = [
  'probe.config',
  'src/probe',
  'src/probe.test',
  'src/__tests__/probe',
  'e2e/probe.spec',
  'app/probe',
  'components/probe',
  'hooks/probe',
  'constants/probe',
].flatMap((stem) => ['ts', 'tsx', 'mts', 'cts'].map((ext) => `${stem}.${ext}`))

const lintRules = [
  '@typescript-eslint/no-explicit-any',
  '@typescript-eslint/no-non-null-assertion',
  '@typescript-eslint/ban-ts-comment',
  'household/linked-suppressions',
]

// Each whole setting, options included. A rule can stay at `error` while its options switch
// off what it checks: `ignoreRestArgs`, `'ts-ignore': false`, or a descriptionFormat of `.*`.
// A probe that no config covers, or that is ignored, has no settings and fails too.
const strictLint = {
  '@typescript-eslint/no-explicit-any': [2],
  '@typescript-eslint/no-non-null-assertion': [2],
  // 06-clients §8: a type-check suppression links the issue that removes it. `@ts-ignore`
  // and `@ts-nocheck` are left at the rule's default, which bans them.
  '@typescript-eslint/ban-ts-comment': [
    2,
    {
      minimumDescriptionLength: 10,
      'ts-expect-error': { descriptionFormat: String.raw`(#|/issues/)\d+` },
    },
  ],
  // And so does an ESLint disable comment, or one comment could switch off any rule above.
  'household/linked-suppressions': [2],
  reportUnusedDisableDirectives: 2,
}

function lintSettings(config: unknown): Json {
  return {
    ...Object.fromEntries(lintRules.map((name) => [name, field(config, 'rules', name)])),
    reportUnusedDisableDirectives: field(config, 'linterOptions', 'reportUnusedDisableDirectives'),
  }
}

describe('the workspace', () => {
  it('holds the packages PL-1 lays out', () => {
    expect(packages).toEqual(
      expect.arrayContaining([
        'apps/mobile',
        'apps/web',
        'packages/api',
        'packages/domain',
        'packages/i18n',
        'packages/icons',
        'packages/sync',
        'packages/test-vectors',
        'packages/tokens',
      ]),
    )
  })

  it('takes every catalogued tool from the catalog', () => {
    const catalog = field(workspace, 'catalog')
    const drift: string[] = []
    for (const dir of ['.', ...packages]) {
      const manifest = readRecord(`${dir}/package.json`)
      for (const kind of ['dependencies', 'devDependencies']) {
        const deps = field(manifest, kind)
        if (!isRecord(deps)) continue
        for (const [name, spec] of Object.entries(deps)) {
          if (field(catalog, name) !== undefined && spec !== 'catalog:') {
            drift.push(`${dir}: ${name}@${String(spec)}`)
          }
        }
      }
    }
    expect(drift).toEqual([])
  })
})

describe('an ESLint suppression', () => {
  // The rule reads comments, not types, so a JavaScript probe exercises it without a
  // TypeScript project behind it. `undefinedName` gives each directive something to suppress.
  const probe = join(root, 'tooling', 'src', 'suppression-probe.js')
  async function unlinked(code: string): Promise<number> {
    const [result] = await eslint.lintText(code, { filePath: probe })
    return (result?.messages ?? []).filter(
      (message) => message.ruleId === 'household/linked-suppressions',
    ).length
  }

  it.each([
    '// eslint-disable-next-line no-undef\nundefinedName()\n',
    'undefinedName() // eslint-disable-line no-undef -- defined by the host page\n',
    '/* eslint-disable no-undef */\nundefinedName()\n',
    '/* eslint no-undef: "off" */\nundefinedName()\n',
  ])('fails without a linked issue: %j', async (code) => {
    expect(await unlinked(code)).toBe(1)
  })

  it.each([
    '// eslint-disable-next-line no-undef -- #12 defined by the host page\nundefinedName()\n',
    'undefinedName() // eslint-disable-line no-undef -- https://github.com/o/r/issues/12\n',
    '/* eslint-disable no-undef -- #12 */\nundefinedName()\n',
    '/* eslint no-undef: "off" -- #12 */\nundefinedName()\n',
  ])('passes with one: %j', async (code) => {
    expect(await unlinked(code)).toBe(0)
  })
})

describe.each(packages)('%s', (dir) => {
  it('is typechecked and linted by exactly the commands these guards read', () => {
    const scripts = field(readRecord(`${dir}/package.json`), 'scripts')
    // Exact commands, not patterns. The guards below read tsconfig.json and the ESLint
    // config file, so `tsc -p <another project>` or `eslint --rule …` would compile or lint
    // under settings neither guard sees.
    const remedy =
      'the strictness guards read only tsconfig.json and the ESLint config, so they vouch for ' +
      'no other command. For another layout (`tsc -b` over project references, say), first ' +
      'extend tooling/src/workspace.test.ts to check what that command compiles or lints'
    expect(field(scripts, 'typecheck'), `${dir} typecheck: ${remedy}`).toBe('tsc --noEmit')
    expect(field(scripts, 'lint'), `${dir} lint: ${remedy}`).toBe('eslint . --max-warnings=0')
  })

  it('is configured with the strict flags of 06-clients', () => {
    const parsed = ts.getParsedCommandLineOfConfigFile(
      join(root, dir, 'tsconfig.json'),
      {},
      {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
          throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
        },
      },
    )
    if (parsed === undefined) throw new Error(`${dir}/tsconfig.json did not parse`)
    expect(parsed.errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual(
      [],
    )
    // A solution-style tsconfig (`files: []` plus references) would pass every flag below
    // while `tsc --noEmit` compiled nothing.
    expect(parsed.fileNames, `${dir}/tsconfig.json compiles no files`).not.toEqual([])

    const { options } = parsed
    expect({
      strict: options.strict,
      noUncheckedIndexedAccess: options.noUncheckedIndexedAccess,
      exactOptionalPropertyTypes: options.exactOptionalPropertyTypes,
      noImplicitOverride: options.noImplicitOverride,
      noFallthroughCasesInSwitch: options.noFallthroughCasesInSwitch,
    }).toEqual({
      strict: true,
      noUncheckedIndexedAccess: true,
      exactOptionalPropertyTypes: true,
      noImplicitOverride: true,
      noFallthroughCasesInSwitch: true,
    })

    // `strict: true` is only a default for this family; any member can still be turned
    // off beside it, and the package would compile as non-strict while claiming strict.
    const family = [
      'alwaysStrict',
      'noImplicitAny',
      'noImplicitThis',
      'strictBindCallApply',
      'strictBuiltinIteratorReturn',
      'strictFunctionTypes',
      'strictNullChecks',
      'strictPropertyInitialization',
      'useUnknownInCatchVariables',
    ] as const
    expect(family.filter((flag) => options[flag] === false)).toEqual([])
  })

  it('lints `any`, non-null assertions and unlinked suppressions as errors, in tests too', async () => {
    const settings = await Promise.all(
      lintProbes.map(async (probe) => {
        const config: unknown = await eslint.calculateConfigForFile(join(root, dir, probe))
        return [probe, lintSettings(config)] as const
      }),
    )
    expect(Object.fromEntries(settings)).toEqual(
      Object.fromEntries(lintProbes.map((probe) => [probe, strictLint])),
    )
  })
})

describe('a developer machine and CI', () => {
  // Every job of every workflow, named `<file>#<job>`. A job added later (a nightly
  // conformance run, an end-to-end suite) is held to the same pins as the go job.
  const jobs = globSync(['.github/workflows/*.yml', '.github/workflows/*.yaml'], { cwd: root })
    .map((path) => path.split('\\').join('/'))
    .sort()
    .flatMap((path) => {
      const defined = field(readRecord(path), 'jobs')
      return isRecord(defined)
        ? Object.entries(defined).map(([name, job]) => [`${path}#${name}`, job] as const)
        : []
    })

  it('run the same PostgreSQL image', () => {
    const compose = readRecord('docker-compose.yml')
    const local = field(compose, 'services', 'postgres', 'image')
    expect(local).toMatch(/^postgres:17\./)
    expect(
      field(readRecord('.github/workflows/ci.yml'), 'jobs', 'go', 'services', 'postgres', 'image'),
    ).toBe(local)

    const postgres = jobs.flatMap(([job, definition]) => {
      const services = field(definition, 'services')
      if (!isRecord(services)) return []
      return Object.entries(services)
        .map(([name, service]) => [`${job} ${name}`, field(service, 'image')] as const)
        .filter(([, image]) => typeof image === 'string' && /(^|\/)postgres[:@]/.test(image))
    })
    expect(Object.fromEntries(postgres)).toEqual(
      Object.fromEntries(postgres.map(([where]) => [where, local])),
    )
  })

  // A cached `go test` result passes a database test without running it: CI restores Go's
  // cache through setup-go, and locally the compose Postgres may not be running.
  it('run the Go tests uncached', () => {
    const scripts = field(readRecord('package.json'), 'scripts')
    const goTests = [
      ...jobs.flatMap(([, definition]) => {
        const steps = field(definition, 'steps')
        return Array.isArray(steps) ? steps.map((step: unknown) => field(step, 'run')) : []
      }),
      ...(isRecord(scripts) ? Object.values(scripts) : []),
    ]
      .filter((command): command is string => typeof command === 'string')
      // One shell command each, so every `go test` is judged on its own flags: continued
      // lines joined, then split at line ends, `;`, `&&` and `||`.
      .flatMap((script) => script.replace(/\\\r?\n/g, ' ').split(/\r?\n|;|&&|\|\|/))
      .map((command) => command.trim())
      .filter((command) => /\bgo test\b/.test(command))
    expect(goTests, 'no `go test` in any workflow or the root scripts').not.toEqual([])
    expect(goTests.filter((command) => !/\s--?count[=\s]+1\b/.test(command))).toEqual([])
  })
})
