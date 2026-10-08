// A destination of the shell's navigation: a link, with the word that names where it goes and,
// before it, a glyph that is decoration. The one that is open says so to assistive technology and
// is drawn so, by more than its colour.
import type { ReactNode } from 'react'
import { NavLink as RouterLink } from 'react-router'
import { cx } from '../ui/cx.ts'
import styles from './NavLink.module.css'

export interface NavLinkProps {
  readonly to: string
  /** Open only at this very address, and not at the ones under it: a household's own home. */
  readonly end?: boolean
  readonly icon?: ReactNode
  /** What stands after the name: a count of what waits there. */
  readonly trailing?: ReactNode
  readonly children: ReactNode
}

export function NavLink({ to, end = false, icon, trailing, children }: NavLinkProps) {
  return (
    <RouterLink to={to} end={end} className={cx(styles.link)}>
      {icon === undefined ? null : <span className={styles.icon}>{icon}</span>}
      <span className={styles.name}>{children}</span>
      {trailing}
    </RouterLink>
  )
}
