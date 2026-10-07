// The landing route. Before the shell and sign-in exist (item 25) it is the app's name and
// nothing else: a page that proves the build, its fonts, its tokens and its policy on a real
// route, and that every gate has something to run against.
import { useTranslate } from '../i18n/I18nProvider.tsx'
import styles from './Root.module.css'

export function Home() {
  const t = useTranslate()
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{t('app.name')}</h1>
    </div>
  )
}
