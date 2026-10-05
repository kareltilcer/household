// Dialogs and sheets, menus and toasts (02-components §1), as far as jsdom can hold them: what
// each asks of the platform and what it does with the answer. What the browser itself does with a
// modal dialog and a menu under the keyboard is the end-to-end suite's (e2e/primitives.spec.ts).
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect, useRef, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { draw, Press } from '../test/render.tsx'
import { Button, IconButton } from './Button.tsx'
import { Dialog, Sheet } from './Dialog.tsx'
import { TextField } from './Field.tsx'
import { Menu, type MenuItem } from './Menu.tsx'
import { useToast, type ShowToast } from './Toast.tsx'

const words = {
  title: 'Delete Weekly shop?',
  lost: 'The list and its 14 items are deleted for everyone in the household.',
  keep: 'Keep the list',
  meter: 'Cellar meter',
  more: 'More actions for Cellar meter',
  cleared: '7 checked items cleared from Weekly shop',
  scan: 'Scan of the meter',
  discard: 'Discard the changes?',
  restored: 'Weekly shop has its 7 items again',
  name: 'Name',
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

  it('stays open when a press that began on the ground is let go inside it', () => {
    const onClose = vi.fn()
    draw(<Confirm onClose={onClose} />)
    const dialog = screen.getByRole('dialog')
    fireEvent.pointerDown(dialog)
    fireEvent.pointerUp(within(dialog).getByRole('heading'))
    // The click of such a press is the dialog's own: the one element that holds both its ends.
    fireEvent.click(dialog)
    expect(onClose).not.toHaveBeenCalled()
    // The next press, begun and ended on the ground, is one on the ground.
    fireEvent.pointerDown(dialog)
    fireEvent.pointerUp(dialog)
    fireEvent.click(dialog)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('is closed with the screen that held it, so the page is not left inert', async () => {
    const onClose = vi.fn()
    const close = vi.spyOn(HTMLDialogElement.prototype, 'close')
    const { unmount } = draw(<Confirm onClose={onClose} />)
    unmount()
    expect(close).toHaveBeenCalled()
    // Its own close asks nothing of an owner that is gone.
    await act(() => Promise.resolve())
    expect(onClose).not.toHaveBeenCalled()
  })

  it('tells its owner when the platform closes it behind its back', async () => {
    const onClose = vi.fn()
    draw(<Confirm onClose={onClose} />)
    const dialog = screen.getByRole<HTMLDialogElement>('dialog')
    await act(async () => {
      dialog.close()
      await Promise.resolve()
    })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('is shown again when the platform closes it and its owner keeps it open', async () => {
    // A browser lets a page refuse Escape only so many times in a row, and then closes the
    // dialog whatever the page says: an owner in the middle of a save keeps it all the same.
    const onClose = vi.fn()
    draw(
      <Sheet open onClose={onClose} title={words.meter}>
        <TextField label={words.name} />
      </Sheet>,
    )
    const panel = screen.getByRole<HTMLDialogElement>('dialog')
    await userEvent.type(screen.getByRole('textbox', { name: words.name }), words.scan)
    await act(async () => {
      // As the platform does it: a `cancel` the page may not refuse, and then the close.
      panel.dispatchEvent(new Event('cancel'))
      panel.close()
      await Promise.resolve()
    })
    // Asked once, and not for the `cancel` and the close both.
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(panel.open).toBe(true)
    // What was typed into it is where it was.
    expect(screen.getByRole('textbox', { name: words.name })).toHaveValue(words.scan)
  })

  /** Which of the two each call of `showModal` opened, in the order they were opened. */
  function opened(
    showModal: { readonly mock: { readonly contexts: readonly unknown[] } },
    panel: HTMLElement,
  ): string[] {
    return showModal.mock.contexts.map((dialog) => (dialog === panel ? 'panel' : 'question'))
  }

  it('opens after the panel it is drawn inside, where the two open at once', () => {
    const showModal = vi.spyOn(HTMLDialogElement.prototype, 'showModal')
    draw(
      <Sheet open onClose={() => undefined} title={words.meter}>
        <Dialog open onClose={() => undefined} title={words.discard} />
      </Sheet>,
    )
    // The platform stacks modals in the order they open, the last over the rest: opened first,
    // the confirmation would be under the panel it is drawn inside.
    const panel = screen.getByRole('dialog', { name: words.meter })
    expect(opened(showModal, panel)).toEqual(['panel', 'question'])
    expect(screen.getByRole<HTMLDialogElement>('dialog', { name: words.discard }).open).toBe(true)
  })

  it('is shown again under the question its owner asks, when the platform closes it', async () => {
    // An editor that asks before it discards: asked to close, it opens a confirmation.
    function Asking() {
      const [asking, setAsking] = useState(false)
      return (
        <Sheet
          open
          onClose={() => {
            setAsking(true)
          }}
          title={words.meter}
        >
          <Dialog
            open={asking}
            onClose={() => {
              setAsking(false)
            }}
            title={words.discard}
          />
        </Sheet>
      )
    }
    const showModal = vi.spyOn(HTMLDialogElement.prototype, 'showModal')
    draw(<Asking />)
    const panel = screen.getByRole<HTMLDialogElement>('dialog', { name: words.meter })
    showModal.mockClear()
    await act(async () => {
      panel.dispatchEvent(new Event('cancel'))
      panel.close()
      await Promise.resolve()
    })
    expect(panel.open).toBe(true)
    expect(screen.getByRole<HTMLDialogElement>('dialog', { name: words.discard }).open).toBe(true)
    // The panel, and then its question: asked at the `cancel` too, the question would have
    // been opened inside a panel about to close, and under it once it was shown again.
    expect(opened(showModal, panel)).toEqual(['panel', 'question'])
  })

  it('stays open where it is mounted open in strict mode, which closes and reopens it once', async () => {
    const onClose = vi.fn()
    const close = vi.spyOn(HTMLDialogElement.prototype, 'close')
    draw(<Confirm onClose={onClose} />, 'en', { strict: true })
    // Strict mode ran the effect, undid it and ran it again: the dialog was closed in between,
    // and the `close` of that reaches a dialog that is open.
    expect(close).toHaveBeenCalledTimes(1)
    await act(() => Promise.resolve())
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: words.title })).toBeInTheDocument()
  })

  it('draws nothing while it is closed', () => {
    draw(<Dialog open={false} onClose={() => undefined} title={words.title} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText(words.title)).not.toBeInTheDocument()
  })

  it('is asked to close by its own Escape alone, not by a file picker put away inside it', () => {
    const onClose = vi.fn()
    draw(
      <Sheet open onClose={onClose} title={words.meter}>
        <input type="file" aria-label={words.scan} />
      </Sheet>,
    )
    // The platform lets a file input's `cancel` rise, and it reaches the dialog around it.
    const cancel = new Event('cancel', { bubbles: true, cancelable: true })
    act(() => {
      screen.getByLabelText(words.scan).dispatchEvent(cancel)
    })
    expect(onClose).not.toHaveBeenCalled()
    expect(cancel.defaultPrevented).toBe(false)
  })

  it('stays open when Escape closes a confirmation drawn inside it', () => {
    const onClose = vi.fn()
    const onDiscard = vi.fn()
    draw(
      <Sheet open onClose={onClose} title={words.meter}>
        <Dialog open onClose={onDiscard} title={words.discard} />
      </Sheet>,
    )
    // A dialog's own `cancel` does not rise on the platform. React hands it up its tree all the
    // same.
    act(() => {
      screen
        .getByRole('dialog', { name: words.discard })
        .dispatchEvent(new Event('cancel', { cancelable: true }))
    })
    expect(onDiscard).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('gives the focus to what its owner names as it opens, an editor’s first field', () => {
    function Editor() {
      const first = useRef<HTMLInputElement>(null)
      return (
        <Sheet open onClose={() => undefined} title={words.meter} initialFocus={first}>
          <TextField label={words.name} ref={first} />
        </Sheet>
      )
    }
    draw(<Editor />)
    expect(screen.getByRole('textbox', { name: words.name })).toHaveFocus()
  })
})

describe('a side panel', () => {
  it('has a close control with a name, in the member’s language', async () => {
    const onClose = vi.fn()
    draw(<Confirm onClose={onClose} panel />, 'cs')
    await userEvent.click(screen.getByRole('button', { name: 'Zavřít' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('asks to close with nothing: the press is the control’s own, and no event of it its owner’s', async () => {
    const onClose = vi.fn()
    draw(<Sheet open onClose={onClose} title={words.meter} />)
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledExactlyOnceWith()
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

  it('has given the focus back to its trigger by the time the chosen item acts', async () => {
    // What the item opens, a confirmation, takes whatever holds the focus then for what opened
    // it, and gives the focus back there when it closes.
    const focused: (Element | null)[] = []
    draw(
      <Menu
        trigger={trigger}
        items={items(() => {
          focused.push(document.activeElement)
        })}
      />,
    )
    await userEvent.tab()
    await userEvent.keyboard('{Enter}')
    expect(await screen.findByRole('menuitem', { name: 'Rename' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(focused).toEqual([screen.getByRole('button', { name: words.more })])
  })

  it.each([
    ['is busy', { loading: true }],
    ['has nothing to do', { 'aria-disabled': true }],
  ] as const)('does not open from a trigger that %s, by a press or by a key', async (_, held) => {
    draw(
      <Menu
        trigger={<IconButton label={words.more} icon={<svg aria-hidden="true" />} {...held} />}
        items={items(() => undefined)}
      />,
    )
    const button = screen.getByRole('button', { name: words.more })
    // Radix opens a menu on the press itself and on a key, before any click.
    await userEvent.click(button)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    // It keeps the focus, and takes no key either.
    expect(button).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await userEvent.keyboard(' ')
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(button).toHaveAttribute('aria-expanded', 'false')
  })

  it('is drawn inside the dialog it is opened from, since the page outside one is inert', async () => {
    draw(
      <Sheet open onClose={() => undefined} title={words.meter}>
        <Menu trigger={trigger} items={items(() => undefined)} />
      </Sheet>,
    )
    const panel = screen.getByRole('dialog', { name: words.meter })
    await userEvent.click(within(panel).getByRole('button', { name: words.more }))
    expect(panel).toContainElement(screen.getByRole('menu'))
  })

  it('is drawn inside the inner of two dialogs that opened at once, which is the one on top', async () => {
    draw(
      <Sheet open onClose={() => undefined} title={words.meter}>
        <Dialog open onClose={() => undefined} title={words.discard}>
          <Menu trigger={trigger} items={items(() => undefined)} />
        </Dialog>
      </Sheet>,
    )
    const question = screen.getByRole('dialog', { name: words.discard })
    await userEvent.click(within(question).getByRole('button', { name: words.more }))
    expect(question).toContainElement(screen.getByRole('menu'))
  })

  it('is drawn on the page where no dialog is open', async () => {
    draw(
      <>
        <Dialog open={false} onClose={() => undefined} title={words.title} />
        <Menu trigger={trigger} items={items(() => undefined)} />
      </>,
    )
    await userEvent.click(screen.getByRole('button', { name: words.more }))
    expect(screen.getByRole('menu').closest('dialog')).toBeNull()
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
    expect(undo).toHaveBeenCalledExactlyOnceWith()
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

  it('goes when its dwell is over though the one before it was put away from under the pointer', () => {
    vi.useFakeTimers()
    draw(<Clear />)
    fireEvent.click(screen.getByRole('button', { name: 'clear' }))
    // Pointed at, a toast's dwell is held; put away there, it is gone before the pointer leaves.
    fireEvent.pointerMove(screen.getByText(words.cleared))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText(words.cleared)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'clear' }))
    expect(screen.getByText(words.cleared)).toBeVisible()
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(screen.queryByText(words.cleared)).not.toBeInTheDocument()
  })

  /** The control that puts away the first toast on the screen. */
  function firstDismiss(): HTMLElement {
    const [first] = screen.getAllByRole('button', { name: 'Dismiss' })
    if (first === undefined) throw new Error('no toast is shown')
    return first
  }
  const region = () => screen.getByRole('region', { name: 'Notifications (F8)' })

  it('goes when its dwell is over though another beside it was put away by a press on it', () => {
    vi.useFakeTimers()
    draw(<Clear />)
    fireEvent.click(screen.getByRole('button', { name: 'clear' }))
    fireEvent.click(screen.getByRole('button', { name: 'clear' }))
    // A pointer's press: it is on the toast, its control takes the focus, and the toast closes.
    // Radix hands the focus of a toast that closes to the region, and holds every toast's dwell
    // while the focus is there, where a member who pressed with a pointer is not.
    const dismiss = firstDismiss()
    fireEvent.pointerMove(dismiss)
    fireEvent.pointerDown(dismiss)
    act(() => {
      dismiss.focus()
    })
    fireEvent.click(dismiss)
    expect(screen.getAllByText(words.cleared)).toHaveLength(1)
    expect(region().contains(document.activeElement)).toBe(false)

    fireEvent.pointerLeave(region())
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(screen.queryByText(words.cleared)).not.toBeInTheDocument()
  })

  it('goes when its dwell is over though it was raised by a press on another one’s Undo', () => {
    function Restoring() {
      const toast = useToast()
      return (
        <Press
          name="clear"
          onPress={() => {
            toast({
              message: words.cleared,
              undo: () => {
                toast({ message: words.restored })
              },
            })
          }}
        />
      )
    }
    vi.useFakeTimers()
    draw(<Restoring />)
    fireEvent.click(screen.getByRole('button', { name: 'clear' }))
    const undo = screen.getByRole('button', { name: 'Undo' })
    fireEvent.pointerMove(undo)
    fireEvent.pointerDown(undo)
    act(() => {
      undo.focus()
    })
    fireEvent.click(undo)
    expect(screen.queryByText(words.cleared)).not.toBeInTheDocument()
    expect(screen.getByText(words.restored)).toBeVisible()

    fireEvent.pointerLeave(region())
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(screen.queryByText(words.restored)).not.toBeInTheDocument()
  })

  it('keeps the focus in its region for a member who put another beside it away by a key', async () => {
    draw(<Clear />)
    await userEvent.click(screen.getByRole('button', { name: 'clear' }))
    await userEvent.click(screen.getByRole('button', { name: 'clear' }))
    await screen.findAllByText(words.cleared)
    firstDismiss().focus()
    await userEvent.keyboard('{Enter}')
    expect(screen.getAllByText(words.cleared)).toHaveLength(1)
    // They are among the toasts still, and the one that remains waits for them.
    expect(region().contains(document.activeElement)).toBe(true)
  })

  it('is read out as a notification, by that one word and not by its region’s name', async () => {
    draw(<Clear />)
    await userEvent.click(screen.getByRole('button', { name: 'clear' }))
    // What Radix has assistive technology say, for a moment, beside the toast it draws.
    const said = () => document.querySelector('[role="status"][aria-live="assertive"]')
    await waitFor(() => {
      expect(said()).toHaveTextContent(/^Notification 7 checked items cleared from Weekly shop$/)
    })
  })

  it('leaves the focus in its region when the next one comes after it was put away by a key', async () => {
    draw(<Clear />)
    await userEvent.click(screen.getByRole('button', { name: 'clear' }))
    const dismiss = await screen.findByRole('button', { name: 'Dismiss' })
    dismiss.focus()
    await userEvent.keyboard('{Enter}')
    expect(screen.queryByText(words.cleared)).not.toBeInTheDocument()
    // Radix puts the focus on the region a toast was closed in, and the member is there still.
    const held = () =>
      screen.getByRole('region', { name: 'Notifications (F8)' }).contains(document.activeElement)
    expect(held()).toBe(true)

    // The next toast comes by itself, with the focus where it was: it is not dropped.
    fireEvent.click(screen.getByRole('button', { name: 'clear' }))
    expect(await screen.findByText(words.cleared)).toBeVisible()
    expect(held()).toBe(true)
  })

  /** Hands a test the way to raise a toast by itself, with no press that would move the focus. */
  function Arrives({ hand }: { hand: (raise: ShowToast) => void }) {
    const toast = useToast()
    useEffect(() => {
      hand(toast)
    }, [hand, toast])
    return null
  }

  function Editing({ undo }: { undo: () => void }) {
    const [open, setOpen] = useState(true)
    return (
      <Sheet
        open={open}
        onClose={() => {
          setOpen(false)
        }}
        title={words.meter}
      >
        <Clear undo={undo} />
      </Sheet>
    )
  }

  it('is drawn and announced inside an open dialog, where its undo can be reached', async () => {
    const undo = vi.fn()
    draw(<Editing undo={undo} />)
    const panel = screen.getByRole('dialog', { name: words.meter })
    await userEvent.click(within(panel).getByRole('button', { name: 'clear' }))
    expect(await within(panel).findByText(words.cleared)).toBeVisible()
    expect(panel).toContainElement(screen.getByRole('region', { name: 'Notifications (F8)' }))
    // What reads it out is inside the dialog too: outside it, nothing is read.
    expect(panel.querySelector('[role="status"][aria-live="assertive"]')).not.toBeNull()
    await userEvent.click(within(panel).getByRole('button', { name: 'Undo' }))
    expect(undo).toHaveBeenCalledTimes(1)
  })

  it('stays, on the page again, when the dialog it was raised in closes', async () => {
    draw(<Editing undo={() => undefined} />)
    const panel = screen.getByRole('dialog', { name: words.meter })
    await userEvent.click(within(panel).getByRole('button', { name: 'clear' }))
    await within(panel).findByText(words.cleared)
    await userEvent.click(within(panel).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(await screen.findByText(words.cleared)).toBeVisible()
    expect(panel).not.toContainElement(screen.getByRole('region', { name: 'Notifications (F8)' }))
    expect(screen.getByRole('button', { name: 'Undo' })).toBeVisible()
  })

  /** Presses Escape where the focus is, and says whether the key was left for the platform. */
  function escape(): boolean {
    return fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
  }

  it('stays through an Escape pressed elsewhere in the dialog it is drawn in, which is the dialog’s', async () => {
    draw(<Editing undo={() => undefined} />)
    const panel = screen.getByRole('dialog', { name: words.meter })
    const clear = within(panel).getByRole('button', { name: 'clear' })
    await userEvent.click(clear)
    await within(panel).findByText(words.cleared)
    expect(clear).toHaveFocus()
    // The key is left for the platform, which asks the dialog to close with it: one Escape does
    // not close the panel and take the Undo away with it as well.
    expect(escape()).toBe(true)
    expect(within(panel).getByText(words.cleared)).toBeVisible()
    expect(within(panel).getByRole('button', { name: 'Undo' })).toBeVisible()
  })

  it('stays through an Escape pressed in a menu, which the key closes and is spent on', async () => {
    // A toast that arrives by itself while a menu is open: raised by no press, so the focus is
    // in the menu still, and Radix has layered the toast over it.
    let show: ShowToast | undefined
    const onClose = vi.fn()
    draw(
      <Sheet open onClose={onClose} title={words.meter}>
        <Menu
          trigger={<IconButton label={words.more} icon={<svg aria-hidden="true" />} />}
          items={[{ id: 'rename', label: words.name, onSelect: () => undefined }]}
        />
        <Arrives
          hand={(raise) => {
            show = raise
          }}
        />
      </Sheet>,
    )
    const panel = screen.getByRole('dialog', { name: words.meter })
    await userEvent.click(within(panel).getByRole('button', { name: words.more }))
    expect((await screen.findByRole('menu')).contains(document.activeElement)).toBe(true)
    act(() => {
      show?.({ message: words.cleared })
    })
    await within(panel).findByText(words.cleared)
    // Radix hands the key to the toast, its last layer. The menu closes by it all the same, and
    // spends it: the platform is not left the key to ask the panel to close with.
    expect(escape()).toBe(false)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(within(panel).getByText(words.cleared)).toBeVisible()
    expect(onClose).not.toHaveBeenCalled()
    // The next one, with no menu open, is the panel's, and the toast stays through it too.
    expect(escape()).toBe(true)
    expect(within(panel).getByText(words.cleared)).toBeVisible()
  })

  it('is put away by Escape while the focus is on it, and the key is spent there', async () => {
    draw(<Editing undo={() => undefined} />)
    const panel = screen.getByRole('dialog', { name: words.meter })
    await userEvent.click(within(panel).getByRole('button', { name: 'clear' }))
    const undo = await within(panel).findByRole('button', { name: 'Undo' })
    act(() => {
      undo.focus()
    })
    // Spent on the toast: the platform is not left the key to ask the dialog around it with.
    expect(escape()).toBe(false)
    expect(screen.queryByText(words.cleared)).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: words.meter })).toBeInTheDocument()
    // The member is among the toasts still, as after any toast closed by a key.
    expect(region().contains(document.activeElement)).toBe(true)
  })

  /** The list the toasts are drawn in, which is what the key that reaches them puts the focus on. */
  function toasts(): HTMLElement {
    const list = region().querySelector('ol')
    if (list === null) throw new Error('the toasts have no list')
    return list
  }

  it('stays through an Escape pressed on a page with nothing open, where the focus is not among the toasts', async () => {
    draw(<Clear undo={() => undefined} />)
    const clear = screen.getByRole('button', { name: 'clear' })
    await userEvent.click(clear)
    await screen.findByText(words.cleared)
    expect(clear).toHaveFocus()
    // The key is for what the focus is in, a field that takes it back or a search that clears:
    // a toast is no layer the member opened, and its Undo is not put away with their Escape.
    expect(escape()).toBe(true)
    expect(screen.getByText(words.cleared)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeVisible()
  })

  it('is put away by Escape from the toasts’ own region, reached by its key', async () => {
    draw(<Clear undo={() => undefined} />)
    await userEvent.click(screen.getByRole('button', { name: 'clear' }))
    await screen.findByText(words.cleared)
    fireEvent.keyDown(document.body, { key: 'F8', code: 'F8' })
    expect(toasts()).toHaveFocus()
    expect(escape()).toBe(false)
    expect(screen.queryByText(words.cleared)).not.toBeInTheDocument()
  })

  it('keeps the focus in its region for a member who put it away by Escape, whatever a pointer pressed before', async () => {
    draw(<Clear />)
    await userEvent.click(screen.getByRole('button', { name: 'clear' }))
    await userEvent.click(screen.getByRole('button', { name: 'clear' }))
    const [first] = await screen.findAllByText(words.cleared)
    if (first === undefined) throw new Error('no toast is shown')
    // A press on a toast's words closes nothing, and the pointer goes elsewhere.
    fireEvent.pointerDown(first)
    fireEvent.pointerUp(first)
    // Then the keyboard: the key that reaches the toasts, and Escape there.
    fireEvent.keyDown(document.body, { key: 'F8', code: 'F8' })
    expect(toasts()).toHaveFocus()
    escape()
    expect(screen.getAllByText(words.cleared)).toHaveLength(1)
    // Closed by a key: the member is among the toasts still, and is not dropped out of them
    // for a press that closed nothing.
    expect(region().contains(document.activeElement)).toBe(true)
  })

  it('goes when its dwell is over, after an Escape that was its dialog’s', () => {
    vi.useFakeTimers()
    draw(<Editing undo={() => undefined} />)
    const panel = screen.getByRole('dialog', { name: words.meter })
    fireEvent.click(within(panel).getByRole('button', { name: 'clear' }))
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    escape()
    expect(screen.getByText(words.cleared)).toBeVisible()
    act(() => {
      vi.advanceTimersByTime(3000)
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
