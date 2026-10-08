// A link that opened another household than the one this tab was in (F-16, 04-navigation §8, the
// wrong-household case). The household is in the address (D-4), so opening the link is the
// switch: it needs no step of its own. What it needs is to be said, since everything else on
// screen changed with it, the modules, the grants, the banner, the timezone and the currency,
// and one control that goes back.
//
// It is said only where the member did not choose the household themselves: the switcher's own
// navigation says so (Switcher.tsx), and the first household a tab opens is no switch at all.
// The tab's last household is this tab's own to know, kept in its storage.
import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { inHousehold } from '../app/paths.ts'
import { useHouseholdId } from '../household/HouseholdContext.tsx'
import { useHouseholds } from '../household/households.ts'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { Banner } from '../ui/Banner.tsx'
import { switchedByMember } from './Switcher.tsx'

/** Where a tab keeps the household it was last in. */
const key = 'household.tab'

function last(): string | null {
  try {
    return window.sessionStorage.getItem(key)
  } catch {
    return null
  }
}

/** Whether the navigation that came here says the member chose the household themselves. */
function chosen(state: unknown): boolean {
  return (
    typeof state === 'object' && state !== null && 'switched' in state && state.switched === true
  )
}

export function Switched() {
  const t = useTranslate()
  const household = useHouseholdId()
  const location = useLocation()
  const households = useHouseholds()
  // Read once, as this household opens: the shell draws one of these for each household.
  const [from] = useState(() => {
    const before = last()
    return before !== null && before !== household && !chosen(location.state) ? before : null
  })
  const [dismissed, setDismissed] = useState(false)
  useEffect(() => {
    try {
      window.sessionStorage.setItem(key, household)
    } catch {
      // A tab that keeps nothing says nothing of a switch.
    }
  }, [household])

  // The household the tab was in is named only where it is this member's still: one they have
  // left since, or another person's who signed in here before them, is named to nobody.
  const previous = from === null ? undefined : households.data?.find(({ id }) => id === from)
  if (previous === undefined || dismissed) return null
  return (
    <Banner
      tone="info"
      announce
      onDismiss={() => {
        setDismissed(true)
      }}
      actions={
        <Link to={inHousehold.home(previous.id)} state={switchedByMember}>
          {t('shell.switched.back', { household: previous.name ?? '' })}
        </Link>
      }
    >
      {t('shell.switched.body')}
    </Banner>
  )
}
