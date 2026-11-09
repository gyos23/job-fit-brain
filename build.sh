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

# Chrome rejects background.scripts in MV3 and Firefox rejects background.service_worker, so ship one manifest each.
echo "Packaging extension..."
FILES="rules.json rules.js engine.js content.js overlay.css popup.html popup.js background.js icons"
rm -rf dist/firefox job-fit-overlay.zip job-fit-overlay.xpi
mkdir -p dist/firefox
cp -RL $FILES dist/firefox/
node -e "const m=require('./manifest.json');delete m.key;m.background={scripts:['background.js']};require('fs').writeFileSync('dist/firefox/manifest.json',JSON.stringify(m,null,2))"
zip -q -r job-fit-overlay.zip manifest.json $FILES -x "*.DS_Store"
(cd dist/firefox && zip -q -r ../../job-fit-overlay.xpi . -x "*.DS_Store")

echo "✓ Build complete: job-fit-overlay.zip (Chrome), job-fit-overlay.xpi and dist/firefox/ (Firefox/Zen)."
