// What the build adds to Vite's own: the policy in index.html (csp.ts), the script that sets the
// display modes before the first paint (boot.ts), and the build's id, in index.html and in
// build.json beside it, which is how a page learns that a newer build is live (06-clients §7).
// And what it refuses: a dev-only page in any build but the end-to-end suite's (D-154), and a
// base other than the origin's root.
import { createHash } from 'node:crypto'
import { relative, sep } from 'node:path'
import type { HtmlTagDescriptor, Plugin } from 'vite'
import { devPagesMode } from '../src/app/paths.ts'
import { buildFile, buildMeta, buildPlaceholder } from '../src/update/build.ts'
import { bootScript } from './boot.ts'
import { metaPolicy } from './csp.ts'

function digest(...parts: (string | Uint8Array)[]): string {
  const hash = createHash('sha256')
  for (const part of parts) hash.update(part)
  return hash.digest('hex')
}

/**
 * A build's id: a digest of every file it wrote, by name and content. Two builds of the same
 * sources are the same build, so a deploy that changes nothing prompts no one to reload.
 */
export function buildId(files: Readonly<Record<string, string | Uint8Array>>): string {
  const names = Object.keys(files).sort()
  return digest(...names.flatMap((name) => [name, '\0', files[name] ?? '', '\0'])).slice(0, 16)
}

/** Where the dev-only pages are kept, from the app's root: they, and all that only they use. */
const devDirectory = 'src/dev/'

/**
 * The modules among `ids` that are the dev-only pages' own: the files under src/dev of the app
 * at `root`. A build a deployment serves holds none of them. The routes name the pages only for
 * the development server and the end-to-end build (src/app/routes.tsx), but nothing else stops
 * a shipped screen from importing one, or the samples it draws, and build/check.ts knows a
 * dev-only page only by a mark the harness alone writes.
 */
export function devOnly(ids: readonly string[], root: string): string[] {
  return ids.filter((id) => {
    // A module's id is its file, after a NUL where a plugin made it up and before any query.
    const file = id.replace(/^\0/, '').replace(/[?#].*$/, '')
    return relative(root, file).split(sep).join('/').startsWith(devDirectory)
  })
}

/**
 * Refuses a build told to be served from anywhere but its origin's root. The page asks for
 * build.json by its path from the root (src/update/build.ts), as it asks for the API, and the
 * router matches from there: under another base the file would be written where no page asks, a
 * newer build would never be heard of, and nothing would say so.
 */
export function rootBase(base: string): void {
  if (base !== '/') {
    throw new Error(
      `the web app is served from its origin's root, and this build's base is ${base}: ` +
        `the page asks for ${buildFile} and for the API by their paths from the root`,
    )
  }
}

/** The page's statement of its encoding, as index.html writes it. */
const encoding = /[ \t]*<meta charset="utf-8" \/>\r?\n?/

/**
 * What the build puts first in the page's head, and the page without the one of them it already
 * held: the encoding, then the policy, then the script that sets the display modes. The encoding
 * is first because a browser looks for it in a page's first 1024 bytes alone, and before it runs
 * a script: written where index.html has it, it would stand after a policy that grows with every
 * origin it is widened for.
 */
export function head(
  html: string,
  bootFile: string,
): { readonly html: string; readonly tags: HtmlTagDescriptor[] } {
  if (!encoding.test(html)) {
    throw new Error('index.html has no <meta charset="utf-8" />: its encoding has nothing to move')
  }
  return {
    html: html.replace(encoding, ''),
    tags: [
      { tag: 'meta', attrs: { charset: 'utf-8' }, injectTo: 'head-prepend' },
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: metaPolicy },
        injectTo: 'head-prepend',
      },
      // A classic script, so that it runs before the stylesheet below it paints anything.
      { tag: 'script', attrs: { src: `/${bootFile}` }, injectTo: 'head-prepend' },
    ],
  }
}

export function household(): Plugin {
  const boot = bootScript()
  const bootFile = `assets/display-${digest(boot).slice(0, 8)}.js`
  let root = ''
  let devPages = false
  return {
    name: 'household',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      rootBase(config.base)
      root = config.root
      devPages = config.mode === devPagesMode
    },
    buildStart() {
      this.emitFile({ type: 'asset', fileName: bootFile, source: boot })
    },
    transformIndexHtml(html) {
      return head(html, bootFile)
    },
    generateBundle(_, bundle) {
      if (!devPages) {
        const held = devOnly(
          Object.values(bundle).flatMap((file) => (file.type === 'chunk' ? file.moduleIds : [])),
          root,
        )
        if (held.length > 0) {
          const files = [...new Set(held)].join(', ')
          this.error(
            `a dev-only page is in a build that is not the end-to-end suite's: ${files}. ` +
              `Nothing a deployment serves imports ${devDirectory}`,
          )
        }
      }
      const page = bundle['index.html']
      if (page?.type !== 'asset' || typeof page.source !== 'string') {
        this.error('index.html is not in the bundle: the build id has nowhere to go')
      }
      const placeholder = `<meta name="${buildMeta}" content="${buildPlaceholder}"`
      if (!page.source.includes(placeholder)) {
        this.error(`index.html has no ${placeholder}>: the build id has nowhere to go`)
      }
      const files: Record<string, string | Uint8Array> = {}
      for (const [name, file] of Object.entries(bundle)) {
        if (name.endsWith('.map')) continue
        files[name] = file.type === 'chunk' ? file.code : file.source
      }
      const id = buildId(files)
      page.source = page.source.replace(placeholder, `<meta name="${buildMeta}" content="${id}"`)
      this.emitFile({
        type: 'asset',
        // Beside index.html, where the page asks for it by its absolute path.
        fileName: buildFile.replace(/^\//, ''),
        source: `${JSON.stringify({ id })}\n`,
      })
    },
  }
}
