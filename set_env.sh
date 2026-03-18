#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRIVATE_ENV_FILE="${PRIVATE_ENV_FILE:-$SCRIPT_DIR/set_env.private.sh}"

if [ ! -f "$PRIVATE_ENV_FILE" ]; then
  echo "未找到私有配置文件: $PRIVATE_ENV_FILE"
  echo "请复制 $SCRIPT_DIR/set_env.private.example.sh 为 $SCRIPT_DIR/set_env.private.sh 并填写私有值"
  exit 1
fi

set -a
source "$PRIVATE_ENV_FILE"
set +a

if [ -z "${CONTEXTWEAVE_MCP_API_KEY_VALUE:-}" ] || [ -z "${CONTEXTWEAVE_EDITOR_PROTOCOL_VALUE:-}" ]; then
  echo "私有配置文件缺少 CONTEXTWEAVE_MCP_API_KEY_VALUE 或 CONTEXTWEAVE_EDITOR_PROTOCOL_VALUE"
  exit 1
fi

upsert_posix_export() {
  local rc_file="$1"
  local key="$2"
  local value="$3"
  touch "$rc_file"
  if grep -q "^export ${key}=" "$rc_file"; then
    local tmp_file
    tmp_file="$(mktemp)"
    awk -v k="$key" -v v="$value" '
      $0 ~ ("^export " k "=") { print "export " k "=\"" v "\""; next }
      { print }
    ' "$rc_file" > "$tmp_file"
    mv "$tmp_file" "$rc_file"
  else
    printf '\nexport %s="%s"\n' "$key" "$value" >> "$rc_file"
  fi
}

upsert_fish_export() {
  local rc_file="$1"
  local key="$2"
  local value="$3"
  touch "$rc_file"
  if grep -q "^set -gx ${key} " "$rc_file"; then
    local tmp_file
    tmp_file="$(mktemp)"
    awk -v k="$key" -v v="$value" '
      $0 ~ ("^set -gx " k " ") { print "set -gx " k " \"" v "\""; next }
      { print }
    ' "$rc_file" > "$tmp_file"
    mv "$tmp_file" "$rc_file"
  else
    printf '\nset -gx %s "%s"\n' "$key" "$value" >> "$rc_file"
  fi
}

upsert_powershell_export() {
  local rc_file="$1"
  local key="$2"
  local value="$3"
  touch "$rc_file"
  if grep -q "^[[:space:]]*\\\$env:${key}[[:space:]]*=" "$rc_file"; then
    local tmp_file
    tmp_file="$(mktemp)"
    awk -v k="$key" -v v="$value" '
      $0 ~ ("^[[:space:]]*\\$env:" k "[[:space:]]*=") { print "$env:" k " = \"" v "\""; next }
      { print }
    ' "$rc_file" > "$tmp_file"
    mv "$tmp_file" "$rc_file"
  else
    printf '\n$env:%s = "%s"\n' "$key" "$value" >> "$rc_file"
  fi
}

for rc_file in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.bash_profile" "$HOME/.profile"; do
  [ -e "$rc_file" ] || touch "$rc_file"
  upsert_posix_export "$rc_file" "CONTEXTWEAVE_MCP_API_KEY" "$CONTEXTWEAVE_MCP_API_KEY_VALUE"
  upsert_posix_export "$rc_file" "CONTEXTWEAVE_EDITOR_PROTOCOL" "$CONTEXTWEAVE_EDITOR_PROTOCOL_VALUE"
done

fish_rc="$HOME/.config/fish/config.fish"
mkdir -p "$(dirname "$fish_rc")"
upsert_fish_export "$fish_rc" "CONTEXTWEAVE_MCP_API_KEY" "$CONTEXTWEAVE_MCP_API_KEY_VALUE"
upsert_fish_export "$fish_rc" "CONTEXTWEAVE_EDITOR_PROTOCOL" "$CONTEXTWEAVE_EDITOR_PROTOCOL_VALUE"

ps_profile_paths=()
if command -v pwsh >/dev/null 2>&1; then
  p_path="$(pwsh -NoProfile -Command '$PROFILE.CurrentUserAllHosts' 2>/dev/null | tr -d '\r' || true)"
  if [ -n "$p_path" ]; then
    ps_profile_paths+=("$p_path")
  fi
fi
if command -v powershell.exe >/dev/null 2>&1; then
  p_path="$(powershell.exe -NoProfile -Command '$PROFILE.CurrentUserAllHosts' 2>/dev/null | tr -d '\r' || true)"
  if [ -n "$p_path" ]; then
    ps_profile_paths+=("$p_path")
  fi
fi
for rc_file in "${ps_profile_paths[@]}"; do
  mkdir -p "$(dirname "$rc_file")"
  upsert_powershell_export "$rc_file" "CONTEXTWEAVE_MCP_API_KEY" "$CONTEXTWEAVE_MCP_API_KEY_VALUE"
  upsert_powershell_export "$rc_file" "CONTEXTWEAVE_EDITOR_PROTOCOL" "$CONTEXTWEAVE_EDITOR_PROTOCOL_VALUE"
done

export CONTEXTWEAVE_MCP_API_KEY="$CONTEXTWEAVE_MCP_API_KEY_VALUE"
export CONTEXTWEAVE_EDITOR_PROTOCOL="$CONTEXTWEAVE_EDITOR_PROTOCOL_VALUE"

if [[ "${BASH_SOURCE[0]}" != "$0" ]]; then
  echo "已写入 Bash/Zsh/Fish/PowerShell 配置并在当前会话生效"
else
  echo "已写入 Bash/Zsh/Fish/PowerShell 配置。请重开终端后生效"
fi
