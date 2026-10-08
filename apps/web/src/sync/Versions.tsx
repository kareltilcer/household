// The versions of a row side by side (F-6, F-7, 06-clients §5): whose each is, when it was made,
// and what it holds, field by field, in the words the row's own screen uses for them. Two for a
// conflict, the member's and the other author's; two for a value out of order, the member's and
// the entry it is out of order with; one for any other change that was not accepted, which is
// what the member entered. Nothing here is a version number, a vector or a "remote".
import { useId } from 'react'
import { KeyValue, type Pair } from '../ui/KeyValue.tsx'
import styles from './Sync.module.css'

export interface Version {
  /** Whose it is: *Your version*, a member's name, *The entry next to it*. */
  readonly heading: string
  /** What is said of it under its heading, a line each: when it was made, that it is a deletion. */
  readonly notes?: readonly string[]
  /** What it holds. A deletion holds nothing. */
  readonly pairs: readonly Pair[]
}

function VersionBlock({ version }: { readonly version: Version }) {
  const heading = useId()
  return (
    <section className={styles.version} aria-labelledby={heading}>
      <h3 id={heading} className={styles.versionName}>
        {version.heading}
      </h3>
      {(version.notes ?? []).map((note) => (
        <p key={note} className={styles.versionNote}>
          {note}
        </p>
      ))}
      {version.pairs.length === 0 ? null : <KeyValue pairs={version.pairs} />}
    </section>
  )
}

export function Versions({ versions }: { readonly versions: readonly Version[] }) {
  return (
    <div className={styles.versions}>
      {versions.map((version, index) => (
        // A version is its place: the member's first, and two may be headed alike.
        <VersionBlock key={index} version={version} />
      ))}
    </div>
  )
}
