// The web app's build (PL-4). Two builds come out of it:
//
// - `vite build` writes dist/www, what a deployment serves. The dev-only routes, the twelve-state
//   harness among them, are not in it, and the bundle budget is measured on it (build/budget.ts).
// - `vite build --mode e2e` writes dist/e2e, the same build with the dev-only routes in, which the
//   end-to-end suite runs against: axe, the pseudo-locale pass and the policy, on real pages.
//
// Both are production builds under the policy of build/csp.ts. The development server is not: its
// hot reloading injects styles inline, which the policy exists to refuse.
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { catalogChunk, catalogOf } from './build/budget.ts'
import { headerPolicyFor, metaPolicyFor } from './build/csp.ts'
import { deployment } from './build/deployment.ts'
import { household, householdDev } from './build/plugin.ts'
import { apiOrigin, preview } from './build/preview.ts'
import { devPagesMode } from './src/app/paths.ts'

export default defineConfig(({ mode }) => {
  // The services a build's pages reach beside their own origin, the sync service and the object
  // store: the ones its environment names, and for the end-to-end build the development stack's
  // own unless the environment names others.
  const deployed = deployment(mode === devPagesMode)
  // The API, same-origin as in production: its session cookie is `__Host-`, and its CSRF check
  // names this origin. 127.0.0.1, where `pnpm run dev:api` listens and the end-to-end suite
  // starts its own.
  const proxy = { '/api': apiOrigin }
  return {
    plugins: [react(), household({ policy: metaPolicyFor(deployed) }), householdDev()],
    build: {
      outDir: mode === devPagesMode ? 'dist/e2e' : 'dist/www',
      emptyOutDir: true,
      // A file inlined as a data: URL is one the policy refuses: every font and image stays a file.
      assetsInlineLimit: 0,
      // Source maps for the build the end-to-end suite runs, which a failing test is debugged in,
      // and none for the build a deployment serves: a map beside its script hands the app's
      // sources to whoever asks for it (build/check.ts fails a build that holds one).
      sourcemap: mode === devPagesMode,
      rolldownOptions: {
        output: {
          // A part of a language's catalog is a file of its own, named for what it is: the
          // bundle budget counts the app's own words in the largest language with what a first
          // visit downloads, and every other part as the script of the screen that reads it
          // (build/budget.ts).
          chunkFileNames: (chunk) => {
            const part = catalogOf(chunk.moduleIds)
            return part === undefined
              ? 'assets/[name]-[hash].js'
              : `assets/${catalogChunk}${part}-[hash].js`
          },
        },
      },
    },
    // The replica's SDK runs its SQLite, which is WebAssembly, in a worker of its own, written as
    // a module as the app is; the development server leaves both packages as they are published,
    // since its optimiser would bundle the worker away from the files it loads.
    worker: { format: 'es' },
    optimizeDeps: { exclude: ['@powersync/web', '@journeyapps/wa-sqlite'] },
    server: { proxy },
    preview: {
      host: preview.host,
      port: preview.port,
      strictPort: true,
      proxy,
      headers: {
        'Content-Security-Policy': headerPolicyFor(deployed),
        'X-Content-Type-Options': 'nosniff',
      },
    },
  }
})
