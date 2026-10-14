# Fingerprint Shield

Chromium MV3 extension (Chrome/Chromium 120+).

## Install
1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** and select this `fingerprint-shield` folder
   (after updating files, press the reload icon on the extension card)

## What it does
- **Canvas (Tor Browser style)**: reading canvas pixels (`toDataURL`, `toBlob`, `getImageData`,
  `OffscreenCanvas.convertToBlob`, WebGL `readPixels`) returns a blank white image of the same size.
  Drawing and on-screen rendering are unaffected.
  - When a page tries to read, the toolbar icon shows an orange **C** (Tor's permission prompt).
  - Click the icon to allow canvas reads on that site; it reloads and shows a green **OK**.
    Click again to block it again. Allowed sites are stored in `chrome.storage.local`.
- **WebGL**: spoofed unmasked vendor/renderer. Set `CONFIG.webgl.mode = "block"` in `inject.js` to refuse WebGL entirely
- **Timezone**: offset 0, all local `Date` getters/setters/strings behave as UTC, `Intl` defaults to `UTC`
- **Language**: `navigator.language(s)` = `en-US`, `["en-US","en"]`; `Intl`/`toLocaleString` default to `en-US`
- **Network**: `Accept-Language: en-US,en;q=0.9`, plus `DNT` and `Sec-GPC` headers (declarativeNetRequest)
- **Hardening** (chrome.privacy): WebRTC IP leak protection, no network prediction, hyperlink auditing off,
  Topics/FLEDGE/ad-measurement/related-website-sets off, autofill not exposed to pages

All page-side patches run in the MAIN world at `document_start` in every frame, before page scripts.

## Files
- `inject.js` - timezone, language, WebGL strings (static content script)
- `canvas.js` - canvas readback blocking (registered dynamically; skipped for allowed sites)
- `relay.js` - forwards "canvas read blocked" events to the background for the badge
- `background.js` - allow-list, badge, chrome.privacy hardening
- `rules.json` - request header rewriting

## Limits (JavaScript-level spoofing)
- Web Workers / Service Workers are not patched (extensions cannot inject into them before they start)
- Sandboxed iframes and `data:` frames may not receive the scripts
- Sites that legitimately export canvases (image editors, QR/chart "download" buttons) get a blank image until allowed
- A determined site can detect JS-level spoofing; it reduces fingerprint entropy, not guarantees anonymity

## Closing the worker gap (recommended)
Launch Chromium with the real timezone and language set at process level:

    TZ=UTC chromium --lang=en-US --accept-lang=en-US

## Test
browserleaks.com/canvas, /webgl, /javascript and coveryourtracks.eff.org
