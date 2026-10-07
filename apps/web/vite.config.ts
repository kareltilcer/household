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
import { headerPolicy } from './build/csp.ts'
import { preview } from './build/preview.ts'
import { household } from './build/plugin.ts'
import { devPagesMode } from './src/app/paths.ts'

export default defineConfig(({ mode }) => ({
  plugins: [react(), household()],
  build: {
    outDir: mode === devPagesMode ? 'dist/e2e' : 'dist/www',
    emptyOutDir: true,
    // A file inlined as a data: URL is one the policy refuses: every font and image stays a file.
    assetsInlineLimit: 0,
    // Source maps for the build the end-to-end suite runs, which a failing test is debugged in,
    // and none for the build a deployment serves: a map beside its script hands the app's
    // sources to whoever asks for it (build/check.ts fails a build that holds one).
    sourcemap: mode === devPagesMode,
  },
  server: {
    // The API, same-origin as in production: its session cookie is `__Host-`, and its CSRF check
    // names this origin. 127.0.0.1, where `pnpm run dev:api` listens.
    proxy: { '/api': 'http://127.0.0.1:8080' },
  },
  preview: {
    host: preview.host,
    port: preview.port,
    strictPort: true,
    headers: {
      'Content-Security-Policy': headerPolicy,
      'X-Content-Type-Options': 'nosniff',
    },
  },
}))
