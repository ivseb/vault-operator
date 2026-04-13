#!/bin/bash
# FIX-19: Simulate a BRAT installation to verify self-provisioning.
#
# BRAT only installs main.js, manifest.json, styles.css.
# This script creates a minimal test vault with just those files,
# then opens Obsidian so you can verify:
#   1. Console (Cmd+Option+I): "[AssetProvisioner] Extracted N runtime assets"
#   2. No uncaught exceptions or cascading errors
#   3. Features work: semantic search, sandbox, skills, PPTX templates
#
# Usage: ./scripts/test-brat-install.sh

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TEST_DIR="/tmp/obsilo-brat-test"
VAULT_DIR="$TEST_DIR/TestVault"
PLUGIN_DIR="$VAULT_DIR/.obsidian/plugins/obsilo-agent"

echo "=== BRAT Installation Simulator ==="
echo ""

# Clean up previous test
if [ -d "$TEST_DIR" ]; then
    echo "Cleaning up previous test at $TEST_DIR..."
    rm -rf "$TEST_DIR"
fi

# Create minimal vault structure
mkdir -p "$PLUGIN_DIR"

# Copy ONLY what BRAT would install (3 files)
echo "Copying BRAT-equivalent files (main.js, manifest.json, styles.css)..."
cp "$PROJECT_DIR/main.js" "$PLUGIN_DIR/"
cp "$PROJECT_DIR/manifest.json" "$PLUGIN_DIR/"
cp "$PROJECT_DIR/styles.css" "$PLUGIN_DIR/"

# Show what we have
echo ""
echo "Plugin directory contents (BRAT-only):"
ls -la "$PLUGIN_DIR/"
echo ""
echo "Total size: $(du -sh "$PLUGIN_DIR" | cut -f1)"

# Create minimal Obsidian config to enable the plugin
mkdir -p "$VAULT_DIR/.obsidian"
cat > "$VAULT_DIR/.obsidian/community-plugins.json" << 'EOF'
["obsilo-agent"]
EOF

echo ""
echo "=== Test Vault ready at: $VAULT_DIR ==="
echo ""
echo "Next steps:"
echo "  1. Open Obsidian and switch to vault: $VAULT_DIR"
echo "     Or run: open 'obsidian://open?path=$VAULT_DIR'"
echo "  2. Open Developer Console: Cmd+Option+I"
echo "  3. Look for: '[AssetProvisioner] Extracted N runtime assets'"
echo "  4. Verify NO errors (no ENOENT, no 'not opened', no 'worker not found')"
echo "  5. Test features: semantic search, sandbox code execution, bundled skills"
echo ""
echo "To clean up: rm -rf $TEST_DIR"
echo ""

# Ask if user wants to open Obsidian
read -p "Open Obsidian with test vault now? [y/N] " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    open "obsidian://open?path=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$VAULT_DIR'))")"
    echo "Obsidian opening... check the Developer Console (Cmd+Option+I)"
fi
