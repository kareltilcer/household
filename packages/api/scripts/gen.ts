// Generates src/generated/ from docs/api/openapi.yaml, the committed contract. It runs as the
// package's `gen` script, which turbo runs before every typecheck, lint and test, so the types
// the clients compile against are the contract's on every build and a contract change that
// breaks a client breaks the build (06-clients §1). The output is not committed: it is a
// function of the contract, and a committed copy could drift from it.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import openapiTS, { astToString, COMMENT_HEADER } from 'openapi-typescript'
import { parse } from 'yaml'

const contract = new URL('../../../docs/api/openapi.yaml', import.meta.url)
const out = new URL('../src/generated/', import.meta.url)

const ast = await openapiTS(contract, {
  // Findings the contract keeps on purpose are listed in .redocly.lint-ignore.yaml, which
  // openapi-typescript does not read; `pnpm run lint:api` is where they are judged.
  silent: true,
})

// The ProblemCode members as a runtime list, in the contract's order, so the client checks a
// response's code against the contract's list and not against a hand-kept copy.
// openapi-typescript's own `enumValues` would emit one for every enum in the document.
const document: unknown = parse(readFileSync(contract, 'utf8'))
const members: unknown = at(document, 'components', 'schemas', 'ProblemCode', 'enum')
if (!Array.isArray(members) || !members.every((m): m is string => typeof m === 'string')) {
  throw new Error('gen: the contract has no ProblemCode enum of strings')
}

mkdirSync(out, { recursive: true })
writeFileSync(new URL('openapi.ts', out), COMMENT_HEADER + astToString(ast))
writeFileSync(
  new URL('problem-codes.ts', out),
  `${COMMENT_HEADER}import type { components } from './openapi.ts'

/** The contract's ProblemCode members, in the order it declares them. */
export const problemCodes = ${JSON.stringify(members)} as const satisfies readonly components['schemas']['ProblemCode'][]
`,
)

function at(value: unknown, ...path: string[]): unknown {
  let current = value
  for (const key of path) {
    current =
      typeof current === 'object' && current !== null
        ? (current as Record<string, unknown>)[key]
        : undefined
  }
  return current
}
