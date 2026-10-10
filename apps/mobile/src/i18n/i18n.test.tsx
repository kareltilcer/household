// The language at run time: what it starts as, how it is changed, and how it follows the account.
import { beforeEach, describe, expect, it } from '@jest/globals'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { catalogs, pseudolocalize } from '@household/i18n'
import { act, render as draw, screen, userEvent } from '@testing-library/react-native'
import { DisplayProvider } from '../display/DisplayProvider.tsx'
import { render } from '../test/render.tsx'
import { Button } from '../ui/Button.tsx'
import { Text } from '../ui/Text.tsx'
import { I18nProvider, useI18n, type I18n } from './I18nProvider.tsx'
import { readLocale, storageKey } from './locale.ts'

beforeEach(async () => {
  await AsyncStorage.clear()
})

let i18n: I18n

function Probe() {
  i18n = useI18n()
  const { locale, setLocale, t, format } = i18n
  return (
    <>
      <Text testID="words">{t('ui.offline.bar')}</Text>
      <Text testID="tags">{`${locale} ${format.locale}`}</Text>
      <Button
        testID="cs"
        onPress={() => {
          setLocale('cs')
        }}
      >
        {String(1)}
      </Button>
      <Button
        testID="pseudo"
        onPress={() => {
          setLocale('en-XA')
        }}
      >
        {String(2)}
      </Button>
    </>
  )
}

describe('the language switch', () => {
  it('starts in the device’s first language that Household ships', async () => {
    await draw(
      <DisplayProvider>
        <I18nProvider languages={['fr-FR', 'de-AT', 'cs']}>
          <Probe />
        </I18nProvider>
      </DisplayProvider>,
    )
    expect(screen.getByTestId('tags')).toHaveTextContent('de de-AT')
    expect(screen.getByTestId('words')).toHaveTextContent(catalogs.de['ui.offline.bar'])
  })

  it('shows every word in the language chosen, at once, and keeps the choice', async () => {
    await render(<Probe />)
    expect(screen.getByTestId('words')).toHaveTextContent(catalogs.en['ui.offline.bar'])
    await userEvent.press(screen.getByTestId('cs'))
    expect(screen.getByTestId('words')).toHaveTextContent(catalogs.cs['ui.offline.bar'])
    expect(screen.getByTestId('tags')).toHaveTextContent('cs cs')
    expect(await AsyncStorage.getItem(storageKey)).toBe('cs')
    expect(await readLocale()).toBe('cs')
  })

  it('offers the pseudo-locale, which is English accented and formats as English', async () => {
    await render(<Probe />, { languages: ['en-GB'] })
    await userEvent.press(screen.getByTestId('pseudo'))
    expect(screen.getByTestId('words')).toHaveTextContent(
      pseudolocalize(catalogs.en['ui.offline.bar']),
    )
    expect(screen.getByTestId('tags')).toHaveTextContent('en-XA en-GB')
  })
})

describe('the account’s language', () => {
  it('is shown once the session knows it, and formats before the device’s own tag', async () => {
    await render(<Probe />, { languages: ['en-GB', 'pl-PL'] })
    await act(() => {
      i18n.followAccount('pl')
    })
    expect(screen.getByTestId('tags')).toHaveTextContent('pl pl')
    expect(await AsyncStorage.getItem(storageKey)).toBe('pl')
    // The account's own tag for the language comes before the device's.
    await act(() => {
      i18n.followAccount('de-CH')
    })
    expect(screen.getByTestId('tags')).toHaveTextContent('de de-CH')
  })

  it('does not take back a language chosen here since, until the account’s changes', async () => {
    await render(<Probe />)
    await act(() => {
      i18n.followAccount('pl')
    })
    await userEvent.press(screen.getByTestId('cs'))
    await act(() => {
      i18n.followAccount('pl')
    })
    expect(screen.getByTestId('tags')).toHaveTextContent('cs cs')
    await act(() => {
      i18n.followAccount('sk')
    })
    expect(screen.getByTestId('tags')).toHaveTextContent('sk sk')
  })

  it('never takes the pseudo-locale away, which is nobody’s', async () => {
    await render(<Probe />)
    await userEvent.press(screen.getByTestId('pseudo'))
    await act(() => {
      i18n.followAccount('de')
    })
    expect(screen.getByTestId('tags')).toHaveTextContent('en-XA en')
  })

  it('leaves the language as it is when nobody is signed in any more', async () => {
    await render(<Probe />, { languages: ['en-GB'] })
    await act(() => {
      i18n.followAccount('de-AT')
    })
    expect(screen.getByTestId('tags')).toHaveTextContent('de de-AT')
    await act(() => {
      i18n.followAccount(undefined)
    })
    expect(screen.getByTestId('tags')).toHaveTextContent('de de')
  })
})
