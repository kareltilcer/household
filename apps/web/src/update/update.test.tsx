import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { draw } from '../test/render.tsx'
import {
  buildFile,
  buildMeta,
  buildPlaceholder,
  checkEvery,
  liveBuild,
  ownBuild,
  watchForUpdate,
} from './build.ts'
import { UpdatePrompt } from './UpdatePrompt.tsx'

/** A page whose index.html names `id` as its build. */
function builtAs(id: string): void {
  const meta = document.createElement('meta')
  meta.name = buildMeta
  meta.content = id
  document.head.append(meta)
}

afterEach(() => {
  document.head.querySelector(`meta[name="${buildMeta}"]`)?.remove()
})

describe('a page’s own build', () => {
  it('is the id its index.html carries', () => {
    builtAs('008f0f94379a5b41')
    expect(ownBuild()).toBe('008f0f94379a5b41')
  })

  it('is none for a page no build made', () => {
    expect(ownBuild()).toBeUndefined()
    builtAs(buildPlaceholder)
    expect(ownBuild()).toBeUndefined()
  })
})

describe('the build that is live', () => {
  const answering = (response: Response) => () => Promise.resolve(response)

  it('is what build.json names, asked past every cache and with no cookie', async () => {
    const fetch = vi.fn(answering(Response.json({ id: 'next' })))
    expect(await liveBuild(fetch)).toBe('next')
    expect(fetch).toHaveBeenCalledWith(buildFile, { cache: 'no-store', credentials: 'omit' })
  })

  it('is unknown, and never a newer one, when it cannot be read', async () => {
    expect(await liveBuild(answering(new Response('deploying', { status: 503 })))).toBeUndefined()
    expect(await liveBuild(answering(new Response('<html>')))).toBeUndefined()
    expect(await liveBuild(answering(Response.json({ id: 7 })))).toBeUndefined()
    expect(await liveBuild(answering(Response.json({ id: '' })))).toBeUndefined()
    expect(await liveBuild(answering(Response.json(null)))).toBeUndefined()
    expect(await liveBuild(() => Promise.reject(new TypeError('offline')))).toBeUndefined()
  })
})

/** The page is looked at again. */
function lookAgain(): void {
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('watching for a newer build', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('tells once, when the page is looked at and another build is live', async () => {
    const onUpdate = vi.fn()
    const live = vi.fn(() => Promise.resolve<string | undefined>('own'))
    const watch = watchForUpdate('own', onUpdate, live)
    lookAgain()
    await vi.advanceTimersByTimeAsync(0)
    expect(onUpdate).not.toHaveBeenCalled()

    live.mockResolvedValue('next')
    lookAgain()
    lookAgain()
    await vi.advanceTimersByTimeAsync(0)
    expect(onUpdate).toHaveBeenCalledTimes(1)
    // Told: it asks no more.
    const asked = live.mock.calls.length
    lookAgain()
    await vi.advanceTimersByTimeAsync(checkEvery)
    expect(live).toHaveBeenCalledTimes(asked)
    watch.stop()
  })

  it('asks again every so often while the page stays open', async () => {
    const live = vi.fn(() => Promise.resolve<string | undefined>('own'))
    const watch = watchForUpdate('own', vi.fn(), live)
    await vi.advanceTimersByTimeAsync(checkEvery * 3)
    expect(live).toHaveBeenCalledTimes(3)
    watch.stop()
    await vi.advanceTimersByTimeAsync(checkEvery * 3)
    lookAgain()
    expect(live).toHaveBeenCalledTimes(3)
  })

  it('does not ask while the page is hidden', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    const live = vi.fn(() => Promise.resolve<string | undefined>('next'))
    const watch = watchForUpdate('own', vi.fn(), live)
    lookAgain()
    await vi.advanceTimersByTimeAsync(checkEvery)
    expect(live).not.toHaveBeenCalled()
    watch.stop()
  })

  it('takes not knowing for no news', async () => {
    const onUpdate = vi.fn()
    const watch = watchForUpdate('own', onUpdate, () => Promise.resolve(undefined))
    lookAgain()
    await vi.advanceTimersByTimeAsync(0)
    expect(onUpdate).not.toHaveBeenCalled()
    watch.stop()
  })

  it('tells at once when the page can no longer load one of its own files', () => {
    const onUpdate = vi.fn()
    const watch = watchForUpdate('own', onUpdate, () => Promise.resolve('own'))
    window.dispatchEvent(new Event('vite:preloadError'))
    expect(onUpdate).toHaveBeenCalledTimes(1)
    watch.stop()
  })

  it('watches nothing on a page no build made', async () => {
    const live = vi.fn(() => Promise.resolve<string | undefined>('next'))
    const watch = watchForUpdate(undefined, vi.fn(), live)
    lookAgain()
    await vi.advanceTimersByTimeAsync(checkEvery)
    expect(live).not.toHaveBeenCalled()
    watch.stop()
  })
})

describe('the reload prompt', () => {
  const live = () => Promise.resolve('next')

  it('says nothing until a newer build is live', () => {
    builtAs('own')
    draw(<UpdatePrompt live={live} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('says a newer build is ready, and reloads only when the member says so', async () => {
    builtAs('own')
    const reload = vi.fn()
    draw(<UpdatePrompt live={live} reload={reload} />)
    lookAgain()
    expect(await screen.findByRole('status')).toHaveTextContent(
      'A new version of Household is ready.',
    )
    expect(reload).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('stops watching with the screen that held it', async () => {
    builtAs('own')
    const asked = vi.fn(live)
    const { unmount } = draw(<UpdatePrompt live={asked} />)
    unmount()
    act(lookAgain)
    await Promise.resolve()
    expect(asked).not.toHaveBeenCalled()
  })
})
