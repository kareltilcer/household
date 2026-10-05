// A menu of actions (02-components §1), over Radix's dropdown menu for what a menu has to do:
// open from its trigger by pointer or keyboard, move by the arrow keys and by typing, close on
// Escape and hand the focus back. It is opened non-modally: Radix's modal menu locks the page's
// scroll by injecting a style, which the policy refuses (ADR 0025).
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import type { ReactElement, ReactNode } from 'react'
import styles from './Menu.module.css'
import { cx } from './cx.ts'

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
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className={styles.menu}
          align="end"
          sideOffset={4}
          collisionPadding={8}
          data-third-party=""
        >
          {items.map((item) => (
            <DropdownMenu.Item
              key={item.id}
              className={cx(styles.item, item.danger === true && styles.danger)}
              onSelect={item.onSelect}
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
