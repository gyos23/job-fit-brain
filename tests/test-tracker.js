// Tests for "Log to tracker": record building (engine.js) and the Apps Script's
// pure helpers (apps-script/Code.gs). Run with: node tests/test-tracker.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// engine.js reads JOB_PIPELINE_RULES from globalThis before falling back to
// rules.json, so load the compiled rules.js first (works without ~/job-pipeline).
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '../rules.js'), 'utf-8'));
const { canonicalPostingUrl, foundViaFor, buildTrackerRecord, formatClaudeBrief } = require('../engine.js');

const gas = { module: { exports: {} } };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../apps-script/Code.gs'), 'utf-8'), gas);
const { normalizeUrl, findDuplicate, lastDataRow, headerIndex } = gas.module.exports;

console.log('Running tracker logging tests...');

// 1. Canonical posting URLs
assert.strictEqual(
  canonicalPostingUrl('https://www.linkedin.com/jobs/search/?currentJobId=4486859604&keywords=pm'),
  'https://www.linkedin.com/jobs/view/4486859604/');
assert.strictEqual(
  canonicalPostingUrl('https://ie.linkedin.com/jobs/view/senior-project-manager-at-acme-recruit-4486859604?trk=x'),
  'https://www.linkedin.com/jobs/view/4486859604/');
assert.strictEqual(
  canonicalPostingUrl('https://ie.indeed.com/jobs?q=pm&vjk=ed02752476c30b47'),
  'https://ie.indeed.com/viewjob?jk=ed02752476c30b47');
assert.strictEqual(
  canonicalPostingUrl('https://job-boards.greenhouse.io/acme/jobs/6227964004?gh_src=abc#app'),
  'https://job-boards.greenhouse.io/acme/jobs/6227964004');
assert.strictEqual(foundViaFor('https://www.linkedin.com/jobs/view/1/'), 'LinkedIn');
assert.strictEqual(foundViaFor('https://jobs.apple.com/en-ie/details/1'), 'Employer site');
console.log('✓ canonical URLs and Found Via');

// 2. Record built from a Claude verdict
{
  const verdict = {
    matchScore: 66, tier: 'MID', confidence: 'Mid',
    subscores: { domain: 16, methods: 16, scope: 15, portfolio: 10, gaps: 9 },
    whyItScoresWell: ['Programme governance'], whatHoldsItBack: ['D&A depth'],
    needsFromCandidate: ['Dependency management?'], summaryLine: 'Data & Analytics programme, Dublin contract.',
    tracker: { priority: 26.4, priorityFormula: 'Priority 26.40 = 66 x 1.0 x 0.40 / 1.0', postedDate: '11/3/2026',
      applicants: '31', workMode: 'Hybrid (assumed)', salaryStated: 'EUR 600-650 per day',
      decidingGap: 'D&A technical depth', gapCategory: 'Technical domain depth' }
  };
  const rec = buildTrackerRecord(verdict, { title: 'Senior Project Manager', company: 'Acme Recruit' },
    'https://www.linkedin.com/jobs/search/?currentJobId=4486859604', 'Full JD text here', new Date(2026, 10, 3));
  const f = rec.fields;
  assert.strictEqual(f['Posting URL'], 'https://www.linkedin.com/jobs/view/4486859604/');
  assert.strictEqual(f['Confidence'], 'mid');
  assert.strictEqual(f['Status'], 'To Apply');
  assert.strictEqual(f['Date Added'], '11/3/2026');
  assert.strictEqual(f['JD Saved'], 'No', 'JD Saved starts No; the script flips it after the archive read-back');
  assert.strictEqual(f['Found Via'], 'LinkedIn');
  assert.strictEqual(f['Priority Score'], 26.4);
  assert(f['Notes'].startsWith('Priority 26.40 = 66'), 'Notes lead with the priority formula');
  assert(f['Notes'].includes('Domain 16 + Method 16 + Scope 15 + Portfolio 10 + Gap 9 = 66'));
  assert(!/\.\./.test(f['Notes']), 'no doubled full stops');
  assert(rec.archive.jdText.endsWith('Full JD text here'));
  assert.strictEqual(rec.tier, 'MID');
  assert.strictEqual(buildTrackerRecord({ tier: 'SKIP', matchScore: 20 }, {}, '', '').fields['Confidence'], 'low');
  console.log('✓ tracker record from Claude verdict');
}

// 3. Page facts reach the Claude brief
{
  const brief = formatClaudeBrief({ clarificationNotes: [] },
    { title: 'PM', company: 'X', url: 'https://x', pageFacts: ['3 hours ago', '31 applicants'] }, 'jd');
  assert(brief.includes('Page shows: 3 hours ago | 31 applicants'));
  console.log('✓ page facts in Claude brief');
}

// 4. Apps Script duplicate detection, by live header names
{
  const header = ['Posting URL', 'Role Title', 'Notes', 'Status', 'Company Name'];
  const col = headerIndex(header);
  const rows = [
    ['https://www.linkedin.com/jobs/view/4480510525/', 'Customer Delivery Manager', '', 'Rejected', 'Archer Recruitment'],
    ['', 'Senior Project Manager', '', 'Applied', 'Securitas Ireland'],
    ['', '', '', '', '']
  ];
  const byUrl = findDuplicate(rows, col, { 'Posting URL': 'https://ie.linkedin.com/jobs/view/4480510525?trk=1', 'Role Title': 'X', 'Company Name': 'Y' });
  assert.deepStrictEqual([byUrl.row, byUrl.status, byUrl.reason], [2, 'Rejected', 'same posting URL']);
  const byName = findDuplicate(rows, col, { 'Posting URL': 'https://jobs.smartrecruiters.com/a', 'Role Title': 'Senior  Project Manager', 'Company Name': 'securitas ireland' });
  assert.deepStrictEqual([byName.row, byName.reason], [3, 'same title and company']);
  assert.strictEqual(findDuplicate(rows, col, { 'Posting URL': 'https://new.example/job', 'Role Title': 'New', 'Company Name': 'Co' }), null);
  assert.strictEqual(normalizeUrl('https://www.linkedin.com/jobs/search/?currentJobId=4480510525'), 'linkedin:4480510525');
  console.log('✓ duplicate detection');
}

// 5. Next free row ignores blank rows in between but not data below them
{
  const rows = [['a', 'x'], ['', ''], ['b', ''], ['', ''], ['', '']]; // sheet rows 2..6
  assert.strictEqual(lastDataRow(rows, [0, 1]), 4, 'last data is sheet row 4; next free is 5');
  assert.strictEqual(lastDataRow([['', '']], [0, 1]), 1);
  console.log('✓ next free row');
}

console.log('All tracker tests passed.');
