// What a route that is not built yet shows: the app's name as its title, which every page has one
// of. Nothing ships with a route that draws this: the item that adds a route builds its screen.
import { useTranslate } from '../i18n/I18nProvider.tsx'
import styles from './Root.module.css'

export function Placeholder() {
  const t = useTranslate()
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{t('app.name')}</h1>
    </div>
  )
}
