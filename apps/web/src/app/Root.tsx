// What every route is drawn inside. Item 24 gives it the page's one landmark and the prompt that
// a newer build is live; the shell (the sidebar, the app bar, the household switcher) is item
// 25's, and takes this place.
import { useEffect } from 'react'
import { Outlet } from 'react-router'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { UpdatePrompt } from '../update/UpdatePrompt.tsx'
import styles from './Root.module.css'

export function Root() {
  const t = useTranslate()
  useEffect(() => {
    document.title = t('app.name')
  }, [t])
  return (
    <div className={styles.root}>
      <UpdatePrompt />
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  )
}
