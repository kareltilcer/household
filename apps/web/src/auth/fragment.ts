// What an address carries for the page it opens and for nobody else. An email's link carries its
// token in the fragment (`#token=…`), which a browser sends to no server, so it is in no log on
// the way (ADR 0009); the API sends Apple's answer to a sign-in on in the fragment too, and
// Google returns with a query (ADR 0010).
//
// A page reads what it was opened with once, and takes it out of the address at once, replacing
// the history entry rather than adding one: the token is then in no entry to go back to, and in
// no address copied from the bar. The replacement is the router's own, which owns the history:
// it writes `history.replaceState`, and its own location is left with no token either.
//
// What a page was opened with is not all that reaches it. A link opened in a tab that is on its
// page already, pasted into the address or taken from a bookmark, changes the fragment under the
// page and loads nothing: the page that was drawn would go on saying what it said, of the link
// before or of none, and what arrived would leave the address unread, where a reload no longer
// finds it. So each arrival is read as the first was, and counted: the page draws its screen
// keyed by `arrival`, which begins it again for what arrived, as a load would have (ADR 0026).
import { useLayoutEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'

/** What reached a page last: read once, and in the address no longer. */
export interface Carried {
  readonly fragment: URLSearchParams
  /** The query, where the page asked for it: empty for a page that reads the fragment alone. */
  readonly query: URLSearchParams
  /**
   * Which arrival this is, counted from what the page was opened with: the key of the screen
   * drawn for it, so that the next is drawn a screen of its own.
   */
  readonly arrival: number
}

/** The fields of a fragment or a query, written as a form's are, with or without its first mark. */
function fieldsOf(part: string): URLSearchParams {
  return new URLSearchParams(part.replace(/^[#?]/, ''))
}

/**
 * Whether `fields` hold anything for a page to read. A fragment that names a place on the page,
 * as a link past its header would, is a field with no value: it is taken out of the address as
 * any other, and begins nothing again.
 */
function carries(fields: URLSearchParams): boolean {
  return [...fields.values()].some((value) => value !== '')
}

function useCarried(withQuery: boolean): Carried {
  const location = useLocation()
  const navigate = useNavigate()
  const { pathname, search, hash } = location
  const state: unknown = location.state
  const kept = withQuery ? '' : search
  // What the address holds for the page, as it is written: nothing, once it is taken out.
  const held = `${withQuery ? search : ''}${hash}`
  const [seen, setSeen] = useState(held)
  const [carried, setCarried] = useState<Carried>(() => ({
    fragment: fieldsOf(hash),
    query: fieldsOf(withQuery ? search : ''),
    arrival: 0,
  }))
  // The address changed under the page: what it held was taken out, or something arrived. It is
  // told apart from the address it was last drawn with, and not from what was read last, so that
  // the same link opened twice arrives twice, as it would be loaded twice.
  if (held !== seen) {
    setSeen(held)
    const fragment = fieldsOf(hash)
    const query = fieldsOf(withQuery ? search : '')
    if (carries(fragment) || carries(query)) {
      setCarried({ fragment, query, arrival: carried.arrival + 1 })
    }
  }
  // Before the page is painted with it. The effect runs again where React's strict mode runs it
  // twice, and replaces the entry with what it already is.
  useLayoutEffect(() => {
    if (held === '') return
    void navigate({ pathname, search: kept, hash: '' }, { replace: true, state })
  }, [held, navigate, pathname, kept, state])
  return carried
}

/**
 * What the fragment last carried to this page, which the address then holds no longer: the page
 * draws its screen keyed by `arrival`.
 */
export function useFragment(): Carried {
  return useCarried(false)
}

/**
 * The fragment and the query that last reached this page, for the one page a provider returns to
 * with either, and neither is left in the address.
 */
export function useFragmentAndQuery(): Carried {
  return useCarried(true)
}
