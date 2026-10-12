#!/usr/bin/env bash
# Installs the Maestro the flows are written for (PL-3), for CI's two device jobs and for a
# developer on macOS or Linux: `bash e2e/install-maestro.sh [folder]`. This is the one place
# its version is written.
#
# It fetches the release's own archive and holds it to the digest GitHub publishes beside it,
# where Maestro's documented installer (`curl ... get.maestro.mobile.dev | bash`) runs whatever
# that address serves on the day: every action of the workflow is pinned by its commit, and
# this is pinned by its bytes. To move it, read the new release's digest:
#   gh api repos/mobile-dev-inc/Maestro/releases/tags/cli-<version> \
#     --jq '.assets[] | select(.name == "maestro.zip") | .digest'
#
# It needs a Java of 17 or later on PATH, which both runners have, and unpacks to
# <folder>/maestro: the runner's temporary folder in CI, where it also puts `maestro` on the
# PATH of the steps after it.
set -euo pipefail

version=2.11.0
sha256=5384593cb4e7a106489e75a821d157dd43f4e438df6bc308b72e82c685e1283a

into="${1:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}}"
archive="$into/maestro-$version.zip"

curl --fail --silent --show-error --location --output "$archive" \
  "https://github.com/mobile-dev-inc/Maestro/releases/download/cli-$version/maestro.zip"
# shasum is on both runners; sha256sum is not on macOS.
echo "$sha256  $archive" | shasum --algorithm 256 --check
rm -rf "$into/maestro"
unzip -q "$archive" -d "$into"
rm "$archive"

if [ -n "${GITHUB_PATH:-}" ]; then
  echo "$into/maestro/bin" >> "$GITHUB_PATH"
fi
"$into/maestro/bin/maestro" --version
