// What an address that arrives comes to (04-navigation §8, PRD 06 §6), as one function of the
// address and of who is here: the four situations of a link, and the one that is none. An
// address arrives from a pressed notification, whose `data.url` the server wrote, or from the
// system, a link in the app's own scheme or on its host (Links.tsx). It is the web's own
// address, a path, and the app opens it one to one (app/paths.ts).
//
// This file is data in and data out, with nothing of React Native's or of expo-router's: what
// each answer does is Links.tsx's, and what a household's own address answers, which only the
// server says, is its frame's (household/data.ts).
import { isOwnPath, paths, routeIds } from '../app/paths.ts'

/** Who is here as an address arrives. */
export interface Standing {
  /**
   * Whether nobody is signed in. Where it is not yet known who is, the address is opened as a
   * member's: its route waits for the answer, and holds it itself if that is nobody.
   */
  readonly visitor: boolean
  /** The household whose screens are drawn, or null where none is. */
  readonly shown: string | null
}

export type Arrival =
  /** No address of the app's own: another origin's, or nothing at all. It opens nothing. */
  | { readonly kind: 'nothing' }
  /** Nobody is signed in (the cold start): held through the sign-in, which says so. */
  | { readonly kind: 'held'; readonly path: string }
  /** The household on screen, or no household's (warm): the target goes on to the stack. */
  | { readonly kind: 'opened'; readonly path: string }
  /**
   * Another household than the one on screen (the wrong household). The address is the switch,
   * and it is said, since everything else on screen changes with it; `from` is the way back.
   */
  | {
      readonly kind: 'switched'
      readonly path: string
      readonly from: string
      readonly to: string
    }
  /**
   * An address the app has no screen for (no access, as far as an address alone tells): the
   * neutral screen, which names nothing and gives no cause. A household its member may no
   * longer open reads the same, once its own frame has asked.
   */
  | { readonly kind: 'notAvailable'; readonly path: string }

/** `address` without what follows its path: a query, a fragment, a slash at its end. */
function pathOf(address: string): string {
  const end = address.search(/[?#]/)
  const path = end === -1 ? address : address.slice(0, end)
  return path.length > 1 ? path.replace(/\/+$/, '') : path
}

/**
 * The household an address is in, as its second segment names it, or null for an address of no
 * household's. In lower case: an id is written in either.
 */
export function householdOf(address: string): string | null {
  const match = /^\/households\/([^/?#]+)/.exec(address)
  return match?.[1] === undefined ? null : match[1].toLowerCase()
}

/** A route's pattern as an expression its addresses match: a parameter is one segment. */
function pattern(path: string): RegExp {
  const source = path
    .split('/')
    .map((segment) =>
      /^\[[A-Za-z]+\]$/.test(segment) ? '[^/]+' : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    )
    .join('/')
  return new RegExp(`^${source}$`)
}

/**
 * The routes that are a screen: every line of the table but the ones that take whatever no
 * other does, which draw *not available*. A module's own screens are lines of their own as
 * they are built, and its catch-all is not one.
 */
const screens = routeIds
  .map((id) => paths[id].path)
  .filter((path) => !path.endsWith('[...rest]') && path !== paths.notFound.path)
  .map(pattern)

/** Whether the app has a screen at `address`. */
export function hasScreen(address: string): boolean {
  const path = pathOf(address)
  return screens.some((screen) => screen.test(path))
}

/** What `address` comes to for whoever `standing` says is here. */
export function resolve(address: unknown, standing: Standing): Arrival {
  if (typeof address !== 'string' || !isOwnPath(address)) return { kind: 'nothing' }
  if (standing.visitor) return { kind: 'held', path: address }
  const household = householdOf(address)
  if (household !== null && standing.shown !== null && household !== standing.shown.toLowerCase()) {
    return { kind: 'switched', path: address, from: standing.shown.toLowerCase(), to: household }
  }
  return hasScreen(address)
    ? { kind: 'opened', path: address }
    : { kind: 'notAvailable', path: address }
}
