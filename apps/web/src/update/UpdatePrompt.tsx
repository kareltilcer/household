// The reload prompt (06-clients §7): when a newer build is live, the page says so and offers to
// reload. It never reloads by itself: a member may be half-way through a form, and what they
// typed is theirs to keep until they choose.
import { useEffect, useState } from 'react'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { Banner } from '../ui/Banner.tsx'
import { Button } from '../ui/Button.tsx'
import { ownBuild, watchForUpdate } from './build.ts'
import styles from './UpdatePrompt.module.css'

export interface UpdatePromptProps {
  /** Reloads the page. Defaults to the browser's own reload. */
  readonly reload?: () => void
  /** Reads the live build. Defaults to asking for build.json (build.ts). */
  readonly live?: () => Promise<string | undefined>
}

export function UpdatePrompt({ reload, live }: UpdatePromptProps) {
  const t = useTranslate()
  const [available, setAvailable] = useState(false)
  useEffect(() => {
    const watch = watchForUpdate(
      ownBuild(),
      () => {
        setAvailable(true)
      },
      live,
    )
    return watch.stop
  }, [live])
  if (!available) return null
  return (
    <div className={styles.prompt}>
      <Banner
        tone="info"
        announce
        actions={
          <Button
            variant="primary"
            onClick={
              reload ??
              (() => {
                window.location.reload()
              })
            }
          >
            {t('ui.reload')}
          </Button>
        }
      >
        {t('ui.update.available')}
      </Banner>
    </div>
  )
}
