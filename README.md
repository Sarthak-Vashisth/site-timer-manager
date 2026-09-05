# Watch Limit Timer

Watch Limit Timer is a Chrome extension that helps control time spent on distracting websites. It starts a countdown when you open a protected site and closes that tab when the configured time limit ends.

YouTube and Instagram are protected by default, and you can add more sites from the extension popup.

## Features

- Starts a timer when you open a protected site.
- Closes the protected tab when the timer ends.
- Uses a default limit of 30 minutes.
- Lets you configure the limit from 1 to 240 minutes.
- Locks the running timer after it starts, so changing the limit later does not affect the current tab.
- Shows a countdown overlay on protected pages.
- Lets you drag the countdown overlay anywhere on the page.
- Remembers the overlay position for future pages.
- Lets you add or remove protected sites.
- Includes YouTube learning-channel exceptions.
- Uses a custom toolbar icon.

## Install Locally

1. Open Chrome.
2. Go to `chrome://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked**.
5. Select this folder:

After loading, pin **Watch Limit Timer** from the Chrome extensions menu.

## Configure Timer

1. Click the extension icon in the Chrome toolbar.
2. Enter the time limit in minutes.
3. Click **Save**.

The default limit is `30` minutes. You can set any value from `1` to `240`.

Set the time before opening a protected site. Once a timer starts, the running timer is locked and will close the tab at the originally scheduled time.

## Protected Sites

YouTube and Instagram are protected by default:

```text
youtube.com
instagram.com
```

To add another site:

1. Click the extension icon.
2. Go to **Protected sites**.
3. Enter a domain or URL, for example:

```text
reddit.com
https://x.com
facebook.com
```

4. Click **Add**.

Click **Show protected sites** to view or remove saved sites.

Subdomains are included automatically. For example, adding `reddit.com` also protects `www.reddit.com`.

## Learning YouTube Channels

Learning channels are YouTube channels that should not count against your timer.

To add a learning channel:

1. Click the extension icon.
2. Go to **Learning channels**.
3. Paste a YouTube channel URL, for example:

```text
https://www.youtube.com/@freeCodeCamp
https://www.youtube.com/channel/CHANNEL_ID
```

4. Click **Add**.

When you open that channel page, or any video from that channel, the timer stops for that tab.

When you move to another YouTube channel, another video, or the YouTube homepage, the timer starts again if the page is not part of your learning-channel list.

Click **Show added channels** to view or remove saved learning channels.

## Countdown Overlay

When the timer is running, the page shows a small countdown overlay.

You can drag the overlay with your mouse so it does not cover the video or page controls. The extension remembers the position and reuses it on future protected pages.

## How It Works

- `background.js` tracks tabs, starts alarms, and closes protected tabs when time is up.
- `content.js` shows the countdown overlay and detects YouTube learning-channel pages/videos.
- `popup.html`, `popup.css`, and `popup.js` provide the settings UI.
- `icons/` contains the extension toolbar icons.
- `manifest.json` defines the Chrome extension permissions, popup, icons, background script, and content script.

## Troubleshooting

If changes do not appear:

1. Go to `chrome://extensions`.
2. Click the reload button on **Watch Limit Timer**.
3. Refresh already-open YouTube, Instagram, or protected-site tabs.

If you see `Extension context invalidated`, it usually means an old content script is still running in a tab after the extension was reloaded. Refresh that tab once.

If the icon does not update, reload the extension and unpin/pin it again from the Chrome toolbar.
