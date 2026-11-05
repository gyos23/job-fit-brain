#!/usr/bin/env bash
# Registers the native messaging host for Chrome-family browsers and Firefox/Zen (macOS).
# Usage: host/install-host.sh [chrome-extension-id]
# The default ID comes from the "key" in manifest.json (unpacked installs). Store installs
# get a different ID: pass it here.
set -euo pipefail

HOST_NAME="com.jobfit.claude_host"
GECKO_ID="job-fit-overlay@jobfit.local"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST_SCRIPT="$SCRIPT_DIR/job_fit_claude_host.py"
CHROME_EXT_ID="${1:-jbljfmamepnilgemekjfbmjchdepaceo}"

chmod +x "$HOST_SCRIPT"
SUPPORT="$HOME/Library/Application Support"

for dir in "Google/Chrome" "Chromium" "BraveSoftware/Brave-Browser" "Microsoft Edge"; do
  [ -d "$SUPPORT/$dir" ] || continue
  mkdir -p "$SUPPORT/$dir/NativeMessagingHosts"
  cat > "$SUPPORT/$dir/NativeMessagingHosts/$HOST_NAME.json" <<JSON
{
  "name": "$HOST_NAME",
  "description": "Job Fit Overlay Claude host",
  "path": "$HOST_SCRIPT",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$CHROME_EXT_ID/"]
}
JSON
  echo "✓ Registered for $dir"
done

mkdir -p "$SUPPORT/Mozilla/NativeMessagingHosts"
cat > "$SUPPORT/Mozilla/NativeMessagingHosts/$HOST_NAME.json" <<JSON
{
  "name": "$HOST_NAME",
  "description": "Job Fit Overlay Claude host",
  "path": "$HOST_SCRIPT",
  "type": "stdio",
  "allowed_extensions": ["$GECKO_ID"]
}
JSON
echo "✓ Registered for Firefox/Zen"
