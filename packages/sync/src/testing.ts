// A small registry for the library's own tests: an item of every merge policy the tests need, a note
// with its redacted projection, and a read-only entity.

import { asRegistry } from './registry.ts'

const base = {
  household_id: 'uuid',
  version: 'integer',
  created_by: 'uuid',
  created_at: 'timestamp',
  updated_by: 'uuid',
  updated_at: 'timestamp',
  deleted_at: 'timestamp',
} as const

export const testRegistry = asRegistry({
  description: 'The library tests’ registry.',
  streams: [
    { stream: 'items', entity: 'test.item', table: 'items' },
    { stream: 'checks', entity: 'test.check', table: 'checks' },
    { stream: 'notes_shared', entity: 'test.note', table: 'notes' },
    { stream: 'notes_redacted', entity: 'test.note', table: 'notes_redacted' },
    { stream: 'budgets', entity: 'test.budget', table: 'budgets' },
    { stream: 'settings', entity: 'test.setting', table: 'settings' },
    { stream: 'module_enablement', entity: 'admin.module_enablement', table: 'module_enablement' },
  ],
  entities: {
    'test.item': { module: 'test', table: 'items', policy: 'lww_field', offline_writes: true },
    'test.check': { module: 'test', table: 'checks', policy: 'state_set', offline_writes: true },
    'test.note': {
      module: 'test',
      table: 'notes',
      redacted: 'notes_redacted',
      policy: 'lww_row',
      offline_writes: true,
    },
    'test.budget': {
      module: 'test',
      table: 'budgets',
      policy: 'strict_version',
      offline_writes: true,
    },
    'test.setting': {
      module: 'test',
      table: 'settings',
      policy: 'strict_version',
      offline_writes: false,
    },
    'admin.module_enablement': {
      module: 'admin',
      table: 'module_enablement',
      policy: 'strict_version',
      offline_writes: false,
    },
  },
  tables: {
    items: {
      entity: 'test.item',
      redacted: false,
      columns: { ...base, title: 'text', quantity: 'integer', tags: 'text[]', meta: 'json' },
    },
    checks: {
      entity: 'test.check',
      redacted: false,
      columns: { ...base, item_id: 'uuid', checked: 'boolean', checked_at: 'timestamp' },
    },
    notes: {
      entity: 'test.note',
      redacted: false,
      columns: { ...base, visibility: 'text', owner_id: 'uuid', title: 'text' },
    },
    notes_redacted: {
      entity: 'test.note',
      redacted: true,
      columns: { household_id: 'uuid', owner_id: 'uuid', version: 'integer' },
    },
    budgets: {
      entity: 'test.budget',
      redacted: false,
      columns: { ...base, name: 'text', amount_minor: 'integer', currency: 'text' },
    },
    settings: { entity: 'test.setting', redacted: false, columns: { ...base, name: 'text' } },
    module_enablement: {
      entity: 'admin.module_enablement',
      redacted: false,
      columns: { ...base, module: 'text', enabled: 'boolean' },
    },
  },
})
