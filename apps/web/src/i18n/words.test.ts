// No screen reads a word its route does not fetch (D-159). A language's catalog comes in parts
// (@household/i18n's parts.ts): the app's own words before anything is drawn, and each other part
// with the screens whose route names it (app/paths.ts, `words`). A screen that asked for a key of
// a part nobody fetched would find no word and fail where its member stands, in whichever
// language and on whichever visit a component test did not draw: every test holds every part
// (test/setup.ts). So the sources are read here as they are written, and each file held to the
// parts that are fetched by the time it runs.
import { catalogs, isMessageKey } from '@household/i18n'
import { partOf, type Part } from '@household/i18n/lazy'
import type { RouteObject } from 'react-router'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { paths, routeIds, type RouteId, type RoutePath } from '../app/paths.ts'
import { routes, served } from '../app/routes.tsx'

/** Every file of the app, as it is written, by its path from src: no test, and no test's own. */
const sources: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>(['../**/*.{ts,tsx}', '!../**/*.test.{ts,tsx}', '!../test/**'], {
      query: '?raw',
      import: 'default',
      eager: true,
    }),
  ).map(([path, text]) => [from('i18n/words.test.ts', path), text]),
)

/**
 * `path` as `file` writes it, a path from its own directory, as a path from src. One that leaves
 * src still begins with `..`: a file of the build's own.
 */
function from(file: string, path: string): string {
  const steps = file.split('/').slice(0, -1)
  for (const step of path.split('/')) {
    if (step === '.') continue
    if (step === '..' && steps.length > 0 && steps.at(-1) !== '..') steps.pop()
    else steps.push(step)
  }
  return steps.join('/')
}

const entry = 'main.tsx'
const router = 'app/routes.tsx'
const everyKey = Object.keys(catalogs.en)

/** The app's own words: the part that is fetched before anything is drawn. */
const own: Part = 'app'

/** What a file says of itself that this test reads. */
interface Written {
  /** The catalog's keys it names. */
  readonly keys: readonly string[]
  /** The files it imports for their code, each there before it runs. */
  readonly imports: readonly string[]
  /** The files it fetches as it runs: each `import('…')`. */
  readonly fetches: readonly string[]
}

/**
 * The keys a template may come to: every key of the catalog it matches, each `${…}` read as one
 * or more of the characters a key is written in. `module.${module}.name` names the modules'
 * names, and the name something is kept under in this browser, `household.last.${user}`, names
 * no key unless one is written so. A template that writes no letter of its own, `${a}${b}`,
 * names none either: read so it would name them all, and it is no key's shape.
 */
function keysOf(template: ts.TemplateExpression): string[] {
  const written = [template.head, ...template.templateSpans.map((span) => span.literal)].map(
    (part) => part.text,
  )
  if (!written.some((text) => /[a-z]/.test(text))) return []
  const shape = new RegExp(
    `^${written.map((text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[a-z0-9_.]+')}$`,
  )
  return everyKey.filter((key) => shape.test(key))
}

/** Whether an import or a re-export is of types alone: no code of the file it names is run. */
function typesAlone(node: ts.ImportDeclaration | ts.ExportDeclaration): boolean {
  if (ts.isExportDeclaration(node)) {
    const named = node.exportClause
    return (
      node.isTypeOnly ||
      (named !== undefined &&
        ts.isNamedExports(named) &&
        named.elements.every((element) => element.isTypeOnly))
    )
  }
  const clause = node.importClause
  // With no clause it is imported for what it does: a stylesheet, the tokens.
  if (clause === undefined) return false
  const named = clause.namedBindings
  return (
    clause.phaseModifier === ts.SyntaxKind.TypeKeyword ||
    (clause.name === undefined &&
      named !== undefined &&
      ts.isNamedImports(named) &&
      named.elements.every((element) => element.isTypeOnly))
  )
}

/** The files `node`, a part of `file`, fetches as it runs. */
function fetchesOf(node: ts.Node, file: string): string[] {
  const fetches: string[] = []
  const visit = (inner: ts.Node): void => {
    if (ts.isCallExpression(inner) && inner.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [target] = inner.arguments
      if (target !== undefined && ts.isStringLiteralLike(target) && target.text.startsWith('.')) {
        fetches.push(from(file, target.text))
      }
    }
    ts.forEachChild(inner, visit)
  }
  visit(node)
  return fetches
}

function parse(file: string, text: string): ts.SourceFile {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, kind)
}

const read = new Map<string, { readonly text: string; readonly written: Written }>()

/** What `file` says of itself, read once for each text it is given. */
function writtenIn(file: string, text: string): Written {
  const before = read.get(file)
  if (before?.text === text) return before.written
  const keys = new Set<string>()
  const imports: string[] = []
  const source = parse(file, text)
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const named = node.moduleSpecifier
      // A package's name is no file of the app's: what a package names is its own.
      if (
        named !== undefined &&
        ts.isStringLiteral(named) &&
        named.text.startsWith('.') &&
        !typesAlone(node)
      ) {
        imports.push(from(file, named.text))
      }
      return
    }
    // A type is no word read: `MessageKey & \`sync.rejected.reason.${string}\`` runs nowhere.
    if (ts.isTypeNode(node)) return
    if (ts.isStringLiteralLike(node)) {
      if (isMessageKey(node.text)) keys.add(node.text)
    } else if (ts.isTemplateExpression(node)) {
      for (const key of keysOf(node)) keys.add(key)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  const written = { keys: [...keys], imports, fetches: fetchesOf(source, file) }
  read.set(file, { text, written })
  return written
}

/**
 * The screen's file of each route the router names a page for, by the route's id: the one file
 * its page imports as it is opened (routes.tsx, `pages`).
 */
function screensIn(text: string): Map<RouteId, string> {
  const screens = new Map<RouteId, string>()
  const isRouteId = (name: string): name is RouteId => routeIds.some((id) => id === name)
  const within = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
      isRouteId(node.name.text)
    ) {
      const [screen, ...others] = fetchesOf(node.initializer, router)
      if (screen !== undefined && others.length === 0) screens.set(node.name.text, screen)
      return
    }
    ts.forEachChild(node, within)
  }
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'pages'
    ) {
      if (node.initializer !== undefined) within(node.initializer)
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(parse(router, text))
  return screens
}

/**
 * The routes the router draws a screen for with a file it fetches, by their whole paths: every
 * route with a `lazy` and no route under it, a layout's own path before its screens'.
 */
function fetchedPaths(table: readonly RouteObject[], under = ''): string[] {
  return table.flatMap((route) => {
    const last = route.path ?? ''
    const path =
      last.startsWith('/') || last === '*' ? last : [under, last].filter(Boolean).join('/')
    if (route.children !== undefined) {
      return fetchedPaths(route.children, path === '*' ? under : path)
    }
    if (route.lazy === undefined) return []
    return [last === '*' && under !== '' ? `${under}/*` : path]
  })
}

/** The words a route names beside the app's own. */
function wordsOf(id: RouteId): readonly Part[] {
  const route: RoutePath = paths[id]
  return route.words ?? []
}

/**
 * Everything wrong with `files`, the app's sources by their paths from src, where each route
 * fetches `words(id)` beside the app's own: empty where every file reads only what is fetched
 * by the time it runs, and every route fetches only what its screen reads.
 *
 * - The entry and every file it imports are the first download, which has the app's own words
 *   and no other. So has a file fetched as the app runs that is no route's screen, the two
 *   shells among them, with every file it imports: whoever fetches it fetches no words.
 * - A route's screen and every file it imports have the app's own and the parts the route names.
 * - What a file fetches as it runs is no part of it: the walk of its imports stops there.
 */
function problems(
  files: Readonly<Record<string, string>>,
  words: (id: RouteId) => readonly Part[] = wordsOf,
): string[] {
  const found: string[] = []
  const written = (file: string): Written => {
    const text = files[file]
    if (text === undefined) throw new Error(`${file} is imported, and is not among the sources`)
    return writtenIn(file, text)
  }
  /** Every file `root` reaches by the imports that are there before it runs, itself among them. */
  const reached = (root: string): string[] => {
    const seen = new Set<string>()
    const queue = [root]
    for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
      if (seen.has(file)) continue
      seen.add(file)
      // A stylesheet reads no word, and neither does what the build shares with the app, the
      // name of a file it writes.
      queue.push(
        ...written(file).imports.filter((path) => /\.tsx?$/.test(path) && !path.startsWith('..')),
      )
    }
    return [...seen]
  }
  /**
   * Each key the files `root` reaches read that is of no part in `held`, with its file and its
   * part, said after `where`: what fetched them, and with which words.
   */
  const unheld = (where: string, root: string, held: readonly Part[]): string[] =>
    reached(root).flatMap((file) =>
      written(file).keys.flatMap((key) => {
        const part = partOf(key)
        if (part !== undefined && held.includes(part)) return []
        const whose = part === undefined ? 'which is the server’s alone' : `of the part ${part}`
        return [`${where}: ${file} reads ${key}, ${whose}`]
      }),
    )

  const screens = screensIn(files[router] ?? '')
  // The router's own table, as it runs, against what was read of it as it is written: a page
  // written in a way the reading does not follow would be a screen nothing here holds.
  const lazily = new Set(fetchedPaths(routes))
  for (const id of served) {
    if (lazily.has(paths[id].path) && !screens.has(id)) {
      found.push(`${id}: its page fetches a file, and which one could not be read off ${router}`)
    }
    if (words(id).length > 0 && !screens.has(id)) {
      found.push(`${id}: it names words, and has no file of its own to fetch them with`)
    }
  }

  const ofRoutes = new Set(screens.values())
  // Every file fetched as the app runs, from wherever: by the entry, by a screen, by another.
  const roots = new Set([entry, ...ofRoutes])
  for (const root of roots) {
    for (const file of reached(root)) for (const fetch of written(file).fetches) roots.add(fetch)
  }
  for (const root of roots) {
    if (ofRoutes.has(root)) continue
    const where = root === entry ? 'the first download' : `${root}, fetched with no words`
    found.push(...unheld(where, root, [own]))
  }
  for (const [id, screen] of screens) {
    const named = words(id)
    const held = [own, ...named]
    found.push(...unheld(`${id}, whose route fetches ${held.join(' and ')}`, screen, held))
    // And the other way, so that the list does not outlive what it was written for.
    const parts = new Set(reached(screen).flatMap((file) => written(file).keys.map(partOf)))
    for (const part of named) {
      if (!parts.has(part)) {
        found.push(`${id}: its route fetches the part ${part}, which no file of its screen reads`)
      }
    }
  }
  return found
}

describe('the words a screen reads', () => {
  it('are fetched by the time it is drawn: the app’s own, and the parts its route names', () => {
    expect(problems(sources)).toEqual([])
  })

  // The sources are read at all, and for what they are: a comment and a type read no word, an
  // import of types runs no file, and a name kept in this browser is no key.
  it('are read off a file as it is written: its keys, its imports and what it fetches', () => {
    const { keys, imports, fetches } = writtenIn(
      'x/Probe.tsx',
      [
        "import { useTranslate } from '../i18n/I18nProvider.tsx'",
        "import type { Household } from '../household/households.ts'",
        "import { type ModuleKey } from '../household/data.ts'",
        "import styles from './Probe.module.css'",
        "import { newId } from '@household/api'",
        "export { RowLink } from '../household/RowLink.tsx'",
        "export type { Level } from '../household/grants.ts'",
        'const kept = `household.last.${user}`',
        'const both = `${kept}${user}`',
        "const reason: `sync.rejected.reason.${string}` = 'sync.rejected.reason.forbidden'",
        "// t('household.leave.child')",
        "export const name = (module: ModuleKey) => t(`module.${module}.name`) + t('ui.retry')",
        'export const said = (rest: string) => t(`account.delete.${rest}`)',
        "export const open = () => import('../sync/open.ts')",
      ].join('\n'),
    )
    expect(imports).toEqual([
      'i18n/I18nProvider.tsx',
      'x/Probe.module.css',
      'household/RowLink.tsx',
    ])
    expect(fetches).toEqual(['sync/open.ts'])
    expect([...keys].sort()).toEqual(
      everyKey
        .filter(
          (key) =>
            key === 'ui.retry' ||
            key === 'sync.rejected.reason.forbidden' ||
            /^module\.[a-z]+\.name$/.test(key) ||
            key.startsWith('account.delete.'),
        )
        .sort(),
    )
    expect(keys).toContain('module.shopping.name')
    // What stands for `${…}` may be more than one word of a key.
    expect(keys).toContain('account.delete.sole.body')
  })

  it('are held to every route whose screen is a file of its own', () => {
    const screens = screensIn(sources[router] ?? '')
    expect(screens.get('leave')).toBe('household/Leave.tsx')
    expect(screens.get('devShell')).toBe('dev/shell/DevShell.tsx')
    // All but the two screens that are in the first download: where the app opens, and what
    // stands for an address that opens nothing.
    expect(routeIds.filter((id) => !screens.has(id))).toEqual(['home', 'notFound'])
    expect(fetchedPaths(routes).sort()).toEqual(
      [...screens.keys()].map((id) => paths[id].path).sort(),
    )
  })
})

// That it bites: the sources with one thing wrong, each as a change to a screen would make it.
describe('a screen that reads a word its route does not fetch', () => {
  const changed = (file: string, was: string, now: string): Readonly<Record<string, string>> => {
    const text = sources[file] ?? ''
    expect(text).toContain(was)
    return { ...sources, [file]: text.replace(was, now) }
  }
  /** The app's routes, with other words for some than paths.ts names. */
  const named = (given: Partial<Record<RouteId, readonly Part[]>>) => (id: RouteId) =>
    given[id] ?? wordsOf(id)

  it('fails, named with its route, its file, the key and the part', () => {
    const account = changed(
      'account/Account.tsx',
      "'account.households.leave_named'",
      "'household.leave.action'",
    )
    expect(problems(account)).toEqual([
      'account, whose route fetches app: account/Account.tsx reads household.leave.action, of the part household',
    ])
    // And passes once its route fetches the part.
    expect(problems(account, named({ account: ['household'] }))).toEqual([])
  })

  it('fails for a file its screen imports, and for a key it names by a template', () => {
    const found = problems(
      changed('account/common.ts', "'ui.not_available.title'", '`household.grant.level.${level}`'),
    )
    expect(found).toContain(
      'accountDevices, whose route fetches app: account/common.ts reads household.grant.level.view, of the part household',
    )
    // The household's own screens import the file too, and have the part.
    expect(found.filter((problem) => problem.startsWith('settings'))).toEqual([])
  })

  it('fails in the first download and in a shell, which have the app’s own words alone', () => {
    expect(
      problems(
        changed('app/NotAvailable.tsx', "'ui.not_available.title'", "'household.leave.child'"),
      ),
    ).toContain(
      'the first download: app/NotAvailable.tsx reads household.leave.child, of the part household',
    )
    expect(
      problems(changed('shell/Frame.tsx', "'shell.skip'", "'household.leave.child'")),
    ).toContain(
      'shell/HouseholdShell.tsx, fetched with no words: shell/Frame.tsx reads household.leave.child, of the part household',
    )
  })

  it('fails for a word that no client fetches', () => {
    expect(
      problems(
        changed('household/Leave.tsx', "'household.leave.child'", "'email.verify_email.subject'"),
      ),
    ).toEqual([
      'leave, whose route fetches app and household: household/Leave.tsx reads email.verify_email.subject, which is the server’s alone',
    ])
  })

  it('fails a route that fetches too little, and one that fetches what its screen does not read', () => {
    const bare = problems(sources, named({ leave: [] }))
    expect(bare).toContain(
      'leave, whose route fetches app: household/Leave.tsx reads household.leave.child, of the part household',
    )
    expect(bare.filter((problem) => !problem.startsWith('leave, '))).toEqual([])
    expect(problems(sources, named({ account: ['household'] }))).toEqual([
      'account: its route fetches the part household, which no file of its screen reads',
    ])
    expect(problems(sources, named({ home: ['household'] }))).toEqual([
      'home: it names words, and has no file of its own to fetch them with',
    ])
  })

  it('fails a page whose file the reading of the router does not find', () => {
    const unread = changed(router, "import('../household/Leave.tsx')", 'import(leave)')
    expect(problems(unread)).toEqual(
      expect.arrayContaining([
        `leave: its page fetches a file, and which one could not be read off ${router}`,
      ]),
    )
  })
})
