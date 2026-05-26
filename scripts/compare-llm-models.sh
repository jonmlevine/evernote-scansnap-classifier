#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${SCANSNAP_ENV_FILE:-$HOME/.config/evernote-scansnap-classifier/env}"

if [[ -f "$env_file" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$env_file"
  set +a
fi

export SCANSNAP_LLM_API_BASE="${SCANSNAP_LLM_API_BASE:-http://127.0.0.1:1234/v1}"
export SCANSNAP_LLM_API_KEY="${SCANSNAP_LLM_API_KEY:-lm-studio}"
export SCANSNAP_LLM_COMPARE_MODELS="${SCANSNAP_LLM_COMPARE_MODELS:-qwen-3.6-27b,gemma-4-31b}"

exec node "$repo_root/scripts/compare-llm-models.js" "$@"
