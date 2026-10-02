# 15 — Chat

## What it is

Messaging inside the household: one room everybody is in, plus any number of created groups.
Carried from `home` v10/v10.1 essentially unchanged in behaviour.

**Scoped to a single household, always.** No cross-household messaging, no discovery, no public
rooms, no contact with anyone outside. This is a product decision with a compliance consequence:
it keeps Household out of the EU Digital Services Act's "online platform" obligations, and it means
there is no route by which a stranger can contact a child profile. **D-74.**

**The UK Online Safety Act is the one open question against this module**, because Chat is a
user-to-user service and the UK is a launch market (**D-89**). The closed-household design removes
the risk the Act targets, but whether that amounts to a Schedule 1 exemption is for counsel, and it
sits on the Phase 5 checklist. It is flagged here because the answer could mean shipping Chat
disabled in UK households — the only realistic way a launch-market decision reaches into a module.
See [05-privacy-and-compliance.md](../05-privacy-and-compliance.md) §11.

**Why it survives when every family has WhatsApp:** because the message that says *"got the milk"*
should be next to the shopping list, and because per-item comments (Tasks, Calendar, Finance) carry
the contextual conversation while Chat carries everything else. It is not trying to replace anyone's
messenger; it is the household's channel inside the household's app.

## Functional requirements

**FR-CT1 — Conversations.** A `general` conversation is created with the household and contains
every member automatically. Members may create `group` conversations with an explicit member list. A
`direct` conversation is a group of two, presented differently.

**FR-CT2 — Membership and the floor.** A member added to an existing conversation gets an
`effective_from` message id — the **floor** — and sees nothing before it. Carried from `home`: a
member added today should not be handed the household's back catalogue.

**FR-CT3 — Messages.** Send, edit within a window, delete (tombstoned, showing "message deleted").
Plain text with links, mentions and emoji. Replies quote a parent message.

**FR-CT4 — Reactions.** A fixed set of emoji, one chip per emoji under the bubble. The API takes the
**desired state** (`reacted: true|false`) rather than toggling, because the gesture that drives it is
a double tap and a gesture fires twice far more easily than a button does. Carried from `home` D265.

**FR-CT5 — Unread.** Per member per conversation, tracked by a last-read message id. Unread counts
are bounded by the member's floor.

**FR-CT6 — Attachments.** Images, video and files, uploaded through the API with the same sniffing,
size caps and quota enforcement as Documents, stored under the `chat/` prefix, thumbnailed
asynchronously. **They count toward the storage meter**, which is why FR-CT8 exists.

**FR-CT7 — Move to Documents.** An attachment can be moved into Documents — a **custody transfer,
not a copy**: the bytes move to the documents prefix, the chat message keeps a reference, and the
household stops paying for it twice. Carried from `home` v10 FR-V10-14.

**FR-CT8 — Storage clean-up.** A page listing the largest attachments, the oldest, and the total per
conversation, with multi-select delete and multi-select move-to-Documents. Two configurable
thresholds warn when the `chat/` prefix grows. In a metered-storage product, chat video is the line
item that surprises people, and giving them a tool beats sending them a bill.

**FR-CT9 — Realtime.** **The one exception to the nudge-only WebSocket** ([01](../01-architecture.md)
§7): message payloads ride the socket to resolved conversation members, because a pull round-trip is
visible latency in a chat and nowhere else. The frame is marshalled once per audience, never per
recipient. *Under D-93 there is no socket (**D-124**): a message reaches its readers through its stream
on PowerSync's connection, which sends each row as it changes, so no pull round-trip delays it.*

**FR-CT10 — Push.** New messages notify conversation members in the `direct` category, honouring
mutes and quiet hours. A conversation can be muted individually.

**FR-CT11 — Search.** Full-text within conversations the caller is in, language-aware, with the
floor applied. A member cannot search text they cannot read.

**FR-CT12 — Deletion.** A conversation can be soft-deleted to a bin by a member with `manage` and
restored from it; hard deletion purges messages and attachments. The `general` conversation cannot be
deleted.

**FR-CT13 — Refusals are `404`.** A conversation the caller is not in does not exist as far as the
API is concerned. Carried from `home` D217 — a `403` turns a guessed id into an oracle over who talks
to whom.

## Data model

`chat_conversations`, `chat_members`, `chat_messages`, `chat_reactions`, `chat_attachments`,
`chat_reads`. Constraints per `home`: the floor is anchored on a message id rather than a timestamp;
`(message_id, user_id, emoji)` unique on reactions; a conversation's `last_message` presented to a
caller is bounded by that caller's floor and is null when nothing is visible to them.

## Sync

| Entity | Policy | Notes |
|---|---|---|
| `chat.conversation` | `strict_version` | |
| `chat.message` | **`additive`** | The message and its envelope — author, conversation, reply parent, timestamps, tombstone. Appended and never merged |
| `chat.message_body` | `lww_row` | The editable text, split out for the same reason Notes splits `notes.note` from `notes.note_body` ([07-notes.md](07-notes.md)): one entity declares one policy, and an edit within FR-CT3's window is a whole-body replacement that cannot be field-merged honestly. Rare, online-only, and the loser is preserved |
| `chat.reaction` | `state_set` | Key `(message, user, emoji)`, resolution `latest_client_time`. Desired-state semantics — FR-CT4 |
| `chat.read` | `state_set` | Key `(conversation, user)`, resolution **`monotonic`** — a read marker only moves forward, so the merge is a maximum rather than a latest-timestamp. [03](../03-platform-strands.md) §2.5 |
| Attachment bytes | not synced | Metadata and thumbnails sync; originals fetched on demand |

Messages sent offline queue and send on reconnect, ordered, showing a pending state — the behaviour
every messenger has and every user expects.

**The floor is enforced in the feed, not only in the API.** FR-CT2 gives a member added to an
existing conversation an `effective_from` message id and says they see nothing before it. That rule
has to hold on *both* delivery paths or it holds on neither: the membership row therefore also stores
`floor_seq` — the household's `sync_changes.seq` at the moment of joining — and the sync pull
predicate carries a `seq >= floor_seq` term for the row's audience
([03](../03-platform-strands.md) §2.3, **D-90**). Without it, a member added to a group today would
replicate every message in it still inside the 90-day horizon: the back catalogue FR-CT2 exists to
withhold, delivered by the path nobody was looking at. The two floors are written in one transaction
from one event, so they cannot drift.

> **Under D-93 the replicated path is PowerSync's streams, and the floor is not a term of them**,
> because a stream cannot compare a row with a member's floor ([09](../09-decisions.md) D-93). The
> server keeps **readers** on each row the floor bounds instead: the conversation's members whose
> floor its message is at or above. That is the message, and equally its body, its reactions and its
> attachments' metadata, since each is an entity with a stream of its own, and a row resolved
> through the conversation's membership instead would reach every member of it, whatever their
> floor. The write that creates such a row sets them, and a change of membership rewrites them in
> the transaction that makes it, removal from the household included: readers left behind would
> reach a member re-added later with the grant, in conversations they are no longer in. A rewrite
> of the readers alone is not an edit of the row, so a queued or `If-Match` edit to it still
> applies against the version it was made at. A member added with a floor is a reader of nothing
> before it, so FR-CT2's floor holds on the replicated path as well. `floor_seq`, a position in a
> feed nothing now pulls, has no reader under D-93 and is not stored.

## Catalog contributions

Widget `chat.unread`; metrics `chat.unread_total` and `chat.unread_conversations` (both per
recipient); search scope `chat.message`; storage declares its tables and the `chat/` prefix with
per-conversation attribution.

## Permissions

| Operation | Level |
|---|---|
| Read conversations you are in, send, react | `contribute` |
| `view` only | Read-only participation — can read, cannot post. Useful for a supervised child profile |
| Create or delete a conversation, manage its membership | `manage` |
| Hard-delete a conversation | `manage` |

**A `child` is `none` by default** and must be granted deliberately by an owner.

## Non-goals

- **No cross-household messaging, no external contacts, no invitations to non-members.**
- No voice or video calls, no voice messages in 1.0.
- No end-to-end encryption — see [05](../05-privacy-and-compliance.md) §6 for why the product does
  not claim it.
- No message scheduling, no bots, no integrations, no threads beyond a single reply quote.
- No disappearing messages.
