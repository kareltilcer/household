// The replicas a device keeps, by name, and their removal (FR-ID7): what is noted before a
// replica is opened, what a sign-in that ended marks, and how far a removal that failed is
// taken up again at the next start.
import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { households, ids } from '../test/fixtures.ts'
import {
  claimReplica,
  keptReplicas,
  markLeaving,
  removeLeft,
  replicaDatabase,
  replicaFiles,
  type Removal,
} from './databases.ts'

const member = ids.member
const other = ids.otherMember
const home = households.own.id
const second = households.other.id

/** A removal that keeps what it was asked, and fails where a test says. */
function removing(fails: { empty?: boolean; remove?: boolean } = {}) {
  const asked: string[] = []
  const removal: Removal = {
    empty: (who, which) => {
      asked.push(`empty:${who}/${which}`)
      return fails.empty === true ? Promise.reject(new Error('locked')) : Promise.resolve()
    },
    remove: (who, which) => {
      asked.push(`remove:${who}/${which}`)
      return fails.remove === true ? Promise.reject(new Error('busy')) : Promise.resolve()
    },
  }
  return { asked, removal, fails }
}

/** The device refuses the reading of its notes that is `nth` from now, once, and answers every other. */
function refuseRead(nth = 1) {
  const getItem = jest.mocked(AsyncStorage.getItem)
  const answered = getItem.getMockImplementation() ?? (() => Promise.resolve(null))
  for (let before = 1; before < nth; before += 1) getItem.mockImplementationOnce(answered)
  getItem.mockRejectedValueOnce(new Error('the storage could not be read'))
}

beforeEach(async () => {
  await AsyncStorage.clear()
})

describe('a replica’s names', () => {
  it('are its member’s and its household’s both, whatever case either id was written in', () => {
    const name = replicaDatabase(member.toUpperCase(), home.toUpperCase())
    expect(name).toBe(`household.${member}.${home}.db`)
    // Two members' copies of one household are two files, and one member's of two.
    expect(replicaDatabase(other, home)).not.toBe(name)
    expect(replicaDatabase(member, second)).not.toBe(name)
    // One file name, with no folder in it: the SDK is handed a name, and no path.
    expect(name).not.toMatch(/[/\\]/)
    expect(replicaFiles(member.toUpperCase(), home)).toEqual(['replicas', member, home])
  })
})

describe('a replica that is opened', () => {
  it('is noted first, once, and may be opened', async () => {
    const { removal, asked } = removing()
    expect(await claimReplica(member, home, removal)).toBe(true)
    expect(await claimReplica(member.toUpperCase(), home, removal)).toBe(true)
    expect(await keptReplicas()).toEqual([{ member, household: home }])
    expect(asked).toEqual([])
  })

  it('is not opened where the device would not keep its note: nothing would ever remove it', async () => {
    const { removal } = removing()
    jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('database or disk is full'))
    expect(await claimReplica(member, home, removal)).toBe(false)
    expect(await keptReplicas()).toEqual([])
    // Asked again once the device keeps what it is told, it is noted, and may be opened.
    expect(await claimReplica(member, home, removal)).toBe(true)
    expect(await keptReplicas()).toEqual([{ member, household: home }])
  })

  it('is opened where it is noted already, with nothing written: a device that writes nothing now shuts no replica it has the note of', async () => {
    const { removal } = removing()
    await claimReplica(member, home, removal)
    const written = jest.mocked(AsyncStorage.setItem).mock.calls.length
    expect(await claimReplica(member, home, removal)).toBe(true)
    expect(jest.mocked(AsyncStorage.setItem).mock.calls).toHaveLength(written)
  })
})

describe('a sign-in that ended', () => {
  it('marks every replica of its member as leaving, and nobody else’s', async () => {
    const { removal } = removing()
    await claimReplica(member, home, removal)
    await claimReplica(member, second, removal)
    await claimReplica(other, home, removal)
    await markLeaving(member.toUpperCase())
    expect(await keptReplicas()).toEqual([
      { member, household: home, leaving: true },
      { member, household: second, leaving: true },
      { member: other, household: home },
    ])
  })

  it('has each emptied and then deleted, and forgets it once both are done', async () => {
    const { removal, asked } = removing()
    await claimReplica(member, home, removal)
    await claimReplica(other, home, removal)
    await markLeaving(member)
    await removeLeft(removal)
    expect(asked).toEqual([`empty:${member}/${home}`, `remove:${member}/${home}`])
    expect(await keptReplicas()).toEqual([{ member: other, household: home }])
    // And nothing is left to say of a device that keeps none.
    await markLeaving(other)
    await removeLeft(removal)
    expect(await AsyncStorage.getAllKeys()).toEqual([])
  })

  it('deletes what could not be emptied all the same, and forgets it once its file is gone', async () => {
    // A wipe that fails may fail at every start, on a device with no room left or over a file
    // that is damaged: the rows are not kept for good for want of it.
    const { removal, asked } = removing({ empty: true })
    await claimReplica(member, home, removal)
    await markLeaving(member)
    await removeLeft(removal)
    expect(asked).toEqual([`empty:${member}/${home}`, `remove:${member}/${home}`])
    expect(await keptReplicas()).toEqual([])
  })

  it('keeps what could be neither emptied nor deleted as leaving, and takes it up at the next start', async () => {
    const first = removing({ empty: true, remove: true })
    await claimReplica(member, home, first.removal)
    await markLeaving(member)
    await removeLeft(first.removal)
    expect(first.asked).toEqual([`empty:${member}/${home}`, `remove:${member}/${home}`])
    // Not noted as emptied: nothing says its file holds nothing.
    expect(await keptReplicas()).toEqual([{ member, household: home, leaving: true }])

    const next = removing()
    await removeLeft(next.removal)
    expect(next.asked).toEqual([`empty:${member}/${home}`, `remove:${member}/${home}`])
    expect(await keptReplicas()).toEqual([])
  })

  it('keeps a file that could not be deleted as emptied, and only deletes it the next time', async () => {
    const first = removing({ remove: true })
    await claimReplica(member, home, first.removal)
    await markLeaving(member)
    await removeLeft(first.removal)
    expect(await keptReplicas()).toEqual([
      { member, household: home, leaving: true, emptied: true },
    ])

    const next = removing()
    await removeLeft(next.removal)
    // It is emptied once: the second try is the file's alone.
    expect(next.asked).toEqual([`remove:${member}/${home}`])
    expect(await keptReplicas()).toEqual([])
  })

  it('never rejects, whatever a removal throws', async () => {
    const { removal } = removing({ empty: true, remove: true })
    await claimReplica(member, home, removal)
    await markLeaving(member)
    await expect(removeLeft(removal)).resolves.toBeUndefined()
  })
})

describe('a replica its member comes back to', () => {
  it('is removed before it is opened again, and noted anew', async () => {
    const { removal, asked } = removing()
    await claimReplica(member, home, removal)
    await markLeaving(member)
    // Asked before the removal was: the claim does it first.
    expect(await claimReplica(member, home, removal)).toBe(true)
    expect(asked).toEqual([`empty:${member}/${home}`, `remove:${member}/${home}`])
    expect(await keptReplicas()).toEqual([{ member, household: home }])
  })

  it('is theirs to open where it was emptied and only its file could not be deleted', async () => {
    const { removal } = removing({ remove: true })
    await claimReplica(member, home, removal)
    await markLeaving(member)
    expect(await claimReplica(member, home, removal)).toBe(true)
    // An empty file is nobody's leavings: it is the member's again, and no longer to delete.
    expect(await keptReplicas()).toEqual([{ member, household: home }])
  })

  it('is not opened where it could be neither emptied nor deleted: it holds what an ended sign-in left', async () => {
    const { removal } = removing({ empty: true, remove: true })
    await claimReplica(member, home, removal)
    await markLeaving(member)
    expect(await claimReplica(member, home, removal)).toBe(false)
    expect(await keptReplicas()).toEqual([{ member, household: home, leaving: true }])
  })

  it('is theirs to open anew where it could not be emptied and its file was deleted', async () => {
    const { removal } = removing({ empty: true })
    await claimReplica(member, home, removal)
    await markLeaving(member)
    // Nothing of the ended sign-in is left in a file that is gone: the next is made anew.
    expect(await claimReplica(member, home, removal)).toBe(true)
    expect(await keptReplicas()).toEqual([{ member, household: home }])
  })
})

describe('notes the device will not read', () => {
  // Read as no notes, the next one written would be written over these, and a replica with no
  // note is one that nothing marks when its member's sign-in ends.
  const mine = { member, household: home }
  const theirs = { member: other, household: home }

  beforeEach(async () => {
    const { removal } = removing()
    await claimReplica(member, home, removal)
    await claimReplica(other, home, removal)
  })

  it('are written over by no replica that is claimed, which is not opened', async () => {
    const { removal } = removing()
    // Refused as the claim looks for what is leaving, and then as it looks for its own note.
    for (const nth of [1, 2]) {
      refuseRead(nth)
      await expect(claimReplica(member, second, removal)).rejects.toThrow('could not be read')
      expect(await keptReplicas()).toEqual([mine, theirs])
    }
    // Asked again once the device says what it holds, it is noted beside the others.
    expect(await claimReplica(member, second, removal)).toBe(true)
    expect(await keptReplicas()).toEqual([mine, theirs, { member, household: second }])
  })

  it('are written over by no removal: what was removed stays noted as leaving, and the next start goes on', async () => {
    const first = removing()
    await claimReplica(member, second, first.removal)
    await markLeaving(member)
    // Refused as the removal comes back to note what it did to the first of the two.
    refuseRead(2)
    await removeLeft(first.removal)
    // The one after it is removed all the same, and its note with it.
    expect(first.asked).toEqual([
      `empty:${member}/${home}`,
      `remove:${member}/${home}`,
      `empty:${member}/${second}`,
      `remove:${member}/${second}`,
    ])
    expect(await keptReplicas()).toEqual([{ ...mine, leaving: true }, theirs])

    const next = removing()
    await removeLeft(next.removal)
    expect(next.asked).toEqual([`empty:${member}/${home}`, `remove:${member}/${home}`])
    expect(await keptReplicas()).toEqual([theirs])
  })

  it('leave a removal with nothing to do, which still never rejects', async () => {
    const { removal, asked } = removing()
    await markLeaving(member)
    refuseRead()
    await expect(removeLeft(removal)).resolves.toBeUndefined()
    expect(asked).toEqual([])
    expect(await keptReplicas()).toEqual([{ ...mine, leaving: true }, theirs])
  })

  it('mark nothing as leaving, and say so: the next start marks what this one could not', async () => {
    refuseRead()
    await expect(markLeaving(member)).rejects.toThrow('could not be read')
    expect(await keptReplicas()).toEqual([mine, theirs])
    // What is asked after it is done in its turn, as after any other step.
    await markLeaving(member)
    expect(await keptReplicas()).toEqual([{ ...mine, leaving: true }, theirs])
  })

  it('are not said to be nobody’s: whom the device keeps a replica of could not be told', async () => {
    refuseRead()
    await expect(keptReplicas()).rejects.toThrow('could not be read')
    expect(await keptReplicas()).toEqual([mine, theirs])
  })
})

describe('what is asked at once', () => {
  it('is done one step after another: a replica is not noted while its removal is under way', async () => {
    const order: string[] = []
    let emptied: () => void = () => undefined
    const removal: Removal = {
      empty: () =>
        new Promise<void>((resolve) => {
          order.push('emptying')
          emptied = () => {
            order.push('emptied')
            resolve()
          }
        }),
      remove: () => {
        order.push('removed')
        return Promise.resolve()
      },
    }
    await claimReplica(member, home, removing().removal)
    await markLeaving(member)
    const left = removeLeft(removal)
    const claimed = claimReplica(member, home, removal).then((may) => {
      order.push(`claimed:${String(may)}`)
    })
    // The removal has begun, and the claim waits behind it.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(order).toEqual(['emptying'])
    emptied()
    await Promise.all([left, claimed])
    expect(order).toEqual(['emptying', 'emptied', 'removed', 'claimed:true'])
  })

  it('reads a note nobody could have written as no note', async () => {
    await AsyncStorage.setItem('household.replicas', '{"not":"a list"}')
    expect(await keptReplicas()).toEqual([])
    await AsyncStorage.setItem('household.replicas', '[{"member":1},"x",null]')
    expect(await keptReplicas()).toEqual([])
    await AsyncStorage.setItem('household.replicas', 'not json')
    expect(await claimReplica(member, home, removing().removal)).toBe(true)
  })
})
