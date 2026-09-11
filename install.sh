#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PATCH="$SCRIPT_DIR/patch.mjs"

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
