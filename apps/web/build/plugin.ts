// What the build adds to Vite's own: the policy in index.html (csp.ts), the script that sets the
// display modes before the first paint (boot.ts), and the build's id, in index.html and in
// build.json beside it, which is how a page learns that a newer build is live (06-clients §7).
import { createHash } from 'node:crypto'
import type { HtmlTagDescriptor, Plugin } from 'vite'
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

export function household(): Plugin {
  const boot = bootScript()
  const bootFile = `assets/display-${digest(boot).slice(0, 8)}.js`
  let base = '/'
  return {
    name: 'household',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      base = config.base
    },
    buildStart() {
      this.emitFile({ type: 'asset', fileName: bootFile, source: boot })
    },
    transformIndexHtml(): HtmlTagDescriptor[] {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: metaPolicy },
          injectTo: 'head-prepend',
        },
        // A classic script, so that it runs before the stylesheet below it paints anything.
        { tag: 'script', attrs: { src: `${base}${bootFile}` }, injectTo: 'head-prepend' },
      ]
    },
    generateBundle(_, bundle) {
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
