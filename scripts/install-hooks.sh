#!/usr/bin/env bash
# Install Obsilo git hooks.
# Currently installs: pre-commit (consistency-check Mode A + Mode C launch).
#
# Hooks live in scripts/hooks/ and are symlinked into .git/hooks/.
# Symlink approach keeps hooks under version control while git
# requires them in .git/hooks/.

set -euo pipefail
ROOT=$(git rev-parse --show-toplevel)
SRC="$ROOT/scripts/hooks"
DST="$ROOT/.git/hooks"

mkdir -p "$DST"

for hook in pre-commit; do
    src="$SRC/$hook"
    dst="$DST/$hook"
    if [ ! -f "$src" ]; then
        echo "[install-hooks] missing source: $src"
        continue
    fi
    chmod +x "$src"
    if [ -e "$dst" ] || [ -L "$dst" ]; then
        if [ -L "$dst" ] && [ "$(readlink "$dst")" = "$src" ]; then
            echo "[install-hooks] $hook already linked, ok"
            continue
        fi
        echo "[install-hooks] backing up existing $hook to $hook.bak"
        mv "$dst" "$dst.bak"
    fi
    ln -s "$src" "$dst"
    echo "[install-hooks] linked $hook -> $src"
done

echo
echo "Hooks installed. Bypass any single commit with: git commit --no-verify"
