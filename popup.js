/**
 * Job Fit Scorer - Popup Controller
 */

(function () {
  'use strict';

  const badgeEl = document.getElementById('badge');
  const scoreEl = document.getElementById('score');
  const titleEl = document.getElementById('page-title');
  const metaEl = document.getElementById('page-meta');
  const scoreBtn = document.getElementById('score-btn');
  const trackerBtn = document.getElementById('tracker-btn');

  function updateUI(result, metadata) {
    if (!result) {
      badgeEl.className = 'score-badge tier-LOW';
      badgeEl.textContent = 'NO POST';
      scoreEl.textContent = '--';
      titleEl.textContent = 'No job post detected';
      metaEl.textContent = 'Navigate to a job posting on LinkedIn, Indeed, etc.';
      return;
    }

    badgeEl.className = `score-badge tier-${result.tier}`;
    badgeEl.textContent = result.tier;
    scoreEl.textContent = `${result.matchScore}%`;
    titleEl.textContent = metadata.title || 'Job Posting';
    titleEl.title = metadata.title || '';

    const flagsStr = result.flags.length > 0 ? ` • ${result.flags.map(f => f.name).join(', ')}` : '';
    metaEl.textContent = `${metadata.company || result.workMode}${flagsStr}`;
  }

  function queryTab() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || tabs.length === 0) return;
      const tabId = tabs[0].id;

      chrome.tabs.sendMessage(tabId, { action: 'get_status' }, (response) => {
        if (chrome.runtime.lastError || !response) {
          // If content script was not injected on this domain, inject it on-demand
          chrome.scripting.executeScript({
            target: { tabId },
            files: ['rules.js', 'engine.js', 'content.js']
          }).then(() => {
            setTimeout(() => {
              chrome.tabs.sendMessage(tabId, { action: 'get_status' }, (res2) => {
                if (res2) updateUI(res2.result, res2.metadata);
              });
            }, 300);
          }).catch(() => {
            updateUI(null);
          });
          return;
        }
        updateUI(response.result, response.metadata);
      });
    });
  }

  scoreBtn.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || tabs.length === 0) return;
      const tabId = tabs[0].id;
      chrome.tabs.sendMessage(tabId, { action: 'force_rescore' }, (response) => {
        if (response) updateUI(response.result, response.metadata);
      });
    });
  });

  trackerBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'get_tracker_config' }, (cfg) => {
      if (cfg && cfg.trackerSheetUrl) chrome.tabs.create({ url: cfg.trackerSheetUrl });
      else trackerBtn.textContent = 'Set the sheet URL under Tracker logging setup';
    });
  });

  const profile = (typeof JOB_PIPELINE_RULES !== 'undefined' && JOB_PIPELINE_RULES.profile) || {};
  const rules = (typeof JOB_PIPELINE_RULES !== 'undefined' && JOB_PIPELINE_RULES.rules) || [];
  document.getElementById('profile-line').textContent = [profile.name, profile.targetTitle].filter(Boolean).join(' | ') || 'No profile in rules.json';
  document.getElementById('profile-list').innerHTML = [
    ['Target', profile.targetTitle],
    ['Location', profile.location && `${profile.location} (<${profile.commuteLimitMinutes} min commute, relocation: ${profile.relocation})`],
    ['Floor', profile.salaryFloorPermanent && `${profile.salaryFloorPermanent} perm / ${profile.salaryFloorContract} contract`],
    ['Standing rules', rules.map(r => `${r.id}: ${r.effect}`).join('; ')]
  ].filter(([, v]) => v).map(([k, v]) => `<li><strong>${k}:</strong> ${String(v).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</li>`).join('');

  const trackerUrlEl = document.getElementById('tracker-url');
  const trackerTokenEl = document.getElementById('tracker-token');
  const trackerSheetEl = document.getElementById('tracker-sheet');
  const trackerStatusEl = document.getElementById('tracker-status');

  function loadTrackerSettings() {
    chrome.storage.local.get(['trackerWebAppUrl', 'trackerToken', 'trackerSheetUrl'], (cfg) => {
      trackerUrlEl.value = cfg.trackerWebAppUrl || '';
      trackerSheetEl.value = cfg.trackerSheetUrl || '';
      trackerTokenEl.value = cfg.trackerToken || '';
      trackerStatusEl.textContent = cfg.trackerWebAppUrl && cfg.trackerToken
        ? 'Logging is set up.'
        : 'Not set up yet: the card\'s Log button needs both values.';
      if (!cfg.trackerWebAppUrl || !cfg.trackerToken) {
        document.getElementById('tracker-settings').open = true;
      }
    });
  }

  document.getElementById('tracker-save').addEventListener('click', () => {
    const url = trackerUrlEl.value.trim();
    const token = trackerTokenEl.value.trim();
    if (url && !/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(url)) {
      trackerStatusEl.textContent = 'That URL should look like https://script.google.com/macros/s/<id>/exec';
      return;
    }
    chrome.storage.local.set({ trackerWebAppUrl: url, trackerToken: token, trackerSheetUrl: trackerSheetEl.value.trim() }, () => {
      trackerStatusEl.textContent = url && token ? 'Saved. Logging is set up.' : 'Saved, but both values are needed.';
    });
  });

  document.addEventListener('DOMContentLoaded', () => {
    queryTab();
    loadTrackerSettings();
  });
})();
