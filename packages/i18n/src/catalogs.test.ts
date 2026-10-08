import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { catalogs, locales, sourceLocale, type Locale } from './catalogs.ts'
import { parseMessage, signature } from './message.ts'

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const root = resolve(pkg, '../..')
const keyShape = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'))
}

describe.each(locales)('catalogs/%s.json', (locale) => {
  const catalog: Readonly<Record<string, string>> = catalogs[locale]
  const raw = readJson(join(pkg, 'catalogs', `${locale}.json`))

  it("has English's keys, in order, each lowercase words joined by dots", () => {
    const keys = Object.keys(raw as object)
    expect(keys).toEqual(Object.keys(catalogs.en).sort())
    expect(keys.filter((key) => !keyShape.test(key))).toEqual([])
  })

  it.each(Object.keys(catalogs.en))('%s is in the subset and takes English’s arguments', (key) => {
    const message = catalog[key] ?? ''
    expect(message.trim()).not.toBe('')
    const english = signature(parseMessage(catalogs.en[key as keyof typeof catalogs.en]))
    const own = signature(parseMessage(message))
    expect([...own.keys()].sort()).toEqual([...english.keys()].sort())
    // A translation may use as a number only what English does: a caller passes a string
    // wherever English takes a value.
    for (const [arg, kind] of own) {
      if (kind === 'number') expect(english.get(arg), `{${arg}}`).toBe('number')
    }
  })
})

// A row's own control is drawn as a word and named in full for what it acts on (the web's
// `RowAction` and `RowLink`, and the two buttons written the same way by hand: the one that
// disconnects a provider and the one that shows a module again). What is drawn is what somebody
// who speaks to their device says to press it, so the name holds the drawn words together and in
// their order (WCAG 2.1, 2.5.3):
// *Send again* is in *Send again to {email}*, and not in *Send the invitation to {email} again*.
describe('a control drawn as a word and named in full', () => {
  const drawnInNamed: readonly (readonly [string, string])[] = [
    ['account.devices.rename.action', 'account.devices.rename.named'],
    ['account.devices.sign_out', 'account.devices.sign_out_named'],
    ['account.households.leave', 'household.leave.action'],
    ['account.households.open', 'account.households.open_named'],
    ['account.households.waiting.open', 'account.households.waiting.open_named'],
    ['account.security.providers.disconnect', 'account.security.providers.disconnect_named'],
    ['household.invitations.resend.word', 'household.invitations.resend.named'],
    ['household.invitations.withdraw.word', 'household.invitations.withdraw.named'],
    ['household.invitations.withdraw.word', 'household.invitations.withdraw.named_link'],
    ['household.modules.turn_off.word', 'household.modules.turn_off.named'],
    ['household.modules.turn_on.word', 'household.modules.turn_on.named'],
    ['shell.arrange.show', 'shell.arrange.show_named'],
  ]

  it.each(locales)('holds the word it is drawn as in its name, in %s', (locale) => {
    const catalog: Readonly<Record<string, string>> = catalogs[locale]
    const apart = drawnInNamed.filter(([drawn, named]) => {
      const word = (catalog[drawn] ?? '').toLocaleLowerCase(locale)
      return word === '' || !(catalog[named] ?? '').toLocaleLowerCase(locale).includes(word)
    })
    expect(apart).toEqual([])
  })
})

describe('the module names', () => {
  it("are one per module of the contract's ModuleKeyValue", () => {
    const contract: unknown = parse(readFileSync(join(root, 'docs/api/openapi.yaml'), 'utf8'))
    const modules = (
      contract as { components: { schemas: { ModuleKeyValue: { enum: string[] } } } }
    ).components.schemas.ModuleKeyValue.enum
    const named = Object.keys(catalogs.en)
      .filter((key) => /^module\.[a-z]+\.name$/.test(key))
      .map((key) => key.split('.')[1])
    expect(named.sort()).toEqual([...modules].sort())
  })
})

describe('the review ledger', () => {
  const ledgers = readdirSync(join(pkg, 'review')).sort()

  it('has one file per translated language, and none for English', () => {
    expect(ledgers).toEqual(
      locales
        .filter((l) => l !== sourceLocale)
        .map((l) => `${l}.json`)
        .sort(),
    )
  })

  it.each(locales.filter((l) => l !== sourceLocale))(
    'review/%s.json lists drafts of the current English',
    (locale: Locale) => {
      const ledger = readJson(join(pkg, 'review', `${locale}.json`)) as Record<string, unknown>
      const keys = Object.keys(ledger)
      expect(keys).toEqual([...keys].sort())
      const en: Readonly<Record<string, string>> = catalogs.en
      for (const [key, english] of Object.entries(ledger)) {
        // A draft records the English it translates. When English changes, the draft is
        // stale: redraft it and record the new English.
        expect(english, `${locale}: ${key}`).toBe(en[key])
      }
    },
  )
})

// The Done-when of plan item 6: a missing key breaks the type check. Each probe is compiled
// with this package's settings beside its sources and must fail to.
describe('the type check', () => {
  function compile(source: string): string[] {
    const configFile = join(pkg, 'tsconfig.json')
    const config = ts.getParsedCommandLineOfConfigFile(
      configFile,
      {},
      {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: (d) => {
          throw new Error(ts.flattenDiagnosticMessageText(d.messageText, '\n'))
        },
      },
    )
    if (config === undefined) throw new Error('tsconfig.json did not parse')
    const probe = join(pkg, 'src', '__probe__.ts')
    const host = ts.createCompilerHost(config.options)
    const read = host.readFile.bind(host)
    const exists = host.fileExists.bind(host)
    const sourceFile = host.getSourceFile.bind(host)
    const same = (a: string) => resolve(a) === probe
    host.readFile = (f) => (same(f) ? source : read(f))
    host.fileExists = (f) => same(f) || exists(f)
    host.getSourceFile = (f, language, ...rest) =>
      same(f) ? ts.createSourceFile(f, source, language) : sourceFile(f, language, ...rest)
    const program = ts.createProgram([probe], config.options, host)
    return ts
      .getPreEmitDiagnostics(program, program.getSourceFile(probe))
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
  }

  it('passes a key every catalog has', () => {
    expect(
      compile(`import { createTranslator } from './index.ts'
export const name: string = createTranslator('cs')('module.shopping.name')
`),
    ).toEqual([])
  }, 60_000)

  it('fails a key the catalogs do not have', () => {
    const errors = compile(`import { createTranslator } from './index.ts'
export const name: string = createTranslator('cs')('module.nothing.name')
`)
    expect(errors.join('\n')).toContain('module.nothing.name')
  }, 60_000)

  it('fails a catalog missing a key', () => {
    const errors = compile(`import { catalogs, defineCatalogs } from './index.ts'
const { 'module.shopping.name': _, ...cs } = catalogs.cs
defineCatalogs({ ...catalogs, cs })
`)
    expect(errors.join('\n')).toContain('module.shopping.name')
  }, 60_000)

  it('fails a catalog with a key English does not have', () => {
    const errors = compile(`import { catalogs, defineCatalogs } from './index.ts'
defineCatalogs({ ...catalogs, pl: { ...catalogs.pl, 'module.extra.name': 'x' } })
`)
    expect(errors).not.toEqual([])
  }, 60_000)
})
