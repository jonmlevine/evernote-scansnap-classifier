#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
private_dir="${1:-$repo_root/private}"

mkdir -p "$private_dir/test"

write_if_missing() {
  local path="$1"
  if [[ -e "$path" ]]; then
    echo "exists: $path"
    return
  fi
  cat > "$path"
  echo "created: $path"
}

write_if_missing "$private_dir/SCANSNAP_CLASSIFICATION_PATTERNS.md" <<'EOF'
# ScanSnap Classification Patterns

This stub reserves the private classification-pattern path. Replace it with the real private submodule contents for local review work.

## UI Correction Log

| Timestamp | Note ID | Original title | Suggested title | Final title | Suggested notebook | Final notebook | Suggested tags | Final tags | Changes | OCR cue |
|---|---|---|---|---|---|---|---|---|---|---|
EOF

write_if_missing "$private_dir/classificationRules.js" <<'EOF'
export const classificationRules = {};

export default classificationRules;
EOF

write_if_missing "$private_dir/test/api.test.js" <<'EOF'
import { test } from "node:test";

test("private API tests are supplied by the private submodule", { skip: true }, () => {});
EOF

write_if_missing "$private_dir/test/model.test.js" <<'EOF'
import { test } from "node:test";

test("private model tests are supplied by the private submodule", { skip: true }, () => {});
EOF

write_if_missing "$private_dir/test/learningStore.test.js" <<'EOF'
import { test } from "node:test";

test("private learning-store tests are supplied by the private submodule", { skip: true }, () => {});
EOF
