// The module chip and the member avatar (02-components §1), as the list row and the search result
// row carry them. A module chip is the module's accent, its glyph and its name: the accent is the
// glyph's and the rule's, never the name's ink, and never the only thing that tells two modules
// apart. An avatar is a member's initials inside a ring of their colour, and a portrait their
// picture, which the avatar stands in for where there is none to draw.
import { ModuleIcon } from '@household/icons/web'
import { accentToken, cssVar, type ModuleId } from '@household/tokens'
import { useState, type CSSProperties } from 'react'
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

/** The first letters of a name's first two words: what stands where a member has no picture. */
export function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => (Array.from(word)[0] ?? '').toLocaleUpperCase())
    .join('')
}

export interface PortraitProps {
  /** The picture's link, or null for a member who has none. */
  readonly address: string | null
  /** The member's name, whose initials stand where the picture does not. */
  readonly name: string
  readonly tone?: MemberTone
  /** How the picture is drawn where it stands: its size and its shape are its screen's. */
  readonly className: string | undefined
}

/**
 * A member's picture, which gives way to their initials where it has no link or its link no
 * longer loads.
 */
export function Portrait({ address, name, tone = 1, className }: PortraitProps) {
  // A picture's link is good for minutes (D-9), and whose it is may be read from what this
  // browser kept: a link that no longer loads gives way to the initials, and is no broken image.
  const [failed, setFailed] = useState<string | null>(null)
  if (address !== null && failed !== address) {
    return (
      <img
        className={className}
        src={address}
        // Decoration: the member's name is written beside it, or is the page's own title.
        alt=""
        onError={() => {
          setFailed(address)
        }}
      />
    )
  }
  return <Avatar initials={initialsOf(name)} tone={tone} />
}
