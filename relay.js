// Fingerprint Shield - isolated-world relay.
// canvas.js (MAIN world) fires a DOM event when a page tries to read canvas
// pixels; this forwards it to the background so the toolbar badge can show it.

document.addEventListener("__fps_canvas_read", () => {
  try {
    chrome.runtime.sendMessage({ type: "canvas-blocked" });
  } catch (_) {
    // extension reloaded/unavailable
  }
});
