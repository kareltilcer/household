// What the app does when an address arrives, wherever it is open, drawing nothing (03-patterns
// §8, 04-navigation §8). An address arrives two ways.
//
// - A pressed notification carries one (`data.url`), and nothing opens it but this: the app
//   goes there by its own router, with nothing started again. What the address opens is the
//   route's to say: for a member who may no longer see it, the neutral screen and never a leak.
// - The system hands the app a link, in its own scheme or on its host. expo-router opens that
//   by itself; what is done here is what the router does not know to do, holding it for a
//   visitor and noting that it changes the household.
//
// Either way only an address of the app's own does anything (resolve.ts).
import { router } from 'expo-router'
import { useEffect, useRef } from 'react'
import { Linking } from 'react-native'
import { paths } from '../app/paths.ts'
import { onPressed } from '../push/device.ts'
import { pushTarget } from '../push/registration.ts'
import { useSession } from '../session/context.ts'
import { addressOf } from './address.ts'
import { holdDestination } from './destination.ts'
import { resolve } from './resolve.ts'
import { linkArrived, shownHousehold } from './switched.ts'

/** Where an address came from: a notification's is opened here, the system's by the router. */
type Source = 'pressed' | 'system'

export function Links() {
  const { state } = useSession()
  // Who is here, as the listeners below read it: they are told of an address outside any render.
  const visitor = useRef(false)
  useEffect(() => {
    visitor.current = state.status === 'visitor'
  }, [state.status])

  useEffect(() => {
    const arrive = (address: string | null, source: Source) => {
      const arrival = resolve(address, { visitor: visitor.current, shown: shownHousehold() })
      switch (arrival.kind) {
        case 'nothing':
          return
        case 'held':
          // Held whoever was here before: somebody pressing a notification is on their way in.
          holdDestination(arrival.path)
          if (source === 'pressed') router.navigate(paths.signIn.path)
          return
        case 'switched':
          linkArrived(arrival.to)
          break
        case 'opened':
        case 'notAvailable':
          break
      }
      // On to the stack, so that Back returns to where its member was. An address with no
      // screen is opened too: what stands there is the neutral screen, which is the answer.
      if (source === 'pressed') router.push(arrival.path)
    }
    const stopPressed = onPressed((data) => {
      arrive(pushTarget(data), 'pressed')
    })
    const links = Linking.addEventListener('url', ({ url }) => {
      arrive(addressOf(url), 'system')
    })
    return () => {
      stopPressed()
      links.remove()
    }
  }, [])
  return null
}
