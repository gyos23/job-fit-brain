# Scoring rubric (EXAMPLE: edit the numbers and lists to match your search)

Score ONE job posting against profile.md and rules.json. Read the whole posting first.
Never judge from the title or a search snippet. If the posting text is missing or unreadable,
say so and do not score.

## Step 1: hard gates (from rules.json)
Apply every rule in rules.json. Rules are pointers; you read the posting and decide whether
the rule really applies (for example "preferred" is not "required").
- SKIP: a hard exclude applies (construction, PMO build/run, relocation abroad).
- AUTO-LOW: the posting requires something your profile rules out (for example financial-services experience).
- Cap at LOW: 10+ years asked; Director or Head-of seniority; a language requirement; a required technical depth
  you lack; on-site commute beyond your limit; pay clearly below your floor; work authorisation you do not hold.
- Cap at MID (Claude-only: the browser badge cannot see pay): pay unstated or below your target; a named certification or platform is required (ITIL, ServiceNow, SAP); 8-12 years asked; pay unstated.

## Step 2: match score, 0 to 100
| Part | Max | What earns points |
|---|---|---|
| Domain proof | 30 | Industries and problem types you have delivered before |
| Methods and tools | 20 | Methods, certifications and tools in profile.md |
| Scope and seniority | 20 | Title and years asked against your level; budget, vendors, stakeholders |
| Portfolio fit | 15 | Size and type of delivery you have run |
| Gaps | 15 | Start at 15. Subtract for each stated must-have you lack (see "Known gaps" in profile.md) |

Round to a whole number. Show the five sub-scores.

## Step 3: tier
- HIGH: no cap and match 70 or more.
- MID: match 45 to 69, or capped at MID.
- LOW: match under 45, or capped at LOW.
- SKIP / AUTO-LOW: step 1 says so. Say which rule and quote the posting line that triggered it.

## Step 4: priority (optional ranking)
Priority = Match x Freshness x Source / Competition
- Freshness: 1.0 within 3 days, 0.7 within 7 days, 0.4 older.
- Source: 0.25 direct apply, 0.40 recruiter.
- Competition: 1.0, or 1.5 at 100+ applicants.

## Output rules
- Name the single deciding gap.
- Label the score "Claude's estimate" and list the sub-scores.
- Ask the candidate about anything that would change the tier instead of guessing.
