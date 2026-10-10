// Placeholder: what the session group (S1) stands around every screen, in this order.
//   1. the problem hub and the query client (src/api: `ApiProvider`, the query client's provider)
//   2. the session (`SessionProvider`), which hands the account's language to the i18n provider
//      (`useI18n().followAccount(me.locale)`)
//   3. *please update* in every screen's place, where the server asked for a newer build
// The root layout (src/app/Root.tsx) draws this inside the display and i18n providers and
// around the toasts and the router's stack, and is not edited again: the session group fills
// this file. Today it passes its children through.
import type { ReactNode } from 'react'

export function SessionProviders({ children }: { readonly children: ReactNode }) {
  return children
}
