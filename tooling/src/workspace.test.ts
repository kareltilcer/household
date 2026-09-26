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

describe.each(packages)('%s', (dir) => {
  it('is typechecked and linted, with warnings failing the lint', () => {
    const scripts = field(readRecord(`${dir}/package.json`), 'scripts')
    expect(field(scripts, 'typecheck')).toMatch(/\btsc\b/)
    expect(field(scripts, 'lint')).toMatch(/\beslint\b.*--max-warnings=0/)
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

  it.each(['ts', 'tsx'])(
    'lints `any`, non-null assertions and unlinked suppressions in .%s as errors',
    async (ext) => {
      const config: unknown = await eslint.calculateConfigForFile(
        join(root, dir, 'src', `probe.${ext}`),
      )
      const severity = (rule: string): unknown => {
        const setting = field(config, 'rules', rule)
        return Array.isArray(setting) ? setting[0] : setting
      }
      const options = (rule: string): unknown => {
        const setting = field(config, 'rules', rule)
        return Array.isArray(setting) ? setting[1] : undefined
      }
      expect(severity('@typescript-eslint/no-explicit-any')).toBe(2)
      expect(severity('@typescript-eslint/no-non-null-assertion')).toBe(2)
      expect(field(config, 'linterOptions', 'reportUnusedDisableDirectives')).toBe(2)
      // 06-clients §8: a type-check suppression links the issue that removes it.
      expect(severity('@typescript-eslint/ban-ts-comment')).toBe(2)
      expect(
        field(options('@typescript-eslint/ban-ts-comment'), 'ts-expect-error', 'descriptionFormat'),
      ).toEqual(expect.any(String))
    },
  )
})

describe('a developer machine and CI', () => {
  const ci = readRecord('.github/workflows/ci.yml')

  it('run the same PostgreSQL image', () => {
    const compose = readRecord('docker-compose.yml')
    const local = field(compose, 'services', 'postgres', 'image')
    expect(local).toMatch(/^postgres:17\./)
    expect(field(ci, 'jobs', 'go', 'services', 'postgres', 'image')).toBe(local)
  })
})
