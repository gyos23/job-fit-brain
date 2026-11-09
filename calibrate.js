#!/usr/bin/env node
// Reconcile the badge with Claude: replays every logged (posting, Claude verdict) pair through the
// CURRENT engine and shows where it disagrees. Pairs are logged by the Feed to Claude button.
// Usage: node calibrate.js [--worst N]
const fs = require('fs');
const os = require('os');
const path = require('path');
const engine = require('./engine.js');

const brain = process.env.JOB_FIT_BRAIN || path.join(os.homedir(), '.job-fit-brain');
engine.applyConfig(JSON.parse(fs.readFileSync(path.join(brain, 'rules.json'), 'utf-8')));
const file = path.join(os.homedir(), '.job-fit-overlay', 'calibration.jsonl');
if (!fs.existsSync(file)) { console.log(`No pairs yet (${file}). Press Feed to Claude on a few postings first.`); process.exit(0); }

const worstN = +(process.argv[process.argv.indexOf('--worst') + 1]) || 3;
const parts = ['domain', 'methods', 'scope', 'portfolio', 'gaps'];
const rows = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l)).map(p => {
  const r = engine.scorePosting(p.text, p.title);
  const cl = p.claude.subscores || {};
  return { p, r, d: p.claude.matchScore - r.matchScore,
    dp: Object.fromEntries(parts.map(k => [k, (cl[k] ?? 0) - r.breakdown[k].score])) };
});

const pct = (n) => Math.round(100 * n / rows.length);
const tierMatch = rows.filter(x => x.r.tier === String(x.p.claude.tier).toUpperCase()).length;
console.log(`${rows.length} pairs | tier agreement ${pct(tierMatch)}% | mean Claude - badge: ${(rows.reduce((n, x) => n + x.d, 0) / rows.length).toFixed(1)}`);
console.log('Mean gap per part (Claude - badge). Large positive = badge under-scores; fix that category first:');
for (const k of parts) console.log(`  ${k.padEnd(9)} ${(rows.reduce((n, x) => n + x.dp[k], 0) / rows.length).toFixed(1)}`);

console.log(`\nWorst ${worstN} misses (what Claude credited that the badge missed):`);
for (const x of rows.sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, worstN)) {
  console.log(`- ${x.p.title} @ ${x.p.company}: badge ${x.r.matchScore} ${x.r.tier} vs Claude ${x.p.claude.matchScore} ${x.p.claude.tier}`);
  for (const w of (x.p.claude.whyItScoresWell || []).slice(0, 3)) console.log(`    Claude: ${w}`);
  console.log(`    Badge hit: ${parts.flatMap(k => x.r.breakdown[k].hits || []).join(', ') || 'nothing'}`);
}
console.log('\nNext: add the missed terms to categories in your rules.json, run ./build.sh, then re-run this to see the gap shrink.');
