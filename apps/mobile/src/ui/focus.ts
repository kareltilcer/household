// The ring a control draws while the focus is on it (06-clients §4): a keyboard's focus, or a
// switch's. A touch gives none, so nothing is drawn for a finger. It is one ring for every
// control, 2 px in the focus token: set off from the control by its own width, or drawn inside
// it where the control fills its row, a tab's slot or a row of More, and an outline outside it
// would be cut by what stands beside it.
import { useState } from 'react'
import type { ViewStyle } from 'react-native'
import { useTheme } from '../display/DisplayProvider.tsx'

export interface FocusRing {
  /** The outline, spread last into the control's style: nothing while the focus is elsewhere. */
  readonly ring: ViewStyle
  /** What the control hears the focus by: its `onFocus` and its `onBlur`. */
  readonly onFocus: () => void
  readonly onBlur: () => void
}

export function useFocusRing(place: 'outside' | 'inside' = 'outside'): FocusRing {
  const theme = useTheme()
  const [focused, setFocused] = useState(false)
  return {
    ring: focused
      ? {
          outlineWidth: 2,
          outlineStyle: 'solid',
          outlineOffset: place === 'inside' ? -2 : 2,
          outlineColor: theme.color.focus,
        }
      : {},
    onFocus: () => {
      setFocused(true)
    },
    onBlur: () => {
      setFocused(false)
    },
  }
}
