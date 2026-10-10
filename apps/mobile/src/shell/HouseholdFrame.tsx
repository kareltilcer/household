// Placeholder: the household's frame. Owner: the shell group (H1).
// It reads the household, draws *could not be read* or *not available* in the screens' place,
// the switch banner, and above every screen the bars: the sync group's `HouseholdBars` first
// (the offline bar and *not receiving*), then a place for item 29's one entitlement banner.
// Today it draws the bars and the screens and nothing else.
import type { ReactNode } from 'react'
import { View } from 'react-native'
import { HouseholdBars } from '../sync/HouseholdBars.tsx'

export interface HouseholdFrameProps {
  /** The household in the address, which may be no household's id at all. */
  readonly household: string
  readonly children: ReactNode
}

export function HouseholdFrame({ household, children }: HouseholdFrameProps) {
  return (
    <View style={{ flex: 1 }}>
      <HouseholdBars household={household} />
      {/* Item 29's entitlement banner stands here, under the offline bar's place. */}
      {children}
    </View>
  )
}
