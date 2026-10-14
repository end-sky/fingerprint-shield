// Fingerprint Shield - background service worker.
//  1. Registers canvas.js (Tor-style canvas readback blocking) for every site
//     except the ones the user allowed via the toolbar button.
//  2. Shows a badge when a page tried to read canvas pixels.
//  3. Applies extra Chromium hardening through the chrome.privacy API.

const CANVAS_SCRIPT_ID = "canvas-block";

// ---------------------------------------------------------------------------
// Per-site canvas permission (the toolbar button is our "Tor prompt")
// ---------------------------------------------------------------------------
const hostOf = (url) => {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u.hostname : null;
  } catch (_) {
    return null;
  }
};

async function getAllowed() {
  const { allowed = [] } = await chrome.storage.local.get("allowed");
  return allowed;
}

async function syncCanvasScript() {
  const allowed = await getAllowed();
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [CANVAS_SCRIPT_ID] });
  } catch (_) {
    // not registered yet
  }
  await chrome.scripting.registerContentScripts([
    {
      id: CANVAS_SCRIPT_ID,
      js: ["canvas.js"],
      matches: ["<all_urls>"],
      excludeMatches: allowed.map((h) => `*://${h}/*`),
      runAt: "document_start",
      allFrames: true,
      matchOriginAsFallback: true,
      world: "MAIN",
      persistAcrossSessions: true,
    },
  ]);
}

async function refreshBadge(tabId, url) {
  const host = hostOf(url);
  const allowed = host ? (await getAllowed()).includes(host) : false;
  try {
    await chrome.action.setBadgeText({ tabId, text: allowed ? "OK" : "" });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: "#2e7d32" });
    await chrome.action.setTitle({
      tabId,
      title: allowed
        ? `Canvas reads ALLOWED on ${host}. Click to block again (reloads page).`
        : "Fingerprint Shield: click to allow canvas reads on this site",
    });
  } catch (_) {
    // tab gone
  }
}

chrome.action.onClicked.addListener(async (tab) => {
  const host = hostOf(tab.url);
  if (!host) return;
  const allowed = await getAllowed();
  const next = allowed.includes(host) ? allowed.filter((h) => h !== host) : [...allowed, host];
  await chrome.storage.local.set({ allowed: next });
  await syncCanvasScript();
  await chrome.tabs.reload(tab.id);
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === "loading") refreshBadge(tabId, tab.url);
});

// relay.js reports blocked reads -> orange "C" badge, like Tor's doorhanger.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type !== "canvas-blocked" || !sender.tab?.id) return;
  const host = hostOf(sender.tab.url) || "this site";
  const tabId = sender.tab.id;
  chrome.action.setBadgeText({ tabId, text: "C" });
  chrome.action.setBadgeBackgroundColor({ tabId, color: "#e65100" });
  chrome.action.setTitle({
    tabId,
    title: `Canvas read blocked on ${host}. Click to allow it (reloads page).`,
  });
});

// ---------------------------------------------------------------------------
// chrome.privacy hardening
// ---------------------------------------------------------------------------
async function set(setting, value, label) {
  if (!setting || typeof setting.set !== "function") return;
  try {
    await setting.set({ value });
  } catch (err) {
    console.warn(`[Fingerprint Shield] could not set ${label}:`, err);
  }
}

async function applyHardening() {
  const p = chrome.privacy;

  // Stop WebRTC from leaking local/public IPs outside the proxy path.
  await set(p.network?.webRTCIPHandlingPolicy, "disable_non_proxied_udp", "webRTCIPHandlingPolicy");
  // No speculative connections (prefetch/preconnect leak browsing intent).
  await set(p.network?.networkPredictionEnabled, false, "networkPredictionEnabled");

  // Tracking / ad-tech surfaces.
  await set(p.websites?.hyperlinkAuditingEnabled, false, "hyperlinkAuditingEnabled");
  await set(p.websites?.doNotTrackEnabled, true, "doNotTrackEnabled");
  await set(p.websites?.topicsEnabled, false, "topicsEnabled");
  await set(p.websites?.fledgeEnabled, false, "fledgeEnabled");
  await set(p.websites?.adMeasurementEnabled, false, "adMeasurementEnabled");
  await set(p.websites?.relatedWebsiteSetsEnabled, false, "relatedWebsiteSetsEnabled");

  // Don't expose autofill data to pages.
  await set(p.services?.autofillAddressEnabled, false, "autofillAddressEnabled");
  await set(p.services?.autofillCreditCardEnabled, false, "autofillCreditCardEnabled");
}

async function init() {
  await syncCanvasScript();
  await applyHardening();
}

chrome.runtime.onInstalled.addListener(init);
chrome.runtime.onStartup.addListener(init);
