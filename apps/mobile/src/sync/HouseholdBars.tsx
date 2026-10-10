// Placeholder: the bars above a household's screens. Owner: the sync group (Y1).
// One bar whose sentence changes where it stands: offline, and *not receiving* (D-105). The
// shell's frame draws it above every screen of a household (src/shell/HouseholdFrame.tsx).
// Today it draws nothing.
export interface HouseholdBarsProps {
  readonly household: string
}

/** Told whose bars these are, and drawing none yet. */
export const HouseholdBars: (props: HouseholdBarsProps) => null = () => null
