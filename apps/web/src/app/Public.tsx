// The frame of the screens a person reaches before they are signed in, or by a link an email
// carried (A-1 to A-11): the product's name, and the screen in the page's one landmark. It is
// drawn for anyone, a member who follows an email's link among them. It holds nothing of a
// household: no shell, no household's name, no trace that this browser ever held one.
import { Outlet } from 'react-router'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import styles from './Public.module.css'

export function Public() {
  const t = useTranslate()
  return (
    <div className={styles.frame}>
      <header className={styles.brand}>
        <span className={styles.name}>{t('app.name')}</span>
      </header>
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  )
}
