// The shell around a member's own account (A-19): the same frame as a household's, with the
// account's own navigation in the sidebar's place. Account is per person and a household's
// settings are elsewhere: the two are never mixed on one screen, so nothing of a household is
// drawn here but the way back to one.
import { Outlet } from 'react-router'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { AccountNavigation } from './AccountNavigation.tsx'
import { Frame } from './Frame.tsx'

export function AccountShell() {
  const t = useTranslate()
  return (
    <Frame
      heading={t('shell.account.heading')}
      navigationLabel={t('shell.account.navigation')}
      navigation={<AccountNavigation />}
    >
      <Outlet />
    </Frame>
  )
}
