#!/usr/bin/env bash
# Builds dist/job-fit-score.zip: the skill plus a snapshot of your brain, for upload to claude.ai
# (Settings > Capabilities > Skills). Claude Code does not need this; setup.sh links the skill live.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
BRAIN="${JOB_FIT_BRAIN:-$HOME/.job-fit-brain}"
[ -f "$BRAIN/rules.json" ] || { echo "No brain at $BRAIN. Run ./setup.sh first." >&2; exit 1; }
STAGE="$(mktemp -d)"; trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/job-fit-score/brain" dist
cp skill/job-fit-score/SKILL.md "$STAGE/job-fit-score/"
cp -L "$BRAIN"/*.md "$BRAIN"/rules.json "$STAGE/job-fit-score/brain/"
rm -f dist/job-fit-score.zip
(cd "$STAGE" && zip -q -r "$OLDPWD/dist/job-fit-score.zip" job-fit-score -x "*.DS_Store")
echo "✓ dist/job-fit-score.zip (snapshot of $BRAIN). Re-run after you edit the brain, then re-upload."
