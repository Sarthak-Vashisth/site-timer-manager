const DEFAULT_LIMIT_MINUTES = 30;
const MIN_LIMIT_MINUTES = 1;
const MAX_LIMIT_MINUTES = 240;
const SESSION_KEY = "watchLimitSessions";
const LIMIT_KEY = "limitMinutes";
const PROTECTED_SITES_KEY = "protectedSites";
const DAILY_WATCHTIME_KEY = "dailyWatchtime";
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
  await removeSession(tabId, { recordWatchtime: true });
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
  if (message?.type === "getTodaysWatchtime") {
    getTodaysWatchtime().then(sendResponse);
    return true;
  }

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
    await removeSession(tabId, { recordWatchtime: true });
    return;
  }

  const sessions = await getSessions();
  const existing = sessions[String(tabId)];

  if (existing?.siteId === site.id) {
    notifyTab(tabId, existing);
    return;
  }

  if (existing) {
    chrome.alarms.clear(alarmName(tabId));
    await removeSession(tabId, { recordWatchtime: true });
  }

  const reusableSession = findRunningSiteSession(sessions, site.id);
  const limitMinutes = reusableSession?.limitMinutes ?? await getLimitMinutes();
  const startedAt = reusableSession?.startedAt ?? Date.now();
  const endsAt = reusableSession?.endsAt ?? startedAt + limitMinutes * 60 * 1000;

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

function findRunningSiteSession(sessions, siteId) {
  const now = Date.now();

  return Object.values(sessions).find((session) => {
    return session.siteId === siteId && session.endsAt > now;
  }) ?? null;
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

async function removeSession(tabId, { recordWatchtime = false } = {}) {
  const sessions = await getSessions();
  const session = sessions[String(tabId)];

  if (recordWatchtime && session && isLastRunningSessionForSite(sessions, tabId, session.siteId)) {
    await addWatchtime(session);
  }

  delete sessions[String(tabId)];
  await saveSessions(sessions);
}

async function stopTimerForTab(tabId) {
  chrome.alarms.clear(alarmName(tabId));
  await removeSession(tabId, { recordWatchtime: true });
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

function isLastRunningSessionForSite(sessions, closingTabId, siteId) {
  const now = Date.now();

  return !Object.entries(sessions).some(([tabId, session]) => {
    return tabId !== String(closingTabId) && session.siteId === siteId && session.endsAt > now;
  });
}

async function addWatchtime(session) {
  const now = Date.now();
  const dayStart = getTodayStartMs();
  const elapsedMs = Math.max(0, Math.min(now, session.endsAt) - Math.max(session.startedAt, dayStart));

  if (elapsedMs === 0) {
    return;
  }

  const dailyWatchtime = await getDailyWatchtime();
  const existingEntry = dailyWatchtime.sites[session.siteId] ?? {
    label: session.siteLabel,
    totalMs: 0
  };

  dailyWatchtime.sites[session.siteId] = {
    label: session.siteLabel,
    totalMs: existingEntry.totalMs + elapsedMs
  };

  await chrome.storage.local.set({ [DAILY_WATCHTIME_KEY]: dailyWatchtime });
}

async function getTodaysWatchtime() {
  const dailyWatchtime = await getDailyWatchtime();
  const sessions = await getSessions();
  const now = Date.now();
  const dayStart = getTodayStartMs();
  const activeSiteSessions = new Map();

  for (const session of Object.values(sessions)) {
    if (session.endsAt <= now || activeSiteSessions.has(session.siteId)) {
      continue;
    }

    activeSiteSessions.set(session.siteId, session);
  }

  for (const session of activeSiteSessions.values()) {
    const elapsedMs = Math.max(0, Math.min(now, session.endsAt) - Math.max(session.startedAt, dayStart));
    const existingEntry = dailyWatchtime.sites[session.siteId] ?? {
      label: session.siteLabel,
      totalMs: 0
    };

    dailyWatchtime.sites[session.siteId] = {
      label: session.siteLabel,
      totalMs: existingEntry.totalMs + elapsedMs
    };
  }

  return dailyWatchtime;
}

async function getDailyWatchtime() {
  const today = getTodayKey();
  const { [DAILY_WATCHTIME_KEY]: dailyWatchtime } = await chrome.storage.local.get(DAILY_WATCHTIME_KEY);

  if (dailyWatchtime?.date === today && dailyWatchtime.sites) {
    return {
      date: today,
      sites: dailyWatchtime.sites
    };
  }

  return {
    date: today,
    sites: {}
  };
}

function getTodayKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getTodayStartMs() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}
