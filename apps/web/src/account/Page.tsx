// What every screen of a member's own account is set in (A-19, 04-navigation §4): the screen's
// one title, and under it sections with a heading each. The shell's frame draws the bar, the
// account's navigation and the page's one landmark around it (shell/AccountShell.tsx); a screen
// is its title and its sections.
import { useId, type ReactNode } from 'react'
import { usePageTitle } from '../app/title.ts'
import styles from './Settings.module.css'

export interface SettingsPageProps {
  /** The screen's name: the page's one `<h1>`. */
  readonly title: string
  /** A sentence under it, where the title alone would not say what the screen is for. */
  readonly lead?: string | undefined
  readonly children: ReactNode
}

export function SettingsPage({ title, lead, children }: SettingsPageProps) {
  usePageTitle(title)
  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <h1 className={styles.title}>{title}</h1>
        {lead === undefined ? null : <p className={styles.lead}>{lead}</p>}
      </div>
      {children}
    </div>
  )
}

export interface SectionProps {
  readonly title: string
  /** What the section's settings are, or where they are kept, in a sentence under its heading. */
  readonly note?: string | undefined
  readonly children: ReactNode
}

/** A section of a settings page: named by its heading, for assistive technology too. */
export function Section({ title, note, children }: SectionProps) {
  const id = useId()
  return (
    <section className={styles.section} aria-labelledby={id}>
      <h2 id={id} className={styles.heading}>
        {title}
      </h2>
      {note === undefined ? null : <p className={styles.note}>{note}</p>}
      {children}
    </section>
  )
}
