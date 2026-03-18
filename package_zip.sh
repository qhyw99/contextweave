#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$ROOT_DIR/contextweave-diagrams"
PACKAGE_NAME="${1:-contextweave-diagrams.zip}"
OUTPUT_PATH="$ROOT_DIR/$PACKAGE_NAME"

if [ ! -d "$SKILL_DIR" ]; then
  echo "Skill 目录不存在: $SKILL_DIR" >&2
  exit 1
fi

if [ -f "$OUTPUT_PATH" ]; then
  rm -f "$OUTPUT_PATH"
fi

cd "$ROOT_DIR"
zip -r "$OUTPUT_PATH" "contextweave-diagrams" \
  -x "*.git*" \
  -x "*/__pycache__/*" \
  -x "*/__pycache__/" \
  -x "*.pyc" \
  -x "*.pyo" \
  -x "*.DS_Store"

echo "Created: $OUTPUT_PATH"
