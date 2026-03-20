#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_NAME="${1:-interactive-architecture-diagram}"
SKILL_DIR="$ROOT_DIR/skills/$SKILL_NAME"
PACKAGE_NAME="${SKILL_NAME}.zip"
OUTPUT_PATH="$ROOT_DIR/$PACKAGE_NAME"

if [ ! -d "$SKILL_DIR" ]; then
  echo "Skill 目录不存在: $SKILL_DIR" >&2
  exit 1
fi

if [ -f "$OUTPUT_PATH" ]; then
  rm -f "$OUTPUT_PATH"
fi

cd "$ROOT_DIR/skills"
zip -r "$OUTPUT_PATH" "$SKILL_NAME" \
  -x "*.git*" \
  -x "*/__pycache__/*" \
  -x "*/__pycache__/" \
  -x "*.pyc" \
  -x "*.pyo" \
  -x "*.DS_Store"

echo "Created: $OUTPUT_PATH"
