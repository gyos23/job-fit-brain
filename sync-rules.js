#!/usr/bin/env node
// Links the brain's rules.json into the extension and compiles it to rules.js.
// Brain dir: $JOB_FIT_BRAIN, else ~/.job-fit-brain, else the bundled brain-template.
const fs = require('fs');
const os = require('os');
const path = require('path');

function brainDir() {
  const user = process.env.JOB_FIT_BRAIN || path.join(os.homedir(), '.job-fit-brain');
  if (fs.existsSync(path.join(user, 'rules.json'))) return user;
  console.warn(`No brain at ${user}; using brain-template (copy it there: see docs/BRAIN.md).`);
  return path.join(__dirname, 'brain-template');
}

const src = path.join(brainDir(), 'rules.json');
const link = path.join(__dirname, 'rules.json');
const rules = JSON.parse(fs.readFileSync(src, 'utf-8'));

fs.rmSync(link, { force: true });
fs.symlinkSync(fs.realpathSync(src), link);

fs.writeFileSync(path.join(__dirname, 'rules.js'), `// AUTO-GENERATED from the brain's rules.json. Do not edit directly.
(function (root) {
  'use strict';
  const rules = ${JSON.stringify(rules, null, 2)};
  if (typeof module === 'object' && module.exports) {
    module.exports = rules;
  } else {
    root.JOB_PIPELINE_RULES = rules;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
`, 'utf-8');
console.log(`✓ Synced ${src} -> rules.json, rules.js`);
