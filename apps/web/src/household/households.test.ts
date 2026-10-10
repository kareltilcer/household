// Which day a household's data goes on, of the two its own answer may carry (households.ts): the
// server's erasure takes whichever is due first, a deletion its owners scheduled or the day a
// lapse keeps its data until, and neither holds the other back.
import { describe, expect, it } from 'vitest'
import { deletedBy, goesAt, keptUntil } from './households.ts'

const retained = '2026-10-10T00:00:00Z'

function lapsed(deletion: string | null) {
  return {
    entitlement: { state: 'read_only' as const, data_retained_until: retained },
    deletion_scheduled_at: deletion,
  }
}

describe('the day a household’s data goes on', () => {
  it('is the lapse’s where no deletion is scheduled', () => {
    expect(keptUntil(lapsed(null))).toBe(retained)
    expect(goesAt(lapsed(null))).toBe(retained)
    expect(deletedBy(lapsed(null), retained)).toBe(false)
  })

  it('is the lapse’s still where a deletion is scheduled for later, as one made in a lapse’s last thirty days is', () => {
    const later = lapsed('2026-11-03T09:00:00Z')
    expect(keptUntil(later)).toBe(retained)
    expect(goesAt(later)).toBe(retained)
  })

  it('is the deletion’s where that comes first, or at the same moment, and the lapse’s day is then not said', () => {
    const sooner = lapsed('2026-09-01T09:00:00Z')
    expect(keptUntil(sooner)).toBeNull()
    expect(goesAt(sooner)).toBe('2026-09-01T09:00:00Z')
    // The two are compared as moments, however each is written.
    const same = lapsed('2026-10-10T02:00:00+02:00')
    expect(keptUntil(same)).toBeNull()
    expect(goesAt(same)).toBe('2026-10-10T02:00:00+02:00')
  })

  it('is the deletion’s in a household that has not lapsed, and none where nothing is scheduled', () => {
    const active = { entitlement: { state: 'active' as const }, deletion_scheduled_at: retained }
    expect(keptUntil(active)).toBeNull()
    expect(goesAt(active)).toBe(retained)
    expect(goesAt({ entitlement: { state: 'active' as const } })).toBeNull()
    expect(goesAt({})).toBeNull()
  })
})
