// A sheet, for an editor (02-components §1: "mobile prefers sheets"): it comes from the foot of
// the screen with the sheet's radius on its top corners, the screen staying where it was beneath
// it. It has a close control with a name, which a dialog has not, its body scrolls, and it stands
// above the keyboard, which never covers the field being typed in. Everything else of it is the
// dialog's (ui/Dialog.tsx).
import { Surface, type DialogProps } from './Dialog.tsx'

export type SheetProps = DialogProps

export function Sheet(props: SheetProps) {
  return <Surface {...props} sheet />
}
