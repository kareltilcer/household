// *Please update*: the one screen with no household, no session and no data behind it. What it
// says, in five languages, and its one action, which is there only where it can act. That it
// stands in every screen's place is the session's test (session/session.test.tsx).
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { catalogs } from '@household/i18n'
import { act, screen, userEvent } from '@testing-library/react-native'
import { Linking } from 'react-native'
import { expectAccessible } from '../test/a11y.ts'
import { render } from '../test/render.tsx'
import * as announcer from '../ui/announce.ts'
import { UpdateRequired } from './UpdateRequired.tsx'

const page = 'https://apps.apple.com/app/id0000000000'
const action = catalogs.en['device.update.action']

beforeEach(() => {
  // React Native's stand-in for `Linking` is a mock already, the same one for every test of
  // this file: what one test told it and counted of it is put away before the next.
  jest.spyOn(Linking, 'openURL').mockReset()
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('please update', () => {
  it.each(['en', 'cs', 'sk', 'de', 'pl'] as const)(
    'says in %s that the app must be updated, and that nothing on the device is lost',
    async (locale) => {
      await render(<UpdateRequired />, { locale })
      expect(
        screen.getByRole('header', { name: catalogs[locale]['ui.update.required.title'] }),
      ).toBeOnTheScreen()
      expect(screen.getByText(catalogs[locale]['device.update.body'])).toBeOnTheScreen()
      expect(screen.getByTestId('update-required')).toBeOnTheScreen()
      expectAccessible()
    },
  )

  // A tablet is a layout of this app: the sentence is true of one.
  it('speaks of the device, which a tablet is too', () => {
    expect(catalogs.en['device.update.body']).toContain('this device')
    expect(catalogs.en['device.update.body']).not.toContain('phone')
  })

  // A control that cannot act is absent: the app is in no store until a build is told of one.
  it('draws no control where the build was told of no store page', async () => {
    await render(<UpdateRequired />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('opens the app’s page in the store, by its one action', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true)
    await render(<UpdateRequired store={page} />)
    expect(screen.getAllByRole('button')).toHaveLength(1)
    await userEvent.press(screen.getByRole('button', { name: action }))
    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith(page)
    expect(screen.queryByTestId('banner:danger')).toBeNull()
    expectAccessible()
  })

  it('is busy while the store is being opened, and takes no second press', async () => {
    let opened: (value: true) => void = () => undefined
    const open = jest.spyOn(Linking, 'openURL').mockReturnValue(
      new Promise<true>((resolve) => {
        opened = resolve
      }),
    )
    await render(<UpdateRequired store={page} />)
    const button = screen.getByRole('button', { name: action })
    await userEvent.press(button)
    expect(button).toBeBusy()
    await userEvent.press(button)
    expect(open).toHaveBeenCalledTimes(1)
    await act(() => {
      opened(true)
    })
    expect(button).not.toBeBusy()
  })

  // The press came to nothing, which no control of the screen says.
  it('says so, at once, where the device opens no store, and takes the press again', async () => {
    const said = jest.spyOn(announcer, 'announceNow').mockImplementation(() => undefined)
    const open = jest.spyOn(Linking, 'openURL').mockRejectedValueOnce(new Error('nothing opens it'))
    await render(<UpdateRequired store={page} />)
    await userEvent.press(screen.getByRole('button', { name: action }))
    expect(screen.getByTestId('banner:danger')).toHaveTextContent(
      catalogs.en['device.update.failed'],
    )
    expect(said).toHaveBeenCalledTimes(1)
    expect(said).toHaveBeenCalledWith(catalogs.en['device.update.failed'])
    // Pressed again, with a store that opens: the sentence goes.
    open.mockResolvedValueOnce(true)
    await userEvent.press(screen.getByRole('button', { name: action }))
    expect(open).toHaveBeenCalledTimes(2)
    expect(screen.queryByTestId('banner:danger')).toBeNull()
    expectAccessible()
  })

  it('survives the largest text, in the longest language', async () => {
    jest.spyOn(Linking, 'openURL').mockResolvedValue(true)
    await render(<UpdateRequired store={page} />, { locale: 'de', scale: 2 })
    expect(
      screen.getByRole('button', { name: catalogs.de['device.update.action'] }),
    ).toBeOnTheScreen()
    expectAccessible()
  })
})
