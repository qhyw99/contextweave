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

echo "Updating SKILL_VERSION..."
COMMIT_HASH=$(cd "$ROOT_DIR" && git rev-parse --short=7 HEAD 2>/dev/null || echo "unknown")
sed -i "s/const SKILL_VERSION = .*/const SKILL_VERSION = \"$COMMIT_HASH\";/" "$SKILL_DIR/scripts/cw_client.cjs"

BACKEND_CONFIG="$ROOT_DIR/../interleaved-thinking/config.yaml"
if [ -f "$BACKEND_CONFIG" ]; then
  echo "Updating required_skill_version in backend config..."
  sed -i "s/required_skill_version: \".*\"/required_skill_version: \"$COMMIT_HASH\"/" "$BACKEND_CONFIG"
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
