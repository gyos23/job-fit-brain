#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "=== Verifying Job Fit Overlay ==="

# Sync canonical rules
echo "Syncing rules from your brain (~/.job-fit-brain)..."
node sync-rules.js

# Syntax checks
echo "Checking syntax..."
node --check rules.js
node --check engine.js
node --check content.js
node --check popup.js
node --check background.js
node --check cli.js

# Run tests
echo "Running engine tests..."
node tests/test-engine.js
node tests/test-tracker.js

# Build zip / xpi package
echo "Packaging extension..."
PACKAGE_NAME="job-fit-overlay.zip"
rm -f "$PACKAGE_NAME" job-fit-overlay.xpi
zip -q -r "$PACKAGE_NAME" \
  manifest.json \
  rules.json \
  rules.js \
  engine.js \
  content.js \
  overlay.css \
  popup.html \
  popup.js \
  background.js \
  icons \
  -x "*.DS_Store"

cp "$PACKAGE_NAME" job-fit-overlay.xpi

echo "✓ Build complete: $PACKAGE_NAME and job-fit-overlay.xpi created."
