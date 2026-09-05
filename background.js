const DEFAULT_LIMIT_MINUTES = 30;
const MIN_LIMIT_MINUTES = 1;
const MAX_LIMIT_MINUTES = 240;
const SESSION_KEY = "watchLimitSessions";
const LIMIT_KEY = "limitMinutes";
const PROTECTED_SITES_KEY = "protectedSites";
const ALARM_PREFIX = "close-tab-";
const DEFAULT_PROTECTED_SITES = ["youtube.com", "instagram.com"];

chrome.runtime.onInstalled.addListener(async () => {
  const {
    [LIMIT_KEY]: limitMinutes,
    [PROTECTED_SITES_KEY]: protectedSites
  } = await chrome.storage.sync.get([LIMIT_KEY, PROTECTED_SITES_KEY]);

  if (!Number.isFinite(limitMinutes)) {
    await chrome.storage.sync.set({ [LIMIT_KEY]: DEFAULT_LIMIT_MINUTES });
  }

  if (!Array.isArray(protectedSites)) {
    await chrome.storage.sync.set({ [PROTECTED_SITES_KEY]: DEFAULT_PROTECTED_SITES });
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "sync" && changes[PROTECTED_SITES_KEY]) {
    recheckOpenTabs();
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === "complete") {
    trackTab(tabId, tab.url);
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    await trackTab(tabId, tab.url);
  } catch {
    // The tab may have closed before Chrome returned it.
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  chrome.alarms.clear(alarmName(tabId));
  await removeSession(tabId);
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm.name.startsWith(ALARM_PREFIX)) {
    return;
  }

  const tabId = Number(alarm.name.slice(ALARM_PREFIX.length));

  try {
    await chrome.tabs.remove(tabId);
  } catch {
    await removeSession(tabId);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!sender.tab?.id) {
    return false;
  }

  if (message?.type === "getTimerSession") {
    getSessionForTab(sender.tab.id).then(sendResponse);
    return true;
  }

  if (message?.type === "stopTimerForAllowedChannel") {
    stopTimerForTab(sender.tab.id).then(sendResponse);
    return true;
  }

  if (message?.type === "restartTimerForLimitedSite") {
    trackTab(sender.tab.id, message.url || sender.tab.url).then(() => sendResponse({ ok: true }));
    return true;
  }

  return false;
});

async function trackTab(tabId, url) {
  const site = await getLimitedSite(url);

  if (!site) {
    chrome.alarms.clear(alarmName(tabId));
    await removeSession(tabId);
    return;
  }

  const sessions = await getSessions();
  const existing = sessions[String(tabId)];

  if (existing?.siteId === site.id) {
    notifyTab(tabId, existing);
    return;
  }

  const limitMinutes = await getLimitMinutes();
  const startedAt = Date.now();
  const endsAt = startedAt + limitMinutes * 60 * 1000;

  sessions[String(tabId)] = {
    siteId: site.id,
    siteLabel: site.label,
    startedAt,
    endsAt,
    limitMinutes
  };

  await saveSessions(sessions);
  chrome.alarms.create(alarmName(tabId), { when: endsAt });
  notifyTab(tabId, sessions[String(tabId)]);
}

async function getLimitedSite(url) {
  if (!url) {
    return null;
  }

  try {
    const { hostname } = new URL(url);
    const host = hostname.toLowerCase();
    const protectedSites = await getProtectedSites();
    const matchedSite = protectedSites.find((siteHost) => host === siteHost || host.endsWith(`.${siteHost}`));

    if (!matchedSite) {
      return null;
    }

    return {
      id: matchedSite,
      label: matchedSite
    };
  } catch {
    return null;
  }
}

async function recheckOpenTabs() {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map((tab) => trackTab(tab.id, tab.url)));
}

async function getLimitMinutes() {
  const { [LIMIT_KEY]: storedLimit } = await chrome.storage.sync.get(LIMIT_KEY);
  return normalizeLimit(storedLimit);
}

async function getProtectedSites() {
  const { [PROTECTED_SITES_KEY]: protectedSites } =
    await chrome.storage.sync.get(PROTECTED_SITES_KEY);

  if (!Array.isArray(protectedSites)) {
    return DEFAULT_PROTECTED_SITES;
  }

  return [...new Set(protectedSites.map(normalizeSiteHost).filter(Boolean))];
}

function normalizeSiteHost(value) {
  const rawValue = String(value).trim().toLowerCase();

  if (!rawValue) {
    return "";
  }

  try {
    const parsedUrl = rawValue.includes("://") ? new URL(rawValue) : new URL(`https://${rawValue}`);
    return parsedUrl.hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function normalizeLimit(value) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return DEFAULT_LIMIT_MINUTES;
  }

  return Math.min(MAX_LIMIT_MINUTES, Math.max(MIN_LIMIT_MINUTES, Math.round(parsed)));
}

async function getSessions() {
  const { [SESSION_KEY]: sessions = {} } = await chrome.storage.local.get(SESSION_KEY);
  return sessions;
}

async function saveSessions(sessions) {
  await chrome.storage.local.set({ [SESSION_KEY]: sessions });
}

async function removeSession(tabId) {
  const sessions = await getSessions();
  delete sessions[String(tabId)];
  await saveSessions(sessions);
}

async function stopTimerForTab(tabId) {
  chrome.alarms.clear(alarmName(tabId));
  await removeSession(tabId);
  notifyTab(tabId, null);
  return { ok: true };
}

async function getSessionForTab(tabId) {
  const sessions = await getSessions();
  const session = sessions[String(tabId)];

  if (!session || session.endsAt <= Date.now()) {
    return { session: null };
  }

  return { session };
}

function notifyTab(tabId, session) {
  chrome.tabs.sendMessage(tabId, { type: "timerSessionUpdated", session }).catch(() => {
    // The content script may not be ready yet; it will request the session when it loads.
  });
}

function alarmName(tabId) {
  return `${ALARM_PREFIX}${tabId}`;
}
