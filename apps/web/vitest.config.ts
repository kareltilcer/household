// Unit and component tests (PL-3): Vitest, in two projects. `app` is src/, with React Testing
// Library in jsdom; `build` is the build's own parts and the check of a build, on Node, where a
// test that needs a document names jsdom in its first line. The end-to-end suite is Playwright's
// (e2e/, playwright.config.ts) and no part of this.
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    restoreMocks: true,
    unstubGlobals: true,
    projects: [
      {
        extends: true,
        test: {
          name: 'app',
          environment: 'jsdom',
          include: ['src/**/*.test.{ts,tsx}'],
          setupFiles: ['src/test/setup.ts'],
        },
      },
      {
        extends: true,
        test: { name: 'build', environment: 'node', include: ['build/**/*.test.ts'] },
      },
    ],
  },
})
