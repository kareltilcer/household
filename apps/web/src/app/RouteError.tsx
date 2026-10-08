// What a route that failed shows in its place: the failure named in words, with an action, and
// never a blank page (07-delivery §3). A route that could not be loaded or drawn is named where it
// would have stood, inside what every route is drawn in (Root), which stays: its landmark, its
// watch for a newer build, and the shell that takes its place (item 25). A newer build that took
// a file away is what such a failure most often is, and the prompt that says so is Root's. Only
// where Root failed itself does the failure stand for the whole page. Neither asks for anything
// a broken route could have taken down with it but the language.
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { Button } from '../ui/Button.tsx'
import styles from './Root.module.css'
import { usePageTitle } from './title.ts'

function Failure() {
  const t = useTranslate()
  usePageTitle(t('ui.error.title'))
  return (
    <>
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
    </>
  )
}

/** In the place of a route that failed, inside Root's landmark. */
export function RouteError() {
  return (
    <div className={styles.page}>
      <Failure />
    </div>
  )
}

/** In the place of the whole page, where Root itself failed: the landmark is its own. */
export function RootError() {
  return (
    <main className={styles.page}>
      <Failure />
    </main>
  )
}
