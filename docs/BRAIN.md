# Writing your brain

The brain is a folder, `~/.job-fit-brain/` (or `$JOB_FIT_BRAIN`). `setup.sh` creates it from `brain-template/`. Edit the three core files, then run `./build.sh` in the repo.

You can point a file at one you already maintain with a symlink (for example `rubric.md` at an existing scoring skill). Any other `*.md` in the folder (for example `pipeline.md`) is also sent to Claude as reference.

## profile.md
Free text. Put everything Claude should treat as fact about you: where you live, commute limit, targets, pay floor, work authorisation, relocation, work-mode default, experience, certifications, and **known gaps** (the rubric subtracts for those). Claude reads this file in the extension, in Claude Code and in chat, so a fact you tell chat once and never write here will not carry over.

## rubric.md
The scoring method in plain language. The template defines hard gates, a five-part 0-100 score (domain 30, methods 20, scope 20, portfolio 15, gaps 15), tiers and an optional priority formula. Change the lists and weights to your search. Keep the five part names: the extension card and the tracker expect them.

## rules.json
Two audiences share this file. Claude sees `rules`, `years`, `preferred_words`, `profile`, `work_mode_default` and `_note`. The browser triage engine also uses the rest.

| Key | Used by | Meaning |
|---|---|---|
| `rules[]` | Claude + engine | Hard gates. `id`, `pattern` (regex, case-insensitive), `effect` (starts with `SKIP`, `HARD EXCLUDE`, `AUTO-LOW`, `CAP LOW`, `CAP MID` or `CHECK COMMUTE`), optional `downgrade_if_preferred` |
| `years` | both | `cap_low_at`, `cap_mid_from`: years asked that cap the tier |
| `preferred_words` | both | Regex words that turn a required-rule into an info note ("preferred") |
| `profile` | popup, tracker | Display facts: `name`, `shortName`, `targetTitle`, `location`, `commuteLimitMinutes`, `salaryFloorPermanent`, `salaryFloorContract`, `relocation` |
| `work_mode_default` | both | Work mode when the posting does not say |
| `tiers` | engine | `high_from`, `mid_from` thresholds |
| `categories` | engine | `domain`, `methods`, `scope`, `portfolio`: each has `max` and `items[]` of `{id, label, points, pattern}`. Points add up to the category max |
| `gap_base`, `gap_per_capped_flag` | engine | Gaps start at `gap_base` and lose `gap_per_capped_flag` for each cap or exclude that fires |
| `adjustments[]` | engine | Negative points for known gaps. `category` (`scope` or `gaps`), `points`, match on `text` and/or `title` (regex), `unlessTitle`, `skipIf` (another adjustment id), `flag` (show on the card, with `name`, `effect`, `evidence`), `ask` (a yes/no question on the card that gives the points back) |
| `waivers[]` | engine | Drop a rule match when something else is true, for example PRINCE2 is waived if the posting also accepts PMP |
| `commute_ask` | engine | Wording of the commute question when the `onsite_commute` rule fires |

Rules of thumb:
- Put anything that must never change between surfaces in `rules[]` and `rubric.md`. Put tuning knobs for the instant badge in `categories` and `adjustments`.
- A regex in JSON needs doubled backslashes: `\\b`, `\\s`.
- The tests in `tests/test-engine.js` check that the engine matches `rules.json` exactly. If you add a benchmark posting, put it under `private/fixtures/` and add an assertion; `private/` is gitignored.

## Two layers, on purpose
The badge only knows what regexes in `rules.json` can see. The rubric can say more ("cap at MID if pay is unstated", "cap at LOW if hands-on engineering is the core of the role"), and only Claude can apply those. So a posting can show HIGH on the badge and MID from Claude. That is the design: the badge is a fast filter, Claude decides. If you want the badge to catch a cap too, add a rule to `rules.json` and expect the badge to get stricter.

## Checking the result
```bash
./build.sh                                  # recompile, run tests
python3 -c 'import json,struct,sys;m=json.dumps({"action":"ping"}).encode();sys.stdout.buffer.write(struct.pack("@I",len(m))+m)' | host/job_fit_claude_host.py | tail -c +5
```
The ping lists every brain file it loaded, with the resolved path and size. `contextMissing` must be empty.
