// What any other address under a household opens: nothing (F-17). The way out is the household
// the member is in, which the shell around this has already read.
import { NotAvailable } from '../app/NotAvailable.tsx'
import { inHousehold } from '../app/paths.ts'
import { useHouseholdId } from '../household/HouseholdContext.tsx'

export function Elsewhere() {
  return <NotAvailable home={inHousehold.home(useHouseholdId())} />
}
