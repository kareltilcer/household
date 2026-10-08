// *Please update* (06-clients §7, ADR 0010): the server answered `400 update_required`, as it
// answers every request of a client older than the oldest it serves, and nothing this build asks
// will be answered again. The screen says so and nothing else is drawn: no shell, no route, no
// way to put it away. On the web an update is a reload: the page is static files, and a newer
// build is what the address serves now. Nothing is lost by it: what a member queued is kept in
// this browser and sent by the build that loads.
import styles from '../app/Root.module.css'
import { usePageTitle } from '../app/title.ts'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { Button } from '../ui/Button.tsx'

export function UpdateRequired() {
  const t = useTranslate()
  usePageTitle(t('ui.update.required.title'))
  return (
    <main className={styles.page}>
      <h1 className={styles.title}>{t('ui.update.required.title')}</h1>
      <p className={styles.lead}>{t('ui.update.required.body')}</p>
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
