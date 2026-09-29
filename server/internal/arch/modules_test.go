package arch_test

import (
	"slices"
	"testing"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/jackc/pgx/v5"

	apispec "github.com/kareltilcer/household/docs/api"
	"github.com/kareltilcer/household/server/internal/platform/household"
)

// The module ids are the contract's (PRD modules/00 §6): the modules table, which enablement
// and grants reference, holds exactly the members of ModuleKeyValue, every module the server
// registers is one of them, the platform's own among them, and the household surface enables and
// grants them all, in the contract's order.
func TestModuleIDsAreTheContracts(t *testing.T) {
	doc, err := openapi3.NewLoader().LoadFromData(apispec.OpenAPI)
	if err != nil {
		t.Fatal(err)
	}
	schema := doc.Components.Schemas["ModuleKeyValue"]
	if schema == nil || schema.Value == nil {
		t.Fatal("the contract has no ModuleKeyValue schema")
	}
	var contract []string
	for _, v := range schema.Value.Enum {
		s, ok := v.(string)
		if !ok {
			t.Fatalf("ModuleKeyValue holds %v, which is not a string", v)
		}
		contract = append(contract, s)
	}

	tx := adminTx(t)
	rows, err := tx.Query(t.Context(), "SELECT id FROM modules")
	if err != nil {
		t.Fatal(err)
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		t.Fatal(err)
	}
	if !equalSets(ids, contract) {
		t.Errorf("the modules table holds %v; the contract's ModuleKeyValue is %v", ids, contract)
	}
	for _, m := range registry(t).All() {
		if !slices.Contains(contract, m.Name()) {
			t.Errorf("module %s is registered, but the contract's ModuleKeyValue does not name it", m.Name())
		}
	}
	for _, p := range registry(t).Platform() {
		if !slices.Contains(contract, p.Name) {
			t.Errorf("the platform serves module %s, but the contract's ModuleKeyValue does not name it", p.Name)
		}
	}
	if !slices.Equal(household.Modules, contract) {
		t.Errorf("the household surface serves %v; the contract's ModuleKeyValue is %v", household.Modules, contract)
	}
}

func equalSets(a, b []string) bool {
	a, b = slices.Clone(a), slices.Clone(b)
	slices.Sort(a)
	slices.Sort(b)
	return slices.Equal(a, b)
}
