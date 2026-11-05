#!/usr/bin/env bash
# One-command setup for "Log to tracker".
#
# Creates (or updates) an Apps Script bound to the job tracker sheet, uploads
# apps-script/Code.gs, deploys it as a web app, and writes
# ~/.job-fit-overlay/tracker.json so the extension finds the URL and token
# through the native host. Safe to re-run: it reuses the same script,
# deployment URL and token.
#
# You click "Allow" on Google's consent screens; nothing else is manual.
set -euo pipefail

SHEET_ID="${1:-${JFO_SHEET_ID:-}}"
[ -n "$SHEET_ID" ] || { echo "Usage: apps-script/setup-tracker.sh <google-sheet-id>   (the long id in the sheet URL)"; exit 1; }
CLASP="npx -y @google/clasp@2.4.2"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="$HOME/.job-fit-overlay"
BUILD_DIR="$STATE_DIR/apps-script"
CONFIG="$STATE_DIR/tracker.json"

mkdir -p "$BUILD_DIR"
chmod 700 "$STATE_DIR"

# Token and deployment id from an earlier run, if any.
TOKEN=""
DEPLOYMENT_ID=""
if [ -f "$CONFIG" ]; then
  TOKEN="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("token",""))' "$CONFIG")"
  DEPLOYMENT_ID="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("deploymentId",""))' "$CONFIG")"
fi
[ -n "$TOKEN" ] || TOKEN="$(openssl rand -hex 24)"

echo "== 1/5 Google sign-in for clasp (Apps Script command line)"
if [ ! -f "$HOME/.clasprc.json" ]; then
  echo "A browser tab will open: sign in as the owner of the tracker sheet and click Allow."
  $CLASP login
fi

echo "== 2/5 Preparing files"
cp "$REPO_DIR/apps-script/Code.gs" "$REPO_DIR/apps-script/appsscript.json" "$BUILD_DIR/"
printf "var JFO_TOKEN_FALLBACK = '%s';\n" "$TOKEN" > "$BUILD_DIR/Token.gs"
cd "$BUILD_DIR"

run_clasp() {
  local out
  if ! out="$($CLASP "$@" 2>&1)"; then
    echo "$out"
    if echo "$out" | grep -qi "Apps Script API"; then
      echo
      echo ">> Turn on the Apps Script API (one toggle), then run this script again:"
      echo "   https://script.google.com/home/usersettings"
      command -v open >/dev/null && open "https://script.google.com/home/usersettings"
    fi
    exit 1
  fi
  echo "$out"
}

echo "== 3/5 Script bound to the tracker sheet"
if [ ! -f .clasp.json ]; then
  run_clasp create --type sheets --title "Job Fit Overlay logger" --parentId "$SHEET_ID" --rootDir .
  # clasp create writes its own appsscript.json; put ours back.
  cp "$REPO_DIR/apps-script/appsscript.json" .
fi

echo "== 4/5 Uploading code and deploying"
run_clasp push -f >/dev/null
if [ -n "$DEPLOYMENT_ID" ]; then
  run_clasp deploy -i "$DEPLOYMENT_ID" -d "job-fit-overlay $(date +%F)" >/dev/null
else
  DEPLOY_OUT="$(run_clasp deploy -d "job-fit-overlay $(date +%F)")"
  DEPLOYMENT_ID="$(echo "$DEPLOY_OUT" | grep -o 'AKfy[A-Za-z0-9_-]*' | head -1)"
fi
[ -n "$DEPLOYMENT_ID" ] || { echo "Could not read the deployment id from clasp."; exit 1; }
URL="https://script.google.com/macros/s/$DEPLOYMENT_ID/exec"

python3 - "$CONFIG" "$URL" "$TOKEN" "$DEPLOYMENT_ID" "https://docs.google.com/spreadsheets/d/$SHEET_ID/edit" <<'EOF'
import json, sys
path, url, token, dep, sheet = sys.argv[1:]
json.dump({"url": url, "token": token, "deploymentId": dep, "sheetUrl": sheet}, open(path, "w"), indent=2)
EOF
chmod 600 "$CONFIG"

echo "== 5/5 Authorising the web app"
is_live() { curl -sSL -m 20 "$URL" 2>/dev/null | grep -q '"service":"job-fit-overlay tracker logger"'; }
if ! is_live; then
  echo "A browser tab will open on the web app. Sign in as the sheet owner, click"
  echo "Review permissions > Allow (access to this one spreadsheet only)."
  command -v open >/dev/null && open "$URL"
  for _ in $(seq 1 36); do is_live && break; sleep 5; done
fi

if is_live; then
  echo
  echo "Done. Web app is live and the extension will pick up the settings automatically."
  echo "Reload the extension once (chrome://extensions or about:debugging), then use the card's Log button."
else
  SCRIPT_ID="$(python3 -c 'import json; print(json.load(open(".clasp.json"))["scriptId"])')"
  echo
  echo "Deployed, but the web app is not answering yet. Open the script, run doGet once"
  echo "(Run button), and approve the permission prompt:"
  echo "   https://script.google.com/d/$SCRIPT_ID/edit"
  echo "Then run this script again to confirm."
fi
