// The household a component test draws a household's screen in: what the frame hands a screen
// (HouseholdContext.tsx), with nothing read and nothing kept. The arrangement lives for as long
// as the fixture is drawn, and a change to it is the next thing drawn, as on a device.
//
//   await render(<HouseholdFixture household={household}><Arrange /></HouseholdFixture>)
import { useCallback, useState, type ReactNode } from 'react'
import type { Household } from '../household/data.ts'
import { HouseholdProvider } from './HouseholdContext.tsx'
import { noArrangement, type Arrangement } from './navigation.ts'

export interface HouseholdFixtureProps {
  readonly household: Household
  /** The arrangement it opens with. Left out, none: every module in the product's order. */
  readonly arrangement?: Arrangement
  /** Told of each change, beside it being drawn. */
  readonly onArrange?: (next: Arrangement) => void
  readonly children: ReactNode
}

export function HouseholdFixture({
  household,
  arrangement: first = noArrangement,
  onArrange,
  children,
}: HouseholdFixtureProps) {
  const [arrangement, setArrangement] = useState(first)
  const arrange = useCallback(
    (next: Arrangement) => {
      setArrangement(next)
      onArrange?.(next)
    },
    [onArrange],
  )
  return (
    <HouseholdProvider household={household} arrangement={arrangement} arrange={arrange}>
      {children}
    </HouseholdProvider>
  )
}
