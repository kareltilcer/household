// What an address carries for the page it opens and for nobody else. An email's link carries its
// token in the fragment (`#token=…`), which a browser sends to no server, so it is in no log on
// the way (ADR 0009); the API sends Apple's answer to a sign-in on in the fragment too, and
// Google returns with a query (ADR 0010).
//
// A page reads what it was opened with once, and takes it out of the address at once, replacing
// the history entry rather than adding one: the token is then in no entry to go back to, and in
// no address copied from the bar. The replacement is the router's own, which owns the history:
// it writes `history.replaceState`, and its own location is left with no token either.
import { useLayoutEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'

/** What a page was opened with: read once, and in the address no longer. */
export interface Carried {
  readonly fragment: URLSearchParams
  /** The query, where the page asked for it: empty for a page that reads the fragment alone. */
  readonly query: URLSearchParams
}

/** The fields of a fragment or a query, written as a form's are, with or without its first mark. */
function fieldsOf(part: string): URLSearchParams {
  return new URLSearchParams(part.replace(/^[#?]/, ''))
}

function useCarried(withQuery: boolean): Carried {
  const location = useLocation()
  const navigate = useNavigate()
  const [carried] = useState<Carried>(() => ({
    fragment: fieldsOf(location.hash),
    query: fieldsOf(withQuery ? location.search : ''),
  }))
  const { pathname, search, hash } = location
  const state: unknown = location.state
  const kept = withQuery ? '' : search
  const bare = hash === '' && kept === search
  // Before the page is painted with it. The effect runs again where React's strict mode runs it
  // twice, and replaces the entry with what it already is.
  useLayoutEffect(() => {
    if (bare) return
    void navigate({ pathname, search: kept, hash: '' }, { replace: true, state })
  }, [bare, navigate, pathname, kept, state])
  return carried
}

/** The fields of the fragment this page was opened with, which the address then holds no longer. */
export function useFragment(): URLSearchParams {
  return useCarried(false).fragment
}

/**
 * The fragment and the query this page was opened with, for the one page a provider returns to
 * with either, and neither is left in the address.
 */
export function useFragmentAndQuery(): Carried {
  return useCarried(true)
}
