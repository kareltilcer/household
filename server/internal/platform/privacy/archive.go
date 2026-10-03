package privacy

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"hash"
	"io"
	"path"
	"strings"
	"time"
	"unicode"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kareltilcer/household/server/internal/platform/access"
	"github.com/kareltilcer/household/server/internal/platform/audit"
	"github.com/kareltilcer/household/server/internal/platform/i18n"
	"github.com/kareltilcer/household/server/internal/platform/module"
	"github.com/kareltilcer/household/server/internal/platform/objectstore"
)

// SchemaVersion is the version of an archive's own layout, which its manifest names (FR-PR2): where
// each module's data, the files and the activity log are. It moves when that layout does; what a
// module's JSON holds moves with the API, whose version the manifest names beside it.
const SchemaVersion = 1

// The entries the platform writes itself, whose names no module's derivative may take.
const (
	manifestName = "manifest.json"
	accountName  = "account.json"
	activityName = "activity-log.csv"
	filesDir     = "files"
)

// Manifest is an archive's manifest.json: what is inside, when it was taken, and the schema version
// (FR-PR2). Entries name every other entry of the archive with its length and its SHA-256, so that
// whoever holds the archive can check it is whole.
type Manifest struct {
	SchemaVersion int       `json:"schema_version"`
	APIVersion    string    `json:"api_version,omitempty"`
	Scope         string    `json:"scope"`
	GeneratedAt   time.Time `json:"generated_at"`
	RequestedBy   uuid.UUID `json:"requested_by"`
	// Households are the households the archive holds a part of: one, at the archive's root, for a
	// household's export, and each the requester belongs to or left within its window, under
	// households/{id}/, for their own.
	Households []ManifestHousehold `json:"households"`
	Entries    []ManifestEntry     `json:"entries"`
	// Missing are the files a module named whose bytes the store no longer holds.
	Missing []string `json:"missing,omitempty"`
}

// ManifestHousehold is one household's part of an archive.
type ManifestHousehold struct {
	ID   uuid.UUID `json:"id"`
	Name string    `json:"name"`
	// Path is where its part is, "" for the archive's root.
	Path string `json:"path"`
	// Scope is how much of it the archive takes (module.ExportScope), and Modules the modules asked
	// for it, the ones the requester may see.
	Scope   module.ExportScope `json:"scope"`
	Modules []string           `json:"modules"`
}

// ManifestEntry is one entry of an archive.
type ManifestEntry struct {
	Path   string `json:"path"`
	Bytes  int64  `json:"bytes"`
	SHA256 string `json:"sha256"`
}

// archive writes an export's ZIP, entry by entry, keeping each entry's length and digest for the
// manifest.
type archive struct {
	zw      *zip.Writer
	now     time.Time
	taken   map[string]bool
	entries []ManifestEntry
	missing []string
	open    *entry
}

// entry is the entry being written.
type entry struct {
	w     io.Writer
	path  string
	bytes int64
	sum   hash.Hash
}

func (e *entry) Write(p []byte) (int, error) {
	n, err := e.w.Write(p)
	e.bytes += int64(n)
	e.sum.Write(p[:n])
	return n, err
}

// newArchive starts an archive on w, with the platform's own entries' names taken at its root.
func newArchive(w io.Writer, now time.Time) *archive {
	return &archive{zw: zip.NewWriter(w), now: now, taken: map[string]bool{key(manifestName): true, key(accountName): true}}
}

// key is p as two names are compared: a file system that folds case holds one of them.
func key(p string) string { return strings.ToLower(p) }

// reserve takes name, a platform entry's, so that no module's entry is given it.
func (a *archive) reserve(name string) { a.taken[key(name)] = true }

// close ends the entry being written, recording it.
func (a *archive) close() {
	if a.open != nil {
		a.entries = append(a.entries, ManifestEntry{Path: a.open.path, Bytes: a.open.bytes, SHA256: hex.EncodeToString(a.open.sum.Sum(nil))})
		a.open = nil
	}
}

// create starts the entry at p, exactly: a platform entry, whose name was reserved. stored keeps its
// bytes as they are, for a file that is compressed already.
func (a *archive) create(p string, stored bool) (io.Writer, error) {
	a.close()
	method := zip.Deflate
	if stored {
		method = zip.Store
	}
	w, err := a.zw.CreateHeader(&zip.FileHeader{Name: p, Method: method, Modified: a.now})
	if err != nil {
		return nil, err
	}
	a.open = &entry{w: w, path: p, sum: sha256.New()}
	return a.open, nil
}

// add starts an entry named after p, a module's: cleaned (clean), and given a suffix when the name
// is taken, as two notes with one title are.
func (a *archive) add(p string, stored bool) (io.Writer, error) {
	p = clean(p)
	ext := path.Ext(p)
	stem := strings.TrimSuffix(p, ext)
	for n := 2; a.taken[key(p)]; n++ {
		p = fmt.Sprintf("%s (%d)%s", stem, n, ext)
	}
	a.taken[key(p)] = true
	return a.create(p, stored)
}

// finish writes the manifest, last, and ends the ZIP.
func (a *archive) finish(m Manifest) error {
	a.close()
	m.Entries, m.Missing = a.entries, a.missing
	if m.Entries == nil {
		m.Entries = []ManifestEntry{}
	}
	w, err := a.zw.CreateHeader(&zip.FileHeader{Name: manifestName, Method: zip.Deflate, Modified: a.now})
	if err != nil {
		return err
	}
	if err := writeJSON(w, m); err != nil {
		return err
	}
	return a.zw.Close()
}

// contents are the archive's top-level names, a directory's with its slash, in the order they were
// first written, the manifest last: what the job says is inside (ExportJob.contents).
func (a *archive) contents() []string {
	var out []string
	seen := map[string]bool{}
	for _, e := range a.entries {
		top, _, nested := strings.Cut(e.Path, "/")
		if nested {
			top += "/"
		}
		if !seen[top] {
			seen[top] = true
			out = append(out, top)
		}
	}
	return append(out, manifestName)
}

// writeJSON writes v to w as indented JSON, which a person opens too.
func writeJSON(w io.Writer, v any) error {
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	enc.SetEscapeHTML(false)
	return enc.Encode(v)
}

// segmentRunes caps one segment of an entry's name.
const segmentRunes = 120

// clean is p as an archive names an entry: its segments, each without the characters a file system
// refuses, without the dots and spaces that end a name on Windows, and never empty, "." or "..", so
// that an entry stays inside the folder the archive is unpacked into whatever a note is titled.
func clean(p string) string {
	var out []string
	for seg := range strings.SplitSeq(strings.ReplaceAll(p, `\`, "/"), "/") {
		seg = strings.Map(func(r rune) rune {
			switch {
			case unicode.IsControl(r), strings.ContainsRune(`<>:"|?*`, r):
				return '_'
			}
			return r
		}, seg)
		seg = strings.TrimRight(strings.TrimSpace(seg), ". ")
		if r := []rune(seg); len(r) > segmentRunes {
			ext := []rune(path.Ext(seg))
			if len(ext) > 16 {
				ext = nil
			}
			// Trimmed again where it was cut, which may be at a dot or a space.
			seg = strings.TrimRight(strings.TrimSpace(string(r[:segmentRunes-len(ext)])), ". ") + string(ext)
		}
		if seg == "" {
			seg = "_"
		}
		out = append(out, seg)
	}
	return strings.Join(out, "/")
}

// pending is a file a module asked for, copied into the archive once its household's transaction
// has ended: a household's files may take an hour to copy, which no transaction should be held for.
type pending struct {
	module string
	entity uuid.UUID
	path   string
}

// part is one module's place in one household's part of an archive: the module.Archive it is handed.
type part struct {
	a      *archive
	prefix string
	module string
	files  *[]pending
	wrote  bool
}

var _ module.Archive = (*part)(nil)

// errTwice is JSON's answer to a module that writes its structured data twice.
var errTwice = errors.New("privacy: a module writes its JSON once per export")

// JSON writes v as <module>.json.
func (p *part) JSON(v any) error {
	if p.wrote {
		return errTwice
	}
	p.wrote = true
	w, err := p.a.create(p.prefix+p.module+".json", false)
	if err != nil {
		return err
	}
	return writeJSON(w, v)
}

// Create starts the derivative named name.
func (p *part) Create(name string) (io.Writer, error) {
	return p.a.add(p.prefix+name, false)
}

// File adds the original of the module's entity at files/<module>/<name>, once the transaction the
// module reads in has ended.
func (p *part) File(entity uuid.UUID, name string) error {
	if strings.Trim(name, "/ ") == "" {
		name = entity.String()
	}
	*p.files = append(*p.files, pending{module: p.module, entity: entity, path: p.prefix + filesDir + "/" + p.module + "/" + name})
	return nil
}

// copyFiles copies each of household's files a module asked for into the archive, as it is: nearly
// every original is compressed already. One whose bytes the store no longer holds is named in the
// manifest and left out, rather than failing every export of its household for good.
func (s *Service) copyFiles(ctx context.Context, a *archive, household uuid.UUID, files []pending) error {
	for _, f := range files {
		body, _, err := s.cfg.Files.Original(ctx, household, f.module, f.entity)
		if errors.Is(err, objectstore.ErrNotFound) {
			a.missing = append(a.missing, clean(f.path))
			continue
		}
		if err != nil {
			return err
		}
		w, err := a.add(f.path, true)
		if err == nil {
			_, err = io.Copy(w, body)
		}
		_ = body.Close()
		if err != nil {
			return err
		}
	}
	return nil
}

// The keys the activity log's rows are rendered with beside each event's own summary: who did a
// thing once their account is gone (FR-PR4), the platform acting on its own, and the summary of an
// event about a private item that is not the reader's (FR-AU4, audit.RedactedKey).
const (
	keyFormerMember = "activity.actor.former_member"
	keySystem       = "activity.actor.system"
)

// activity writes household's activity log as CSV, rendered in locale, as reader would read it on
// screen (FR-PR2, FR-AU4): every event, oldest first, with an event about a private item that is not
// theirs redacted, its summary the generic one and its entity dropped. only, when not nil, keeps the
// events reader caused themself, in the modules it names: what a member's own export takes.
func (s *Service) activity(ctx context.Context, tx pgx.Tx, w io.Writer, household, reader uuid.UUID, locale i18n.Locale, only []string) error {
	out := csv.NewWriter(w)
	out.UseCRLF = true
	if err := out.Write([]string{"occurred_at", "actor", "module", "action", "entity_type", "entity_id", "summary"}); err != nil {
		return err
	}
	rows, err := tx.Query(ctx, `
		SELECT e.occurred_at, e.actor_type::text, e.actor_label, e.module, e.action, coalesce(e.entity_type, ''), e.entity_id,
		  e.summary_key, e.summary_args, e.visibility::text, e.owner_id
		FROM audit_events e
		WHERE e.household_id = $1 AND ($3::text[] IS NULL OR (e.actor_id = $2 AND e.module = ANY ($3)))
		ORDER BY e.occurred_at, e.id`, household, reader, only)
	if err != nil {
		return err
	}
	render := func(key string, args i18n.Args) string {
		text, err := s.cfg.Catalogs.Render(locale, key, args)
		if err != nil {
			// A module whose summary has no message yet still has its event in the log, by its key.
			return key
		}
		return text
	}
	var (
		at                             time.Time
		actorType, mod, action, entity string
		label                          *string
		entityID, owner                *uuid.UUID
		summaryKey, visibility         string
		args                           []byte
	)
	_, err = pgx.ForEachRow(rows, []any{&at, &actorType, &label, &mod, &action, &entity, &entityID, &summaryKey, &args, &visibility, &owner}, func() error {
		actor := ""
		switch {
		case label != nil:
			actor = *label
		case audit.ActorType(actorType) == audit.User:
			actor = render(keyFormerMember, nil)
		default:
			actor = render(keySystem, nil)
		}
		id, summary := "", ""
		if audit.Redacted(audit.Visibility(visibility), owner, reader) {
			entity, summary = "", render(audit.RedactedKey, nil)
		} else {
			// Numbers as they were recorded, not as floats (i18n.Args), as a notification's are read.
			var a i18n.Args
			d := json.NewDecoder(bytes.NewReader(args))
			d.UseNumber()
			if err := d.Decode(&a); err != nil {
				return err
			}
			summary = render(summaryKey, a)
			if entityID != nil {
				id = entityID.String()
			}
		}
		return out.Write([]string{at.UTC().Format(time.RFC3339), actor, mod, action, entity, id, summary})
	})
	if err != nil {
		return err
	}
	out.Flush()
	return out.Error()
}

// visible are the modules of sources whose export a member with levels takes: every one they hold
// at least view on, and the platform's own, which every member reads (PRD modules/17). An export
// leaves out a module its member cannot see (PRD modules/00, absence 8).
func visible(sources []source, platform map[string]bool, levels map[string]access.Level) []string {
	var out []string
	for _, src := range sources {
		if platform[src.name] || levels[src.name] >= access.View {
			out = append(out, src.name)
		}
	}
	return out
}
