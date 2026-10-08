// Where a pressed notification leads (03-patterns §8, 04-navigation §8): the worker tells a page
// of the app that is open which address the notification names (build/pushWorker.ts), and the
// page goes there by its own router, with nothing reloaded. It draws nothing. What the address
// opens is the router's to say: for a member who may no longer see it, the neutral screen and
// never a leak. With no page open the worker opens the address itself, and the app resolves it
// as it starts.
import { useEffect } from 'react'
import { useNavigate } from 'react-router'
import { pushTarget } from './worker.ts'

export function PushLinks() {
  const navigate = useNavigate()
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return undefined
    const workers = navigator.serviceWorker
    const open = (event: MessageEvent<unknown>) => {
      const address = pushTarget(event.data)
      if (address !== null) void navigate(address)
    }
    workers.addEventListener('message', open)
    return () => {
      workers.removeEventListener('message', open)
    }
  }, [navigate])
  return null
}
