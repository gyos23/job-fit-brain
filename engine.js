/**
 * Job Fit Scorer - triage engine.
 * Deterministic. Everything personal (profile, keyword categories, gap
 * adjustments, standing rules, tier thresholds) comes from the brain's
 * rules.json, so every surface that loads the same brain gets the same triage.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(root);
  } else {
    root.JobFitScorer = factory(root);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  let currentConfig = (typeof root.JOB_PIPELINE_RULES !== 'undefined')
    ? root.JOB_PIPELINE_RULES
    : (typeof require !== 'undefined' ? require('./rules.json') : null);

  let preferredRegex = /\b(preferred|desirable|advantage|nice to have|ideally|a plus|beneficial)\b/i;
  let standingRules = [];
  let yearsConfig = { cap_low_at: 10, cap_mid_from: 8 };
  let tiers = { high_from: 70, mid_from: 45 };
  let categories = [];
  let adjustments = [];
  let waivers = [];
  let profile = {};
  let workModeDefault = 'Hybrid (assumed)';
  let gapBase = 15;
  let gapPerFlag = 5;
  let commuteAsk = null;

  const rx = (s) => (s ? new RegExp(s, 'i') : null);

  function parseRuleType(effect) {
    if (/AUTO-LOW/i.test(effect)) return 'auto_low';
    if (/SKIP|HARD EXCLUDE/i.test(effect)) return 'exclude';
    if (/CAP LOW/i.test(effect)) return 'cap_low';
    if (/CAP MID/i.test(effect)) return 'cap_mid';
    if (/CHECK COMMUTE/i.test(effect)) return 'check_commute';
    return 'warning';
  }

  function applyConfig(cfg) {
    if (!cfg) return;
    currentConfig = cfg;
    if (cfg.preferred_words) preferredRegex = new RegExp(`\\b(${cfg.preferred_words})\\b`, 'i');
    if (cfg.years) yearsConfig = cfg.years;
    if (cfg.tiers) tiers = cfg.tiers;
    profile = cfg.profile || {};
    workModeDefault = cfg.work_mode_default || workModeDefault;
    gapBase = cfg.gap_base ?? gapBase;
    gapPerFlag = cfg.gap_per_capped_flag ?? gapPerFlag;
    commuteAsk = cfg.commute_ask || null;
    if (Array.isArray(cfg.rules)) {
      standingRules = cfg.rules.map(r => ({
        id: r.id,
        name: r.id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        effect: r.effect,
        type: parseRuleType(r.effect),
        downgradeIfPreferred: r.downgrade_if_preferred || null,
        pattern: new RegExp(r.pattern, 'i')
      }));
    }
    categories = Object.entries(cfg.categories || {}).map(([key, c]) => ({
      key, max: c.max, items: c.items.map(i => ({ ...i, pattern: rx(i.pattern) }))
    }));
    adjustments = (cfg.adjustments || []).map(a => ({
      ...a, text: rx(a.text), title: rx(a.title), unlessTitle: rx(a.unlessTitle)
    }));
    waivers = (cfg.waivers || []).map(w => ({ rule: w.rule, match: rx(w.match), ifText: rx(w.waive_if_text) }));
  }

  applyConfig(currentConfig);

  async function loadLatestRules() {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
      try {
        const url = chrome.runtime.getURL('rules.json?_=' + Date.now());
        const res = await fetch(url);
        if (res.ok) {
          const cfg = await res.json();
          applyConfig(cfg);
          return cfg;
        }
      } catch (err) {
        // Fall back gracefully to existing rules if fetch fails
      }
    }
    return currentConfig;
  }

  function extractYears(text) {
    const rx = /(\d{1,2})\s*\+?\s*(?:(?:-|to)\s*(\d{1,2})\s*)?(?:years|yrs)/gi;
    let match;
    let reqYears = 0;
    while ((match = rx.exec(text)) !== null) {
      // For ranges like "5 - 8 years", the first number is the minimum requirement
      const n1 = parseInt(match[1], 10);
      if (n1 > reqYears && n1 < 40) reqYears = n1;
    }
    return reqYears;
  }

  function extractWorkMode(text) {
    if (/\b(100% remote|fully remote|remote-first|work from home|home based)\b/i.test(text)) {
      return 'Remote';
    }
    if (/\b(hybrid|flexible work|blend of office and home|days in office)\b/i.test(text)) {
      return 'Hybrid';
    }
    if (/\b(on-?site|office based|in office 5 days|five days in office)\b/i.test(text)) {
      return 'On-site';
    }
    return workModeDefault;
  }

  function evaluateRules(text) {
    const flags = [];
    for (const rule of standingRules) {
      const match = rule.pattern.exec(text);
      if (match) {
        const start = Math.max(0, match.index - 50);
        const end = Math.min(text.length, match.index + match[0].length + 50);
        const snippet = text.substring(start, end).replace(/\s+/g, ' ').trim();

        let effect = rule.effect;
        let type = rule.type;

        if (rule.downgradeIfPreferred && preferredRegex.test(snippet)) {
          effect = rule.downgradeIfPreferred;
          type = 'info';
        }

        if (waivers.some(w => w.rule === rule.id && w.match.test(match[0]) && (!w.ifText || w.ifText.test(text)))) {
          continue;
        }

        flags.push({
          ruleId: rule.id,
          name: rule.name,
          effect,
          type,
          evidence: snippet
        });
      }
    }

    const maxYears = extractYears(text);
    if (maxYears >= yearsConfig.cap_low_at) {
      flags.push({
        ruleId: 'years_asked',
        name: `${maxYears}+ Years Asked`,
        effect: `CAP LOW (${maxYears}+ years asked)`,
        type: 'cap_low',
        evidence: `Extracted requirement of ${maxYears} years experience`
      });
    } else if (maxYears >= yearsConfig.cap_mid_from) {
      flags.push({
        ruleId: 'years_asked',
        name: `${maxYears} Years Asked`,
        effect: `CAP MID (${maxYears} years asked)`,
        type: 'cap_mid',
        evidence: `Extracted requirement of ${maxYears} years experience`
      });
    }

    return { flags, maxYears };
  }

  function scorePosting(text, title = '') {
    const fullText = (title ? `${title}\n\n` : '') + (text || '');
    const { flags, maxYears } = evaluateRules(fullText);
    const gapFlags = flags.filter(f => f.type === 'cap_low' || f.type === 'cap_mid' || f.type === 'exclude');

    // Keyword categories (domain, methods, scope, portfolio)
    const sums = {};
    for (const cat of categories) {
      const hits = cat.items.filter(i => i.pattern.test(fullText));
      sums[cat.key] = { raw: hits.reduce((n, i) => n + i.points, 0), hits: hits.map(h => h.label), max: cat.max };
    }

    // Adjustments: negative points against scope or gaps; optionally flagged and/or asked
    const applied = new Set();
    const adjust = { scope: 0, gaps: 0 };
    const clarifications = [];
    for (const a of adjustments) {
      if (a.skipIf && applied.has(a.skipIf)) continue;
      if (a.text && !a.text.test(fullText)) continue;
      if (a.title && !a.title.test(title)) continue;
      if (a.unlessTitle && a.unlessTitle.test(title)) continue;
      applied.add(a.id);
      adjust[a.category] += a.points;
      if (a.flag) {
        flags.push({
          ruleId: a.id, name: a.name, effect: a.effect, type: 'info',
          evidence: a.evidence || `Job title: ${title}`
        });
      }
      if (a.ask) {
        const yes = { value: 'yes', label: a.ask.yes, delta: -a.points };
        const no = a.ask.noExcludes
          ? { value: 'no', label: a.ask.no, delta: 0, forceExclude: true }
          : { value: 'no', label: a.ask.no, delta: 0 };
        clarifications.push({
          id: a.ask.id || a.id,
          label: a.ask.label,
          category: a.ask.category,
          defaultChoice: a.ask.default || 'no',
          options: a.ask.noExcludes ? [{ ...yes, delta: 0 }, no] : [no, yes],
          description: a.ask.description
        });
      }
    }

    const clamp = (n, max) => Math.max(0, Math.min(max, n));
    const score = (key) => clamp(sums[key].raw + (adjust[key] || 0), sums[key].max);
    const domainScore = score('domain');
    const methodsScore = score('methods');
    const scopeScore = score('scope');
    const portfolioScore = score('portfolio');
    const gapScore = clamp(gapBase - gapFlags.length * gapPerFlag + adjust.gaps, gapBase);

    const rawMatchScore = domainScore + methodsScore + scopeScore + portfolioScore + gapScore;

    const commuteFlag = flags.find(f => f.ruleId === 'onsite_commute');
    if (commuteFlag && commuteAsk) {
      clarifications.push({
        id: 'commute_willing',
        label: commuteAsk.label,
        category: 'commute',
        defaultChoice: 'flag',
        options: [
          { value: 'flag', label: commuteAsk.keep, delta: 0 },
          { value: 'disqualify', label: commuteAsk.exclude, delta: 0, forceExclude: true }
        ],
        description: commuteFlag.evidence
      });
    }

    // Determine final tier and status
    const hasExclude = flags.some(f => f.type === 'exclude');
    const hasAutoLow = flags.some(f => f.type === 'auto_low');
    const hasCapLow = flags.some(f => f.type === 'cap_low');
    const hasCapMid = flags.some(f => f.type === 'cap_mid');

    let tier = 'LOW';
    let status = 'Low Confidence';
    const matchScore = rawMatchScore;

    if (hasExclude) {
      tier = 'SKIP';
      status = 'Disqualified (Hard Rule Exclusion)';
    } else if (hasAutoLow) {
      tier = 'AUTO-LOW';
      status = 'Disqualified (Required Rule Failed)';
    } else if (hasCapLow) {
      tier = 'LOW';
      status = 'Low Confidence (Capped by Rule)';
    } else if (hasCapMid) {
      tier = rawMatchScore >= tiers.mid_from ? 'MID' : 'LOW';
      status = rawMatchScore >= tiers.mid_from ? 'Mid Confidence (Capped at MID)' : 'Low Confidence';
    } else if (rawMatchScore >= tiers.high_from) {
      tier = 'HIGH';
      status = 'High Confidence';
    } else if (rawMatchScore >= tiers.mid_from) {
      tier = 'MID';
      status = 'Mid Confidence';
    }

    return {
      tier,
      status,
      matchScore,
      rawScore: rawMatchScore,
      workMode: extractWorkMode(fullText),
      maxYears,
      breakdown: {
        domain: { score: domainScore, max: sums.domain.max, hits: sums.domain.hits },
        methods: { score: methodsScore, max: sums.methods.max, hits: sums.methods.hits },
        scope: { score: scopeScore, max: sums.scope.max, hits: sums.scope.hits },
        portfolio: { score: portfolioScore, max: sums.portfolio.max, hits: sums.portfolio.hits },
        gaps: { score: gapScore, max: gapBase, deductions: gapFlags.length * gapPerFlag }
      },
      flags,
      clarifications,
      profile
    };
  }

  function applyClarifications(baseResult, userChoices = {}) {
    let delta = 0;
    let forceExclude = false;
    const appliedNotes = [];

    const updatedClarifications = (baseResult.clarifications || []).map(item => {
      const choice = userChoices[item.id] || item.defaultChoice;
      const opt = item.options.find(o => o.value === choice) || item.options[0];
      if (opt.delta) delta += opt.delta;
      if (opt.forceExclude) forceExclude = true;
      if (choice !== item.defaultChoice) {
        appliedNotes.push(`${item.label.replace(/\?$/, '')}: ${opt.label}`);
      }
      return { ...item, currentChoice: choice };
    });

    const newMatchScore = Math.max(0, Math.min(100, baseResult.rawScore + delta));

    let tier = baseResult.tier;
    let status = baseResult.status;

    if (forceExclude) {
      tier = 'SKIP';
      status = 'Disqualified (Excluded by your answer)';
    } else if (baseResult.tier === 'HIGH' || baseResult.tier === 'MID' || baseResult.tier === 'LOW') {
      if (newMatchScore >= tiers.high_from) {
        tier = 'HIGH';
        status = 'High Confidence';
      } else if (newMatchScore >= tiers.mid_from) {
        tier = 'MID';
        status = 'Mid Confidence';
      } else {
        tier = 'LOW';
        status = 'Low Confidence';
      }
    }

    return {
      ...baseResult,
      matchScore: newMatchScore,
      tier,
      status,
      clarifications: updatedClarifications,
      clarificationNotes: appliedNotes
    };
  }

  function formatTrackerSummary(scoreResult, metadata = {}) {
    const title = metadata.title || 'Role';
    const company = metadata.company || 'Company';
    const b = scoreResult.breakdown;
    const sub = `Domain ${b.domain.score}/${b.domain.max}, Methods ${b.methods.score}/${b.methods.max}, Scope ${b.scope.score}/${b.scope.max}, Port ${b.portfolio.score}/${b.portfolio.max}, Gaps ${b.gaps.score}/${b.gaps.max}`;
    const flagSummary = scoreResult.flags.length > 0
      ? ` | Flags: ${scoreResult.flags.map(f => f.name).join(', ')}`
      : '';
    const clarSummary = (scoreResult.clarificationNotes && scoreResult.clarificationNotes.length > 0)
      ? ` | Clarified: ${scoreResult.clarificationNotes.join('; ')}`
      : '';
    return `Match ${scoreResult.matchScore}/100 (${scoreResult.tier}) | ${title} @ ${company} | Mode: ${scoreResult.workMode} | Sub-scores: ${sub}${flagSummary}${clarSummary}`;
  }

  function formatClaudeBrief(scoreResult, metadata = {}, fullText = '') {
    const title = metadata.title || 'Role';
    const company = metadata.company || 'Company';
    const url = metadata.url || (typeof window !== 'undefined' ? window.location.href : '');
    // The extension's own triage score and flags are deliberately left out so
    // Claude scores independently instead of anchoring on the heuristic.
    // Clarification answers are facts from the user, so they are kept.
    let clarText = '';
    if (scoreResult.clarificationNotes && scoreResult.clarificationNotes.length > 0) {
      clarText = `\nMy answers to clarifying questions:\n` + scoreResult.clarificationNotes.map(c => `- ${c}`).join('\n');
    }

    const facts = (metadata.pageFacts && metadata.pageFacts.length)
      ? `\nPage shows: ${metadata.pageFacts.join(' | ')}`
      : '';

    return `Please evaluate this job posting against my profile, standing rules, and job-pipeline rubric.

Role: ${title}
Company: ${company}
URL: ${url}${facts}${clarText}

Full Job Description:
${(fullText || '').trim()}
`;
  }

  /**
   * Turn a job page URL into the stable "direct link" the tracker stores.
   * LinkedIn search pages carry the job as ?currentJobId=..., so both forms map
   * to https://www.linkedin.com/jobs/view/<id>/. Indeed keeps ?jk=. Everything
   * else loses its query string and fragment.
   */
  function canonicalPostingUrl(rawUrl) {
    let u;
    try { u = new URL(rawUrl); } catch (e) { return rawUrl || ''; }
    const host = u.hostname.replace(/^www\./, '');
    if (host.endsWith('linkedin.com')) {
      const id = (u.pathname.match(/\/jobs\/view\/(?:[^/]*?-)?(\d{6,})/) || [])[1]
        || u.searchParams.get('currentJobId');
      if (id) return `https://www.linkedin.com/jobs/view/${id}/`;
    }
    if (host.endsWith('indeed.com') || host.endsWith('indeed.ie')) {
      const jk = u.searchParams.get('jk') || u.searchParams.get('vjk');
      if (jk) return `https://ie.indeed.com/viewjob?jk=${jk}`;
    }
    return `${u.protocol}//${u.hostname}${u.pathname}`;
  }

  /** "Found Via" value for the tracker, from the page's host name. */
  function foundViaFor(rawUrl) {
    let host = '';
    try { host = new URL(rawUrl).hostname; } catch (e) { return 'Other'; }
    if (/linkedin\.com$/.test(host)) return 'LinkedIn';
    if (/indeed\.(com|ie)$/.test(host)) return 'Indeed';
    if (/(jobleads\.com|irishjobs\.ie|jobs\.ie|glassdoor\.(com|ie))$/.test(host)) return 'Job board';
    return 'Employer site';
  }

  function formatDateMDY(d) {
    return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
  }

  const TIER_TO_CONFIDENCE = { HIGH: 'high', MID: 'mid', LOW: 'low', SKIP: 'low' };

  /**
   * Build the record the Apps Script writes: tracker cells keyed by the live
   * header names in row 1 of "Job Applications", plus the JD Archive row.
   * Columns not named here are left untouched by the script.
   */
  function buildTrackerRecord(verdict, metadata = {}, rawUrl = '', jdText = '', today = new Date()) {
    const v = verdict || {};
    const t = v.tracker || {};
    const s = v.subscores || {};
    const tier = String(v.tier || '').toUpperCase();
    const url = canonicalPostingUrl(rawUrl);
    const join = (arr) => (Array.isArray(arr) && arr.length ? arr.join('; ') : '');

    const notes = [
      t.priorityFormula ? `${t.priorityFormula}.` : '',
      v.summaryLine || '',
      join(v.whyItScoresWell) ? `Why it fits: ${join(v.whyItScoresWell)}.` : '',
      join(v.whatHoldsItBack) ? `Holds it back: ${join(v.whatHoldsItBack)}.` : '',
      t.decidingGap ? `Deciding gap: ${t.decidingGap}.` : '',
      join(v.needsFromCandidate) ? `Needs from ${profile.shortName || 'candidate'}: ${join(v.needsFromCandidate)}.` : '',
      (s.domain !== undefined)
        ? `Match score is Claude's estimate: Domain ${s.domain} + Method ${s.methods} + Scope ${s.scope} + Portfolio ${s.portfolio} + Gap ${s.gaps} = ${v.matchScore}.`
        : `Match score is Claude's estimate: ${v.matchScore}.`,
      'Logged via Job Fit Overlay.'
    ].filter(Boolean).join(' ').replace(/\.\./g, '.');

    const title = (metadata.title || '').trim();
    const company = (metadata.company || '').trim();
    const dateAdded = formatDateMDY(today);

    const fields = {
      'Posting URL': url,
      'Role Title': title,
      'Notes': notes,
      'Match Score': v.matchScore ?? '',
      'Priority Score': t.priority ?? '',
      'Confidence': TIER_TO_CONFIDENCE[tier] || '',
      'Date Added': dateAdded,
      'Status': 'To Apply',
      'Company Name': company,
      'Outreach Sent?': 'No',
      'Reached a Person?': 'No',
      'Posted Date': t.postedDate || 'Not stated',
      'Found Via': foundViaFor(rawUrl),
      'Industry': t.industry || '',
      'Work Mode': t.workMode || '',
      'Salary Stated': t.salaryStated || 'Not stated',
      'Years Asked': t.yearsAsked || 'Not stated',
      'Seniority Level': t.seniority || '',
      'JD Saved': 'No',
      'Location': t.location || '',
      'Role Type': t.roleType || '',
      'Contract Type': t.contractType || '',
      'Salary Min (k EUR)': t.salaryMinK ?? '',
      'Salary Max (k EUR)': t.salaryMaxK ?? '',
      'Years Min': t.yearsMin ?? '',
      'Applicants': t.applicants || '',
      'Application Method': t.applicationMethod || url,
      'Gap Category': t.gapCategory || ''
    };

    const archive = {
      company,
      role: title,
      url,
      dateSaved: dateAdded,
      postedDate: t.postedDate || 'Not stated',
      jdText: `[Captured ${dateAdded} by Job Fit Overlay from ${url}; page text as extracted by the extension.]\n\n${(jdText || '').trim()}`
    };

    return { fields, archive, tier, url };
  }

  return {
    canonicalPostingUrl,
    foundViaFor,
    buildTrackerRecord,
    scorePosting,
    applyClarifications,
    evaluateRules,
    extractYears,
    extractWorkMode,
    formatTrackerSummary,
    formatClaudeBrief,
    applyConfig,
    loadLatestRules,
    get PROFILE() { return profile; },
    get STANDING_RULES() { return standingRules; }
  };
});
