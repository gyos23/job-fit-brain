#!/usr/bin/env node
// Deterministic triage from the shell: node cli.js [--title "Senior PM"] < posting.txt
// Same engine and same brain as the browser overlay, so the result is identical.
const fs = require('fs');
const os = require('os');
const path = require('path');
const engine = require('./engine.js');

const dir = process.env.JOB_FIT_BRAIN || path.join(os.homedir(), '.job-fit-brain');
engine.applyConfig(JSON.parse(fs.readFileSync(path.join(dir, 'rules.json'), 'utf-8')));
const i = process.argv.indexOf('--title');
const r = engine.scorePosting(fs.readFileSync(0, 'utf-8'), i > 0 ? process.argv[i + 1] : '');
console.log(JSON.stringify({
  matchScore: r.matchScore, tier: r.tier, status: r.status, workMode: r.workMode,
  subscores: Object.fromEntries(Object.entries(r.breakdown).map(([k, v]) => [k, `${v.score}/${v.max}`])),
  flags: r.flags.map(f => `${f.name}: ${f.effect}`)
}, null, 2));
