// What a route that failed shows in its place: the failure named in words, with an action, and
// never a blank page (07-delivery §3). A route that could not be loaded or drawn is named where it
// would have stood, inside what every route is drawn in (Root), which stays: its landmark, its
// watch for a newer build, and the shell that takes its place (item 25). A newer build that took
// a file away is what such a failure most often is, and the prompt that says so is Root's. A
// shell is a file as a screen is, and one that failed is named in its own place too, under Root
// and its prompt. Only where Root failed itself does the failure stand for the whole page. None
// of the three asks for anything a broken route could have taken down with it but the language.
//
// Each of the three is said as it arrives, as a screen that says what it is drawn from could not
// be read is (D-166; `Unread`, guards.tsx): it arrives in the place of what was loading, a shape
// that said so under a shell, of the screen a member pressed their way from, or, where Root
// failed, of the whole page they were on, and nothing moves the focus to it.
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { Button } from '../ui/Button.tsx'
import styles from './Root.module.css'
import { Landmark } from './Root.tsx'
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

/** In the place of a route that failed, inside its layout's landmark, and said as it arrives. */
export function RouteError() {
  return (
    <div className={styles.page} role="alert">
      <Failure />
    </div>
  )
}

/**
 * In the place of a shell that failed to load or to draw, inside Root: the shell is what gives
 * a member's page its landmark, so the failure brings its own.
 */
export function ShellError() {
  return (
    <Landmark>
      <RouteError />
    </Landmark>
  )
}

/**
 * In the place of the whole page, where Root itself failed: drawn as a shell's failure is, in a
 * landmark of its own, and said as it arrives, the page a member was on having gone with Root.
 */
export function RootError() {
  return <ShellError />
}
