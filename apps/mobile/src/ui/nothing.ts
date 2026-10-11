// Whether a part a component was handed is one React would draw nothing for. A component that
// stands a part in a wrapper of its own asks first: a wrapper round nothing is not nothing, it
// costs its row a gap, and at 200 % a line of its own where the row wraps (ui/ListRow.tsx), and
// a cell of nothing reads as a fault (ui/KeyValue.tsx). One rule for every component that asks,
// so that none of them takes for something what another takes for nothing.
import type { ReactNode } from 'react'

/**
 * Whether React would draw nothing for `node`: what its owner left out, or decided against by a
 * condition, which comes to `false`, to `null`, or, where the condition was a word, to the
 * empty string. A number is drawn, zero among them, and so is anything React is handed to
 * draw, whatever that then draws.
 */
export function drawsNothing(node: ReactNode): boolean {
  return node === undefined || node === null || node === '' || typeof node === 'boolean'
}
