package db

// The advisory lock keys the server takes, every one of them, declared here alone so that no two are
// the same lock by accident: a key that two packages each chose would make each wait on the other,
// as the scheduler's lead, held for as long as an instance leads, would hold up every bootstrap and
// every test run that took the catalog's (TestAdvisoryLocksDiffer). PostgreSQL keeps a lock on one
// bigint key apart from a lock on two integer keys, so the two forms are two spaces of keys; within
// one, two keys alike are one lock. An advisory lock is scoped to the database of the session that
// takes it, so it serialises only sessions connected to the same database.

// The one-key locks, each spelling eight letters.
const (
	// CatalogLock serialises changes to the three roles and to the databases they own. CreateRoles
	// and PrepareDatabase hold it for their transaction; the tests hold it while they create and drop
	// databases. PostgreSQL does not queue these behind one another: two ALTER ROLEs on one role, or
	// an ALTER ROLE beside a CREATE or DROP DATABASE, fail with "tuple concurrently updated". Every
	// administrator connection that alters roles connects to one database: the database of
	// HOUSEHOLD_ADMIN_DATABASE_URL, and in the tests the maintenance database
	// HOUSEHOLD_TEST_DATABASE_URL names.
	CatalogLock int64 = 0x686f7573_65686f6c // "househol"
	// ReferenceLock serialises the reference data's loads, so that two instances deploying at once
	// apply one load after the other rather than racing to insert the same rows (reference.Load).
	ReferenceLock int64 = 0x72656665_72656e63 // "referenc"
	// SchedulerLock is the scheduler's lead, which its leader holds on a session of its own for as
	// long as it leads (scheduler): each database has a leader of its own.
	SchedulerLock int64 = 0x73636865_64756c65 // "schedule"
)

// The namespaces of the two-key locks, their first key, each spelling four letters; the second is a
// hash of what the lock is on.
const (
	// InvariantLock serialises the creates of one series (push), whose hash is the second key.
	InvariantLock int32 = 0x696e7672 // "invr"
	// CoalesceLock serialises queueing a recipient's repeats under one coalescing key (notify.Queue);
	// the second key is the hash of the household, the recipient and the key.
	CoalesceLock int32 = 0x6e746679 // "ntfy"
	// PushTargetLock serialises registering a push target where one registration replaces or clears
	// another: a web session's browser subscription, and the installations that hold one Expo token
	// (notify); the second key is the hash of the session or of the token.
	PushTargetLock int32 = 0x70757368 // "push"
	// OwnerLock serialises the households one user creates, so that two at once count each other
	// against the households a user may own (fair use, PRD 04 §5); the second key is the user's hash.
	OwnerLock int32 = 0x6f776e72 // "ownr"
)
