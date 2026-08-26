#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js was not found. Install it first, or follow https://skillhub.cn/install/skillhub.md." >&2
  exit 1
fi

exec node "$script_dir/update_skill.cjs" "$@"
