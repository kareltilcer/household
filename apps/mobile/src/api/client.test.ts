import { afterEach, describe, expect, it, jest } from '@jest/globals'
import { Platform } from 'react-native'
import { apiUrl, clientName } from './client.ts'

afterEach(() => {
  jest.restoreAllMocks()
})

describe('clientName', () => {
  it('is a name the server reads: mobile/ and a version of three numbers', () => {
    // clientversion.go: `^(web|mobile)/(.+)$`, the version SemVer's with no leading zero.
    expect(clientName()).toMatch(/^mobile\/(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/)
  })
})

describe('apiUrl', () => {
  it('is the API a build was told, with no slash after it', () => {
    const extra = { variant: 'production', apiUrl: 'https://api.household.test/api/v1/' }
    expect(apiUrl(extra)).toBe('https://api.household.test/api/v1')
  })

  const reached: [os: 'android' | 'ios', url: string][] = [
    ['android', 'http://10.0.2.2:8080/api/v1'],
    ['ios', 'http://127.0.0.1:8080/api/v1'],
  ]

  it.each(reached)(
    'is the developer’s own machine, as %s reaches it, for a development build told none',
    (os, url) => {
      jest.replaceProperty(Platform, 'OS', os)
      expect(apiUrl({ variant: 'development' })).toBe(url)
    },
  )

  // Under Jest expo-constants holds no configuration, so a test hands `apiUrl` its build.
  it('refuses to guess where no configuration is', () => {
    expect(() => apiUrl()).toThrow(/HOUSEHOLD_MOBILE_API_URL/)
  })

  it('refuses a build of another variant that was told none', () => {
    expect(() => apiUrl({ variant: 'staging' })).toThrow(/HOUSEHOLD_MOBILE_API_URL/)
    expect(() => apiUrl({})).toThrow(/HOUSEHOLD_MOBILE_API_URL/)
  })
})
