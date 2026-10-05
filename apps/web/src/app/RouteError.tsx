// What a route that failed to draw shows in its place: the failure named in words, with an
// action, and never a blank page (07-delivery §3). It is drawn outside the route's own tree, so
// it asks for nothing a broken route could have taken down with it but the language.
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { Button } from '../ui/Button.tsx'
import styles from './Root.module.css'

export function RouteError() {
  const t = useTranslate()
  return (
    <main className={styles.page}>
      <h1 className={styles.title}>{t('ui.error.title')}</h1>
      <p className={styles.lead}>{t('ui.error.body')}</p>
      <Button
        variant="primary"
        onClick={() => {
          window.location.reload()
        }}
      >
        {t('ui.reload')}
      </Button>
    </main>
  )
}
