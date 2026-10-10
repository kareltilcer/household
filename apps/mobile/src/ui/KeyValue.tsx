// The key–value detail block (02-components §3): the pane beside every asset, document and
// service. Labels at the start, values at the end, mono for anything numeric. A value that does
// not exist is a dash with a word, never an empty cell: an empty cell reads as a fault.
import type { ReactNode } from 'react'
import { View } from 'react-native'
import { useTheme } from '../display/DisplayProvider.tsx'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import { Text } from './Text.tsx'

export interface Pair {
  readonly key: string
  /**
   * Left out, or anything that would be drawn as nothing, null, an empty string or `false`:
   * nothing is recorded, which the block says in a word. A string or a number is set as the
   * block sets a value; anything else is drawn as it is given.
   */
  readonly value?: ReactNode
  readonly numeric?: boolean
}

/** Whether React would draw nothing for `value`: the empty cell the block never shows. */
function drawsNothing(value: ReactNode): boolean {
  return value === undefined || value === null || value === '' || typeof value === 'boolean'
}

export function KeyValue({ pairs }: { readonly pairs: readonly Pair[] }) {
  const t = useTranslate()
  const theme = useTheme()
  const none = t('ui.kv.none')
  return (
    <View>
      {pairs.map((pair, index) => {
        const { value } = pair
        return (
          // A pair is its place in the block: two may carry one label, two phones or two owners.
          <View
            key={index}
            // A label and its value are one thing to a screen reader, read in one go.
            accessible
            // Side by side while both fit, and one above the other when they do not: at 200 %
            // text a label and its value each take the line they need.
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              columnGap: theme.space['space-2'],
              rowGap: theme.space['space-05'],
              paddingVertical: theme.density['dens-pad-y'],
              ...(index === 0
                ? {}
                : { borderTopWidth: 1, borderTopColor: theme.density['dens-rule'] }),
            }}
          >
            <Text step="caption" color="text-muted" style={{ flexShrink: 1 }}>
              {pair.key}
            </Text>
            {drawsNothing(value) ? (
              // The dash is the cell's face; the word is what it says, and all a screen reader reads.
              <Text color="text-muted" accessibilityLabel={none} style={{ flexShrink: 1 }}>
                {`— ${none}`}
              </Text>
            ) : typeof value === 'string' || typeof value === 'number' ? (
              <Text step={pair.numeric === true ? 'num' : 'body'} style={{ flexShrink: 1 }}>
                {value}
              </Text>
            ) : (
              value
            )}
          </View>
        )
      })}
    </View>
  )
}
