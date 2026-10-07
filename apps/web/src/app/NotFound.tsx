// What an address that matches no route shows. It says nothing about why: an address that never
// existed and one the member may not see read the same (03-patterns §2). The neutral screen a deep
// link resolves to (F-17) is item 25's, and takes this place.
import { Link } from 'react-router'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { paths } from './paths.ts'
import styles from './Root.module.css'

export function NotFound() {
  const t = useTranslate()
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{t('ui.not_found.title')}</h1>
      <p className={styles.lead}>{t('ui.not_found.body')}</p>
      <Link to={paths.home.path} className={styles.link}>
        {t('ui.not_found.home')}
      </Link>
    </div>
  )
}
