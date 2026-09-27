const DEFAULT_LIMIT_MINUTES = 30;
const LIMIT_KEY = "limitMinutes";
const SESSION_KEY = "watchLimitSessions";
const ALLOWED_CHANNELS_KEY = "allowedChannelUrls";
const PROTECTED_SITES_KEY = "protectedSites";
const DEFAULT_PROTECTED_SITES = ["youtube.com", "instagram.com"];

const form = document.querySelector("#settings-form");
const limitInput = document.querySelector("#limit-minutes");
const saveButton = form.querySelector("button");
const lockStatus = document.querySelector("#lock-status");
const saveStatus = document.querySelector("#save-status");
const refreshWatchtimeButton = document.querySelector("#refresh-watchtime");
const watchtimeList = document.querySelector("#watchtime-list");
const siteForm = document.querySelector("#site-form");
const siteInput = document.querySelector("#site-url");
const siteStatus = document.querySelector("#site-status");
const toggleSitesButton = document.querySelector("#toggle-sites");
const siteList = document.querySelector("#site-list");
const channelForm = document.querySelector("#channel-form");
const channelInput = document.querySelector("#channel-url");
const channelStatus = document.querySelector("#channel-status");
const toggleChannelsButton = document.querySelector("#toggle-channels");
const channelList = document.querySelector("#channel-list");
let sitesVisible = true;
let channelsVisible = false;

loadSettings();
loadTodaysWatchtime();
loadProtectedSites();
loadAllowedChannels();

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (await hasRunningTimer()) {
    setLockedState(true);
    saveStatus.textContent = "";
    return;
  }

  const limitMinutes = normalizeLimit(limitInput.value);
  limitInput.value = String(limitMinutes);

  await chrome.storage.sync.set({ [LIMIT_KEY]: limitMinutes });

  saveStatus.textContent = `Saved ${limitMinutes} minute limit.`;
  window.setTimeout(() => {
    saveStatus.textContent = "";
  }, 1800);
});

channelForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const normalizedUrl = normalizeChannelUrl(channelInput.value);

  if (!normalizedUrl) {
    showChannelStatus("Add a valid YouTube channel URL.", true);
    return;
  }

  const channels = await getAllowedChannels();

  if (channels.includes(normalizedUrl)) {
    showChannelStatus("This channel is already added.", true);
    return;
  }

  const nextChannels = [...channels, normalizedUrl];
  await chrome.storage.sync.set({ [ALLOWED_CHANNELS_KEY]: nextChannels });

  channelInput.value = "";
  showChannelStatus("Channel added.");
  setChannelsVisible(true);
  renderAllowedChannels(nextChannels);
});

siteForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const { host: normalizedSite, error } = validateSiteInput(siteInput.value);

  siteInput.setAttribute("aria-invalid", String(Boolean(error)));
  if (error) {
    showStatus(siteStatus, error, true);
    return;
  }

  const sites = await getProtectedSites();

  if (sites.includes(normalizedSite)) {
    renderProtectedSites(sites);
    setSitesVisible(true);
    showStatus(siteStatus, `${normalizedSite} is already in your protected sites.`);
    return;
  }

  const nextSites = [...sites, normalizedSite].sort();
  try {
    await chrome.storage.sync.set({ [PROTECTED_SITES_KEY]: nextSites });
  } catch {
    showStatus(siteStatus, `Could not save ${normalizedSite}. Please try again.`, true);
    return;
  }

  siteInput.value = "";
  showStatus(siteStatus, `${normalizedSite} added to your protected sites.`);
  setSitesVisible(true);
  renderProtectedSites(nextSites);
});

toggleSitesButton.addEventListener("click", () => {
  setSitesVisible(!sitesVisible);
});

refreshWatchtimeButton.addEventListener("click", () => {
  loadTodaysWatchtime();
});

toggleChannelsButton.addEventListener("click", () => {
  setChannelsVisible(!channelsVisible);
});

window.setInterval(loadTodaysWatchtime, 1000);

async function loadSettings() {
  const { [LIMIT_KEY]: storedLimit } = await chrome.storage.sync.get(LIMIT_KEY);
  limitInput.value = String(normalizeLimit(storedLimit));
  setLockedState(await hasRunningTimer());
}

async function loadAllowedChannels() {
  renderAllowedChannels(await getAllowedChannels());
}

async function loadProtectedSites() {
  renderProtectedSites(await getProtectedSites());
}

async function loadTodaysWatchtime() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "getTodaysWatchtime" });
    renderTodaysWatchtime(response?.sites ?? {});
  } catch {
    renderTodaysWatchtime({});
  }
}

async function hasRunningTimer() {
  const { [SESSION_KEY]: sessions = {} } = await chrome.storage.local.get(SESSION_KEY);
  const sessionEntries = Object.entries(sessions);

  if (sessionEntries.length === 0) {
    return false;
  }

  const tabs = await chrome.tabs.query({});
  const openTabIds = new Set(tabs.map((tab) => String(tab.id)));

  return sessionEntries.some(([tabId, session]) => openTabIds.has(tabId) &&
    (session.paused ? session.remainingMs > 0 : session.endsAt > Date.now()));
}

function renderTodaysWatchtime(sites) {
  const entries = Object.entries(sites)
    .filter(([, entry]) => Number(entry.totalMs) > 0)
    .sort(([, first], [, second]) => second.totalMs - first.totalMs);

  watchtimeList.textContent = "";

  if (entries.length === 0) {
    const emptyItem = document.createElement("li");
    emptyItem.className = "watchtime-list__empty";
    emptyItem.textContent = "No protected-site watchtime yet today.";
    watchtimeList.append(emptyItem);
    return;
  }

  entries.forEach(([siteHost, entry]) => {
    const item = document.createElement("li");
    const label = document.createElement("span");
    const time = document.createElement("strong");

    label.textContent = entry.label || siteHost;
    time.textContent = formatDuration(entry.totalMs);

    item.append(label, time);
    watchtimeList.append(item);
  });
}

async function getAllowedChannels() {
  const { [ALLOWED_CHANNELS_KEY]: channels = [] } = await chrome.storage.sync.get(ALLOWED_CHANNELS_KEY);
  return channels.map(normalizeChannelUrl).filter(Boolean);
}

async function getProtectedSites() {
  const { [PROTECTED_SITES_KEY]: sites } =
    await chrome.storage.sync.get(PROTECTED_SITES_KEY);

  if (!Array.isArray(sites)) {
    return DEFAULT_PROTECTED_SITES;
  }

  return [...new Set(sites.map(normalizeSiteHost).filter(Boolean))].sort();
}

async function removeProtectedSite(siteHost) {
  const nextSites = (await getProtectedSites()).filter((host) => host !== siteHost);
  await chrome.storage.sync.set({ [PROTECTED_SITES_KEY]: nextSites });
  renderProtectedSites(nextSites);
  showStatus(siteStatus, `${siteHost} removed from your protected sites.`);
}

async function removeAllowedChannel(channelUrl) {
  const nextChannels = (await getAllowedChannels()).filter((url) => url !== channelUrl);
  await chrome.storage.sync.set({ [ALLOWED_CHANNELS_KEY]: nextChannels });
  renderAllowedChannels(nextChannels);
  showChannelStatus("Channel removed.");
}

function renderProtectedSites(sites) {
  siteList.textContent = "";

  if (sites.length === 0) {
    const emptyItem = document.createElement("li");
    emptyItem.className = "managed-list__empty";
    emptyItem.textContent = "No protected sites added.";
    siteList.append(emptyItem);
    return;
  }

  sites.forEach((siteHost) => {
    const item = document.createElement("li");
    const label = document.createElement("span");
    const removeButton = document.createElement("button");

    label.textContent = siteHost;
    removeButton.type = "button";
    removeButton.textContent = "Remove";
    removeButton.addEventListener("click", () => removeProtectedSite(siteHost));

    item.append(label, removeButton);
    siteList.append(item);
  });
}

function renderAllowedChannels(channels) {
  channelList.textContent = "";

  if (channels.length === 0) {
    const emptyItem = document.createElement("li");
    emptyItem.className = "managed-list__empty";
    emptyItem.textContent = "No learning channels added.";
    channelList.append(emptyItem);
    return;
  }

  channels.forEach((channelUrl) => {
    const item = document.createElement("li");
    const label = document.createElement("span");
    const removeButton = document.createElement("button");

    label.textContent = channelUrl;
    removeButton.type = "button";
    removeButton.textContent = "Remove";
    removeButton.addEventListener("click", () => removeAllowedChannel(channelUrl));

    item.append(label, removeButton);
    channelList.append(item);
  });
}

function setSitesVisible(isVisible) {
  sitesVisible = isVisible;
  siteList.classList.toggle("is-hidden", !sitesVisible);
  toggleSitesButton.setAttribute("aria-expanded", String(sitesVisible));
  toggleSitesButton.textContent = sitesVisible ? "Hide protected sites" : "Show protected sites";
}

function setChannelsVisible(isVisible) {
  channelsVisible = isVisible;
  channelList.classList.toggle("is-hidden", !channelsVisible);
  toggleChannelsButton.setAttribute("aria-expanded", String(channelsVisible));
  toggleChannelsButton.textContent = channelsVisible ? "Hide added channels" : "Show added channels";
}

function showChannelStatus(message, isError = false) {
  showStatus(channelStatus, message, isError);
}

function showStatus(element, message, isError = false) {
  element.textContent = message;
  element.classList.toggle("is-error", isError);

  // Keep site feedback visible until the next site action or the popup closes.
  if (element === siteStatus) {
    return;
  }

  window.setTimeout(() => {
    element.textContent = "";
    element.classList.remove("is-error");
  }, 2200);
}

function setLockedState(isLocked) {
  limitInput.disabled = isLocked;
  saveButton.disabled = isLocked;
  lockStatus.textContent = isLocked
    ? "Timer is running. Change the limit before opening a protected site."
    : "";
}

function normalizeChannelUrl(url) {
  const trimmedUrl = String(url).trim();

  if (/^@[a-z0-9._-]+$/i.test(trimmedUrl)) {
    return trimmedUrl.toLowerCase();
  }

  if (/^(channel|c|user)\/[a-z0-9._-]+$/i.test(trimmedUrl)) {
    return trimmedUrl.toLowerCase();
  }

  try {
    const parsedUrl = new URL(trimmedUrl);
    const hostname = parsedUrl.hostname.toLowerCase();

    if (hostname !== "youtube.com" && !hostname.endsWith(".youtube.com")) {
      return "";
    }

    const pathParts = parsedUrl.pathname.split("/").filter(Boolean);
    const firstPart = pathParts[0]?.toLowerCase();

    if (firstPart?.startsWith("@")) {
      return `@${firstPart.slice(1)}`;
    }

    if (["channel", "c", "user"].includes(firstPart) && pathParts[1]) {
      return `${firstPart}/${pathParts[1].toLowerCase()}`;
    }
  } catch {
    return "";
  }

  return "";
}

function validateSiteInput(value) {
  const rawValue = String(value).trim();
  const reject = (error) => ({ host: "", error });

  if (!rawValue) {
    return reject("Enter a website, like reddit.com or https://reddit.com.");
  }

  if (/[\s\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u.test(rawValue)) {
    return reject("Remove spaces or hidden characters from the address.");
  }

  if (rawValue.includes("\\")) {
    return reject("Use forward slashes (/) in a URL, not backslashes (\\).");
  }

  const hasWebScheme = /^https?:\/\//i.test(rawValue);
  if (!hasWebScheme && /^[a-z][a-z0-9+.-]*:/i.test(rawValue) && !/^[^/:]+:\d+(?:[/?#]|$)/.test(rawValue)) {
    return reject("Only http:// and https:// website addresses are supported.");
  }

  const address = hasWebScheme ? rawValue.replace(/^https?:\/\//i, "") : rawValue;
  const authority = address.split(/[/?#]/, 1)[0];
  if (!authority) {
    return reject("Enter a complete website domain, like reddit.com.");
  }
  if (authority.includes("@")) {
    return reject("Remove login details or @ from the address; they can hide the actual website.");
  }
  if (/[^\x00-\x7f]/.test(authority) || authority.includes("%") || /(?:^|\.)xn--/i.test(authority)) {
    return reject("Internationalized or encoded domains are not supported by this checker because they can resemble other sites. This does not mean the site is malicious.");
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(hasWebScheme ? rawValue : `https://${rawValue}`);
  } catch {
    return reject("This address is malformed. Enter a domain or a valid HTTP/HTTPS URL.");
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  if (hostname.startsWith("[") || /^\d+(?:\.\d+){3}$/.test(hostname)) {
    return reject("Enter a website domain instead of an IP address.");
  }
  const labels = hostname.split(".");
  if (hostname.length > 253 || labels.length < 2 || labels.some((label) =>
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)
  ) || !/^[a-z]{2,63}$/.test(labels.at(-1))) {
    return reject("Enter a valid domain, like reddit.com. Domain labels cannot be empty or start/end with a hyphen.");
  }

  return { host: hostname.replace(/^www\./, ""), error: "" };
}

function normalizeSiteHost(value) {
  const rawValue = String(value).trim().toLowerCase();

  if (!rawValue) {
    return "";
  }

  try {
    const parsedUrl = rawValue.includes("://") ? new URL(rawValue) : new URL(`https://${rawValue}`);
    const host = parsedUrl.hostname.replace(/^www\./, "");

    if (!host.includes(".") || host.includes("..")) {
      return "";
    }

    return host;
  } catch {
    return "";
  }
}

function formatDuration(totalMs) {
  const totalSeconds = Math.floor(totalMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

function normalizeLimit(value) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return DEFAULT_LIMIT_MINUTES;
  }

  return Math.min(240, Math.max(1, Math.round(parsed)));
}
