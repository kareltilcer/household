// The versions of a row (F-6, F-7, 06-clients §5): whose each is, when it was made, and what it
// holds, field by field, in the words the row's own screen uses for them. Two for a conflict,
// the member's and the other author's; two for a value out of order, the member's and the entry
// it is out of order with; one for any other change that was not accepted, which is what the
// member entered. Nothing here is a version number, a vector or a "remote".
//
// One under the other: a sheet on a phone has the room for one label and its value on a line,
// and at 200 % text not always that.
import { View } from 'react-native'
import { useTheme } from '../display/DisplayProvider.tsx'
import { KeyValue, type Pair } from '../ui/KeyValue.tsx'
import { Text } from '../ui/Text.tsx'

export interface Version {
  /** Whose it is: *Your version*, a member's name, *The entry next to it*. */
  readonly heading: string
  /** What is said of it under its heading, a line each: when it was made, that it is a deletion. */
  readonly notes?: readonly string[]
  /** What it holds. A deletion holds nothing. */
  readonly pairs: readonly Pair[]
}

export interface VersionBlockProps {
  readonly version: Version
  /**
   * Whether its name is a heading. In a panel it is, one a version; in a banner it is a label,
   * since a banner stands on a screen whose headings are that screen's own.
   */
  readonly headed?: boolean
  /** What a test and an end-to-end flow find it by: a version is its place, and has no name of its own. */
  readonly testID: string
}

/** One version: a name over what it holds, inside an edge of its own. */
export function VersionBlock({ version, headed = true, testID }: VersionBlockProps) {
  const theme = useTheme()
  return (
    <View
      testID={testID}
      style={{
        gap: theme.space['space-05'],
        padding: theme.space['space-15'],
        borderWidth: 1,
        borderColor: theme.color['border-subtle'],
        borderRadius: theme.radii['radius-card'],
      }}
    >
      <Text weight={600} header={headed}>
        {version.heading}
      </Text>
      {(version.notes ?? []).map((note) => (
        <Text key={note} step="caption" color="text-muted">
          {note}
        </Text>
      ))}
      {version.pairs.length === 0 ? null : <KeyValue pairs={version.pairs} />}
    </View>
  )
}

export function Versions({ versions }: { readonly versions: readonly Version[] }) {
  const theme = useTheme()
  return (
    <View style={{ gap: theme.space['space-15'] }}>
      {versions.map((version, index) => (
        // A version is its place: the member's first, and two may be headed alike.
        <VersionBlock key={index} testID={`sync:version:${String(index)}`} version={version} />
      ))}
    </View>
  )
}
