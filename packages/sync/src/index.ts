/**
 * @household/sync — the sync client over PowerSync's SDKs (D-93, ADR 0001, ADR 0019): a replica of
 * one household, its schema generated from the server's entity registry, the connector that pushes its
 * mutation queue, what the server answered and what the member must see, its report of itself, and the
 * files it uploads apart. The SDK differs per client (06-clients §1): `@household/sync/node`,
 * `@household/sync/web` and `@household/sync/native` open a replica on each; this module is what they
 * share. The conformance suite drives it, in `conformance/`.
 */
export {
  Attachments,
  drain,
  type AttachmentFile,
  type AttachmentOptions,
  type PendingAttachment,
  type UploadTransport,
} from './attachments.ts'
export { ChecksumWatch } from './checksums.ts'
export {
  Connector,
  RateLimited,
  Revoked,
  inProgressWindowMs,
  locate,
  retryAfterMs,
  rowKey,
  type Attempt,
  type ConnectorOptions,
  type Credential,
  type Held,
  type HoldReason,
  type Journal,
  type Observer,
  type QueuedBatch,
  type Rebase,
  type RebaseEntry,
  type Surface,
  type UploadQueue,
} from './connector.ts'
export {
  Digest,
  algorithm,
  entries,
  pairHash,
  type DigestEntry,
  type ReplicaDigest,
  type ReplicaDigestVerdict,
} from './digest.ts'
export { LocalJournal, type RecordedOutcome } from './journal.ts'
export {
  decodeMetadata,
  encodeMetadata,
  ends,
  isEntitlement,
  overridden,
  serverColumns,
  terminal,
  toMutation,
  toSent,
  toStored,
  type Outcome,
  type QueuedWrite,
  type SyncMutation,
  type SyncMutationBatchResult,
  type SyncMutationResult,
  type WriteMetadata,
} from './mutation.ts'
export {
  asRegistry,
  entityOf,
  servedRegistry,
  tableOf,
  type ClientEntity,
  type ClientStream,
  type ClientTable,
  type Kind,
  type Policy,
  type Registry,
} from './registry.ts'
export {
  NeedsConnection,
  Replica,
  type ReplicaOptions,
  type RowState,
  type Write,
} from './replica.ts'
export { localTables, metaKeys, schemaOf } from './schema.ts'
export { hex64, utf8, xxh3 } from './xxh3.ts'
