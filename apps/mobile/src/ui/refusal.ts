// Where the accessibility focus goes when a form is refused (D-166's twin on a device; the web's
// `useRefusedField`, apps/web/src/auth/fields.tsx): to the first field the refusal marked, whose
// sentence is then read with the field. A sentence that arrives beside a field a screen reader
// is not on is said to nobody who cannot see it (WCAG 2.1, 4.1.3), and it is never announced as
// an alert: said twice, and as urgently as a server's failure.
//
// A browser finds the first invalid field in the document. A device has no document to ask, so
// a form's fields say where they are as they are drawn: each one that can carry an error
// (ui/Field.tsx, and the select and the stepper beside it) enters the form it stands in, in the
// order they are drawn, with whether a refusal marks it.
import {
  createContext,
  use,
  useEffect,
  useMemo,
  useRef,
  type Component,
  type RefObject,
} from 'react'
import { focusOn } from './announce.ts'

interface Entry {
  /** The control the focus is given to. */
  readonly target: RefObject<Component | null>
  /** Whether an error is drawn beside it now. */
  readonly marked: { current: boolean }
}

/** A form's fields, in the order they were drawn. */
export interface Fields {
  /** Adds a field after those already there, until the answer's function is called. */
  readonly enter: (entry: Entry) => () => void
}

/**
 * The form a field stands in: `<RefusedFields value={fields}>` around the fields, with what
 * `useRefusedField` answers. A field outside one is no form's, and is given no focus.
 */
export const RefusedFields = createContext<Fields | null>(null)

/**
 * Moves the accessibility focus to the first field the refusal marked. `refused` is what the
 * last submission was refused with, a new value for each refusal; one that marks no field moves
 * nothing, and its banner is announced where it is drawn.
 *
 * The first is the first drawn: fields drawn together are in the order a reader meets them, and
 * one drawn later than its neighbours, where a choice above it brought it, is after them.
 */
export function useRefusedField(refused: unknown): Fields {
  const entries = useRef<readonly Entry[]>([])
  const fields = useMemo<Fields>(
    () => ({
      enter(entry) {
        entries.current = [...entries.current, entry]
        return () => {
          entries.current = entries.current.filter((each) => each !== entry)
        }
      },
    }),
    [],
  )
  // After the fields' own effects, which React runs first, a child's before its parent's: each
  // has said by now whether this refusal marks it.
  useEffect(() => {
    if (refused === undefined || refused === null) return
    const first = entries.current.find((entry) => entry.marked.current)
    if (first !== undefined) focusOn(first.target)
  }, [refused])
  return fields
}

/**
 * A field's part: the ref its control takes, which is what the focus is given to. `marked` is
 * whether an error is drawn beside it.
 */
export function useRefusable(marked: boolean): RefObject<Component | null> {
  const fields = use(RefusedFields)
  const target = useRef<Component | null>(null)
  const flag = useRef(marked)
  useEffect(() => {
    flag.current = marked
  }, [marked])
  useEffect(() => fields?.enter({ target, marked: flag }), [fields])
  return target
}
