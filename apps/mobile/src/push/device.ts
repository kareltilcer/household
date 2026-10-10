// What the device itself says and does about notifications. This is the one file that calls
// expo-notifications: the push's logic (registration.ts) and the links ask through here, so a
// test stands in for one module, and what the app asks of the system can be read in one place.
//
// Nothing here asks the member anything but `requestPermission`, which is a press's alone. A
// device that will not say, or a build with no notifications in it, answers as one that was
// never asked and shows nothing: the app works without them.
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'

/** What the system says of notifications from this app. */
export type Permission = 'default' | 'denied' | 'granted'

/** The channel every notification is shown in on Android, which names none of its own. */
const channel = 'default'

/**
 * `settings` as the app reads it. Allowed is allowed, a provisional allowance among it. Not
 * allowed is `denied` only once the system will not ask again: on Android a permission never
 * asked for reads as not granted too, and may still be asked.
 */
function permissionOf(settings: Notifications.NotificationPermissionsStatus): Permission {
  if (settings.granted) return 'granted'
  return settings.status === Notifications.PermissionStatus.UNDETERMINED || settings.canAskAgain
    ? 'default'
    : 'denied'
}

/** What the system says now: read, with nothing asked. */
export async function permission(): Promise<Permission> {
  try {
    return permissionOf(await Notifications.getPermissionsAsync())
  } catch {
    return 'default'
  }
}

/**
 * Makes the channel Android shows the app's notifications in, under `name`, which is what the
 * system's settings call it; made again it is the same channel, renamed to the language the app
 * is in now. The server names no channel, and without this one the system would file them under
 * a name of its own. Nothing on iOS, which has none.
 */
export async function ensureChannel(name: string): Promise<void> {
  if (Platform.OS !== 'android') return
  await Notifications.setNotificationChannelAsync(channel, {
    name,
    importance: Notifications.AndroidImportance.DEFAULT,
  })
}

/**
 * Puts the system's own question, whether Household may show notifications. A device already
 * answered is not asked again, which the system would refuse to do in any case. Android puts
 * the question only once the app has a channel to show them in, so the channel is made first.
 */
export async function requestPermission(name: string): Promise<Permission> {
  await ensureChannel(name)
  const before = await permission()
  if (before !== 'default') return before
  return permissionOf(await Notifications.requestPermissionsAsync())
}

/**
 * The Expo push token of this installation in the project `project`: what the server sends a
 * push to (FR-NT1). It asks Expo's own service, so it rejects with no connection.
 */
export async function expoToken(project: string): Promise<string> {
  const token = await Notifications.getExpoPushTokenAsync({ projectId: project })
  return token.data
}

/**
 * Shows a notification that arrives while the app is open, as one that arrives while it is
 * closed is shown: the server has already held back what its member muted (FR-NT5), and what
 * it sent is meant to be seen. Left unsaid, the system shows nothing over an open app.
 */
export function showWhileOpen(): void {
  try {
    Notifications.setNotificationHandler({
      handleNotification: () =>
        Promise.resolve({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: true,
          shouldSetBadge: false,
        }),
    })
  } catch {
    // A build with no notifications shows none.
  }
}

/** What a notification carried beside its words: the server's `data`. */
function dataOf(response: Notifications.NotificationResponse): unknown {
  return response.notification.request.content.data
}

/**
 * Listens for a notification being pressed: `listener` is handed what the notification carried,
 * for the one whose press opened the app and for each pressed while it is open, once each,
 * until the function this returns is called.
 */
export function onPressed(listener: (data: unknown) => void): () => void {
  // A press that opened the app is given by both ways of asking on some systems.
  let last: string | undefined
  const pressed = (response: Notifications.NotificationResponse) => {
    const id = response.notification.request.identifier
    if (id === last) return
    last = id
    listener(dataOf(response))
  }
  try {
    const opening = Notifications.getLastNotificationResponse()
    if (opening !== null) {
      // Taken, so that the next start of the app does not open it again.
      Notifications.clearLastNotificationResponse()
      pressed(opening)
    }
    const subscription = Notifications.addNotificationResponseReceivedListener(pressed)
    return () => {
      subscription.remove()
    }
  } catch {
    return () => undefined
  }
}
