// A device's sign-in as the device holds it: kept under its member, renewed before it lapses
// and one renewal at a time, and ended by nothing but the server's refusal to renew it.
import { describe, expect, it, jest } from '@jest/globals'
import { ids } from '../test/fixtures.ts'
import {
  createTokenStore,
  renewBefore,
  vaultKeys,
  type Exchange,
  type TokenPair,
  type TokenStoreOptions,
} from './tokens.ts'
import { memoryVault } from './vault.ts'

const minute = 60_000

function pair(name: string): TokenPair {
  return { access_token: `access-${name}`, refresh_token: `refresh-${name}`, expires_in: 900 }
}

/** A device at a time the test moves, whose renewals the test answers. */
function device(kept: Record<string, string> = {}) {
  const vault = memoryVault(kept)
  const clock = { now: 1_000_000 }
  const exchange = jest.fn<TokenStoreOptions['exchange']>()
  const ended = jest.fn<(member: string) => void>()
  let minted = 0
  const tokens = createTokenStore({
    vault,
    exchange,
    now: () => clock.now,
    newId: () => {
      minted += 1
      return minted === 1 ? ids.device : ids.otherMember
    },
  })
  tokens.onEnded(ended)
  return { vault, clock, exchange, ended, tokens }
}

/** A promise a test settles when it says. */
function held<Value>() {
  let resolve: (value: Value) => void = () => undefined
  let reject: (error: unknown) => void = () => undefined
  const promise = new Promise<Value>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

describe('a device that holds no sign-in', () => {
  it('reads as nobody’s, and signs a request with nothing', async () => {
    const { tokens, exchange } = device()
    expect(await tokens.start()).toBeNull()
    expect(tokens.member()).toBeNull()
    expect(tokens.members()).toEqual([])
    expect(await tokens.current()).toBeUndefined()
    expect(exchange).not.toHaveBeenCalled()
  })

  it('makes its installation’s id once, and keeps it', async () => {
    const { tokens, vault } = device()
    const [one, other] = await Promise.all([tokens.device(), tokens.device()])
    expect(one).toBe(ids.device)
    expect(other).toBe(ids.device)
    expect(vault.held()[vaultKeys.device]).toBe(ids.device)
    // The next start of the app reads the same one, and makes none.
    const next = device(vault.held())
    expect(await next.tokens.device()).toBe(ids.device)
  })

  it('goes on with an id it could not keep, for as long as the app runs', async () => {
    const { tokens, vault } = device()
    jest.spyOn(vault, 'set').mockRejectedValue(new Error('the keystore refused'))
    expect(await tokens.device()).toBe(ids.device)
    expect(await tokens.device()).toBe(ids.device)
  })
})

describe('a sign-in the device was given', () => {
  it('is kept under its member, who is the one signed in from then on', async () => {
    const { tokens, vault, clock } = device()
    await tokens.start()
    await tokens.keep(ids.member.toUpperCase(), pair('a'))
    expect(tokens.member()).toBe(ids.member)
    expect(await tokens.current()).toBe('access-a')
    expect(JSON.parse(vault.held()[vaultKeys.signIn(ids.member)] ?? '')).toEqual({
      access: 'access-a',
      refresh: 'refresh-a',
      expires_at: clock.now + 900_000,
    })
    expect(JSON.parse(vault.held()[vaultKeys.signIns] ?? '')).toEqual({
      active: ids.member,
      members: [ids.member],
    })
  })

  it('is read back at the next start, with nothing asked of the server', async () => {
    const first = device()
    await first.tokens.keep(ids.member, pair('a'))
    const next = device(first.vault.held())
    expect(await next.tokens.start()).toBe(ids.member)
    expect(await next.tokens.current()).toBe('access-a')
    expect(next.exchange).not.toHaveBeenCalled()
  })

  // A shared tablet signs several profiles in, each with a sign-in of its own (D-104): the
  // device keeps each under its member, and one of them is the one in use.
  it('stands beside another member’s, each under its own key', async () => {
    const { tokens, vault } = device()
    await tokens.keep(ids.member, pair('a'))
    await tokens.keep(ids.otherMember, pair('b'))
    expect(tokens.member()).toBe(ids.otherMember)
    expect(tokens.members()).toEqual([ids.member, ids.otherMember])
    expect(Object.keys(vault.held()).sort()).toEqual(
      [vaultKeys.signIn(ids.member), vaultKeys.signIn(ids.otherMember), vaultKeys.signIns].sort(),
    )
  })

  it('is removed with its member, and the installation’s id stays', async () => {
    const { tokens, vault } = device()
    await tokens.device()
    await tokens.keep(ids.member, pair('a'))
    await tokens.remove(ids.member)
    expect(tokens.member()).toBeNull()
    expect(await tokens.current()).toBeUndefined()
    expect(vault.held()).toEqual({
      [vaultKeys.device]: ids.device,
      [vaultKeys.signIns]: JSON.stringify({ active: null, members: [] }),
    })
  })

  it('is nobody’s where the device names a member and holds no pair for them', async () => {
    const { tokens, vault } = device({
      [vaultKeys.signIns]: JSON.stringify({ active: ids.member, members: [ids.member] }),
      [vaultKeys.signIn(ids.member)]: 'no pair at all',
    })
    expect(await tokens.start()).toBeNull()
    expect(vault.held()[vaultKeys.signIn(ids.member)]).toBeUndefined()
  })

  // A keychain that is shut for now holds what it held: read as holding nothing, a sign-in it
  // still has would be taken for gone, and what the device kept of its member removed for it.
  it('is nobody’s for this run where the vault will not say, and nothing of it is removed', async () => {
    const first = device()
    await first.tokens.keep(ids.member, pair('a'))
    const { tokens, vault } = device(first.vault.held())
    jest.spyOn(vault, 'get').mockRejectedValue(new Error('the keychain is shut'))
    const remove = jest.spyOn(vault, 'remove')
    await expect(tokens.start()).rejects.toThrow('the keychain is shut')
    expect(tokens.member()).toBeNull()
    expect(tokens.members()).toEqual([])
    expect(await tokens.current()).toBeUndefined()
    expect(remove).not.toHaveBeenCalled()
    expect(vault.held()[vaultKeys.signIn(ids.member)]).toContain('refresh-a')
  })

  // Kept over a list that was never read, a sign-in would drop from it every one the vault could
  // not name a moment ago: theirs would be sign-ins the device holds and cannot list, and what
  // it kept of them removed at the next start as nobody's.
  it('is not kept over sign-ins the vault would not name, and is kept beside them once it does', async () => {
    const first = device()
    await first.tokens.keep(ids.member, pair('a'))
    const { tokens, vault } = device(first.vault.held())
    const get = jest.spyOn(vault, 'get').mockRejectedValue(new Error('the keychain is shut'))
    const set = jest.spyOn(vault, 'set')
    await expect(tokens.start()).rejects.toThrow('the keychain is shut')
    await expect(tokens.keep(ids.otherMember, pair('b'))).rejects.toThrow('the keychain is shut')
    await expect(tokens.remove(ids.member)).rejects.toThrow('the keychain is shut')
    expect(set).not.toHaveBeenCalled()
    expect(tokens.member()).toBeNull()
    // The keychain opens: what it holds is read before anything is written.
    get.mockRestore()
    await tokens.keep(ids.otherMember, pair('b'))
    expect(JSON.parse(vault.held()[vaultKeys.signIns] ?? '')).toEqual({
      active: ids.otherMember,
      members: [ids.member, ids.otherMember],
    })
  })

  // A pair the vault holds for a member it does not name is a sign-in the next start cannot
  // list: who is signed in is written first, and again with the pair until both are taken.
  it('names its member before it keeps their pair, and writes both again where the vault refused', async () => {
    const { tokens, vault } = device()
    await tokens.start()
    const set = jest.spyOn(vault, 'set').mockRejectedValueOnce(new Error('the keystore refused'))
    await tokens.keep(ids.member, pair('a'))
    // Refused at the first of the two: nothing of the sign-in is kept, and no pair stands alone.
    expect(set.mock.calls.map(([key]) => key)).toEqual([vaultKeys.signIns])
    expect(vault.held()).toEqual({})
    expect(await tokens.current()).toBe('access-a')
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0)
    })
    expect(set.mock.calls.map(([key]) => key)).toEqual([
      vaultKeys.signIns,
      vaultKeys.signIns,
      vaultKeys.signIn(ids.member),
    ])
    const next = device(vault.held())
    expect(await next.tokens.start()).toBe(ids.member)
    expect(next.tokens.members()).toEqual([ids.member])
  })

  // What an app closed between the two writes leaves: a member named, with no pair, which the
  // next start signs in to nothing. And never a pair for a member nobody names.
  it('leaves no pair the device cannot list where only the first of its two writes landed', async () => {
    const { tokens, vault } = device()
    await tokens.start()
    const set = vault.set
    let written = 0
    jest.spyOn(vault, 'set').mockImplementation((key, value) => {
      written += 1
      return written === 1 ? set(key, value) : Promise.reject(new Error('the app was closed'))
    })
    await tokens.keep(ids.member, pair('a'))
    expect(Object.keys(vault.held())).toEqual([vaultKeys.signIns])
    const next = device(vault.held())
    expect(await next.tokens.start()).toBeNull()
    expect(next.tokens.members()).toEqual([])
    expect(next.vault.held()[vaultKeys.signIn(ids.member)]).toBeUndefined()
  })

  // Made anew over a vault that may hold one, the id a sign-in of this run named would not be
  // the one the next start reads back, and the server refuses a registration that names another.
  it('names no installation where the vault will not say whether it holds one, until it does', async () => {
    const first = device()
    expect(await first.tokens.device()).toBe(ids.device)
    const { tokens, vault } = device(first.vault.held())
    const get = jest.spyOn(vault, 'get').mockRejectedValue(new Error('the keychain is shut'))
    const set = jest.spyOn(vault, 'set')
    await expect(tokens.device()).rejects.toThrow('the keychain is shut')
    expect(set).not.toHaveBeenCalled()
    get.mockRestore()
    // The one the vault held all along, and none of this run's making.
    expect(await tokens.device()).toBe(ids.device)
    expect(vault.held()[vaultKeys.device]).toBe(ids.device)
  })

  it('works for as long as the app runs on a device that will not keep it', async () => {
    const { tokens, vault } = device()
    jest.spyOn(vault, 'set').mockRejectedValue(new Error('the keystore refused'))
    await tokens.keep(ids.member, pair('a'))
    expect(await tokens.current()).toBe('access-a')
  })
})

describe('an access token', () => {
  it('is sent as it is while it has more than a minute left', async () => {
    const { tokens, clock, exchange } = device()
    await tokens.keep(ids.member, pair('a'))
    clock.now += 900_000 - renewBefore - 1
    expect(await tokens.current()).toBe('access-a')
    expect(exchange).not.toHaveBeenCalled()
  })

  it('is renewed first where it is about to lapse, and the new pair kept', async () => {
    const { tokens, clock, exchange, vault } = device()
    await tokens.keep(ids.member, pair('a'))
    clock.now += 900_000 - renewBefore
    exchange.mockResolvedValue({ kind: 'renewed', tokens: pair('b') })
    expect(await tokens.current()).toBe('access-b')
    expect(exchange).toHaveBeenCalledWith('refresh-a')
    expect(JSON.parse(vault.held()[vaultKeys.signIn(ids.member)] ?? '')).toEqual({
      access: 'access-b',
      refresh: 'refresh-b',
      expires_at: clock.now + 900_000,
    })
  })

  it('is sent as it is where the server could not be asked for a new one', async () => {
    const { tokens, clock, exchange, ended, vault } = device()
    await tokens.keep(ids.member, pair('a'))
    clock.now += 20 * minute
    exchange.mockRejectedValue(new TypeError('Network request failed'))
    expect(await tokens.current()).toBe('access-a')
    // Nothing ended, and nothing was changed: the device holds what it held.
    expect(ended).not.toHaveBeenCalled()
    expect(JSON.parse(vault.held()[vaultKeys.signIn(ids.member)] ?? '')).toMatchObject({
      refresh: 'refresh-a',
    })
  })
})

describe('a renewal', () => {
  it('is one at a time: every request that needs one is served by it', async () => {
    const { tokens, exchange } = device()
    await tokens.keep(ids.member, pair('a'))
    const answer = held<Exchange>()
    exchange.mockReturnValue(answer.promise)
    const waiting = [tokens.renew('access-a'), tokens.renew('access-a'), tokens.renew('access-a')]
    answer.resolve({ kind: 'renewed', tokens: pair('b') })
    expect(await Promise.all(waiting)).toEqual(['access-b', 'access-b', 'access-b'])
    expect(exchange).toHaveBeenCalledTimes(1)
  })

  it('is not asked for again by a request refused on the token it replaced', async () => {
    const { tokens, exchange } = device()
    await tokens.keep(ids.member, pair('a'))
    exchange.mockResolvedValue({ kind: 'renewed', tokens: pair('b') })
    expect(await tokens.renew('access-a')).toBe('access-b')
    // A request that left with the old token and was answered after the renewal.
    expect(await tokens.renew('access-a')).toBe('access-b')
    expect(exchange).toHaveBeenCalledTimes(1)
  })

  // D-98: a phone on a bad connection loses the answer to a renewal and asks again with the
  // token it still holds, which the server takes for the retry it is.
  it('that got no answer changes nothing, and is asked again with the same token', async () => {
    const { tokens, exchange, ended } = device()
    await tokens.keep(ids.member, pair('a'))
    exchange.mockRejectedValueOnce(new TypeError('Network request failed'))
    await expect(tokens.renew('access-a')).rejects.toThrow('Network request failed')
    expect(tokens.member()).toBe(ids.member)
    expect(ended).not.toHaveBeenCalled()
    exchange.mockResolvedValueOnce({ kind: 'renewed', tokens: pair('b') })
    expect(await tokens.renew('access-a')).toBe('access-b')
    expect(exchange.mock.calls).toEqual([['refresh-a'], ['refresh-a']])
  })

  it('the server refused ends the sign-in: the pair is removed, and whoever listens is told', async () => {
    const { tokens, exchange, ended, vault } = device()
    await tokens.device()
    await tokens.keep(ids.member, pair('a'))
    exchange.mockResolvedValue({ kind: 'ended' })
    expect(await tokens.renew('access-a')).toBeUndefined()
    expect(ended).toHaveBeenCalledTimes(1)
    expect(ended).toHaveBeenCalledWith(ids.member)
    expect(tokens.member()).toBeNull()
    expect(await tokens.current()).toBeUndefined()
    expect(vault.held()[vaultKeys.signIn(ids.member)]).toBeUndefined()
    // The installation is the same one for whoever signs in next.
    expect(vault.held()[vaultKeys.device]).toBe(ids.device)
  })

  it('tells nobody who has stopped listening', async () => {
    const { tokens, exchange } = device()
    const listener = jest.fn<(member: string) => void>()
    const stop = tokens.onEnded(listener)
    stop()
    await tokens.keep(ids.member, pair('a'))
    exchange.mockResolvedValue({ kind: 'ended' })
    await tokens.renew('access-a')
    expect(listener).not.toHaveBeenCalled()
  })

  it('answered after its member signed out is nobody’s, and is not kept', async () => {
    const { tokens, exchange, ended, vault } = device()
    await tokens.keep(ids.member, pair('a'))
    const answer = held<Exchange>()
    exchange.mockReturnValue(answer.promise)
    const renewing = tokens.renew('access-a')
    await tokens.remove(ids.member)
    answer.resolve({ kind: 'renewed', tokens: pair('b') })
    expect(await renewing).toBeUndefined()
    expect(tokens.member()).toBeNull()
    expect(vault.held()[vaultKeys.signIn(ids.member)]).toBeUndefined()
    expect(ended).not.toHaveBeenCalled()
  })

  // A request that left as one member and was refused once another's sign-in was the one in
  // use is the first one's request: sent again with the second's token, it is made as them.
  it('hands a request refused on another member’s token nothing of the sign-in in use', async () => {
    const { tokens, exchange } = device()
    await tokens.keep(ids.member, pair('a'))
    await tokens.remove(ids.member)
    await tokens.keep(ids.otherMember, pair('b'))
    expect(await tokens.renew('access-a')).toBeUndefined()
    expect(exchange).not.toHaveBeenCalled()
    // The second one's own is renewed as ever.
    exchange.mockResolvedValue({ kind: 'renewed', tokens: pair('c') })
    expect(await tokens.renew('access-b')).toBe('access-c')
  })

  it('answers a request refused on a token of this sign-in’s the app read as it started', async () => {
    const first = device()
    await first.tokens.keep(ids.member, pair('a'))
    const { tokens, exchange } = device(first.vault.held())
    await tokens.start()
    exchange.mockResolvedValue({ kind: 'renewed', tokens: pair('b') })
    expect(await tokens.renew('access-a')).toBe('access-b')
  })

  // A keychain shut while the device is locked refuses the write, and takes it once it is not:
  // left unwritten, the app closed would start again on a refresh token that is used up.
  it('writes a pair the vault would not take again, as a token is next asked for', async () => {
    const { tokens, exchange, vault } = device()
    await tokens.keep(ids.member, pair('a'))
    const set = jest.spyOn(vault, 'set').mockRejectedValueOnce(new Error('the keychain is shut'))
    exchange.mockResolvedValue({ kind: 'renewed', tokens: pair('b') })
    expect(await tokens.renew('access-a')).toBe('access-b')
    expect(vault.held()[vaultKeys.signIn(ids.member)]).toContain('refresh-a')
    expect(await tokens.current()).toBe('access-b')
    // Who is signed in and then their pair: two writes, each a turn of the vault's.
    const turn = () =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, 0)
      })
    await turn()
    expect(vault.held()[vaultKeys.signIn(ids.member)]).toContain('refresh-b')
    // Written once it was taken, and not at every token asked for after.
    const writes = set.mock.calls.length
    expect(await tokens.current()).toBe('access-b')
    await turn()
    expect(set.mock.calls).toHaveLength(writes)
  })

  it('refused after another member signed in ends nothing of theirs', async () => {
    const { tokens, exchange, ended } = device()
    await tokens.keep(ids.member, pair('a'))
    const answer = held<Exchange>()
    exchange.mockReturnValue(answer.promise)
    const renewing = tokens.renew('access-a')
    await tokens.remove(ids.member)
    await tokens.keep(ids.otherMember, pair('b'))
    answer.resolve({ kind: 'ended' })
    expect(await renewing).toBeUndefined()
    expect(ended).not.toHaveBeenCalled()
    expect(tokens.member()).toBe(ids.otherMember)
    expect(await tokens.current()).toBe('access-b')
  })
})
