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
   * is another once the read is answered again, which is one of the two things a picture that
   * did not load is asked for again for.
   */
  readonly answered: number
  /** The member's name, whose initials stand where the picture does not. */
  readonly name: string
  readonly tone?: MemberTone
  /** How the picture is drawn where it stands: its size and its shape are its screen's. */
  readonly className: string | undefined
}

/**
 * One asking for a picture: its link, the element that asks, and what it was begun under, which
 * is what its failure is held against.
 */
interface Asking {
  readonly address: string
  /** Which answer of its read it was begun under. */
  readonly answered: number
  /** Whether the browser has said it had no connection, as the asking was begun or since. */
  readonly away: boolean
  /** Which element makes it: another for each asking that follows one that failed. */
  readonly element: number
  /** Whether it is made behind the initials: the link has failed, and has not loaded since. */
  readonly behind: boolean
  readonly failed: boolean
}

/**
 * The asking a picture is drawn by: `kept`, or the one that what has happened since it was begun
 * comes to.
 */
function askingOf(kept: Asking | null, address: string, answered: number, online: boolean): Asking {
  if (kept?.address !== address) {
    // Another link than the one kept: asked for in the picture's own place, and by the element
    // that draws the link before it, where one does.
    return {
      address,
      answered,
      away: !online,
      element: kept?.element ?? 0,
      behind: false,
      failed: false,
    }
  }
  if (kept.failed && online && (kept.answered !== answered || kept.away)) {
    return {
      address,
      answered,
      away: false,
      element: kept.element + 1,
      behind: true,
      failed: false,
    }
  }
  return !online && !kept.away ? { ...kept, away: true } : kept
}

/**
 * `kept` with what the element of `asking` says became of it. An element speaks of its own
 * asking alone, and of that as it is kept by then: one that is no longer the asking drawn says
 * nothing of the one that is.
 */
function settled(
  kept: Asking | null,
  asking: Asking,
  outcome: Pick<Asking, 'behind'> | Pick<Asking, 'failed'>,
): Asking | null {
  const own = kept?.address === asking.address && kept.element === asking.element
  return own ? { ...kept, ...outcome } : kept
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
  // So it is asked for again where asking can succeed: once something has happened since the
  // asking that failed was begun. Its read was answered again, the link it then holds being
  // one the server would sign now; or the browser said it had no connection, as the asking was
  // begun or since, and says it has one again. Since it was begun, and not since its failure
  // was told: a picture fails some time after whatever failed it, and by then its read may
  // have been answered, or the connection be back. It is not asked for again while the browser
  // says it has no connection, nor for a failure alone, so a link that has lapsed, which is
  // refused every time, is asked for once for each answer and each return, and no oftener.
  //
  // Each asking that follows a failure is another element's. A browser asks nothing more of an
  // element whose link did not load, and React may draw a failure together with what the
  // picture is asked for again by: the element that failed, kept and hidden, would be an
  // asking nobody made. And it is made behind the initials, which stand until it has loaded:
  // the element that loaded it is the one then drawn, and the picture is fetched once.
  const online = useOnline()
  const [kept, setKept] = useState<Asking | null>(null)
  const initials = <Avatar initials={initialsOf(name)} tone={tone} />
  if (address === null) return initials
  const asking = askingOf(kept, address, answered, online)
  // Kept as it is drawn, so that the next drawing holds what has happened against what this
  // asking was begun under: the component is drawn again at once, by an asking that is kept.
  if (asking !== kept) setKept(asking)
  return (
    <>
      {asking.behind || asking.failed ? initials : null}
      {asking.failed ? null : (
        <img
          key={asking.element}
          // Hidden by the attribute alone, which a class that says how its element is laid out
          // would undo: it takes its screen's class once it is drawn.
          className={asking.behind ? undefined : className}
          hidden={asking.behind}
          src={address}
          // Decoration: the member's name is written beside it, or is the page's own title.
          alt=""
          onLoad={() => {
            if (asking.behind) setKept((was) => settled(was, asking, { behind: false }))
          }}
          onError={() => {
            setKept((was) => settled(was, asking, { failed: true }))
          }}
        />
      )}
    </>
  )
}
