// The engine screen: one line a check (checks.ts), each with a `testID` that says how it came
// out, so the end-to-end flow reads the engine it runs on without reading a word:
// `engine:<check>:passed` or `engine:<check>:failed`, and `engine:all:passed` where every line
// held. This is where a device shows what Jest cannot: Hermes's own `Intl` under the
// polyfills, the fonts the binary embeds, the operating system's random source.
import { useMemo } from 'react'
import { View } from 'react-native'
import { Text } from '../../ui/Text.tsx'
import { DevScreen } from '../DevScreen.tsx'
import { useSample } from '../sample.ts'
import { allChecks, type Check } from './checks.ts'

function verdict(check: Check): 'passed' | 'failed' {
  return check.failed.length === 0 ? 'passed' : 'failed'
}

export interface EngineProps {
  /** The checks to draw. Left out, every one, run on this engine as the screen opens. */
  readonly checks?: readonly Check[]
}

export default function Engine({ checks: given }: EngineProps) {
  const sample = useSample()
  const checks = useMemo(() => given ?? allChecks(), [given])
  const all = checks.every((check) => check.failed.length === 0)
  return (
    <DevScreen page="engine" title={sample('Engine')}>
      <Text testID={`engine:all:${all ? 'passed' : 'failed'}`} weight={500}>
        {all ? sample('All passed') : sample('Something failed')}
      </Text>
      {checks.map((check) => (
        <View key={check.id} testID={`engine:${check.id}:${verdict(check)}`}>
          <Text step="num-sm">
            {`${check.id}: ${String(check.cases)} / ${String(check.cases - check.failed.length)} / ${String(check.failed.length)}`}
          </Text>
          {check.found === undefined ? null : (
            <Text step="caption" color="text-muted" testID={`engine:${check.id}:found`}>
              {check.found}
            </Text>
          )}
          {check.failed.map((name) => (
            <Text key={name} step="caption" color="danger">
              {name}
            </Text>
          ))}
        </View>
      ))}
    </DevScreen>
  )
}
