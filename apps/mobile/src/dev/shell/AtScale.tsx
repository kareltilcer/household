// Draws what stands in it at a text scale of its own, whatever the device says and whatever the
// dev toolbar holds the page at: a bar at 100 % above the same bar at 200 %, on one screen. The
// display's scale is one for the whole app, so this stands a second display around its
// children, with the page's own theme and motion, and holds its scale there. A dev screen's
// alone: a member's text is one size.
import { useEffect, useState, type ReactNode } from 'react'
import { DisplayProvider, useDisplay } from '../../display/DisplayProvider.tsx'

/** Holds the text at `scale` for as long as it is drawn, and draws `children` once it is held. */
function Held({ scale, children }: { readonly scale: number; readonly children: ReactNode }) {
  const { hold } = useDisplay()
  const [held, setHeld] = useState(false)
  useEffect(() => {
    const release = hold({ scale })
    setHeld(true)
    return release
  }, [hold, scale])
  return held ? children : null
}

export function AtScale({
  scale,
  children,
}: {
  readonly scale: number
  readonly children: ReactNode
}) {
  const { preferences } = useDisplay()
  return (
    // Begun again when the page's own modes change: a display takes its modes as it starts.
    <DisplayProvider key={`${preferences.theme}:${preferences.motion}`} preferences={preferences}>
      <Held scale={scale}>{children}</Held>
    </DisplayProvider>
  )
}
