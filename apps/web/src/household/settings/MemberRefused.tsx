// What a write of a member's page was refused with, where the refusal is no field's: said as it
// arrives, and a banner of its own for each refusal, so that the same sentence a second time is
// said a second time.
import { Banner } from '../../ui/Banner.tsx'
import type { Refusal } from './member.ts'

export function Refused({ refusal }: { readonly refusal: Refusal | undefined }) {
  if (refusal === undefined) return null
  return (
    <Banner key={refusal.key} tone="danger" announce>
      {refusal.text}
    </Banner>
  )
}
