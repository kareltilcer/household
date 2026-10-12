// What the shell's dev screen draws: a household nobody is in, a build with more screens than
// any build has, and the bars a member may have. Its words are English and in no catalog
// (D-154); the page passes them through `useSample`.
import { inHousehold } from '../../app/paths.ts'
import type { Household, ModuleKey } from '../../household/data.ts'
import type { ModuleRegistry } from '../../modules/registry.ts'
import type { Destination } from '../../shell/tabs.ts'

/** A household's id that is one, and is nobody's: a row of the page leads to *not available*. */
const nobodys = '0198c0de-0000-7000-8000-0000000d0001'

export const names = {
  household: 'Tilcerovi',
  other: 'Chata Lipno',
} as const

/** A member who holds four modules, Finance at none, and Chat, which the build below cannot open. */
export const household: Pick<Household, 'id' | 'my_grants'> = {
  id: nobodys,
  my_grants: {
    dashboard: 'view',
    tasks: 'contribute',
    shopping: 'contribute',
    finance: 'none',
    garden: 'manage',
    chat: 'view',
    admin: 'view',
  },
}

const at = (module: ModuleKey) => ({
  home: (id: string) => inHousehold.module(id, module),
})

/** A build with screens for five modules, the household's own settings among them. */
export const registry: ModuleRegistry = {
  tasks: at('tasks'),
  shopping: at('shopping'),
  finance: at('finance'),
  garden: at('garden'),
  admin: at('admin'),
}

export interface Drawing {
  readonly id: string
  /** What the page says of it, in English. */
  readonly title: string
  readonly slots: readonly Destination[]
  /** How many changes wait, which More carries. */
  readonly waiting?: number
}

/** The bar in each drawing a member may have (shell/tabs.ts), and one that carries a count. */
export const drawings: readonly Drawing[] = [
  { id: 'five', title: 'Five slots', slots: ['home', 'today', 'add', 'chat', 'more'] },
  { id: 'no-chat', title: 'Four: no Chat', slots: ['home', 'today', 'add', 'more'] },
  { id: 'no-add', title: 'Four: nothing to add', slots: ['home', 'today', 'chat', 'more'] },
  { id: 'three', title: 'Three: neither', slots: ['home', 'today', 'more'] },
  {
    id: 'counted',
    title: 'Three changes wait',
    slots: ['home', 'today', 'more'],
    waiting: 3,
  },
]

/** The widths the page draws a bar and the panes at: a phone held upright, and a tablet. */
export const widths = { phone: 390, tablet: 834 } as const

export type Width = keyof typeof widths

/** The rows of the panes' list, and what each one opens. */
export const rows = [
  { id: 'cellar', title: 'Cellar meter', detail: 'Read on the first of March: 4 512 kWh.' },
  { id: 'garden', title: 'Garden tap', detail: 'Read on the third of March: 118 m³.' },
  { id: 'attic', title: 'Attic meter', detail: 'Not read yet this year.' },
] as const
