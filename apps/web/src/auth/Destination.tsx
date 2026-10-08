// The cold start's promise (04-navigation §8, nav.js `cold`): a visitor who opened an address of
// the app's before signing in is told, on the sign-in screen and again at the second step, that
// signing in leads on to it, so that nobody wonders where they will land. The address is held by
// the guard that sent them here (app/guards.tsx) and cleared by it on arrival. The app cannot
// name what the address opens, a row of a household nobody has signed in to yet, so it says
// *the page you opened*.
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { heldDestination } from '../session/destination.ts'
import { Banner } from '../ui/Banner.tsx'

export function Destination() {
  const t = useTranslate()
  if (heldDestination() === null) return null
  return <Banner tone="neutral">{t('auth.destination')}</Banner>
}
