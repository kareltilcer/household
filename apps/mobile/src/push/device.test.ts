// What the device itself says and does about notifications, with the system stood in for: how
// its answer is read, when its question is put, and what a pressed notification hands on.
import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import {
  ensureChannel,
  expoToken,
  onPressed,
  permission,
  requestPermission,
  showWhileOpen,
} from './device.ts'

jest.mock('expo-notifications', () => ({
  PermissionStatus: { GRANTED: 'granted', DENIED: 'denied', UNDETERMINED: 'undetermined' },
  AndroidImportance: { DEFAULT: 3 },
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn(() => Promise.resolve(null)),
  getExpoPushTokenAsync: jest.fn(),
  setNotificationHandler: jest.fn(),
  getLastNotificationResponse: jest.fn(() => null),
  clearLastNotificationResponse: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
}))

type Settings = Notifications.NotificationPermissionsStatus

function settings(status: string, granted: boolean, canAskAgain: boolean): Settings {
  return { status, granted, canAskAgain, expires: 'never' } as Settings
}

const says = (answer: Settings) =>
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(answer)

function response(id: string, data: unknown): Notifications.NotificationResponse {
  return {
    actionIdentifier: 'default',
    notification: { date: 0, request: { identifier: id, content: { data }, trigger: null } },
  } as unknown as Notifications.NotificationResponse
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(Notifications.getLastNotificationResponse).mockReturnValue(null)
})

describe('what the system says of notifications', () => {
  it.each([
    ['allowed', settings('granted', true, true), 'granted'],
    // iOS's quiet allowance: allowed, as far as registering goes.
    ['allowed provisionally', settings('undetermined', true, true), 'granted'],
    ['never asked', settings('undetermined', false, true), 'default'],
    // Android reads a permission never asked for as not granted, and may still be asked.
    ['not granted, and still to be asked', settings('denied', false, true), 'default'],
    ['refused, and not to be asked again', settings('denied', false, false), 'denied'],
  ])('is read as it is: %s', async (_name, answer, read) => {
    says(answer)
    expect(await permission()).toBe(read)
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled()
  })

  it('is taken as never asked on a device that will not say', async () => {
    jest.mocked(Notifications.getPermissionsAsync).mockRejectedValue(new Error('no such module'))
    expect(await permission()).toBe('default')
  })
})

describe('the system’s question', () => {
  it('is put where it has not been answered, and its answer read', async () => {
    says(settings('undetermined', false, true))
    jest
      .mocked(Notifications.requestPermissionsAsync)
      .mockResolvedValue(settings('granted', true, true))
    expect(await requestPermission('Notifications')).toBe('granted')
    expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['allowed already', settings('granted', true, true), 'granted'],
    ['refused for good', settings('denied', false, false), 'denied'],
  ])('is not put again on a device that %s', async (_name, answer, read) => {
    says(answer)
    expect(await requestPermission('Notifications')).toBe(read)
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled()
  })

  // Android puts the question only once the app has a channel to show notifications in.
  it('is put on Android after the channel is made, under the name it was given', async () => {
    const os = jest.replaceProperty(Platform, 'OS', 'android')
    says(settings('denied', false, true))
    const order: string[] = []
    jest.mocked(Notifications.setNotificationChannelAsync).mockImplementation(() => {
      order.push('channel')
      return Promise.resolve(null)
    })
    jest.mocked(Notifications.requestPermissionsAsync).mockImplementation(() => {
      order.push('question')
      return Promise.resolve(settings('granted', true, true))
    })
    await requestPermission('Oznámení')
    expect(order).toEqual(['channel', 'question'])
    expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith('default', {
      name: 'Oznámení',
      importance: 3,
    })
    os.restore()
  })

  it('makes no channel on iOS, which has none', async () => {
    await ensureChannel('Notifications')
    expect(Notifications.setNotificationChannelAsync).not.toHaveBeenCalled()
  })
})

describe('the installation’s token', () => {
  it('is Expo’s, asked for with the project the build belongs to', async () => {
    jest
      .mocked(Notifications.getExpoPushTokenAsync)
      .mockResolvedValue({ type: 'expo', data: 'ExponentPushToken[abc]' })
    expect(await expoToken('a project')).toBe('ExponentPushToken[abc]')
    expect(Notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'a project' })
  })
})

describe('a notification that arrives while the app is open', () => {
  it('is shown as any other is, and badges nothing', async () => {
    showWhileOpen()
    const handler = jest.mocked(Notifications.setNotificationHandler).mock.calls[0]?.[0]
    const shown = await handler?.handleNotification({} as Notifications.Notification)
    expect(shown).toEqual({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    })
  })

  it('is shown by nothing on a build with no notifications, which goes on', () => {
    jest.mocked(Notifications.setNotificationHandler).mockImplementationOnce(() => {
      throw new Error('no such module')
    })
    expect(() => {
      showWhileOpen()
    }).not.toThrow()
  })
})

describe('a pressed notification', () => {
  const data = { url: '/households/a/today', household_id: 'a' }

  it('that opened the app is handed on once, and taken, so the next start does not open it again', () => {
    jest.mocked(Notifications.getLastNotificationResponse).mockReturnValue(response('one', data))
    const pressed = jest.fn()
    onPressed(pressed)
    expect(pressed).toHaveBeenCalledTimes(1)
    expect(pressed).toHaveBeenCalledWith(data)
    expect(Notifications.clearLastNotificationResponse).toHaveBeenCalledTimes(1)
  })

  it('while the app is open is handed on, each once', () => {
    const pressed = jest.fn()
    onPressed(pressed)
    expect(pressed).not.toHaveBeenCalled()
    const listener = jest.mocked(Notifications.addNotificationResponseReceivedListener).mock
      .calls[0]?.[0]
    listener?.(response('one', data))
    listener?.(response('two', { url: '/' }))
    expect(pressed.mock.calls).toEqual([[data], [{ url: '/' }]])
  })

  // Some systems give the press that opened the app both ways.
  it('is handed on once where the system gives it twice', () => {
    jest.mocked(Notifications.getLastNotificationResponse).mockReturnValue(response('one', data))
    const pressed = jest.fn()
    onPressed(pressed)
    const listener = jest.mocked(Notifications.addNotificationResponseReceivedListener).mock
      .calls[0]?.[0]
    listener?.(response('one', data))
    expect(pressed).toHaveBeenCalledTimes(1)
  })

  it('is listened for until it is stopped', () => {
    const remove = jest.fn()
    jest
      .mocked(Notifications.addNotificationResponseReceivedListener)
      .mockReturnValueOnce({ remove })
    const stop = onPressed(() => undefined)
    expect(remove).not.toHaveBeenCalled()
    stop()
    expect(remove).toHaveBeenCalledTimes(1)
  })

  it('is nothing on a build with no notifications, which goes on', () => {
    jest.mocked(Notifications.getLastNotificationResponse).mockImplementationOnce(() => {
      throw new Error('no such module')
    })
    const pressed = jest.fn()
    const stop = onPressed(pressed)
    expect(() => {
      stop()
    }).not.toThrow()
    expect(pressed).not.toHaveBeenCalled()
  })
})
