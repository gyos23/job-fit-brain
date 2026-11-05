---
name: job-fit-score
description: Score one job posting against the user's job-fit brain (profile, standing rules, rubric) so the result matches the Job Fit Overlay browser extension and every other Claude surface. Use when the user pastes or links a job posting, or says score, rate, evaluate or "is this a fit".
---

# Job fit score

One brain, one rubric. This skill never invents its own criteria.

## 1. Load the brain
Read these files. In Claude Code and Cowork they live in `~/.job-fit-brain/` (or `$JOB_FIT_BRAIN`).
In Claude chat they are bundled next to this file in `brain/`.

- `profile.md`: who is applying, what they want, their gaps.
- `rules.json`: standing rules (the `rules` array, `years`, `preferred_words`).
- `rubric.md`: the scoring method. Follow it exactly.
- Any other `.md` in the brain folder: extra reference, same weight as the rubric.

If a file is missing, say which one and stop. Do not score from memory.

## 2. Read the whole posting
If the user gave a link, fetch the full text. Never score from a title or snippet.
If the text cannot be read, say so and stop.

## 3. Triage (only if you can run shell commands)
Save the posting text to a file, then run `node "$(cat ~/.job-fit-brain/.repo)/cli.js" --title "<job title>" < posting.txt` (setup.sh writes the repo path to `.repo`; use `$JOB_FIT_BRAIN` instead of `~/.job-fit-brain` if set).
It is the same deterministic engine the browser overlay uses. Report its score and flags as
"Triage". If you cannot run shell commands, apply `rules.json` by hand and skip the triage line.

## 4. Score with the rubric
Apply `rubric.md` to the posting. Treat each `rules` pattern as a pointer: read the posting and
decide whether the rule truly applies ("preferred" is not "required").

## 5. Answer in this shape
- **Match N/100, TIER** (HIGH, MID, LOW, SKIP)
- Sub-scores: domain, methods, scope, portfolio, gaps
- Flags: each rule or cap that fired, with the quoted posting line
- Deciding gap: one line
- Triage line (if run) and the difference from your score
- Questions for the candidate: anything that would change the tier

Label the number "Claude's estimate". The hard gates (exclude, auto-low, caps) must match the
extension exactly; the 0-100 number can differ by a few points because it is a judgment.
