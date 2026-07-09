# Quiet Focus

An focus-friendly Chrome extension (Manifest V3) for processing content and
holding focus sessions. Local-first: TextRank summarization runs on your
device; the only network call is an anonymous heartbeat used to compute the
aggregate "X others focusing right now" count.

## Install (unpacked)

1. Download `quiet-focus.zip` from the companion site and unzip it.
2. Open `chrome://extensions` in any Chromium browser (Chrome, Edge, Brave, Arc).
3. Toggle **Developer mode** on (top-right).
4. Click **Load unpacked** and pick the unzipped folder.
5. Pin the leaf icon, then click it on any article.

## Files

- `manifest.json` — MV3 manifest
- `popup.html` / `popup.css` / `popup.js` — UI, TextRank summarizer, gamification, audio
- `content.js` — Readability-style article extraction
- `background.js` — Anonymous heartbeat service worker
- `icon.png` — Toolbar icon

## Privacy

The extension stores mode, prefs, garden state, and a per-install random
UUID in `chrome.storage.local`. The UUID is sent to a public heartbeat
endpoint approximately once per minute when a focus session is running,
and deleted when the session ends. No URLs, no page content, no account.
