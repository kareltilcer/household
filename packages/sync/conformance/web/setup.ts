// The browser smoke test's household, made in Node before the browser opens: a member who owns it,
// with an item on its list, which the test's replica must find there.
import type { TestProject } from 'vitest/node'
import { Admin } from '../harness/admin.ts'
import { adminDatabaseUrl } from '../harness/env.ts'
import { Rng } from '../harness/rng.ts'

declare module 'vitest' {
  export interface ProvidedContext {
    web: { readonly household: string; readonly member: string; readonly milk: string }
  }
}

export default async function setup(project: TestProject): Promise<void> {
  const admin = new Admin(adminDatabaseUrl)
  try {
    const rng = new Rng(Date.now() % 2 ** 31)
    const member = await admin.member(rng, 'Jana')
    const home = await admin.household(rng, 'Web', [{ member, role: 'owner' }])
    const milk = rng.uuid()
    await admin.insert('conformance_items', home, [{ id: milk, title: 'Milk' }])
    project.provide('web', { household: home.id, member: member.id, milk })
  } finally {
    await admin.close()
  }
}
