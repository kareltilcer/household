// What the page is called: its title, which a tab, a history entry and a screen reader's list of
// windows name it by (WCAG 2.1, 2.4.2). It is the name of the screen that is drawn, its one
// `<h1>`'s words, before the app's own, so that two tabs of the app are told apart and a screen
// that changed says so. A screen says its name where it draws that heading, and the name goes
// with the screen: between two screens, and while one has no name yet, the page is called by the
// app's name alone, as index.html calls it (D-165).
import { useEffect } from 'react'
import { useTranslate } from '../i18n/I18nProvider.tsx'

/** Names the page for the screen whose one `<h1>` reads `page`, for as long as it is drawn. */
export function usePageTitle(page: string): void {
  const t = useTranslate()
  useEffect(() => {
    document.title = t('app.title', { page })
    return () => {
      document.title = t('app.name')
    }
  }, [t, page])
}
