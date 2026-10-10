// The app's own sources, as a test reads them to hold a rule no lint states: which one file
// imports a library, and how every write is asked. A rule held this way fails for the file that
// breaks it, by name, on the day it is written.
import { jest } from '@jest/globals'

/** Node's own, asked for by name: the app's sources know nothing of Node, and its tests read them. */
interface Files {
  readonly readdirSync: (
    path: string,
    options: { readonly recursive: true; readonly encoding: 'utf8' },
  ) => string[]
  readonly readFileSync: (path: string, encoding: 'utf8') => string
}

const files = jest.requireActual<Files>('node:fs')

export interface Source {
  /** From apps/mobile, with forward slashes: `src/api/query.ts`. */
  readonly path: string
  readonly source: string
}

/**
 * Every source file under `directories` that is no test, each directory named from apps/mobile,
 * which is where Jest runs.
 */
export function sourcesIn(directories: readonly string[]): Source[] {
  return directories.flatMap((directory) =>
    files
      .readdirSync(directory, { recursive: true, encoding: 'utf8' })
      .map((name) => `${directory}/${name.replaceAll('\\', '/')}`)
      .filter((path) => /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path))
      .map((path) => ({ path, source: files.readFileSync(path, 'utf8') })),
  )
}
