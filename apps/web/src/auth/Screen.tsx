// What a screen before sign-in is made of (A-1 to A-10, 05-screens §A): its title, a sentence
// under it, a form, and the ways on from it. The frame around it, the product's name and the
// page's one landmark, is `app/Public.tsx`'s; a screen here is one column inside that, and says
// nothing of a household, since nobody is signed in to one.
import type { ReactNode } from 'react'
import { Link, type To } from 'react-router'
import { usePageTitle } from '../app/title.ts'
import { useRefusedField } from './fields.tsx'
import styles from './Screen.module.css'

export interface ScreenProps {
  /** The page's one title. */
  readonly title: string
  /** The sentence under it: what the screen is for, or what happened. */
  readonly lede?: ReactNode
  /**
   * Says the title and its sentence as they change. For a screen that does something as it opens
   * and then says how it went: whoever waits for the answer hears it, where a title that changed
   * without a word would be found only by looking for it. Such a screen is one `Screen` for all
   * that it says, so that what changes is this one's words and not the element that holds them.
   */
  readonly live?: boolean
  readonly children?: ReactNode
}

export function Screen({ title, lede, live = false, children }: ScreenProps) {
  usePageTitle(title)
  return (
    <div className={styles.screen}>
      <div className={styles.head} aria-live={live ? 'polite' : undefined}>
        <h1 className={styles.title}>{title}</h1>
        {lede === undefined ? null : <p className={styles.lede}>{lede}</p>}
      </div>
      {children}
    </div>
  )
}

/** A sentence of a screen's body, under its lede. */
export function Line({ children }: { readonly children: ReactNode }) {
  return <p className={styles.line}>{children}</p>
}

/** Notices that stand above a form together, each a banner of its own. */
export function Notices({ children }: { readonly children: ReactNode }) {
  return <div className={styles.notices}>{children}</div>
}

export interface FormProps {
  readonly onSubmit: () => void
  /**
   * The last submission is still on its way: another is not sent after it. A busy button takes
   * no press, and Enter in a field asks as well, by a way of its own.
   */
  readonly busy?: boolean
  /**
   * What the last submission was refused with, a new value for each refusal: the focus moves to
   * the first field it marked, whose sentence is then read with the field. A refusal that marks
   * no field moves nothing: its banner is announced where it is drawn.
   */
  readonly refused?: unknown
  readonly children: ReactNode
}

/**
 * A screen's form. The browser's own validation is off: its bubbles are in the browser's
 * language and not the app's, and say less than a sentence beside the field does. Enter in a
 * field submits it, as the primary button does.
 */
export function Form({ onSubmit, busy = false, refused, children }: FormProps) {
  const form = useRefusedField(refused)
  return (
    <form
      ref={form}
      className={styles.form}
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        if (!busy) onSubmit()
      }}
    >
      {children}
    </form>
  )
}

/** The ways on from a screen, under its form: every refusal offers a next action (auth.js). */
export function Ways({ children }: { readonly children: ReactNode }) {
  return <div className={styles.ways}>{children}</div>
}

export interface WayProps {
  readonly to: To
  /** What the screen it leads to is told, in the history entry it makes. */
  readonly state?: unknown
  readonly children: ReactNode
}

export function Way({ to, state, children }: WayProps) {
  return (
    <Link to={to} state={state} className={styles.way}>
      {children}
    </Link>
  )
}
