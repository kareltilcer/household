// The toolchain's proof (plan item 28), and no screen of the app's: one of everything the
// shared packages give a device, drawn through the bundle a device runs. It is deleted with the
// first real route. Metro has resolved each import below from the workspace's TypeScript
// sources, and a test renders it under the polyfills (Proof.test.tsx).
import { newId } from '@household/api'
import { createTranslator } from '@household/i18n'
import { ModuleIcon } from '@household/icons/native'
import { openReplica } from '@household/sync/native'
import { nativeThemes } from '@household/tokens/native'
import type { ReactElement } from 'react'
import { Text, View } from 'react-native'
import { clientName } from '../api/client.ts'

const theme = nativeThemes.light
const english = createTranslator('en')
const czech = createTranslator('cs')

/** A count whose Czech is a plural of its own (`few`), and one a number's format groups. */
const counts = [3, 1234] as const

export function Proof(): ReactElement {
  return (
    <View
      style={{
        flex: 1,
        justifyContent: 'center',
        gap: theme.space['space-2'],
        padding: theme.space['space-3'],
        backgroundColor: theme.color.surface,
      }}
    >
      <ModuleIcon module="today" color={theme.color.accent} label={english('nav.today')} />
      <Text style={[theme.type['title-2'], { color: theme.color['text-primary'] }]}>
        {english('app.name')}
      </Text>
      {counts.map((count) => (
        <Text key={count} style={[theme.type.body, { color: theme.color['text-primary'] }]}>
          {czech('shell.sidebar.attention', { count })}
        </Text>
      ))}
      <Text testID="id" style={[theme.type['num-sm'], { color: theme.color['text-muted'] }]}>
        {newId()}
      </Text>
      <Text testID="client" style={[theme.type.caption, { color: theme.color['text-muted'] }]}>
        {clientName()}
      </Text>
      {/* The replica's library is in the bundle, and no database is opened. */}
      <Text testID="replica" style={[theme.type.caption, { color: theme.color['text-muted'] }]}>
        {typeof openReplica}
      </Text>
    </View>
  )
}
