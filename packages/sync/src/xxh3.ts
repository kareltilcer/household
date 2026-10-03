// XXH3-64 with seed 0 and the default secret (xxHash 0.8, Yann Collet, BSD-2-Clause), which a
// replica's report hashes each row's (entity_id, version) pair with (D-125). The server computes it
// with github.com/zeebo/xxh3; packages/test-vectors/vectors/replica-digest.json holds both to one
// answer for every length class this follows: 0, 1–3, 4–8, 9–16, 17–128, 129–240 and longer. It is
// written over BigInt, which every client's engine has (Hermes among them), because a report hashes
// a few thousand short pairs at rest and speed does not matter there.

const mask = (1n << 64n) - 1n
const u64 = (x: bigint): bigint => x & mask

const PRIME32_1 = 0x9e3779b1n
const PRIME32_2 = 0x85ebca77n
const PRIME32_3 = 0xc2b2ae3dn
const PRIME64_1 = 0x9e3779b185ebca87n
const PRIME64_2 = 0xc2b2ae3d27d4eb4fn
const PRIME64_3 = 0x165667b19e3779f9n
const PRIME64_4 = 0x85ebca77c2b2ae63n
const PRIME64_5 = 0x27d4eb2f165667c5n
const PRIME_MX1 = 0x165667919e3779f9n
const PRIME_MX2 = 0x9fb21c651e98df25n

/** The default secret, kSecret. */
const secret = Uint8Array.from(
  (
    'b8fe6c3923a44bbe7c01812cf721ad1cded46de9839097db7240a4a4b7b3671f' +
    'cb79e64eccc0e578825ad07dccff7221b8084674f743248ee03590e6813a264c' +
    '3c2852bb91c300cb88d0658b1b532ea371644897a20df94e3819ef46a9deacd8' +
    'a8fa763fe39c343ff9dcbbc7c70b4f1d8a51e04bcdb45931c89f7ec9d9787364' +
    'eac5ac8334d3ebc3c581a0fffa1363eb170ddd51b7f0da49d316552629d4689e' +
    '2b16be587d47a1fc8ff8b8d17ad031ce45cb3a8f95160428afd7fbcabb4b407e'
  )
    .match(/../g)
    ?.map((h) => parseInt(h, 16)) ?? [],
)
const secretSize = 192
const stripeLen = 64
const consumeRate = 8

function read32(b: Uint8Array, at: number): bigint {
  return BigInt(
    ((b[at] ?? 0) |
      ((b[at + 1] ?? 0) << 8) |
      ((b[at + 2] ?? 0) << 16) |
      ((b[at + 3] ?? 0) << 24)) >>>
      0,
  )
}

function read64(b: Uint8Array, at: number): bigint {
  return read32(b, at) | (read32(b, at + 4) << 32n)
}

function rotl64(x: bigint, r: bigint): bigint {
  return u64((x << r) | (x >> (64n - r)))
}

function swap64(x: bigint): bigint {
  let out = 0n
  for (let i = 0n; i < 8n; i++) out = (out << 8n) | ((x >> (i * 8n)) & 0xffn)
  return out
}

function mulFold64(a: bigint, b: bigint): bigint {
  const product = a * b
  return u64(product ^ (product >> 64n))
}

function avalanche64(h: bigint): bigint {
  h = u64((h ^ (h >> 33n)) * PRIME64_2)
  h = u64((h ^ (h >> 29n)) * PRIME64_3)
  return h ^ (h >> 32n)
}

function avalanche(h: bigint): bigint {
  h = u64((h ^ (h >> 37n)) * PRIME_MX1)
  return h ^ (h >> 32n)
}

function rrmxmx(h: bigint, len: number): bigint {
  h ^= rotl64(h, 49n) ^ rotl64(h, 24n)
  h = u64(h * PRIME_MX2)
  h ^= u64((h >> 35n) + BigInt(len))
  h = u64(h * PRIME_MX2)
  return h ^ (h >> 28n)
}

function mix16(input: Uint8Array, at: number, s: number): bigint {
  return mulFold64(
    read64(input, at) ^ read64(secret, s),
    read64(input, at + 8) ^ read64(secret, s + 8),
  )
}

function len1to3(input: Uint8Array): bigint {
  const len = input.length
  const c1 = input[0] ?? 0
  const c2 = input[len >> 1] ?? 0
  const c3 = input[len - 1] ?? 0
  const combined = BigInt(((c1 << 16) | (c2 << 24) | c3 | (len << 8)) >>> 0)
  const bitflip = (read32(secret, 0) ^ read32(secret, 4)) & 0xffffffffn
  return avalanche64(combined ^ bitflip)
}

function len4to8(input: Uint8Array): bigint {
  const len = input.length
  const input1 = read32(input, 0)
  const input2 = read32(input, len - 4)
  const bitflip = read64(secret, 8) ^ read64(secret, 16)
  const keyed = u64(input2 + (input1 << 32n)) ^ bitflip
  return rrmxmx(keyed, len)
}

function len9to16(input: Uint8Array): bigint {
  const len = input.length
  const lo = read64(input, 0) ^ (read64(secret, 24) ^ read64(secret, 32))
  const hi = read64(input, len - 8) ^ (read64(secret, 40) ^ read64(secret, 48))
  return avalanche(u64(BigInt(len) + swap64(lo) + hi + mulFold64(lo, hi)))
}

function len17to128(input: Uint8Array): bigint {
  const len = input.length
  let acc = u64(BigInt(len) * PRIME64_1)
  if (len > 32) {
    if (len > 64) {
      if (len > 96) {
        acc += mix16(input, 48, 96)
        acc += mix16(input, len - 64, 112)
      }
      acc += mix16(input, 32, 64)
      acc += mix16(input, len - 48, 80)
    }
    acc += mix16(input, 16, 32)
    acc += mix16(input, len - 32, 48)
  }
  acc += mix16(input, 0, 0)
  acc += mix16(input, len - 16, 16)
  return avalanche(u64(acc))
}

function len129to240(input: Uint8Array): bigint {
  const len = input.length
  let acc = u64(BigInt(len) * PRIME64_1)
  for (let i = 0; i < 8; i++) acc += mix16(input, 16 * i, 16 * i)
  acc = avalanche(u64(acc))
  const rounds = Math.floor(len / 16)
  for (let i = 8; i < rounds; i++) acc += mix16(input, 16 * i, 16 * (i - 8) + 3)
  acc += mix16(input, len - 16, 136 - 17)
  return avalanche(u64(acc))
}

function accumulate512(acc: bigint[], input: Uint8Array, at: number, s: number): void {
  for (let i = 0; i < 8; i++) {
    const value = read64(input, at + 8 * i)
    const key = value ^ read64(secret, s + 8 * i)
    acc[i ^ 1] = u64((acc[i ^ 1] ?? 0n) + value)
    acc[i] = u64((acc[i] ?? 0n) + (key & 0xffffffffn) * (key >> 32n))
  }
}

function scramble(acc: bigint[], s: number): void {
  for (let i = 0; i < 8; i++) {
    let a = acc[i] ?? 0n
    a ^= a >> 47n
    a ^= read64(secret, s + 8 * i)
    acc[i] = u64(a * PRIME32_1)
  }
}

function long(input: Uint8Array): bigint {
  const len = input.length
  const acc = [
    PRIME32_3,
    PRIME64_1,
    PRIME64_2,
    PRIME64_3,
    PRIME64_4,
    PRIME32_2,
    PRIME64_5,
    PRIME32_1,
  ]
  const stripesPerBlock = (secretSize - stripeLen) / consumeRate
  const blockLen = stripeLen * stripesPerBlock
  const blocks = Math.floor((len - 1) / blockLen)
  for (let n = 0; n < blocks; n++) {
    for (let s = 0; s < stripesPerBlock; s++)
      accumulate512(acc, input, n * blockLen + s * stripeLen, s * consumeRate)
    scramble(acc, secretSize - stripeLen)
  }
  const stripes = Math.floor((len - 1 - blockLen * blocks) / stripeLen)
  for (let s = 0; s < stripes; s++)
    accumulate512(acc, input, blocks * blockLen + s * stripeLen, s * consumeRate)
  accumulate512(acc, input, len - stripeLen, secretSize - stripeLen - 7)
  let result = u64(BigInt(len) * PRIME64_1)
  for (let i = 0; i < 4; i++) {
    result += mulFold64(
      (acc[2 * i] ?? 0n) ^ read64(secret, 11 + 16 * i),
      (acc[2 * i + 1] ?? 0n) ^ read64(secret, 11 + 16 * i + 8),
    )
  }
  return avalanche(u64(result))
}

/** The XXH3-64 of input, with seed 0 and the default secret. */
export function xxh3(input: Uint8Array): bigint {
  const len = input.length
  if (len === 0) return avalanche64(read64(secret, 56) ^ read64(secret, 64))
  if (len <= 3) return len1to3(input)
  if (len <= 8) return len4to8(input)
  if (len <= 16) return len9to16(input)
  if (len <= 128) return len17to128(input)
  if (len <= 240) return len129to240(input)
  return long(input)
}

/** text's UTF-8 bytes, without TextEncoder, which not every client's engine has always had. */
export function utf8(text: string): Uint8Array {
  const out: number[] = []
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0
    if (c < 0x80) out.push(c)
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f))
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f))
    else
      out.push(
        0xf0 | (c >> 18),
        0x80 | ((c >> 12) & 0x3f),
        0x80 | ((c >> 6) & 0x3f),
        0x80 | (c & 0x3f),
      )
  }
  return Uint8Array.from(out)
}

/** A 64-bit hash as sixteen lowercase hexadecimal digits. */
export function hex64(h: bigint): string {
  return h.toString(16).padStart(16, '0')
}
