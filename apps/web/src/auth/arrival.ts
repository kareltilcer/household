// What a page does as it is opened, once: a link's token spent, a provider's code redeemed.
// React's strict mode runs every effect of a component that mounts twice in development, and a
// token or a code is good for one use: sent twice, the second answer, a refusal, would stand in
// the first one's place on the screen.
import { useEffect, useRef } from 'react'

/** Runs `act` when the screen is first drawn, and never again for as long as it is. */
export function useOnArrival(act: () => void): void {
  const arrived = useRef(false)
  // The screen as it first was is the one that arrived: what `act` reads is what it opened with.
  const first = useRef(act)
  useEffect(() => {
    if (arrived.current) return
    arrived.current = true
    first.current()
  }, [])
}
