// A component drawn as the app draws it: in a language, with the display modes and the toasts
// above it. English unless a test names another. And the files of an address, loaded before a
// test waits for what is drawn at it.
import type { DisplayLocale } from '@household/i18n/lazy'
import { render, type RenderResult } from '@testing-library/react'
import type { ReactNode } from 'react'
import { matchRoutes, type RouteObject } from 'react-router'
import { vi } from 'vitest'
import { DisplayProvider } from '../display/DisplayProvider.tsx'
import { I18nProvider } from '../i18n/I18nProvider.tsx'
import { ToastProvider } from '../ui/Toast.tsx'

export function draw(
  ui: ReactNode,
  locale: DisplayLocale = 'en',
  /**
   * `strict` draws it under React's strict mode, as main.tsx draws the app: every effect of a
   * component that mounts is run, undone and run again.
   */
  { strict = false }: { readonly strict?: boolean } = {},
): RenderResult {
  // As a wrapper, so that a test's `rerender` draws its new subject inside the same providers.
  function Around({ children }: { readonly children: ReactNode }) {
    return (
      <I18nProvider locale={locale}>
        <DisplayProvider>
          <ToastProvider>{children}</ToastProvider>
        </DisplayProvider>
      </I18nProvider>
    )
  }
  return render(ui, { wrapper: Around, reactStrictMode: strict })
}

/**
 * Loads the files of the routes of `table` that `address` names, a shell's and its screen's, as
 * the router does when the address is opened. A file imported for the first time is transformed
 * as it is asked for, as is whatever it imports that nothing imported before: on a machine with
 * other work that takes longer than the second a find waits by itself. A test that would be the
 * first of its file to wait on such a screen loads its files first, and waits for what is drawn
 * and no more.
 */
export async function loaded(table: RouteObject[], address: string): Promise<void> {
  const named = matchRoutes(table, address) ?? []
  await Promise.all(
    named.flatMap(({ route }) => (typeof route.lazy === 'function' ? [route.lazy()] : [])),
  )
}

/**
 * A button a test presses, named by what the test calls it. The name is a prop and never a
 * literal in the markup: the lint that keeps words out of the clients' markup holds tests too.
 */
export function Press({ name, onPress }: { readonly name: string; readonly onPress: () => void }) {
  return (
    <button type="button" onClick={onPress}>
      {name}
    </button>
  )
}

/**
 * Makes the root's font size follow `data-scale`, as @household/tokens' stylesheet makes it in a
 * browser: jsdom loads no stylesheet, and resolves the root to 16 px whatever its attributes say.
 */
export function rootFollowsScale(): void {
  const computed = window.getComputedStyle.bind(window)
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
    const style = computed(element, pseudo)
    if (element !== document.documentElement) return style
    const fontSize = element.getAttribute('data-scale') === '200' ? '32px' : '16px'
    return new Proxy(style, {
      get: (target, property): unknown =>
        property === 'fontSize' ? fontSize : Reflect.get(target, property),
    })
  })
}
