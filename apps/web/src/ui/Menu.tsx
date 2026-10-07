// A menu of actions (02-components §1), over Radix's dropdown menu for what a menu has to do:
// open from its trigger by pointer or keyboard, move by the arrow keys and by typing, close on
// Escape and hand the focus back. It is opened non-modally: Radix's modal menu locks the page's
// scroll by injecting a style, which the policy refuses (ADR 0025).
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { useRef, useState, type ReactElement, type ReactNode } from 'react'
import styles from './Menu.module.css'
import { cx } from './cx.ts'
import { useTopModal } from './topLayer.ts'

export interface MenuItem {
  readonly id: string
  readonly label: string
  readonly onSelect: () => void
  /** A glyph before the words: decoration. */
  readonly icon?: ReactNode
  /** Destroys something: its label names what (06-clients §3). */
  readonly danger?: boolean
}

export interface MenuProps {
  /** The control that opens it: a Button or an IconButton, which carries its own name. */
  readonly trigger: ReactElement
  readonly items: readonly MenuItem[]
}

export function Menu({ trigger, items }: MenuProps) {
  // Inside the open modal, where one is open: the page outside it is inert, and a menu drawn
  // there, as Radix draws it by itself, could be opened from a dialog and never chosen from.
  const modal = useTopModal()
  const opener = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  return (
    <DropdownMenu.Root modal={false} open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger asChild ref={opener}>
        {trigger}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal container={modal}>
        <DropdownMenu.Content
          className={styles.menu}
          align="end"
          sideOffset={4}
          collisionPadding={8}
          data-third-party=""
          onKeyDown={(event) => {
            // Escape closes the menu, and Radix sees to it for whatever it layered last. A
            // toast raised while the menu is open is layered after it: Radix hands the key to
            // the toast, which leaves it alone (Toast), and the menu would never hear of it.
            // So a key nothing has spent closes the menu here and is spent, and the dialog
            // the menu is drawn in is not asked to close by it too.
            if (event.key === 'Escape' && !event.defaultPrevented) {
              event.preventDefault()
              setOpen(false)
            }
          }}
        >
          {items.map((item) => (
            <DropdownMenu.Item
              key={item.id}
              className={cx(styles.item, item.danger === true && styles.danger)}
              onSelect={() => {
                // The focus is handed back before the item acts, and not after, as Radix
                // hands it by itself. What the item opens, a confirmation, takes whatever
                // holds the focus then for what opened it and gives the focus back there when
                // it closes: left on the item, which is gone by then, it would be given to
                // nothing.
                opener.current?.focus()
                item.onSelect()
              }}
            >
              {item.icon}
              <span>{item.label}</span>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
