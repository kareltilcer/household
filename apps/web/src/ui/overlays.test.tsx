// Dialogs and sheets, menus and toasts (02-components §1), as far as jsdom can hold them: what
// each asks of the platform and what it does with the answer. What the browser itself does with a
// modal dialog and a menu under the keyboard is the end-to-end suite's (e2e/primitives.spec.ts).
import { act, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { draw, Press } from '../test/render.tsx'
import { Button, IconButton } from './Button.tsx'
import { Dialog, Sheet } from './Dialog.tsx'
import { Menu, type MenuItem } from './Menu.tsx'
import { useToast } from './Toast.tsx'

const words = {
  title: 'Delete Weekly shop?',
  lost: 'The list and its 14 items are deleted for everyone in the household.',
  keep: 'Keep the list',
  meter: 'Cellar meter',
  more: 'More actions for Cellar meter',
  cleared: '7 checked items cleared from Weekly shop',
} as const

function Confirm({ onClose, panel = false }: { onClose: () => void; panel?: boolean }) {
  const [open, setOpen] = useState(true)
  const close = () => {
    onClose()
    setOpen(false)
  }
  const Surface = panel ? Sheet : Dialog
  return (
    <Surface
      open={open}
      onClose={close}
      title={words.title}
      description={words.lost}
      actions={<Button onClick={close}>{words.keep}</Button>}
    />
  )
}

describe('a dialog', () => {
  it('opens modally, named by its title and described by what will be lost', () => {
    const showModal = vi.spyOn(HTMLDialogElement.prototype, 'showModal')
    draw(<Confirm onClose={() => undefined} />)
    expect(showModal).toHaveBeenCalledTimes(1)
    const dialog = screen.getByRole('dialog', { name: words.title })
    expect(dialog).toHaveAccessibleDescription(words.lost)
    expect(within(dialog).getByRole('heading', { level: 2, name: words.title })).toBeVisible()
  })

  it('is closed by its owner when Escape asks, and not by the platform behind its back', () => {
    const onClose = vi.fn()
    draw(<Confirm onClose={onClose} />)
    const dialog = screen.getByRole('dialog')
    const cancel = new Event('cancel', { cancelable: true })
    act(() => {
      dialog.dispatchEvent(cancel)
    })
    expect(cancel.defaultPrevented).toBe(true)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes on a press on the ground behind it, and not on one inside it', async () => {
    const onClose = vi.fn()
    draw(<Confirm onClose={onClose} />)
    const dialog = screen.getByRole('dialog')
    await userEvent.click(within(dialog).getByRole('heading'))
    expect(onClose).not.toHaveBeenCalled()
    await userEvent.click(dialog)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('stays open when a press that began inside it ends on the ground', () => {
    const onClose = vi.fn()
    draw(<Confirm onClose={onClose} />)
    const dialog = screen.getByRole('dialog')
    fireEvent.pointerDown(within(dialog).getByRole('heading'))
    fireEvent.click(dialog)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('is closed with the screen that held it, so the page is not left inert', () => {
    const close = vi.spyOn(HTMLDialogElement.prototype, 'close')
    const { unmount } = draw(<Confirm onClose={() => undefined} />)
    unmount()
    expect(close).toHaveBeenCalled()
  })

  it('draws nothing while it is closed', () => {
    draw(<Dialog open={false} onClose={() => undefined} title={words.title} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText(words.title)).not.toBeInTheDocument()
  })
})

describe('a side panel', () => {
  it('has a close control with a name, in the member’s language', async () => {
    const onClose = vi.fn()
    draw(<Confirm onClose={onClose} panel />, 'cs')
    await userEvent.click(screen.getByRole('button', { name: 'Zavřít' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('is the only one of the two with that control: a modal is closed by its choices', () => {
    draw(<Confirm onClose={() => undefined} />)
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([words.keep])
  })
})

describe('a menu', () => {
  function items(onSelect: (id: string) => void): MenuItem[] {
    return ['Rename', 'Archive', 'Delete the cellar meter'].map((label, index) => ({
      id: label,
      label,
      danger: index === 2,
      onSelect: () => {
        onSelect(label)
      },
    }))
  }
  const trigger = <IconButton label={words.more} icon={<svg aria-hidden="true" />} />

  it('opens from its trigger, which says whether it is open', async () => {
    draw(<Menu trigger={trigger} items={items(() => undefined)} />)
    const button = screen.getByRole('button', { name: words.more })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    await userEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Rename',
      'Archive',
      'Delete the cellar meter',
    ])
  })

  it('does what the chosen item does, once, and closes', async () => {
    const onSelect = vi.fn()
    draw(<Menu trigger={trigger} items={items(onSelect)} />)
    await userEvent.click(screen.getByRole('button', { name: words.more }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Archive' }))
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('Archive')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('is opened and driven by the keyboard, and closes on Escape', async () => {
    const onSelect = vi.fn()
    draw(<Menu trigger={trigger} items={items(onSelect)} />)
    await userEvent.tab()
    await userEvent.keyboard('{Enter}')
    expect(await screen.findByRole('menu')).toBeInTheDocument()
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('Archive')

    await userEvent.keyboard('{Enter}')
    expect(await screen.findByRole('menu')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('leaves the page behind it alone: it locks no scroll and hides nothing', async () => {
    draw(
      <>
        <Menu trigger={trigger} items={items(() => undefined)} />
        <Press name="beside" onPress={() => undefined} />
      </>,
    )
    await userEvent.click(screen.getByRole('button', { name: words.more }))
    // A modal menu would inject a style to lock the scroll, which the policy refuses.
    expect(document.querySelectorAll('style')).toHaveLength(0)
    expect(document.body).not.toHaveAttribute('data-scroll-locked')
    expect(screen.getByRole('button', { name: 'beside' })).toBeInTheDocument()
  })
})

describe('a toast', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  function Clear({ undo }: { undo?: () => void }) {
    const toast = useToast()
    return (
      <Press
        name="clear"
        onPress={() => {
          toast({ message: words.cleared, ...(undo === undefined ? {} : { undo }) })
        }}
      />
    )
  }

  it('says what happened, in a region with a name and a key to reach it', async () => {
    draw(<Clear />)
    await userEvent.click(screen.getByRole('button', { name: 'clear' }))
    expect(await screen.findByText(words.cleared)).toBeVisible()
    expect(screen.getByRole('region', { name: 'Notifications (F8)' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
  })

  it('takes it back with a button, and goes once it has', async () => {
    const undo = vi.fn()
    draw(<Clear undo={undo} />)
    await userEvent.click(screen.getByRole('button', { name: 'clear' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    expect(undo).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(words.cleared)).not.toBeInTheDocument()
  })

  it('can be put away, by a control with a name', async () => {
    draw(<Clear undo={() => undefined} />)
    await userEvent.click(screen.getByRole('button', { name: 'clear' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText(words.cleared)).not.toBeInTheDocument()
  })

  it('keeps its undo for the whole dwell, and goes when the dwell is over', () => {
    vi.useFakeTimers()
    draw(<Clear undo={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: 'clear' }))
    act(() => {
      vi.advanceTimersByTime(4999)
    })
    expect(screen.getByRole('button', { name: 'Undo' })).toBeVisible()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.queryByText(words.cleared)).not.toBeInTheDocument()
  })

  it('shows each of several, apart', async () => {
    draw(<Clear />)
    await userEvent.click(screen.getByRole('button', { name: 'clear' }))
    await userEvent.click(screen.getByRole('button', { name: 'clear' }))
    expect(await screen.findAllByText(words.cleared)).toHaveLength(2)
  })
})
