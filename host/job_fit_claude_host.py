#!/usr/bin/env python3
"""Job Fit Overlay - Claude Native Messaging Host
Bridges Chrome & Firefox/Zen extensions to the local authenticated Claude CLI.

Claude scores each posting from the brain directory (~/.job-fit-brain or
$JOB_FIT_BRAIN): profile.md, rules.json, rubric.md and any other .md there.
The same files feed the Claude skill, so every surface scores from one source.
"""
import sys
import json
import struct
import subprocess
import os
import datetime
import shutil

HOME = os.path.expanduser("~")
BRAIN = os.environ.get("JOB_FIT_BRAIN") or os.path.join(HOME, ".job-fit-brain")
CORE = [("profile.md", "profile (who is applying)"), ("rules.json", "rules.json (standing rules)"),
        ("rubric.md", "rubric (scoring method)")]
ENGINE_ONLY_KEYS = ("categories", "adjustments", "waivers", "tiers", "gap_base", "gap_per_capped_flag", "commute_ask")
CLAUDE_CANDIDATES = [
    os.environ.get("JOB_FIT_CLAUDE", ""),
    os.path.join(HOME, ".local/bin/claude"),
    os.path.join(HOME, ".claude/local/claude"),
    os.path.join(HOME, ".npm-global/bin/claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
]


def find_claude():
    # Browsers launch native hosts with a minimal PATH, so shutil.which alone is not enough.
    return next((p for p in CLAUDE_CANDIDATES if p and os.path.exists(p)), shutil.which("claude"))


def read_rules():
    try:
        with open(os.path.join(BRAIN, "rules.json"), encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def build_prompts():
    rules = read_rules()
    default_mode = rules.get("work_mode_default", "Hybrid (assumed)")
    system = (
        "You are a job-fit scorer. The reference documents below are the candidate's profile, "
        "standing rules and scoring rubric. Score the ONE posting you are given exactly as the "
        "rubric prescribes: same hard excludes, caps, 5-part score, tiers and logistics checks. "
        "The rubric may describe a larger scan or logging workflow; ignore all of it except scoring this one posting.\n\n"
        "Only score this posting. Do not search for other jobs, write to any tracker or sheet, "
        "tailor a CV, or run any other pipeline stage. Respond with JSON only."
    )
    schema = OUTPUT_SCHEMA.replace("__DEFAULT_MODE__", default_mode)
    return system, schema


OUTPUT_SCHEMA = """Respond ONLY with valid JSON matching this schema:
{
  "matchScore": <integer 0-100>,
  "tier": "<HIGH|MID|LOW|SKIP>",
  "confidence": "<High|Mid-High|Mid|Low>",
  "subscores": {"domain": <0-30>, "methods": <0-20>, "scope": <0-20>, "portfolio": <0-15>, "gaps": <0-15>},
  "whyItScoresWell": ["<bullet>"],
  "whatHoldsItBack": ["<bullet>"],
  "needsFromCandidate": ["<question>"],
  "summaryLine": "<one-line tracker Notes summary>",
  "tracker": {
    "postedDate": "<m/d/yyyy if the posting shows it, else 'Not stated'>",
    "applicants": "<applicant count if shown, e.g. '<25' or '172', else ''>",
    "workMode": "<Remote | Hybrid | On-site | '__DEFAULT_MODE__' when not stated>",
    "location": "<city/county as stated>",
    "industry": "<industry>",
    "seniority": "<seniority level>",
    "roleType": "<e.g. Project Manager, Programme Manager, Delivery Manager>",
    "contractType": "<Permanent | Contract (length) | Fixed-term (length)>",
    "salaryStated": "<pay exactly as stated, or 'Not stated'>",
    "salaryMinK": <number in k or null>,
    "salaryMaxK": <number in k or null>,
    "yearsAsked": "<years of experience as stated, or 'Not stated'>",
    "yearsMin": <number or null>,
    "source": "<Direct | Recruiter>",
    "priority": <Priority Score per the rubric, 2 decimals>,
    "priorityFormula": "<'Priority X = Match x freshness (posted ...) x source / competition (...)' as in the rubric>",
    "decidingGap": "<the single deciding gap>",
    "gapCategory": "<short gap category>",
    "applicationMethod": "<direct employer careers URL if known, else the posting URL>"
  }
}"""


def read_message():
    raw_length = sys.stdin.buffer.read(4)
    if len(raw_length) == 0:
        return None
    message_length = struct.unpack('@I', raw_length)[0]
    message_bytes = sys.stdin.buffer.read(message_length)
    return json.loads(message_bytes.decode('utf-8'))


def send_message(message):
    encoded = json.dumps(message).encode('utf-8')
    sys.stdout.buffer.write(struct.pack('@I', len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


def brain_files():
    """Core files first, then any other .md in the brain dir (e.g. pipeline.md)."""
    found = []
    for name, label in CORE:
        found.append((name, label))
    core = {n for n, _ in CORE}
    extras = sorted(n for n in os.listdir(BRAIN) if n.endswith(".md") and n not in core) if os.path.isdir(BRAIN) else []
    return found + [(n, f"{n} (extra reference)") for n in extras]


def load_context():
    """Return (reference text, loaded [{file,path,bytes}], missing [file])."""
    sections, loaded, missing = [], [], []
    for name, label in brain_files():
        path = os.path.join(BRAIN, name)
        try:
            with open(path, "r", encoding="utf-8") as f:
                text = f.read()
        except Exception:
            missing.append(name)
            continue
        if name == "rules.json":
            # The triage engine's keyword data is not Claude's rubric; leaving it out avoids anchoring.
            cfg = json.loads(text)
            shown = {k: v for k, v in cfg.items() if k not in ENGINE_ONLY_KEYS}
            sections.append(f"=== {label} ===\n{json.dumps(shown, indent=1)}")
        else:
            sections.append(f"=== {label} ===\n{text}")
        loaded.append({"file": name, "path": os.path.realpath(path), "bytes": len(text.encode("utf-8"))})
    return "\n\n".join(sections), loaded, missing


def evaluate_with_claude(posting_text):
    claude = find_claude()
    if not claude:
        return {"success": False, "error": "Claude CLI not found. Install it or set JOB_FIT_CLAUDE to its path."}

    reference, loaded, missing = load_context()
    if missing and any(m in ("rules.json", "rubric.md", "profile.md") for m in missing):
        return {"success": False, "error": f"Brain incomplete at {BRAIN}: missing {', '.join(missing)}. See docs/BRAIN.md."}
    system_prompt, schema = build_prompts()
    today = datetime.date.today()
    full_prompt = (
        f"REFERENCE DOCUMENTS\n\n{reference}\n\n"
        f"Today's date: {today.month}/{today.day}/{today.year} (use it for posting freshness).\n\n"
        f"=== JOB POSTING TO SCORE ===\n{posting_text}\n\n{schema}"
    )

    try:
        # Prompt goes in via stdin (no argv size limit); tools are disabled so
        # the rubric's scan/sheet-writing steps cannot run.
        cmd = [claude, "-p", "--tools", "", "--system-prompt", system_prompt]
        res = subprocess.run(cmd, input=full_prompt, capture_output=True,
                             text=True, timeout=180)
        output = res.stdout.strip()

        start = output.find('{')
        end = output.rfind('}')
        if start != -1 and end != -1:
            data = json.loads(output[start:end + 1])
            return {"success": True, "data": data, "contextLoaded": loaded,
                    "contextMissing": missing}
        return {"success": False, "error": "Could not parse JSON from Claude",
                "raw": output or res.stderr.strip()}
    except subprocess.TimeoutExpired:
        return {"success": False, "error": "Claude CLI timed out after 180s"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def main():
    while True:
        msg = read_message()
        if msg is None:
            break
        action = msg.get("action")
        if action == "ping":
            _, loaded, missing = load_context()
            send_message({"status": "ok", "claude": find_claude(), "brain": BRAIN,
                          "contextLoaded": loaded, "contextMissing": missing})
        elif action == "get_tracker_config":
            # Written by apps-script/setup-tracker.sh so the popup needs no pasting.
            cfg_path = os.path.join(HOME, ".job-fit-overlay", "tracker.json")
            try:
                with open(cfg_path, "r", encoding="utf-8") as f:
                    cfg = json.load(f)
                send_message({"ok": True, "url": cfg.get("url", ""), "token": cfg.get("token", ""), "sheetUrl": cfg.get("sheetUrl", "")})
            except Exception:
                send_message({"ok": False, "error": f"No tracker config at {cfg_path}"})
        elif action == "score_job":
            send_message(evaluate_with_claude(msg.get("prompt", "")))
        else:
            send_message({"error": f"Unknown action: {action}"})


if __name__ == "__main__":
    main()
