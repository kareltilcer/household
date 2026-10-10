// Placeholder: the session a component test is drawn in. Owner: the session group (S1).
// The test harness (src/test/render.tsx) draws every test inside this, so that a component
// that asks who is signed in is answered. The session group gives it its props (a member, a
// visitor, an ended sign-in) and its provider; a test that needs none passes none. Today it
// passes its children through.
import type { ReactNode } from 'react'

export interface SessionFixtureProps {
  readonly children: ReactNode
}

export function SessionFixture({ children }: SessionFixtureProps) {
  return children
}
