// A tablet is a layout of this app, and no client of its own (PL-5): the same screens, drawn in
// the room they are given. The one measure that decides between the two layouts is here.
//
// The room is counted in the reader's text size, as the web's breakpoint is counted in em: a
// tablet whose reader has doubled the text has half the room for words, and is drawn as a phone
// is. 744 pt is the narrowest tablet held upright; every phone held upright is under it, and so
// is a tablet at twice the text.

/** The least width, in points at a text scale of one, that two panes and the tablet's bar are drawn from. */
export const wideFrom = 744

/** Whether `width` points are a tablet's room for a reader at `textScale`. */
export function isWide(width: number, textScale: number): boolean {
  return width / textScale >= wideFrom
}
