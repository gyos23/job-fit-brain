#!/usr/bin/env bash
# One command: create your brain from the template, build the extension, register the Claude host,
# link the skill into Claude Code, and verify. Safe to re-run; it never overwrites an existing brain.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
BRAIN="${JOB_FIT_BRAIN:-$HOME/.job-fit-brain}"

if [ ! -d "$BRAIN" ]; then
  cp -R brain-template "$BRAIN"
  echo "✓ Created $BRAIN from the template. EDIT profile.md, rules.json and rubric.md before trusting any score (docs/BRAIN.md)."
else
  echo "✓ Using existing brain at $BRAIN"
fi

echo "$PWD" > "$BRAIN/.repo"
./build.sh
host/install-host.sh "$@"

mkdir -p "$HOME/.claude/skills"
ln -sfn "$PWD/skill/job-fit-score" "$HOME/.claude/skills/job-fit-score"
echo "✓ Linked skill into ~/.claude/skills/job-fit-score"
# The skill reads the brain from ~/.job-fit-brain; only link it when the brain lives elsewhere.
[ "$BRAIN" = "$HOME/.job-fit-brain" ] || echo "  Note: set JOB_FIT_BRAIN=$BRAIN in your shell so Claude Code finds it."

echo
echo "Verify the host (all three brain files must list a path and byte size):"
python3 -c 'import json,struct,sys;m=json.dumps({"action":"ping"}).encode();sys.stdout.buffer.write(struct.pack("@I",len(m))+m)' \
  | JOB_FIT_BRAIN="$BRAIN" host/job_fit_claude_host.py | tail -c +5 | python3 -m json.tool
echo
echo "Next: load the extension (README step 3), then reload it."
