// The shell's frame (04-navigation §4, F-13, F-14): the app bar, the sidebar and the page's one
// landmark, around a household's screens or a member's own account. The sidebar is the shell's
// navigation, drawn beside the content where the window has the room and in a side panel, opened
// from the bar, where it has not: a phone's width, or a desk's at 200 % text. A link skips past
// both to the content, the first thing the keyboard reaches.
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useLocation } from 'react-router'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { Button } from '../ui/Button.tsx'
import { Sheet } from '../ui/Dialog.tsx'
import styles from './Frame.module.css'

/** The width under which the sidebar is a panel: in em, so that it counts in the reader's own text size. */
const narrow = '(width < 52em)'

function subscribeToWidth(notify: () => void): () => void {
  const query = window.matchMedia(narrow)
  query.addEventListener('change', notify)
  return () => {
    query.removeEventListener('change', notify)
  }
}

/** Whether the window is too narrow for the sidebar to stand beside the content. */
export function useNarrow(): boolean {
  return useSyncExternalStore(subscribeToWidth, () => window.matchMedia(narrow).matches)
}

export interface FrameProps {
  /** What the bar names: the household the address names, or the account (F-14). */
  readonly heading: string
  /** What the navigation is of, for assistive technology and as its panel's title. */
  readonly navigationLabel: string
  /** The navigation: the sidebar's content, top to bottom. */
  readonly navigation: ReactNode
  /** What stands above every screen: the offline bar, a household's banner. */
  readonly above?: ReactNode
  readonly children: ReactNode
}

/**
 * The id of the page's landmark, which the skip link names, and where the focus is put when what
 * held it above a screen has left (EntitlementBanner.tsx).
 */
export const contentId = 'content'

export function Frame({ heading, navigationLabel, navigation, above, children }: FrameProps) {
  const t = useTranslate()
  const isNarrow = useNarrow()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  // The panel is closed by the navigation it holds: an address was chosen.
  useEffect(() => {
    setOpen(false)
  }, [location.key])
  return (
    <div className={styles.frame}>
      <a className={styles.skip} href={`#${contentId}`}>
        {t('shell.skip')}
      </a>
      <header className={styles.bar}>
        {isNarrow ? (
          // In a word, as every destination of the navigation it opens is (04-navigation §1).
          <Button
            variant="ghost"
            onClick={() => {
              setOpen(true)
            }}
          >
            {t('shell.menu')}
          </Button>
        ) : null}
        <p className={styles.heading}>{heading}</p>
      </header>
      {isNarrow ? (
        <Sheet
          open={open}
          onClose={() => {
            setOpen(false)
          }}
          title={navigationLabel}
        >
          <nav aria-label={navigationLabel} className={styles.navigation}>
            {navigation}
          </nav>
        </Sheet>
      ) : (
        <nav aria-label={navigationLabel} className={styles.sidebar}>
          <div className={styles.navigation}>{navigation}</div>
        </nav>
      )}
      <div className={styles.content}>
        {above}
        <main id={contentId} tabIndex={-1} className={styles.main}>
          {children}
        </main>
      </div>
    </div>
  )
}
