#!/usr/bin/env bash
# Makes a project with @zodiaceco/create (built: `bun run build` in create/)
# and runs the CLI on it under one runtime, with the SDK installed from a
# packed release: pull the contracts, type-check, and compare what a push
# would send with the snapshot.
#
#   scripts/check-runtime.sh <node|bun> <packed .tgz> [--update]
#
# `--update` rewrites the snapshot instead of comparing with it.
set -euo pipefail

runtime=$1
case $runtime in
  node | bun) ;;
  *)
    echo "unknown runtime: $runtime" >&2
    exit 1
    ;;
esac
tarball=$(cd "$(dirname "$2")" && pwd)/$(basename "$2")
update=${3:-}

root=$(cd "$(dirname "$0")/.." && pwd)
snapshot=$root/test/constellation-template.specification.json

workdir=$(mktemp -d)
trap 'rm -rf "$workdir"' EXIT
project=$workdir/project

$runtime "$root/create/dist/index.mjs" "$project" --yes --no-install --no-git
cd "$project"

case $runtime in
  node)
    npm install --silent --no-audit --no-fund "$tarball" typescript@5
    zodiac() { npx --no-install zodiac "$@"; }
    tsc() { npx --no-install tsc "$@"; }
    ;;
  bun)
    # `file:`, or Bun takes the published release of the same version.
    bun add --silent "@zodiaceco/sdk@file:$tarball" typescript@5
    # `--bun`, or the CLI's `node` shebang has Node run it.
    zodiac() { bun run --bun zodiac "$@"; }
    tsc() { bun run --bun tsc "$@"; }
    ;;
esac

zodiac pull-contracts
tsc --noEmit -p .
zodiac push --dry-run > specification.json

if [ "$update" = "--update" ]; then
  cp specification.json "$snapshot"
  echo "Updated $snapshot"
elif ! diff -u "$snapshot" specification.json; then
  echo "What $runtime would push differs from $snapshot." >&2
  exit 1
fi
