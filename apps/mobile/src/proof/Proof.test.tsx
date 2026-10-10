// The proof screen, rendered as a device would: under the polyfills, with every shared package
// imported from its sources. What it holds is what the toolchain was built to give.
import { expect, it } from '@jest/globals'
import { isUuid } from '@household/api'
import { nativeThemes } from '@household/tokens/native'
import { render, screen } from '@testing-library/react-native'
import { Proof } from './Proof.tsx'

it('draws one of everything the shared packages give a device', async () => {
  await render(<Proof />)

  // The catalogs, and a type step in one of the embedded families.
  expect(screen.getByText('Household')).toHaveStyle({
    fontFamily: 'IBMPlexSans-Medium',
    color: nativeThemes.light.color['text-primary'],
  })
  // Czech's own plural for three, and a number grouped as Czech groups it: FormatJS's rules,
  // installed by the polyfills.
  expect(screen.getByText('3 změny vyžadují vaši pozornost')).toBeOnTheScreen()
  expect(screen.getByText('1 234 změn vyžaduje vaši pozornost')).toBeOnTheScreen()
  // A glyph, drawn by react-native-svg and named by the catalog.
  expect(screen.getByLabelText('Today')).toBeOnTheScreen()
  // An identifier, which is drawn from `crypto.getRandomValues`.
  const id: unknown = screen.getByTestId('id').props.children
  expect(isUuid(id) && id.charAt(14)).toBe('7')
  expect(screen.getByTestId('client')).toHaveTextContent(/^mobile\/\d+\.\d+\.\d+$/)
  // The replica's library, with PowerSync's SDK and op-sqlite under it, and no database opened.
  expect(screen.getByTestId('replica')).toHaveTextContent('function')
})
