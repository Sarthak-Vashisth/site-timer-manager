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
let sitesVisible = false;
let channelsVisible = false;

loadSettings();
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

  const normalizedSite = normalizeSiteHost(siteInput.value);

  if (!normalizedSite) {
    showStatus(siteStatus, "Add a valid site, like reddit.com.", true);
    return;
  }

  const sites = await getProtectedSites();

  if (sites.includes(normalizedSite)) {
    showStatus(siteStatus, "This site is already protected.", true);
    return;
  }

  const nextSites = [...sites, normalizedSite].sort();
  await chrome.storage.sync.set({ [PROTECTED_SITES_KEY]: nextSites });

  siteInput.value = "";
  showStatus(siteStatus, "Site added.");
  setSitesVisible(true);
  renderProtectedSites(nextSites);
});

toggleSitesButton.addEventListener("click", () => {
  setSitesVisible(!sitesVisible);
});

toggleChannelsButton.addEventListener("click", () => {
  setChannelsVisible(!channelsVisible);
});

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

async function hasRunningTimer() {
  const { [SESSION_KEY]: sessions = {} } = await chrome.storage.local.get(SESSION_KEY);
  const sessionEntries = Object.entries(sessions);

  if (sessionEntries.length === 0) {
    return false;
  }

  const tabs = await chrome.tabs.query({});
  const openTabIds = new Set(tabs.map((tab) => String(tab.id)));

  return sessionEntries.some(([tabId, session]) => openTabIds.has(tabId) && session.endsAt > Date.now());
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
  showStatus(siteStatus, "Site removed.");
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

  window.setTimeout(() => {
    element.textContent = "";
    element.classList.remove("is-error");
  }, 2200);
}

function setLockedState(isLocked) {
  limitInput.disabled = isLocked;
  saveButton.disabled = isLocked;
  lockStatus.textContent = isLocked
    ? "Timer is running. Change the limit before opening YouTube or Instagram."
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

function normalizeLimit(value) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return DEFAULT_LIMIT_MINUTES;
  }

  return Math.min(240, Math.max(1, Math.round(parsed)));
}
