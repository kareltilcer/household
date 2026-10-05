import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { draw, Press, rootFollowsScale } from '../test/render.tsx'
import { useDisplay } from './DisplayProvider.tsx'
import { attributesOf, defaults, parsePreferences, storageKey } from './modes.ts'
import { measureTextScale } from './store.ts'

describe('the display modes', () => {
  it('default to the light theme, each screen’s own density, 100 % text and the device’s motion', () => {
    expect(parsePreferences(null)).toEqual(defaults)
    expect(attributesOf(defaults)).toEqual({
      'data-theme': null,
      'data-density': null,
      'data-scale': null,
      'data-motion': null,
    })
  })

  it('take each mode that is one of its own, and the default for anything else', () => {
    expect(
      parsePreferences(JSON.stringify({ theme: 'dark', density: 'cosy', scale: 200, motion: 1 })),
    ).toEqual({ ...defaults, theme: 'dark' })
    for (const stored of ['', 'not json', 'null', '[]', '7', '"dark"']) {
      expect(parsePreferences(stored), stored).toEqual(defaults)
    }
  })

  it('write a mode as its attribute only where the stylesheet reads one', () => {
    expect(
      attributesOf({ theme: 'system', density: 'compact', scale: '200', motion: 'reduced' }),
    ).toEqual({
      'data-theme': 'system',
      'data-density': 'compact',
      'data-scale': '200',
      'data-motion': 'reduced',
    })
    // A member's choice of comfortable is written, since a table reads it against its own.
    expect(attributesOf({ ...defaults, density: 'comfortable' })['data-density']).toBe(
      'comfortable',
    )
  })
})

function Probe() {
  const { preferences, set, hold, reducedMotion, textScale } = useDisplay()
  return (
    <div>
      <output>{JSON.stringify({ ...preferences, reducedMotion, textScale })}</output>
      <Press
        name="dark and compact"
        onPress={() => {
          set({ theme: 'dark' })
          set({ density: 'compact' })
        }}
      />
      <Press
        name="reduce"
        onPress={() => {
          set({ motion: 'reduced' })
        }}
      />
      <Press
        name="hold"
        onPress={() => {
          const release = hold({ scale: '200' })
          window.addEventListener('release', release, { once: true })
        }}
      />
    </div>
  )
}

function shown(): Record<string, unknown> {
  return JSON.parse(screen.getByRole('status').textContent) as Record<string, unknown>
}

describe('the display provider', () => {
  it('starts from what this browser holds, and puts it on the root', () => {
    rootFollowsScale()
    window.localStorage.setItem(storageKey, JSON.stringify({ theme: 'dark', scale: '200' }))
    draw(<Probe />)
    expect(shown()).toMatchObject({ theme: 'dark', scale: '200', textScale: 2 })
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(document.documentElement).toHaveAttribute('data-scale', '200')
  })

  it('keeps every change, two made at once among them, here and on the root', async () => {
    draw(<Probe />)
    await userEvent.click(screen.getByRole('button', { name: 'dark and compact' }))
    expect(shown()).toMatchObject({ theme: 'dark', density: 'compact' })
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(document.documentElement).toHaveAttribute('data-density', 'compact')
    expect(parsePreferences(window.localStorage.getItem(storageKey))).toMatchObject({
      theme: 'dark',
      density: 'compact',
    })
  })

  it('holds a mode over the member’s own without keeping it, and gives it back', async () => {
    rootFollowsScale()
    draw(<Probe />)
    await userEvent.click(screen.getByRole('button', { name: 'hold' }))
    expect(document.documentElement).toHaveAttribute('data-scale', '200')
    expect(shown()).toMatchObject({ scale: '200', textScale: 2 })
    expect(window.localStorage.getItem(storageKey)).toBeNull()
    act(() => {
      window.dispatchEvent(new Event('release'))
    })
    expect(document.documentElement).not.toHaveAttribute('data-scale')
    expect(shown()).toMatchObject({ scale: '100', textScale: 1 })
  })

  it('follows a change made in another tab', () => {
    draw(<Probe />)
    window.localStorage.setItem(storageKey, JSON.stringify({ theme: 'system' }))
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: storageKey }))
    })
    expect(document.documentElement).toHaveAttribute('data-theme', 'system')
  })

  it('reduces motion by the member’s choice, or by their device’s', async () => {
    draw(<Probe />)
    expect(shown()).toMatchObject({ reducedMotion: false })
    await userEvent.click(screen.getByRole('button', { name: 'reduce' }))
    expect(shown()).toMatchObject({ reducedMotion: true })
    expect(document.documentElement).toHaveAttribute('data-motion', 'reduced')
  })

  it('reads the device’s own preference for reduced motion', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }))
    draw(<Probe />)
    expect(shown()).toMatchObject({ motion: 'system', reducedMotion: true })
  })

  it('works where storage is refused', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })
    draw(<Probe />)
    await userEvent.click(screen.getByRole('button', { name: 'dark and compact' }))
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
  })
})

/** A root whose font size the browser resolved to `fontSize`. */
function rootAt(fontSize: string): void {
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({ fontSize } as CSSStyleDeclaration)
}

describe('the text scale', () => {
  it('is the root’s font size against the scale’s own, whoever set it', () => {
    rootAt('32px')
    expect(measureTextScale(document.documentElement)).toBe(2)
    rootAt('20px')
    expect(measureTextScale(document.documentElement)).toBe(1.25)
  })

  it('is what the attribute says where the size cannot be measured', () => {
    rootAt('')
    expect(measureTextScale(document.documentElement)).toBe(1)
    document.documentElement.setAttribute('data-scale', '200')
    expect(measureTextScale(document.documentElement)).toBe(2)
  })
})
