const TIMER_ID = "watch-limit-timer";
const ALLOWED_CHANNELS_KEY = "allowedChannelUrls";
const OVERLAY_POSITION_KEY = "timerOverlayPosition";

let activeSession = null;
let intervalId = null;
let urlIntervalId = null;
let lastAllowedState = null;
let lastUrl = location.href;
let mutationObserver = null;
let isContextActive = true;
let dragState = null;

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "timerSessionUpdated") {
    if (message.session) {
      startTimer(message.session);
      lastAllowedState = null;
      updateAllowedChannelState().catch(deactivateContentScript);
    } else {
      activeSession = null;
      removeTimer();
    }
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "sync" && changes[ALLOWED_CHANNELS_KEY]) {
    lastAllowedState = null;
    updateAllowedChannelState().catch(deactivateContentScript);
  }
});

requestTimerSession();
watchForAllowedChannel().catch(deactivateContentScript);
window.addEventListener("yt-navigate-finish", handleYouTubeNavigation);
window.addEventListener("popstate", handleYouTubeNavigation);

async function requestTimerSession() {
  try {
    if (!isExtensionContextValid()) {
      deactivateContentScript();
      return;
    }

    const response = await chrome.runtime.sendMessage({ type: "getTimerSession" });

    if (response?.session) {
      startTimer(response.session);
    }
  } catch (error) {
    deactivateContentScript(error);
  }
}

async function watchForAllowedChannel() {
  if (!isContextActive) {
    return;
  }

  await updateAllowedChannelState();

  mutationObserver = new MutationObserver(() => {
    if (!isContextActive) {
      return;
    }

    if (lastUrl !== location.href) {
      lastUrl = location.href;
      lastAllowedState = null;
    }

    window.clearTimeout(watchForAllowedChannel.pendingUpdate);
    watchForAllowedChannel.pendingUpdate = window.setTimeout(() => {
      updateAllowedChannelState().catch(deactivateContentScript);
    }, 300);
  });

  mutationObserver.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  urlIntervalId = window.setInterval(() => {
    if (!isContextActive) {
      return;
    }

    if (lastUrl !== location.href) {
      lastUrl = location.href;
      lastAllowedState = null;
      updateAllowedChannelState().catch(deactivateContentScript);
    }
  }, 1000);
}

function handleYouTubeNavigation() {
  if (!isContextActive) {
    return;
  }

  lastUrl = location.href;
  lastAllowedState = null;
  removeTimer();

  window.clearTimeout(handleYouTubeNavigation.pendingUpdate);
  handleYouTubeNavigation.pendingUpdate = window.setTimeout(() => {
    updateAllowedChannelState().catch(deactivateContentScript);
  }, 600);
}

async function updateAllowedChannelState() {
  if (!isContextActive || !isExtensionContextValid()) {
    deactivateContentScript();
    return;
  }

  if (!isYouTubePage()) {
    return;
  }

  const allowedChannels = await getAllowedChannels();
  const channelUrls = findPageChannelUrls();
  const isAllowed = channelUrls.some((channelUrl) => allowedChannels.includes(normalizeChannelUrl(channelUrl)));

  if (isAllowed === lastAllowedState) {
    return;
  }

  lastAllowedState = isAllowed;

  try {
    if (!isExtensionContextValid()) {
      deactivateContentScript();
      return;
    }

    await chrome.runtime.sendMessage({
      type: isAllowed ? "stopTimerForAllowedChannel" : "restartTimerForLimitedSite",
      url: location.href
    });
  } catch (error) {
    deactivateContentScript(error);
  }
}

async function getAllowedChannels() {
  if (!isExtensionContextValid()) {
    deactivateContentScript();
    return [];
  }

  const { [ALLOWED_CHANNELS_KEY]: allowedChannels = [] } = await chrome.storage.sync.get(ALLOWED_CHANNELS_KEY);
  return allowedChannels.map(normalizeChannelUrl).filter(Boolean);
}

function findPageChannelUrls() {
  const urls = new Set();

  addChannelUrl(urls, location.href);

  if (!isYouTubeVideoPage()) {
    return [...urls];
  }

  const ownerLink = document.querySelector("ytd-watch-flexy ytd-video-owner-renderer a[href], #owner ytd-channel-name a[href]");

  if (ownerLink) {
    addChannelUrl(urls, ownerLink.href);
  }

  return [...urls];
}

function addChannelUrl(urls, url) {
  const normalized = normalizeChannelUrl(url);

  if (normalized) {
    urls.add(normalized);
  }
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
    const parsedUrl = new URL(trimmedUrl, location.origin);
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

function isYouTubePage() {
  return location.hostname === "youtube.com" || location.hostname.endsWith(".youtube.com");
}

function isYouTubeVideoPage() {
  return location.pathname === "/watch" || location.pathname.startsWith("/shorts/");
}

function startTimer(session) {
  activeSession = session;
  renderTimer();

  if (intervalId) {
    window.clearInterval(intervalId);
  }

  intervalId = window.setInterval(renderTimer, 1000);
}

function renderTimer() {
  if (!activeSession) {
    removeTimer();
    return;
  }

  const remainingMs = activeSession.endsAt - Date.now();

  if (remainingMs <= 0) {
    removeTimer();
    return;
  }

  const timer = ensureTimer();
  const minutes = Math.floor(remainingMs / 60000);
  const seconds = Math.floor((remainingMs % 60000) / 1000);

  timer.querySelector(".watch-limit-timer__site").textContent = activeSession.siteLabel;
  timer.querySelector(".watch-limit-timer__time").textContent = `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function ensureTimer() {
  const existing = document.getElementById(TIMER_ID);

  if (existing) {
    return existing;
  }

  const timer = document.createElement("aside");
  timer.id = TIMER_ID;
  timer.className = "watch-limit-timer";
  timer.setAttribute("aria-live", "polite");
  timer.innerHTML = `
    <span class="watch-limit-timer__site"></span>
    <strong class="watch-limit-timer__time"></strong>
  `;
  timer.addEventListener("pointerdown", startDraggingTimer);

  document.documentElement.append(timer);
  applySavedTimerPosition(timer);
  return timer;
}

function removeTimer() {
  if (intervalId) {
    window.clearInterval(intervalId);
    intervalId = null;
  }

  document.getElementById(TIMER_ID)?.remove();
}

async function applySavedTimerPosition(timer) {
  try {
    if (!isExtensionContextValid()) {
      return;
    }

    const { [OVERLAY_POSITION_KEY]: savedPosition } = await chrome.storage.local.get(OVERLAY_POSITION_KEY);

    if (!savedPosition) {
      return;
    }

    setTimerPosition(timer, savedPosition.left, savedPosition.top);
  } catch (error) {
    deactivateContentScript(error);
  }
}

function startDraggingTimer(event) {
  if (!isContextActive || event.button !== 0) {
    return;
  }

  const timer = event.currentTarget;
  const rect = timer.getBoundingClientRect();

  dragState = {
    pointerId: event.pointerId,
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top
  };

  timer.classList.add("is-dragging");
  timer.setPointerCapture(event.pointerId);
  timer.addEventListener("pointermove", dragTimer);
  timer.addEventListener("pointerup", stopDraggingTimer);
  timer.addEventListener("pointercancel", stopDraggingTimer);
  event.preventDefault();
}

function dragTimer(event) {
  if (!dragState || event.pointerId !== dragState.pointerId) {
    return;
  }

  const timer = event.currentTarget;
  const nextLeft = event.clientX - dragState.offsetX;
  const nextTop = event.clientY - dragState.offsetY;
  setTimerPosition(timer, nextLeft, nextTop);
}

async function stopDraggingTimer(event) {
  const timer = event.currentTarget;

  timer.classList.remove("is-dragging");
  timer.removeEventListener("pointermove", dragTimer);
  timer.removeEventListener("pointerup", stopDraggingTimer);
  timer.removeEventListener("pointercancel", stopDraggingTimer);

  if (!dragState || event.pointerId !== dragState.pointerId) {
    dragState = null;
    return;
  }

  dragState = null;

  try {
    if (isExtensionContextValid()) {
      await chrome.storage.local.set({
        [OVERLAY_POSITION_KEY]: {
          left: Number.parseFloat(timer.style.left),
          top: Number.parseFloat(timer.style.top)
        }
      });
    }
  } catch (error) {
    deactivateContentScript(error);
  }
}

function setTimerPosition(timer, left, top) {
  const rect = timer.getBoundingClientRect();
  const margin = 8;
  const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
  const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
  const safeLeft = Math.min(maxLeft, Math.max(margin, Number(left) || margin));
  const safeTop = Math.min(maxTop, Math.max(margin, Number(top) || margin));

  timer.style.left = `${safeLeft}px`;
  timer.style.top = `${safeTop}px`;
  timer.style.right = "auto";
}

function deactivateContentScript(error) {
  if (!isContextActive) {
    return;
  }

  if (error && !isExtensionContextInvalidatedError(error)) {
    console.warn("Watch Limit Timer stopped on this page:", error);
  }

  isContextActive = false;
  mutationObserver?.disconnect();
  window.clearTimeout(watchForAllowedChannel.pendingUpdate);
  window.clearTimeout(handleYouTubeNavigation.pendingUpdate);
  window.removeEventListener("yt-navigate-finish", handleYouTubeNavigation);
  window.removeEventListener("popstate", handleYouTubeNavigation);

  if (urlIntervalId) {
    window.clearInterval(urlIntervalId);
    urlIntervalId = null;
  }

  activeSession = null;
  removeTimer();
}

function isExtensionContextValid() {
  return Boolean(chrome?.runtime?.id);
}

function isExtensionContextInvalidatedError(error) {
  return String(error?.message ?? error).includes("Extension context invalidated");
}
