const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { scorePosting, applyClarifications, evaluateRules, extractYears, extractWorkMode, formatTrackerSummary, STANDING_RULES } = require('../engine.js');

console.log('Running JobFitScorer tests...');

// 0. Parity test with canonical rules.json
{
  const canonicalPath = path.resolve(__dirname, '../rules.json');
  if (fs.existsSync(canonicalPath)) {
    const canonical = JSON.parse(fs.readFileSync(canonicalPath, 'utf-8'));
    assert.strictEqual(STANDING_RULES.length, canonical.rules.length,
      `Rule count mismatch! Canonical has ${canonical.rules.length}, engine has ${STANDING_RULES.length}`);
    for (const cr of canonical.rules) {
      const match = STANDING_RULES.find(r => r.id === cr.id);
      assert(match, `Missing canonical rule in engine: ${cr.id}`);
      assert.strictEqual(match.pattern.source, new RegExp(cr.pattern, 'i').source, `Pattern mismatch for rule: ${cr.id}`);
    }
    assert.deepStrictEqual(require('../rules.js'), canonical, 'rules.js is stale: run ./build.sh');
    console.log('✓ Rules parity test passed (engine matches the synced brain rules.json)');
  }
}

// 1. High match role
{
  const jd = `
    Senior Project Manager - Digital Delivery
    We are seeking an experienced Senior Project Manager to lead enterprise SaaS platform implementation and cloud migration.
    Responsibilities:
    - Oversee hybrid Agile/Waterfall project governance, RAID logs, and steering committees.
    - Drive change management and stakeholder readiness across cross-functional teams.
    - Manage vendor contracts, SOWs, RFP evaluations, and budget.
    - Utilize Jira, Smartsheet, and Confluence for tracking critical paths and sprint milestones.
    Requirements:
    - 5+ years of Project Management experience delivering complex tech transformations.
    - PMP or SAFe certification required.
    - Strong process improvement background (Six Sigma Green Belt a plus).
    Location: Galway / Remote hybrid.
  `;
  const res = scorePosting(jd, 'Senior Project Manager');
  assert.strictEqual(res.tier, 'HIGH', `Expected HIGH, got ${res.tier}`);
  assert(res.matchScore >= 70, `Expected score >= 70, got ${res.matchScore}`);
  assert.strictEqual(res.flags.length, 0, 'Expected 0 flags');
  assert.strictEqual(res.workMode, 'Hybrid', 'Expected Hybrid work mode');
  console.log('✓ High match test passed (score:', res.matchScore, ')');
}

// 2. Financial Sector auto-low rule
{
  const jd = `
    Senior Delivery Lead
    Must have 5+ years banking and financial services experience leading regulatory capital programmes.
    PMP required. Hybrid Dublin.
  `;
  const res = scorePosting(jd);
  assert.strictEqual(res.tier, 'AUTO-LOW', `Expected AUTO-LOW for FS, got ${res.tier}`);
  assert(res.flags.some(f => f.ruleId === 'fs_required' && f.type === 'auto_low'));
  console.log('✓ Financial Sector auto-low test passed');
}

// 3. Financial Sector preferred (downgrade to info, not auto-low)
{
  const jd = `
    Senior Project Manager - IT Delivery
    Experience in financial services preferred but not required. PMP and hybrid delivery needed. 5 years experience.
  `;
  const res = scorePosting(jd);
  assert(res.flags.some(f => f.ruleId === 'fs_required' && f.type === 'info'), 'Should downgrade to info');
  assert.notStrictEqual(res.tier, 'AUTO-LOW', 'Should not be AUTO-LOW if preferred');
  console.log('✓ FS preferred downgrade test passed');
}

// 4. PMO Build/Run Skip rule
{
  const jd = `
    Head of PMO / Senior PM
    Opportunity to set up an enterprise PMO from scratch and lead governance frameworks.
  `;
  const res = scorePosting(jd);
  assert.strictEqual(res.tier, 'SKIP', `Expected SKIP for PMO setup, got ${res.tier}`);
  console.log('✓ PMO build/run skip test passed');
}

// 5. Construction hard exclude rule
{
  const jd = `
    Project Manager - Infrastructure & Build
    Experience with NEC3 contracts, site management, and civil engineering subcontractors.
  `;
  const res = scorePosting(jd);
  assert.strictEqual(res.tier, 'SKIP', 'Expected SKIP for construction');
  console.log('✓ Construction hard exclude test passed');
}

// 6. Years asked cap
{
  const jd10 = `Project Manager with 10+ years experience in IT delivery.`;
  const res10 = scorePosting(jd10);
  assert(res10.flags.some(f => f.ruleId === 'years_asked' && f.type === 'cap_low'));
  assert.strictEqual(res10.tier, 'LOW');

  const jd8 = `Project Manager with 8 years experience in delivery.`;
  const res8 = scorePosting(jd8);
  assert(res8.flags.some(f => f.ruleId === 'years_asked' && f.type === 'cap_mid'));
  console.log('✓ Years asked cap test passed');
}

// 7. Platform cert cap mid
{
  const jd = `
    Senior Project Manager - Digital Delivery
    Leading enterprise SaaS platform implementation and cloud migration across complex operational and cross-functional teams.
    Oversee hybrid Agile/Waterfall governance, PMP standards, RAID logs, and change management.
    Manage vendor contracts, RFP evaluations, and budget.
    Utilize Jira and Confluence for tracking critical paths.
    Must hold ServiceNow Certified Implementation Specialist or ITIL v4 certification.
    5 years PM experience.
  `;
  const res = scorePosting(jd, 'Senior Project Manager');
  assert(res.rawScore >= 70, `Expected raw score >= 70, got ${res.rawScore}`);
  assert.strictEqual(res.tier, 'MID', `Expected MID cap, got ${res.tier}`);
  console.log('✓ Platform cert cap mid test passed (raw:', res.rawScore, 'capped to MID)');
}

// 8. Summary format
{
  const sample = scorePosting('Senior Project Manager cloud migration Jira PMP', 'Senior PM');
  const summary = formatTrackerSummary(sample, { title: 'Senior PM', company: 'Acme Corp' });
  assert(summary.includes('Acme Corp'));
  assert(summary.includes('Senior PM'));
  console.log('✓ Summary format test passed:', summary);
}

// 9. Ocuco Calibration (row 281 benchmark)
{
  const ocucoPath = path.resolve(__dirname, '../private/fixtures/ocuco.clean.txt');
  if (fs.existsSync(ocucoPath)) {
    const ocucoText = fs.readFileSync(ocucoPath, 'utf-8');
    const res = scorePosting(ocucoText, 'Project Manager');
    assert.strictEqual(res.matchScore, 76, `Expected Ocuco to score exactly 76, got ${res.matchScore}`);
    assert.strictEqual(res.tier, 'HIGH', `Expected Ocuco tier HIGH, got ${res.tier}`);
    assert(res.flags.some(f => f.ruleId === 'onsite_commute'), 'Expected Dublin commute flag');
    assert(res.flags.some(f => f.ruleId === 'over_levelled'), 'Expected over-levelled flag');
    assert(res.flags.some(f => f.ruleId === 'gap_pi_planning'), 'Expected PI planning gap');
    assert(res.flags.some(f => f.ruleId === 'gap_ecommerce'), 'Expected eCommerce gap');
    console.log('✓ Ocuco benchmark test passed (Score: 76, Tier: HIGH, all flags matched)');

    // 10. Interactive Clarification Live Recalculation
    // Toggling PI-planning to Yes restores 5 points (76 -> 81)
    const clarified1 = applyClarifications(res, { gap_pi_planning: 'yes' });
    assert.strictEqual(clarified1.matchScore, 81, `Expected 81, got ${clarified1.matchScore}`);

    // Toggling all clarifications to Yes restores up to 88 (chat estimate)
    const clarifiedFull = applyClarifications(res, {
      gap_pi_planning: 'yes',
      gap_ecommerce: 'yes',
      over_levelled: 'yes'
    });
    assert.strictEqual(clarifiedFull.matchScore, 88, `Expected 88 with full positive clarification, got ${clarifiedFull.matchScore}`);

    const summary = formatTrackerSummary(clarified1, { title: 'Project Manager', company: 'Ocuco' });
    assert(summary.includes('Clarified:'), 'Expected Clarified note in summary');
    console.log('✓ Interactive clarifications test passed (76 -> 81 -> 88 live recalculation)');
  }
}

// 11. Securitas Benchmark (Digital Transformation Officer)
{
  const securitasPath = path.resolve(__dirname, '../private/fixtures/securitas.clean.txt');
  if (fs.existsSync(securitasPath)) {
    const text = fs.readFileSync(securitasPath, 'utf-8');
    const res = scorePosting(text, 'Digital Transformation Officer');
    assert.strictEqual(res.matchScore, 78, `Expected Securitas to score exactly 78, got ${res.matchScore}`);
    assert(res.flags.some(f => f.ruleId === 'onsite_commute'), 'Expected Clonee Meath commute flag');
    assert(res.flags.some(f => f.ruleId === 'gap_ms_automate'), 'Expected Power Automate gap');
    assert(res.flags.some(f => f.ruleId === 'gap_officer_title'), 'Expected Officer title step-down gap');
    console.log('✓ Securitas benchmark test passed (Score: 78, Tier: HIGH, all flags matched)');
  }
}

// 12. CBRE Benchmark (Sr. Change Management Manager - Remote EST)
{
  const cbrePath = path.resolve(__dirname, '../private/fixtures/cbre.clean.txt');
  if (fs.existsSync(cbrePath)) {
    const text = fs.readFileSync(cbrePath, 'utf-8');
    const res = scorePosting(text, 'Sr. Change Management Manager (Remote - EST)');
    assert.strictEqual(res.matchScore, 60, `Expected CBRE to score exactly 60, got ${res.matchScore}`);
    assert.strictEqual(res.tier, 'MID', `Expected CBRE tier to be MID, got ${res.tier}`);
    assert(res.flags.some(f => f.ruleId === 'gap_change_mgmt_title'), 'Expected Change Mgmt title gap');
    assert(res.flags.some(f => f.ruleId === 'gap_change_cert'), 'Expected PROSCI certification gap');
    assert(res.flags.some(f => f.ruleId === 'gap_direct_people_mgmt'), 'Expected direct line management gap');
    assert(res.flags.some(f => f.ruleId === 'est_working_hours'), 'Expected EST hours flag');
    assert(res.flags.some(f => f.ruleId === 'us_remote_auth'), 'Expected US remote auth flag');
    assert(res.clarifications.some(c => c.id === 'est_hours_willing'), 'Expected EST hours clarification option');
    console.log('✓ CBRE benchmark test passed (Score: 60, Tier: MID, exactly matched Claude benchmark)');
  }
}

console.log('\nAll tests passed successfully!');
