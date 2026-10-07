// The module chip and the member avatar (02-components §1), as the list row and the search result
// row carry them. A module chip is the module's accent, its glyph and its name: the accent is the
// glyph's and the rule's, never the name's ink, and never the only thing that tells two modules
// apart. An avatar is a member's initials inside a ring of their colour.
import { ModuleIcon } from '@household/icons/web'
import { accentToken, cssVar, type ModuleId } from '@household/tokens'
import type { CSSProperties } from 'react'
import { useTranslate } from '../i18n/I18nProvider.tsx'
import styles from './Chip.module.css'
import { cx } from './cx.ts'

export function ModuleChip({ module }: { readonly module: ModuleId }) {
  const t = useTranslate()
  const accent = { '--chip-accent': cssVar(accentToken(module)) } as CSSProperties
  return (
    <span className={styles.chip} style={accent}>
      <span className={styles.chipGlyph}>
        <ModuleIcon module={module} size={16} />
      </span>
      <span>{t(`module.${module}.name`)}</span>
    </span>
  )
}

/** A member's colour in this household: one of the eight series colours, assigned once. */
export type MemberTone = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

export interface AvatarProps {
  /** The member's initials. Decoration beside their name; `name` is said where there is none. */
  readonly initials: string
  readonly tone: MemberTone
  /** The member's name, for an avatar that stands alone. */
  readonly name?: string
}

export function Avatar({ initials, tone, name }: AvatarProps) {
  return (
    <span
      className={cx(styles.avatar, styles[`tone${String(tone)}`])}
      {...(name === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': name })}
    >
      {initials}
    </span>
  )
}
