/**
 * Job Fit Overlay - Content Script
 * Extracts job description from job board or careers page, runs deterministic scoring,
 * and renders a non-intrusive Shadow-DOM overlay.
 */

(function () {
  'use strict';

  if (window.__JOB_FIT_OVERLAY_INITIALIZED__) {
    return;
  }
  window.__JOB_FIT_OVERLAY_INITIALIZED__ = true;

  let hostEl = null;
  let shadowRoot = null;
  let isExpanded = false;
  let currentResult = null;
  let currentMetadata = { title: '', company: '' };
  let currentCleanText = '';
  let lastEvaluatedTextHash = '';
  let userClarificationChoices = {};

  function isJunkTitle(t) {
    if (!t) return true;
    return /internet explorer|browser.*(support|update)|enable javascript|cookie/i.test(t);
  }

  function extractPosting() {
    let title = '';
    let company = '';
    let text = '';

    // 1. Try structured data (JSON-LD JobPosting) first
    try {
      const scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (const s of scripts) {
        if (!s.innerText) continue;
        const data = JSON.parse(s.innerText);
        const posting = data['@type'] === 'JobPosting'
          ? data
          : (Array.isArray(data['@graph']) ? data['@graph'].find(x => x && x['@type'] === 'JobPosting') : null);
        if (posting) {
          if (posting.title && !isJunkTitle(posting.title)) title = posting.title.trim();
          if (posting.hiringOrganization && posting.hiringOrganization.name) {
            company = posting.hiringOrganization.name.trim();
          }
          if (posting.description) {
            const div = document.createElement('div');
            div.innerHTML = posting.description;
            text = div.innerText.trim();
          }
          if (title && text && text.length > 150) {
            return { title, company, text };
          }
        }
      }
    } catch (e) {
      // Fall through to DOM extraction
    }

    const host = window.location.hostname;

    if (host.includes('linkedin.com')) {
      const titleEl = document.querySelector('.job-details-jobs-unified-top-card__job-title, .jobs-unified-top-card__job-title, h1.t-24, .job-view-layout h1, h1');
      title = titleEl && !isJunkTitle(titleEl.innerText) ? titleEl.innerText.trim() : '';

      const compEl = document.querySelector('.job-details-jobs-unified-top-card__company-name, .jobs-unified-top-card__company-name, .jobs-unified-top-card__subtitle-primary-grouping');
      company = compEl ? compEl.innerText.trim() : '';

      const descEl = document.querySelector('#job-details, .jobs-description-content__text, .jobs-box__html-content, .jobs-description__container');
      text = descEl ? descEl.innerText.trim() : '';
    } else if (host.includes('indeed.com') || host.includes('indeed.ie')) {
      const titleEl = document.querySelector('[data-testid="jobsearch-JobInfoHeader-title"], h1.jobsearch-JobInfoHeader-title, h1');
      title = titleEl && !isJunkTitle(titleEl.innerText) ? titleEl.innerText.trim() : '';

      const compEl = document.querySelector('[data-company-name="true"], [data-testid="inlineHeader-companyName"]');
      company = compEl ? compEl.innerText.trim() : '';

      const descEl = document.querySelector('#jobDescriptionText, .jobsearch-JobComponent-description');
      text = descEl ? descEl.innerText.trim() : '';
    } else if (host.includes('smartrecruiters.com')) {
      const titleEl = document.querySelector('h1.job-title, [data-qa="job-title"], .job-header h1, h1[class*="Title"]');
      title = titleEl && !isJunkTitle(titleEl.innerText) ? titleEl.innerText.trim() : '';

      const compEl = document.querySelector('.company-name, [data-qa="company-name"], .job-header .company');
      company = compEl ? compEl.innerText.trim() : '';

      const descEl = document.querySelector('#st-jobDescription, .job-sections, [data-qa="job-description"], .job-detail');
      text = descEl ? descEl.innerText.trim() : '';
    } else if (host.includes('bamboohr.com')) {
      const titleEl = document.querySelector('h1, .jss-title, [data-qa="job-title"]');
      title = titleEl && !isJunkTitle(titleEl.innerText) ? titleEl.innerText.trim() : '';

      const descEl = document.querySelector('.BambooHR-ATS-Jobs-Item, [data-qa="job-description"], .jss-description, article, main');
      text = descEl ? descEl.innerText.trim() : '';
    } else if (host.includes('jobleads.com')) {
      const titleEl = document.querySelector('h1, .job-detail-header-title');
      title = titleEl && !isJunkTitle(titleEl.innerText) ? titleEl.innerText.trim() : '';

      const descEl = document.querySelector('.job-description, [data-testid="job-description"], .job-detail-body');
      text = descEl ? descEl.innerText.trim() : '';
    } else if (host.includes('irishjobs.ie') || host.includes('jobs.ie')) {
      const titleEl = document.querySelector('h1[data-genesis-element="CARD_HEADING"], h1.job-header-title, h1');
      title = titleEl && !isJunkTitle(titleEl.innerText) ? titleEl.innerText.trim() : '';

      const compEl = document.querySelector('[data-genesis-element="TEXT"][data-testid="company-name"], .company-name');
      company = compEl ? compEl.innerText.trim() : '';

      const descEl = document.querySelector('[data-genesis-element="CARD_BODY"], .job-description, .job-details');
      text = descEl ? descEl.innerText.trim() : '';
    }

    // Generic fallback for direct employer careers pages or other job sites
    if (!text || text.length < 150) {
      if (!title || isJunkTitle(title)) {
        const allH1 = document.querySelectorAll('h1');
        for (const h1 of allH1) {
          const t = h1.innerText.trim();
          if (t && !isJunkTitle(t)) {
            title = t;
            break;
          }
        }
        if (!title) {
          title = !isJunkTitle(document.title) ? document.title : 'Job Posting';
        }
      }
      const genericDesc = document.querySelector('article, [role="main"], main, #job-description, .job-description, .description');
      if (genericDesc && genericDesc.innerText.trim().length > 150) {
        text = genericDesc.innerText.trim();
      } else if (document.body && document.body.innerText.trim().length > 200) {
        text = document.body.innerText.trim();
      }
    }

    return { title, company, text };
  }

  function hashSnippet(str) {
    let hash = 0;
    const len = Math.min(str.length, 1000);
    for (let i = 0; i < len; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return hash + '_' + str.length;
  }

  function ensureShadowRoot() {
    if (shadowRoot) return shadowRoot;

    hostEl = document.getElementById('job-fit-overlay-root');
    if (!hostEl) {
      hostEl = document.createElement('div');
      hostEl.id = 'job-fit-overlay-root';
      document.body.appendChild(hostEl);
    }

    shadowRoot = hostEl.attachShadow({ mode: 'open' });

    // Inject CSS
    const styleLink = document.createElement('link');
    styleLink.rel = 'stylesheet';
    styleLink.href = chrome.runtime.getURL('overlay.css');
    shadowRoot.appendChild(styleLink);

    const container = document.createElement('div');
    container.id = 'jfo-container';
    shadowRoot.appendChild(container);

    return shadowRoot;
  }

  function renderOverlay() {
    ensureShadowRoot();
    const container = shadowRoot.getElementById('jfo-container');
    if (!container || !currentResult) return;

    const r = currentResult;
    const meta = currentMetadata;
    const tierClass = `tier-${r.tier}`;

    if (!isExpanded) {
      container.innerHTML = `
        <div class="jfo-pill" id="jfo-pill-btn" title="Click to view full Job Fit analysis">
          <span class="jfo-pill-badge ${tierClass}">${r.tier}</span>
          <span class="jfo-pill-score">${r.matchScore}%</span>
        </div>
      `;

      shadowRoot.getElementById('jfo-pill-btn').addEventListener('click', () => {
        isExpanded = true;
        renderOverlay();
      });
      return;
    }

    // Build flags/caps banners
    let bannersHtml = '';
    for (const flag of r.flags) {
      let bClass = 'banner-warning';
      if (flag.type === 'exclude' || flag.type === 'auto_low') {
        bClass = 'banner-danger';
      } else if (flag.type === 'info') {
        bClass = 'banner-info';
      }
      bannersHtml += `
        <div class="jfo-banner ${bClass}">
          <div class="jfo-banner-title">${escapeHtml(flag.effect)}</div>
          ${flag.evidence ? `<div class="jfo-banner-evidence">"${escapeHtml(flag.evidence)}"</div>` : ''}
        </div>
      `;
    }

    // Build breakdown bars
    const b = r.breakdown;
    const breakdownHtml = `
      <div>
        <div class="jfo-section-title">Score Breakdown (${r.matchScore}/100)</div>

        <div class="jfo-breakdown-row"><span>Domain Proof</span><span>${b.domain.score}/${b.domain.max}</span></div>
        <div class="jfo-bar-track"><div class="jfo-bar-fill" style="width: ${(b.domain.score / b.domain.max) * 100}%;"></div></div>

        <div class="jfo-breakdown-row"><span>Methods & Tools</span><span>${b.methods.score}/${b.methods.max}</span></div>
        <div class="jfo-bar-track"><div class="jfo-bar-fill" style="width: ${(b.methods.score / b.methods.max) * 100}%;"></div></div>

        <div class="jfo-breakdown-row"><span>Scope & Seniority</span><span>${b.scope.score}/${b.scope.max}</span></div>
        <div class="jfo-bar-track"><div class="jfo-bar-fill" style="width: ${(b.scope.score / b.scope.max) * 100}%;"></div></div>

        <div class="jfo-breakdown-row"><span>Portfolio Fit</span><span>${b.portfolio.score}/${b.portfolio.max}</span></div>
        <div class="jfo-bar-track"><div class="jfo-bar-fill" style="width: ${(b.portfolio.score / b.portfolio.max) * 100}%;"></div></div>

        <div class="jfo-breakdown-row"><span>Gap Count</span><span>${b.gaps.score}/${b.gaps.max}</span></div>
        <div class="jfo-bar-track"><div class="jfo-bar-fill" style="width: ${(b.gaps.score / b.gaps.max) * 100}%;"></div></div>
      </div>
    `;

    // Clarifications & Tuning section
    let clarifyHtml = '';
    if (r.clarifications && r.clarifications.length > 0) {
      clarifyHtml = `
        <div>
          <div class="jfo-section-title">Clarifications & Tuning</div>
          <div class="jfo-clarify-card">
            ${r.clarifications.map(c => {
              const currentChoice = userClarificationChoices[c.id] || c.defaultChoice;
              return `
                <div class="jfo-clarify-item">
                  <div class="jfo-clarify-label">${escapeHtml(c.label)}</div>
                  ${c.description ? `<div class="jfo-clarify-sub">${escapeHtml(c.description)}</div>` : ''}
                  <div class="jfo-clarify-options">
                    ${c.options.map(opt => {
                      const isSel = opt.value === currentChoice;
                      const isPositive = isSel && (opt.delta > 0 || opt.value === 'yes' || opt.value === 'accept');
                      const activeCls = isSel ? (isPositive ? 'active active-positive' : 'active') : '';
                      return `<button class="jfo-clarify-btn ${activeCls}" data-cid="${c.id}" data-val="${opt.value}">${escapeHtml(opt.label)}</button>`;
                    }).join('')}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }

    // Matched skills chips
    const allHits = [...b.domain.hits, ...b.methods.hits, ...b.scope.hits, ...b.portfolio.hits];
    let hitsHtml = '';
    if (allHits.length > 0) {
      hitsHtml = `
        <div>
          <div class="jfo-section-title">Matched Qualifications</div>
          <div class="jfo-chips-wrap">
            ${allHits.map(h => `<span class="jfo-chip jfo-chip-hit">✓ ${escapeHtml(h)}</span>`).join('')}
          </div>
        </div>
      `;
    }

    // Determine Claude Action Button based on triage tier
    let claudeBtnLabel = '🚀 Feed to Claude';
    let claudeBtnClass = 'jfo-btn-green';

    if (r.tier === 'SKIP' || r.tier === 'AUTO-LOW' || r.tier === 'EXCLUDE' || r.matchScore < 50) {
      claudeBtnLabel = '⚠️ Feed to Claude (Are you sure?)';
      claudeBtnClass = 'jfo-btn-red';
    } else if (r.tier === 'MID' || (r.matchScore >= 50 && r.matchScore < 70)) {
      claudeBtnLabel = '🤔 Feed to Claude (2nd Opinion)';
      claudeBtnClass = 'jfo-btn-amber';
    }

    let claudeResponseHtml = '';
    if (r.claudeVerdict) {
      const cv = r.claudeVerdict;
      claudeResponseHtml = `
        <div class="jfo-claude-verdict-box">
          <div class="jfo-section-title" style="color: #6366f1;">⚡ Claude Live Assessment</div>
          <div style="font-size: 13px; font-weight: 600; margin-bottom: 6px;">
            Match: ${cv.matchScore}/100 (${cv.confidence || cv.tier})
          </div>
          ${r.triageScore !== undefined ? `
            <div style="font-size: 11px; opacity: 0.75; margin-bottom: 6px;">
              Extension triage: ${r.triageScore}/100 (Δ ${cv.matchScore - r.triageScore >= 0 ? '+' : ''}${cv.matchScore - r.triageScore})
            </div>
          ` : ''}
          ${cv.contextMissing && cv.contextMissing.length ? `
            <div style="font-size: 11px; color: #ef4444; margin-bottom: 6px;">
              ⚠ Not loaded: ${escapeHtml(cv.contextMissing.join(', '))}
            </div>
          ` : ''}
          ${cv.whyItScoresWell && cv.whyItScoresWell.length ? `
            <div style="margin-bottom: 6px;">
              <strong style="color: #10b981; font-size: 11px;">Why it scores well:</strong>
              <ul style="margin: 4px 0 0 16px; padding: 0; font-size: 11px; line-height: 1.4;">
                ${cv.whyItScoresWell.map(w => `<li>${escapeHtml(w)}</li>`).join('')}
              </ul>
            </div>
          ` : ''}
          ${cv.whatHoldsItBack && cv.whatHoldsItBack.length ? `
            <div style="margin-bottom: 6px;">
              <strong style="color: #f59e0b; font-size: 11px;">What holds it back:</strong>
              <ul style="margin: 4px 0 0 16px; padding: 0; font-size: 11px; line-height: 1.4;">
                ${cv.whatHoldsItBack.map(h => `<li>${escapeHtml(h)}</li>`).join('')}
              </ul>
            </div>
          ` : ''}
          ${cv.needsFromCandidate && cv.needsFromCandidate.length ? `
            <div>
              <strong style="color: #60a5fa; font-size: 11px;">Needs from you:</strong>
              <ul style="margin: 4px 0 0 16px; padding: 0; font-size: 11px; line-height: 1.4;">
                ${cv.needsFromCandidate.map(n => `<li>${escapeHtml(n)}</li>`).join('')}
              </ul>
            </div>
          ` : ''}
        </div>
      `;
    }

    container.innerHTML = `
      <div class="jfo-card">
        <div class="jfo-header">
          <div class="jfo-header-left">
            <div class="jfo-score-ring ${tierClass}">${r.matchScore}</div>
            <div class="jfo-title-box">
              <div class="jfo-title-main" title="${escapeHtml(meta.title || 'Job Posting')}">${escapeHtml(meta.title || 'Job Posting')}</div>
              <div class="jfo-company-sub">${escapeHtml(meta.company || r.workMode)}</div>
            </div>
          </div>
          <button class="jfo-btn-icon" id="jfo-close-btn" title="Minimize">✕</button>
        </div>

        <div class="jfo-body">
          ${claudeResponseHtml}
          ${bannersHtml}
          ${clarifyHtml}
          ${breakdownHtml}
          ${hitsHtml}
          <div>
            <div class="jfo-section-title">Work Mode & Rules</div>
            <div class="jfo-chips-wrap">
              <span class="jfo-chip">Mode: ${escapeHtml(r.workMode)}</span>
              ${r.maxYears > 0 ? `<span class="jfo-chip">${r.maxYears} Yrs Mentioned</span>` : ''}
              ${JobFitScorer.PROFILE.commuteLimitMinutes ? `<span class="jfo-chip">Commute &lt; ${JobFitScorer.PROFILE.commuteLimitMinutes} min</span>` : ''}
            </div>
          </div>
        </div>

        <div class="jfo-footer">
          <button class="jfo-btn ${claudeBtnClass} jfo-btn-claude" id="jfo-feed-claude-btn" title="Ask local Claude or copy brief">${escapeHtml(claudeBtnLabel)}</button>
          <button class="jfo-btn jfo-btn-secondary" id="jfo-log-btn" ${r.claudeVerdict ? '' : 'disabled'} title="${r.claudeVerdict ? 'Write Claude\'s verdict to the Job Applications tracker and archive the JD' : 'Feed to Claude first; the tracker logs Claude\'s score'}">${r.trackerLog && r.trackerLog.ok ? `✅ Row ${r.trackerLog.row}` : '📝 Log'}</button>
          <button class="jfo-btn jfo-btn-secondary" id="jfo-copy-btn" title="Copy summary for Google Sheets">📋</button>
          <button class="jfo-btn jfo-btn-secondary" id="jfo-rescore-btn" title="Re-evaluate page">🔄</button>
        </div>

        <div class="jfo-toast" id="jfo-toast">Copied to clipboard!</div>
      </div>
    `;

    shadowRoot.getElementById('jfo-close-btn').addEventListener('click', () => {
      isExpanded = false;
      renderOverlay();
    });

    shadowRoot.getElementById('jfo-rescore-btn').addEventListener('click', () => {
      evaluatePage(true);
    });

    // Wire clarification buttons
    shadowRoot.querySelectorAll('.jfo-clarify-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const cid = e.target.getAttribute('data-cid');
        const val = e.target.getAttribute('data-val');
        userClarificationChoices[cid] = val;
        currentResult = JobFitScorer.applyClarifications(currentResult, userClarificationChoices);
        renderOverlay();
      });
    });

    shadowRoot.getElementById('jfo-copy-btn').addEventListener('click', () => {
      const summary = JobFitScorer.formatTrackerSummary(currentResult, currentMetadata);
      navigator.clipboard.writeText(summary).then(() => {
        showToast('Tracker summary copied!');
      });
    });

    const logBtn = shadowRoot.getElementById('jfo-log-btn');
    logBtn.addEventListener('click', () => {
      const cv = currentResult && currentResult.claudeVerdict;
      if (!cv) return;
      if (currentResult.trackerLog && currentResult.trackerLog.ok &&
          !window.confirm(`Already logged to row ${currentResult.trackerLog.row}. Log again?`)) {
        return;
      }
      const record = JobFitScorer.buildTrackerRecord(cv, currentMetadata, window.location.href, currentCleanText);
      if ((record.tier === 'LOW' || record.tier === 'SKIP') &&
          !window.confirm(`Claude rated this ${record.tier}. Standing rule: only mid and high roles are logged. Log it anyway?`)) {
        return;
      }
      sendLog(record, false);
    });

    function sendLog(record, force) {
      logBtn.disabled = true;
      logBtn.textContent = '⏳';
      chrome.runtime.sendMessage({ action: 'log_to_tracker', record, force }, (res) => {
        logBtn.disabled = false;
        logBtn.textContent = '📝 Log';
        if (chrome.runtime.lastError || !res) {
          showToast('Tracker logging failed: extension error');
          return;
        }
        if (res.duplicate) {
          const d = res.duplicate;
          const again = window.confirm(
            `Already in the tracker (${d.reason}): row ${d.row}, "${d.title}" at ${d.company}, status ${d.status || 'blank'}.\n\nLog a new row anyway?`
          );
          if (again) sendLog(record, true);
          return;
        }
        if (!res.ok) {
          showToast(`Not logged: ${res.error || 'unknown error'}`);
          return;
        }
        currentResult.trackerLog = res;
        renderOverlay();
        showToast(res.jdSaved
          ? `Logged to row ${res.row}; JD archived (row ${res.archiveRow})`
          : `Logged to row ${res.row}; JD archive not confirmed, JD Saved left No`);
      });
    }

    const feedClaudeBtn = shadowRoot.getElementById('jfo-feed-claude-btn');
    feedClaudeBtn.addEventListener('click', () => {
      const meta = Object.assign({}, currentMetadata, { pageFacts: collectPageFacts() });
      const brief = JobFitScorer.formatClaudeBrief(currentResult, meta, currentCleanText);
      
      feedClaudeBtn.disabled = true;
      const originalText = feedClaudeBtn.textContent;
      feedClaudeBtn.textContent = '⏳ Asking Claude...';
      showToast('Contacting Claude CLI...');

      // Send to background service worker -> native messaging host
      chrome.runtime.sendMessage({ action: 'ask_claude', prompt: brief }, (response) => {
        feedClaudeBtn.disabled = false;
        feedClaudeBtn.textContent = originalText;

        if (response && response.success && response.data) {
          const cv = response.data;
          if (currentResult.triageScore === undefined) {
            currentResult.triageScore = currentResult.matchScore;
          }
          cv.contextMissing = response.contextMissing || [];
          currentResult.claudeVerdict = cv;
          if (cv.matchScore) {
            currentResult.matchScore = cv.matchScore;
          }
          if (cv.tier) {
            currentResult.tier = cv.tier.toUpperCase();
          }
          showToast('Claude evaluation received!');
          renderOverlay();
        } else {
          // Fallback: Copy to clipboard and open Claude web
          navigator.clipboard.writeText(brief).then(() => {
            showToast('CLI unavailable. Copied brief! Opening Claude...');
            setTimeout(() => {
              window.open('https://claude.ai/new', '_blank');
            }, 300);
          });
        }
      });
    });
  }

  // Posting age and applicant count sit in the page header, outside the JD
  // text, but the tracker's Posted Date, Applicants and Priority need them.
  function collectPageFacts() {
    const text = (document.body && document.body.innerText) || '';
    const re = /(Reposted\s+)?\b\d+\s+(?:minute|hour|day|week|month)s?\s+ago\b|\b(?:Over\s+)?\d[\d,]*\+?\s+applicants\b|Be among the first \d+ applicants|\bPosted\s+(?:today|yesterday|\d+\+?\s+days?\s+ago)\b/gi;
    const seen = [];
    let m;
    while ((m = re.exec(text)) && seen.length < 4) {
      const v = m[0].replace(/\s+/g, ' ').trim();
      if (!seen.includes(v)) seen.push(v);
    }
    return seen;
  }

  function showToast(msg) {
    const toast = shadowRoot.getElementById('jfo-toast');
    if (toast) {
      toast.textContent = msg;
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 2000);
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async function evaluatePage(force = false) {
    const { title, company, text } = extractPosting();
    if (!text || text.length < 80) return;

    // Dynamically pull latest rules from disk (zero-cache via symlink)
    await JobFitScorer.loadLatestRules();

    const hash = hashSnippet(text);
    if (!force && hash === lastEvaluatedTextHash) {
      return;
    }

    lastEvaluatedTextHash = hash;
    userClarificationChoices = {};
    currentMetadata = { title, company };
    currentCleanText = text;
    currentResult = JobFitScorer.scorePosting(text, title);

    renderOverlay();
  }

  // Initial evaluation after DOM idle
  setTimeout(() => evaluatePage(), 500);

  // Monitor SPA transitions and dynamic job clicks (LinkedIn, Indeed)
  let lastUrl = window.location.href;
  setInterval(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      setTimeout(() => evaluatePage(), 800);
    }
  }, 1000);

  const observer = new MutationObserver(() => {
    // Debounce mutation checks
    clearTimeout(window.__jfo_mut_timer);
    window.__jfo_mut_timer = setTimeout(() => {
      evaluatePage();
    }, 1200);
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'get_status') {
      evaluatePage(true);
      sendResponse({ result: currentResult, metadata: currentMetadata });
    } else if (request.action === 'force_rescore') {
      evaluatePage(true);
      sendResponse({ result: currentResult, metadata: currentMetadata });
    }
    return true;
  });
})();
