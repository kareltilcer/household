package files

import (
	"context"
	"io"

	"github.com/google/uuid"
)

// Original opens the original of module's entity in household, as the store holds it, for an export
// to copy into its archive (FR-PR2), and returns its length: objectstore.ErrNotFound for an entity
// that keeps none. Whether the export's requester may read the entity is its module's to decide, as
// it decides what it exports; the caller closes what it is handed.
func (s *Service) Original(ctx context.Context, household uuid.UUID, module string, entity uuid.UUID) (io.ReadCloser, int64, error) {
	body, info, err := s.store.Get(ctx, Key(household, module, entity, Original))
	if err != nil {
		return nil, 0, err
	}
	return body, info.Size, nil
}

// Erase removes every object under household's prefix, h/{household_id}/, every module's originals
// and their variants (FR-PR6, PRD 01 §8), and returns how many: an erased household's, whose rows are
// gone already. It is run again on the nights after, for the bytes an upload in flight put after the
// first pass, which no row records and whose household the sweep no longer lists.
func (s *Service) Erase(ctx context.Context, household uuid.UUID) (int, error) {
	return s.store.RemoveAll(ctx, "h/"+household.String()+"/")
}
