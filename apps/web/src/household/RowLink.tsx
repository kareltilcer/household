// A row's own way on: a link drawn as one word, and named for what it leads to. A list of
// households has an *Open* in every row, and a list of links a screen reader reads out is those
// words alone: each is named in full, *Open Tilcerovi*, and drawn as the word its name holds,
// so that what is seen is what is said (as a row's own control is, account/Devices.tsx).
import { Link } from 'react-router'
import a11y from '../ui/a11y.module.css'
import styles from './RowLink.module.css'

export interface RowLinkProps {
  readonly to: string
  /** What it does and to what, for assistive technology: *Open Tilcerovi*. */
  readonly name: string
  /** The word that is drawn, which the name holds: *Open*. */
  readonly word: string
}

export function RowLink({ to, name, word }: RowLinkProps) {
  return (
    <Link className={styles.link} to={to}>
      <span className={a11y.visuallyHidden}>{name}</span>
      <span aria-hidden="true">{word}</span>
    </Link>
  )
}
