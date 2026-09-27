package pets

// store is not the tenant package: a method of its own that shares the name is no violation.
type store struct{}

func (store) InWriteTx() {}

var tenant store

func save() { tenant.InWriteTx() }
