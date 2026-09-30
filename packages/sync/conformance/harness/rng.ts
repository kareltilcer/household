// The suite's one source of randomness (PRD 10 §4): every schedule, every fault and every
// generated value is drawn from a seeded generator, so that a failing run is replayed from its
// seed. PowerSync's own timing is not the suite's to seed, so a replayed schedule may interleave
// differently with replication; the seed fixes what the clients do and when they do it, because
// what draws as often as that timing decides draws from a generator forked from the schedule's
// (Rng.fork).

/** A seeded pseudo-random generator: sfc32, whose whole state is four 32-bit words. */
export class Rng {
  private a: number
  private b: number
  private c: number
  private d: number
  readonly seed: number

  constructor(seed: number) {
    if (!Number.isSafeInteger(seed)) throw new Error(`a seed is a whole number: ${String(seed)}`)
    this.seed = seed
    // splitmix32 spreads the seed over the state, so that neighbouring seeds start apart.
    let s = seed >>> 0
    const next = (): number => {
      s = (s + 0x9e3779b9) >>> 0
      let z = s
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0
      return (z ^ (z >>> 16)) >>> 0
    }
    this.a = next()
    this.b = next()
    this.c = next()
    this.d = next()
    for (let i = 0; i < 12; i++) this.u32()
  }

  /** A whole number in [0, 2^32). */
  u32(): number {
    const t = (((this.a + this.b) >>> 0) + this.d) >>> 0
    this.d = (this.d + 1) >>> 0
    this.a = this.b ^ (this.b >>> 9)
    this.b = (this.c + (this.c << 3)) >>> 0
    this.c = ((this.c << 21) | (this.c >>> 11)) >>> 0
    this.c = (this.c + t) >>> 0
    return t
  }

  /**
   * A generator of its own, seeded from this one's next draw: what draws from it, however often,
   * leaves this one's sequence where it was. A schedule forks one for each thing whose draws
   * PowerSync's timing decides (a client's ids and keys, a flaky network's rolls), so that the
   * schedule itself stays the seed's.
   */
  fork(): Rng {
    return new Rng(this.u32())
  }

  /** A number in [0, 1). */
  float(): number {
    return this.u32() / 0x1_0000_0000
  }

  /** A whole number in [min, max]. */
  int(min: number, max: number): number {
    if (max < min) throw new Error(`an empty range: ${String(min)}..${String(max)}`)
    return min + Math.floor(this.float() * (max - min + 1))
  }

  /** Whether an event of probability p happens. */
  chance(p: number): boolean {
    return this.float() < p
  }

  /** One of items, which is not empty. */
  pick<T>(items: readonly T[]): T {
    const item = items[this.int(0, items.length - 1)]
    if (item === undefined) throw new Error('pick from an empty list')
    return item
  }

  /** One of options, each drawn in proportion to its weight. */
  weighted<T>(options: readonly (readonly [T, number])[]): T {
    const total = options.reduce((sum, [, w]) => sum + w, 0)
    let at = this.float() * total
    for (const [value, weight] of options) {
      at -= weight
      if (at < 0) return value
    }
    const last = options.at(-1)
    if (last === undefined) throw new Error('a weighted pick from no options')
    return last[0]
  }

  /** A copy of items in an order drawn from this generator. */
  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items]
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(0, i)
      const a = out[i]
      const b = out[j]
      if (a === undefined || b === undefined) continue
      out[i] = b
      out[j] = a
    }
    return out
  }

  /** A UUIDv7-shaped id whose random bits are drawn from this generator, at time ms. */
  uuid(ms: number = Date.now()): string {
    const hex = (n: number, width: number): string => n.toString(16).padStart(width, '0')
    const time = hex(Math.floor(ms), 12)
    const randA = hex(this.int(0, 0xfff), 3)
    const variant = hex(0x8000 | this.int(0, 0x3fff), 4)
    const randB = hex(this.u32(), 8) + hex(this.int(0, 0xffff), 4)
    return `${time.slice(0, 8)}-${time.slice(8, 12)}-7${randA}-${variant}-${randB}`
  }
}
