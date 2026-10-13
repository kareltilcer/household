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
import { useOnline } from './online.ts'

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
  /**
   * Which answer of its read handed this the link (`useAnswered`, api/query.ts): a number that
   * is another once the read is answered again, which is when a picture that did not load is
   * asked for again.
   */
  readonly answered: number
  /** The member's name, whose initials stand where the picture does not. */
  readonly name: string
  readonly tone?: MemberTone
  /** How the picture is drawn where it stands: its size and its shape are its screen's. */
  readonly className: string | undefined
}

/**
 * What a picture that did not load failed under: it is not asked for again while all of it
 * stands.
 */
interface Missed {
  readonly address: string
  readonly answered: number
  readonly online: boolean
}

/**
 * A member's picture, which gives way to their initials where it has no link or its link does
 * not load, and is asked for again where asking can succeed.
 */
export function Portrait({ address, answered, name, tone = 1, className }: PortraitProps) {
  // A picture's link is good for minutes (D-9), and whose it is may be read from what this
  // browser kept: a link that no longer loads gives way to the initials, and is no broken image.
  // The browser keeps the link and never the picture, which the store answers as no cache's to
  // keep (D-198), so one that did not load, lapsed, asked for with no connection or of a store
  // that could not be reached, is drawn from nowhere else. A read in a later five minutes hands
  // this another link, and one in the same five the same link (D-9): left to that, the initials
  // would stand for minutes after whatever kept the picture away had passed.
  //
  // So it is asked for again where asking can succeed: once its read is answered again, the
  // link it then holds being one the server would sign now, and when the browser's word on its
  // connection changes. Either way: a picture may fail as the connection goes, before the
  // browser says so, and asked for with none it fails at once, with nothing sent, under the
  // word the return is then told by. Each is one asking, and none follows from a failure, so a
  // link that has lapsed, which is refused every time, is asked for no oftener than that.
  //
  // And it is asked for behind the initials, which stand until it has loaded: the element that
  // loaded it is the one then drawn, and the picture is fetched once.
  const online = useOnline()
  const [missed, setMissed] = useState<Missed | null>(null)
  const initials = <Avatar initials={initialsOf(name)} tone={tone} />
  if (address === null) return initials
  const behind = missed?.address === address
  const held = behind && missed.answered === answered && missed.online === online
  return (
    <>
      {behind ? initials : null}
      {held ? null : (
        <img
          // Hidden by the attribute alone, which a class that says how its element is laid out
          // would undo: it takes its screen's class once it is drawn.
          className={behind ? undefined : className}
          hidden={behind}
          src={address}
          // Decoration: the member's name is written beside it, or is the page's own title.
          alt=""
          onLoad={() => {
            setMissed(null)
          }}
          onError={() => {
            setMissed({ address, answered, online })
          }}
        />
      )}
    </>
  )
}
