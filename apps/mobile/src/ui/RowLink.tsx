// A row's own way on: a link drawn as one word, and named for what it leads to (the web's
// `RowLink`, apps/web/src/household/RowLink.tsx). A list of households has an *Open* in every
// row: each is named in full, *Open Tilcerovi*, and drawn as the word its name holds, as a
// row's own control is (ui/RowAction.tsx). That it leads somewhere is said by its role, and
// shown by the glyph after the word as well as by the link's colour.
import { router } from 'expo-router'
import { BaseIcon } from './Icon.tsx'
import { Worded } from './RowAction.tsx'

export interface RowLinkProps {
  /** Where it leads: an address of the app's own (src/app/paths.ts). */
  readonly to: string
  /** What it does and to what, for a screen reader: *Open Tilcerovi*. */
  readonly name: string
  /** The word that is drawn, which the name holds: *Open*. */
  readonly word: string
  readonly testID?: string
}

export function RowLink({ to, ...named }: RowLinkProps) {
  return (
    <Worded
      {...named}
      role="link"
      color="text-link"
      edged={false}
      onPress={() => {
        router.push(to)
      }}
    >
      <BaseIcon name="chevron-right" color="text-link" />
    </Worded>
  )
}
