// Job Fit Overlay - Background Service Worker / Script
// Communicates with local native messaging host: com.jobfit.claude_host

const NATIVE_HOST = 'com.jobfit.claude_host';

// Popup settings win; otherwise ask the native host for the config file that
// apps-script/setup-tracker.sh writes, and remember it.
function getTrackerConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['trackerWebAppUrl', 'trackerToken', 'trackerSheetUrl'], (cfg) => {
      if (cfg.trackerWebAppUrl && cfg.trackerToken && cfg.trackerSheetUrl) return resolve(cfg);
      chrome.runtime.sendNativeMessage(NATIVE_HOST, { action: 'get_tracker_config' }, (res) => {
        if (chrome.runtime.lastError || !res || !res.ok || !res.url || !res.token) return resolve({});
        // Popup settings win; the file fills what is missing.
        const found = {
          trackerWebAppUrl: cfg.trackerWebAppUrl || res.url,
          trackerToken: cfg.trackerToken || res.token,
          trackerSheetUrl: cfg.trackerSheetUrl || res.sheetUrl || ''
        };
        chrome.storage.local.set(found, () => resolve(found));
      });
    });
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'ping_claude') {
    chrome.runtime.sendNativeMessage(NATIVE_HOST, { action: 'ping' }, (response) => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse(response);
      }
    });
    return true; // async sendResponse
  }

  if (request.action === 'get_tracker_config') {
    getTrackerConfig().then(sendResponse);
    return true; // async sendResponse
  }

  if (request.action === 'log_to_tracker') {
    getTrackerConfig().then(async (cfg) => {
      if (!cfg.trackerWebAppUrl || !cfg.trackerToken) {
        sendResponse({ ok: false, error: 'Tracker not set up. Run apps-script/setup-tracker.sh, or add the web app URL and token in the extension popup.' });
        return;
      }
      try {
        // text/plain keeps this a "simple" request; Apps Script reads the raw body.
        const res = await fetch(cfg.trackerWebAppUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ token: cfg.trackerToken, record: request.record, force: !!request.force }),
          redirect: 'follow'
        });
        const text = await res.text();
        try {
          sendResponse(JSON.parse(text));
        } catch (e) {
          sendResponse({ ok: false, error: `Unexpected reply from Apps Script (HTTP ${res.status}). Check the web app is deployed with access "Anyone".` });
        }
      } catch (err) {
        sendResponse({ ok: false, error: String(err && err.message || err) });
      }
    });
    return true; // async sendResponse
  }

  if (request.action === 'log_pair') {
    chrome.runtime.sendNativeMessage(NATIVE_HOST, { action: 'log_pair', record: request.record }, () => void chrome.runtime.lastError);
    return false;
  }

  if (request.action === 'ask_claude') {
    chrome.runtime.sendNativeMessage(
      NATIVE_HOST,
      { action: 'score_job', prompt: request.prompt },
      (response) => {
        if (chrome.runtime.lastError) {
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse(response);
        }
      }
    );
    return true; // async sendResponse
  }
});
