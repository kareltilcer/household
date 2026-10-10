// A dev screen narrowed to one part of itself, as the harness narrows itself to one body. A
// page of every primitive in both themes is many screens long, and the end-to-end flow reaches
// a part of it by scrolling: slowly, since the whole page is read at every step, and on
// Android not at all once a swipe starts on a field that keeps a drag for itself. So a page
// names its parts, each gets a control (`<page>:only:<part>`, and `<page>:only:all`), and a
// part that was not chosen is not drawn. A part's control is named by the part's own name,
// which is data, as a dev screen's control on the index is named by its address.
import { createContext, useContext, useState, type ReactNode } from 'react'
import { View } from 'react-native'
import { useTheme } from '../display/DisplayProvider.tsx'
import { Button } from '../ui/Button.tsx'
import { useSample } from './sample.ts'

/** The one part the page's reader chose, or null for every part. */
const Chosen = createContext<string | null>(null)

export interface OnlyProps {
  /** What the controls' `testID`s begin with: the page's own name. */
  readonly page: string
  /** Each part by its name, which its control's `testID` ends in and its `Shown` is given. */
  readonly parts: readonly string[]
  /** The page, each part of it in a `Shown`. */
  readonly children: ReactNode
}

/** The controls that narrow a page to one of `parts`, above the page itself. */
export function Only({ page, parts, children }: OnlyProps) {
  const sample = useSample()
  const theme = useTheme()
  const [only, setOnly] = useState<string | null>(null)
  return (
    <Chosen.Provider value={only}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['space-1'] }}>
        <Button
          testID={`${page}:only:all`}
          variant={only === null ? 'primary' : 'secondary'}
          accessibilityState={{ selected: only === null }}
          onPress={() => {
            setOnly(null)
          }}
        >
          {sample('Every part')}
        </Button>
        {parts.map((part) => (
          <Button
            key={part}
            testID={`${page}:only:${part}`}
            variant={only === part ? 'primary' : 'secondary'}
            accessibilityState={{ selected: only === part }}
            onPress={() => {
              setOnly(part)
            }}
          >
            {part}
          </Button>
        ))}
      </View>
      {children}
    </Chosen.Provider>
  )
}

/**
 * A part of a page: drawn where every part is, or where it is the one chosen. Outside a page
 * that narrows itself, a part drawn alone in a test, it is drawn.
 */
export function Shown({ part, children }: { readonly part: string; readonly children: ReactNode }) {
  const only = useContext(Chosen)
  return only === null || only === part ? children : null
}
