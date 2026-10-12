// A dev screen's route (src/dev/gate.ts). The condition is written out here, and not imported:
// Metro folds a constant only where it stands, and with it folded away a production bundle
// never asks for the screen's file, or for anything that file imports.
import { lazy } from 'react'
import { NotAvailable } from '../../src/app/NotAvailable.tsx'

export default __DEV__ || process.env.EXPO_PUBLIC_HOUSEHOLD_DEV_SCREENS === '1'
  ? lazy(() => import('../../src/dev/signin/index.tsx'))
  : NotAvailable
