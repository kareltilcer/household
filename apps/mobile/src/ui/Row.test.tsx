// A row's own control and a row's own link: drawn as one word, named in full, the word inside
// the name (WCAG 2.1, 2.5.3; the catalogs' own test holds each pair of keys to that).
import { describe, expect, it, jest } from '@jest/globals'
import { catalogs, locales } from '@household/i18n'
import { screen, userEvent } from '@testing-library/react-native'
import { router } from 'expo-router'
import { inHousehold } from '../app/paths.ts'
import { expectAccessible } from '../test/a11y.ts'
import { households } from '../test/fixtures.ts'
import { render } from '../test/render.tsx'
import { sample } from './controls.fixtures.ts'
import { RowAction } from './RowAction.tsx'
import { RowLink } from './RowLink.tsx'

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }))

describe('a row’s own control', () => {
  it('is named for what it acts on, and drawn as the word its name holds', async () => {
    const onPress = jest.fn()
    await render(<RowAction name={sample.signOutPixel} word={sample.signOut} onPress={onPress} />)
    const control = screen.getByRole('button', { name: sample.signOutPixel })
    // What is seen is in what is said, so that somebody who speaks to their device can say it.
    expect(control).toHaveTextContent(sample.signOut)
    expect(sample.signOutPixel).toContain(sample.signOut)
    expect(screen.queryByRole('button', { name: sample.signOut })).toBeNull()
    await userEvent.press(control)
    expect(onPress).toHaveBeenCalledTimes(1)
    expectAccessible()
  })

  it('stays where it is while its write is on its way: named, said to be busy, deaf to a press', async () => {
    const onPress = jest.fn()
    await render(
      <RowAction name={sample.signOutPixel} word={sample.signOut} loading onPress={onPress} />,
      { scale: 2 },
    )
    const control = screen.getByRole('button', { name: sample.signOutPixel })
    expect(control).toBeBusy()
    expect(control).toBeEnabled()
    await userEvent.press(control)
    expect(onPress).not.toHaveBeenCalled()
    expectAccessible()
  })

  it('is drawn from a pair of keys whose word is in its name, in every language', () => {
    // The pair the mobile app draws first, the one the web's lists draw too.
    for (const locale of locales) {
      const word = catalogs[locale]['account.devices.sign_out'].toLocaleLowerCase(locale)
      expect(
        catalogs[locale]['account.devices.sign_out_named'].toLocaleLowerCase(locale),
      ).toContain(word)
    }
  })
})

describe('a row’s own link', () => {
  it('is a link named for where it leads, drawn as the word its name holds, and goes there', async () => {
    const to = inHousehold.home(households.own.id)
    await render(<RowLink to={to} name={sample.openHousehold} word={sample.open} />)
    const link = screen.getByRole('link', { name: sample.openHousehold })
    expect(link).toHaveTextContent(sample.open)
    expect(sample.openHousehold).toContain(sample.open)
    await userEvent.press(link)
    expect(router.push).toHaveBeenCalledWith(to)
    expectAccessible()
  })

  it('is as large a target as any other at 200 %', async () => {
    await render(
      <RowLink
        to={inHousehold.home(households.own.id)}
        name={sample.openHousehold}
        word={sample.open}
      />,
      { scale: 2 },
    )
    expectAccessible()
  })
})
