// Package syncconfig composes PowerSync's sync configurations from the entity registry (plan item
// 13, ADR 0014): the server's, which the PowerSync beside it runs, and the conformance suite's,
// which holds the conformance module's entities too and the stream its negative control subscribes
// to, broken on purpose. cmd/sync-config writes them, go generate runs it, and architecture test 10
// fails a committed file that is not what Files generates.
//
// It is the server's composition, as cmd/household-api is: it imports the module list and the
// conformance module, which the platform may not.
package syncconfig

import (
	"github.com/kareltilcer/household/server/internal/conformance"
	"github.com/kareltilcer/household/server/internal/modules"
	"github.com/kareltilcer/household/server/internal/platform/household"
	"github.com/kareltilcer/household/server/internal/platform/module"
	"github.com/kareltilcer/household/server/internal/platform/sync"
)

// The files Files generates, by their paths from the repository's root.
const (
	// Served is the server's configuration, which deploy/powersync/powersync.yaml loads.
	Served = "deploy/powersync/sync-config.yaml"
	// Suite is the conformance suite's, which its stack's PowerSync loads. Its streams, with their
	// entities and client tables, are in its client registry (SuiteRegistry), which the suite's clients
	// subscribe to.
	Suite = "packages/sync/conformance/stack/powersync/sync-config.yaml"
)

const servedHeader = `PowerSync's sync configuration (ADR 0001, ADR 0014): a stream for each way an entity the server's
modules and the platform declare reaches a member, generated from the entity registry by
server/internal/syncconfig. Do not edit it: ` + "`pnpm run gen`" + ` writes it, and architecture test 10 fails it
when it is not what the registry generates.`

const suiteHeader = `The conformance suite's sync configuration (plan item 13, ADR 0014): the server's streams, the
conformance module's beside them, and one stream broken on purpose that only the suite's negative
control subscribes to. Generated from the entity registry by server/internal/syncconfig. Do not
edit it: ` + "`pnpm run gen`" + ` writes it, and architecture test 10 fails it when it is not what the
registry generates.`

// ServedStreams returns the streams of every entity the server serves: its modules' and admin's.
func ServedStreams() ([]sync.Stream, error) {
	return streams(modules.All()...)
}

// SuiteStreams returns the streams the conformance suite's clients subscribe to: the server's and
// the conformance module's, without the negative control's.
func SuiteStreams() ([]sync.Stream, error) {
	return streams(append(modules.All(), conformance.Module{})...)
}

func streams(mods ...module.Module) ([]sync.Stream, error) {
	registry, err := registryOf(mods...)
	if err != nil {
		return nil, err
	}
	return sync.Streams(registry.Entities())
}

// registryOf returns the registry of mods, with the modules the platform serves itself.
func registryOf(mods ...module.Module) (*module.Registry, error) {
	registry, err := module.NewRegistry(mods...)
	if err != nil {
		return nil, err
	}
	return registry.WithPlatform(household.Admin())
}

// suiteEntities returns every entity the conformance suite's streams send: the server's and the
// conformance module's.
func suiteEntities() ([]sync.Entity, error) {
	registry, err := registryOf(append(modules.All(), conformance.Module{})...)
	if err != nil {
		return nil, err
	}
	return registry.Entities(), nil
}

// Files returns every generated file by its path from the repository's root.
func Files() (map[string][]byte, error) {
	served, err := ServedStreams()
	if err != nil {
		return nil, err
	}
	suite, err := SuiteStreams()
	if err != nil {
		return nil, err
	}
	return map[string][]byte{
		Served: sync.Config(servedHeader, served),
		Suite:  sync.Config(suiteHeader, append(suite, conformance.LeakyStream())),
	}, nil
}
