// Where *please update* leads: the app's own page in the device's store, where the build was
// told of one, and nowhere where it was not.
import { afterEach, describe, expect, it, jest } from '@jest/globals'
import { Linking } from 'react-native'
import { openStore, storeUrl } from './store.ts'

const pages = {
  storeUrl: {
    ios: 'https://apps.apple.com/app/id0000000000',
    android: 'https://play.google.com/store/apps/details?id=com.kareltilcer.household',
  },
}

afterEach(() => {
  jest.restoreAllMocks()
})

describe('the store page of a build', () => {
  it('is the one it was told for the platform it runs on', () => {
    expect(storeUrl(pages, 'ios')).toBe(pages.storeUrl.ios)
    expect(storeUrl(pages, 'android')).toBe(pages.storeUrl.android)
  })

  // A control that cannot act is absent: the screen draws none where there is no page.
  it('is none where the build was told of none', () => {
    expect(storeUrl({ storeUrl: { android: pages.storeUrl.android } }, 'ios')).toBeUndefined()
    expect(storeUrl({ variant: 'development' }, 'ios')).toBeUndefined()
    expect(storeUrl({ storeUrl: 'a page for no platform' }, 'ios')).toBeUndefined()
    // Under Jest, as in a build that was told none.
    expect(storeUrl()).toBeUndefined()
  })

  it('is opened by the system, and a device that opens nothing says so', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValueOnce(true)
    await openStore(pages.storeUrl.ios)
    expect(open).toHaveBeenCalledWith(pages.storeUrl.ios)
    open.mockRejectedValueOnce(new Error('nothing opens this'))
    await expect(openStore(pages.storeUrl.ios)).rejects.toThrow('nothing opens this')
  })
})
