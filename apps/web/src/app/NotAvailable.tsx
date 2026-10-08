// The neutral *not available* screen (F-17, 04-navigation §8, 03-patterns §2): what an address
// that opens nothing shows, whoever asks and whatever the reason. It names no entity, gives no
// cause and offers no retry: an address that never existed, a row that is gone, a module the
// member does not hold and a household they are not in read the same, since telling them apart
// would answer a question the member is not entitled to ask. Every link to something in a
// household came from inside it, there being no public sharing, so it may say to ask whoever
// sent it.
import { Link } from 'react-router'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { paths } from './paths.ts'
import styles from './Root.module.css'

export interface NotAvailableProps {
  /** Where its one way out leads: the household the member is in, or where the app opens. */
  readonly home?: string
}

export function NotAvailable({ home = paths.home.path }: NotAvailableProps) {
  const t = useTranslate()
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{t('ui.not_available.title')}</h1>
      <p className={styles.lead}>{t('ui.not_available.body')}</p>
      <Link to={home} className={styles.link}>
        {t('ui.not_available.home')}
      </Link>
    </div>
  )
}
