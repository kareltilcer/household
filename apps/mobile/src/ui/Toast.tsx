// Placeholder: the toasts. Owner: the controls group (P1).
// `ToastProvider` stands around the router's stack (src/app/Root.tsx) and around every component
// test (src/test/render.tsx); `useToast()` is what a screen says a success with. Today the
// provider passes its children through and there is no `useToast`.
import type { ReactNode } from 'react'

export function ToastProvider({ children }: { readonly children: ReactNode }) {
  return children
}
