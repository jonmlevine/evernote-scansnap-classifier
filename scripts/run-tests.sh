#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

test_files=(test/*.test.js)

if compgen -G "private/test/*.test.js" > /dev/null; then
  test_files+=(private/test/*.test.js)
fi

node --test "${test_files[@]}"
