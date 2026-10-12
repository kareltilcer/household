// This installation as a sign-in names it (PRD 02 FR-ID3, `DeviceSignIn`): its own id, which
// the device makes once and keeps (tokens.ts), a label its member will know it by in their list
// of devices, its platform and the app's version.
import * as Device from 'expo-device'
import { Platform } from 'react-native'
import { version } from '../../package.json'
import type { DeviceSignIn } from './context.ts'

/** The contract's limit on a label. */
const labelLength = 80

/**
 * What the device is called: the name its owner gave it where the system tells, else its model.
 * Undefined where it says neither, and the server then lists it by its platform.
 */
export function deviceLabel(): string | undefined {
  const name = Device.deviceName ?? Device.modelName ?? ''
  // Cut to the contract's length, and never through the middle of a character written as two.
  const label = name
    .trim()
    .slice(0, labelLength)
    .replace(/[\uD800-\uDBFF]$/, '')
  return label === '' ? undefined : label
}

/** The installation `id` as a sign-in's `device`. */
export function describeDevice(id: string): DeviceSignIn {
  const label = deviceLabel()
  return {
    id,
    ...(label === undefined ? {} : { label }),
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    app_version: version,
  }
}
