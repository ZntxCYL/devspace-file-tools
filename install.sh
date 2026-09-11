#!/bin/bash
set -euo pipefail

REPO="ZntxCYL/devspace-file-tools"
REF="${DEVSPACE_FILE_TOOLS_REF:-main}"
RAW_BASE="${DEVSPACE_FILE_TOOLS_RAW_BASE:-https://raw.githubusercontent.com/$REPO/$REF}"
PATCH=""
TEMP_PATCH=""

cleanup() {
  if [ -n "$TEMP_PATCH" ] && [ -f "$TEMP_PATCH" ]; then
    rm -f "$TEMP_PATCH"
  fi
}
trap cleanup EXIT

SCRIPT_PATH="${BASH_SOURCE[0]:-}"
if [ -n "$SCRIPT_PATH" ] && [ -f "$SCRIPT_PATH" ]; then
  SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"
  if [ -f "$SCRIPT_DIR/patch.mjs" ]; then
    PATCH="$SCRIPT_DIR/patch.mjs"
  fi
fi

if [ -z "$PATCH" ]; then
  TEMP_PATCH="$(mktemp "${TMPDIR:-/tmp}/devspace-file-tools.XXXXXX.mjs")"
  PATCH_URL="$RAW_BASE/patch.mjs"
  echo "[devspace-file-tools] downloading patch: $PATCH_URL"

  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$PATCH_URL" -o "$TEMP_PATCH"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$TEMP_PATCH" "$PATCH_URL"
  else
    echo "[devspace-file-tools] curl or wget is required for one-line installation" >&2
    exit 1
  fi

  PATCH="$TEMP_PATCH"
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[devspace-file-tools] node not found in PATH" >&2
  exit 1
fi

find_devspace_root() {
  local candidate

  if [ -n "${DEVSPACE_PACKAGE_ROOT:-}" ]; then
    candidate="$DEVSPACE_PACKAGE_ROOT"
    if [ -f "$candidate/package.json" ] && [ -f "$candidate/dist/server.js" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
    echo "[devspace-file-tools] invalid DEVSPACE_PACKAGE_ROOT: $candidate" >&2
    return 1
  fi

  for candidate in \
    "$PWD/node_modules/@waishnav/devspace" \
    "$HOME/.local/share/devspace-kit/node_modules/@waishnav/devspace"
  do
    if [ -f "$candidate/package.json" ] && [ -f "$candidate/dist/server.js" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  if command -v npm >/dev/null 2>&1; then
    candidate="$(npm root -g 2>/dev/null)/@waishnav/devspace"
    if [ -f "$candidate/package.json" ] && [ -f "$candidate/dist/server.js" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  fi

  return 1
}

PACKAGE_ROOT="$(find_devspace_root || true)"
if [ -z "$PACKAGE_ROOT" ]; then
  echo "[devspace-file-tools] could not find @waishnav/devspace" >&2
  echo "Set DEVSPACE_PACKAGE_ROOT=/path/to/node_modules/@waishnav/devspace and retry." >&2
  exit 1
fi

VERSION="$(node -p "require(process.argv[1]).version" "$PACKAGE_ROOT/package.json")"
echo "[devspace-file-tools] DevSpace root: $PACKAGE_ROOT"
echo "[devspace-file-tools] DevSpace version: $VERSION"

DEVSPACE_PACKAGE_ROOT="$PACKAGE_ROOT" node "$PATCH"

echo "[devspace-file-tools] done"
echo "Restart DevSpace and reconnect the MCP client to refresh its tool list."
