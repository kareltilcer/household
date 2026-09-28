package repo_test

import (
	"strings"
	"testing"

	"github.com/kareltilcer/household/server/internal/platform/repo"
)

func TestReadFileReadsFromTheRoot(t *testing.T) {
	b, err := repo.ReadFile("pnpm-workspace.yaml")
	if err != nil || !strings.Contains(string(b), "packages:") {
		t.Fatalf("got %q, %v", b, err)
	}
}

func TestReadFileStaysInsideTheRepository(t *testing.T) {
	if _, err := repo.ReadFile("../outside.txt"); err == nil {
		t.Fatal("read a file above the root")
	}
}
