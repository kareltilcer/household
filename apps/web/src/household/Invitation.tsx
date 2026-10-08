// What an invitation's link opens (A-24). Its title alone, until its screen is built.
import { Screen } from '../auth/Screen.tsx'
import { useTranslate } from '../i18n/I18nProvider.tsx'

export function Invitation() {
  const t = useTranslate()
  return <Screen title={t('household.invitation.title')} />
}
