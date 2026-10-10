// *Please update* (06-clients §7, A-21, ADR 0010): the server answered `400 update_required`, as
// it answers every request of a client older than the oldest it serves, and nothing this build
// asks will be answered again. The screen says so and nothing else is drawn: no shell, no route,
// no way to put it away, there being nothing behind it that would work
// (session/Providers.tsx draws it in every screen's place).
//
// It is the last thing some members see of the app, on a device that has been in a drawer for
// a year, so its words promise what is true of one: nothing on the device is lost, a device's
// sign-in having no idle expiry (D-99), and what it had not sent is still waiting to be.
//
// On a device an update is the store's. The one action opens the app's page there, where the
// build was told of one for the platform it runs on (store.ts); a build that was told none
// draws no control, a control that cannot act being absent.
import { useState } from 'react'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { Banner } from '../ui/Banner.tsx'
import { Button } from '../ui/Button.tsx'
import { Screen } from '../ui/Screen.tsx'
import { Text } from '../ui/Text.tsx'
import { openStore, storeUrl } from './store.ts'

export interface UpdateRequiredProps {
  /** The app's page in the store. Left out, the build's own for this platform, or none. */
  readonly store?: string | undefined
}

export function UpdateRequired({ store = storeUrl() }: UpdateRequiredProps) {
  const t = useTranslate()
  const [opening, setOpening] = useState(false)
  // The device had nothing that opens the store's address: said, since the press came to nothing.
  const [failed, setFailed] = useState(false)
  return (
    <Screen title={t('ui.update.required.title')} testID="update-required">
      <Text color="text-muted">{t('device.update.body')}</Text>
      {failed ? (
        <Banner tone="danger" announce>
          {t('device.update.failed')}
        </Banner>
      ) : null}
      {store === undefined ? null : (
        <Button
          variant="primary"
          testID="update-required:store"
          loading={opening}
          onPress={() => {
            setOpening(true)
            setFailed(false)
            void openStore(store)
              .catch(() => {
                setFailed(true)
              })
              .finally(() => {
                setOpening(false)
              })
          }}
        >
          {t('device.update.action')}
        </Button>
      )}
    </Screen>
  )
}
