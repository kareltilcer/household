// The zone an instant is shown in to this member, in this household: their own where their
// account names one, and the household's where it names none (`Me.timezone`, PRD 03 §9). A
// timezone is never assumed: a household's screen asks here, and hands the zone to `useFormat`'s
// `instant` and `dayOf`. A calendar day has no zone, and is the household's as it is written.
import { useMe } from '../session/SessionProvider.tsx'
import { useHousehold } from './HouseholdContext.tsx'

export function useTimeZone(): string {
  const own = useMe().timezone
  const household = useHousehold().timezone
  return own ?? household
}
