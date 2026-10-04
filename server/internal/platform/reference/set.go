package reference

import (
	"context"
	"fmt"
	"regexp"
	"strings"

	"github.com/jackc/pgx/v5"
)

// Set is one module's reference data: the datasets it keeps in a directory of its own in
// reference-data, named for it (ADR 0008, ADR 0022). The pipeline is the platform's: the fields
// with their sources, the languages, the review flags and the versions. What a set's records are
// is its module's, which declares the set through module.ReferenceSource, and Read and Load take
// the registry's sets beside the platform's own data.
//
// A set's fields cite the sources <Name>/sources.json lists, which Read holds to the schema of
// the platform's own list; the sources of one set are not another's.
type Set struct {
	// Name is the set's and its directory's, and the module's: garden.
	Name string
	// Schemas are the schemas the set's files are held to, each a file of schemas/. Its Reader
	// decodes against these and no other set's.
	Schemas []string
	// Read reads the set's files through r, Files and Decode, and checks what a schema cannot see,
	// recording each problem with r. r reads the set's own directory and nothing outside it, and
	// a file there that Read does not decode is a problem of its own. It returns what it read,
	// which Data.Sets keeps under the set's name and Load hands to the set's Load.
	Read func(r *Reader) any
	// Load writes what Read returned into the set's tables, in the load's transaction, and reports
	// what it did to each of its datasets, whose names begin with the set's: garden_crops. It
	// writes through Upsert and settles each dataset with Finish, so that a row's version and its
	// dataset's move only when a value changed and no row is ever deleted. It is nil while a set
	// has no tables: its files are then checked and nothing of it is written.
	Load func(ctx context.Context, tx pgx.Tx, data any) ([]Report, error)
}

// setName is the form a set's name takes: a module id's (PRD modules/00 §1).
var setName = regexp.MustCompile(`^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$`)

// checkSets refuses sets Read could not tell apart or read at all: one without a name a
// directory can carry or without a Read, two of one name, and one named for a directory of the
// platform's own data.
func checkSets(sets []Set) error {
	seen := map[string]bool{schemasDir: true, countriesDir: true, unitsDir: true}
	for _, set := range sets {
		switch {
		case !setName.MatchString(set.Name):
			return fmt.Errorf("reference data: %q is not a set's name: lowercase words joined by underscores", set.Name)
		case seen[set.Name]:
			return fmt.Errorf("reference data: two sets are named %s, or it is a directory of the platform's own", set.Name)
		case set.Read == nil:
			return fmt.Errorf("reference data: the set %s has no Read", set.Name)
		}
		seen[set.Name] = true
	}
	return nil
}

// loadSet runs a set's Load on what its Read returned, and holds each report to the set's name.
func loadSet(ctx context.Context, tx pgx.Tx, set Set, data any) ([]Report, error) {
	reports, err := set.Load(ctx, tx, data)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", set.Name, err)
	}
	for _, r := range reports {
		if !strings.HasPrefix(r.Dataset, set.Name+"_") {
			return nil, fmt.Errorf("%s: its dataset %q is not named %s_<dataset>", set.Name, r.Dataset, set.Name)
		}
	}
	return reports, nil
}
