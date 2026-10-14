// Fingerprint Shield - Tor Browser style canvas protection (MAIN world, document_start).
//
// Like Tor Browser, any attempt to READ canvas pixels (toDataURL, toBlob,
// getImageData, OffscreenCanvas.convertToBlob, WebGL readPixels) returns a
// blank white image of the same size unless the user allowed this site via the
// toolbar button. Drawing and on-screen rendering are never affected.
//
// This file is registered dynamically by background.js, with the allowed sites
// listed in excludeMatches, so allowed sites never receive it.

(() => {
  "use strict";

  const EVENT = "__fps_canvas_read";

  // --- keep patched functions looking native (chains with inject.js) -------
  const prevToString = Function.prototype.toString;
  const fakeSource = new WeakMap();
  const patchedToString = function toString() {
    const s = fakeSource.get(this);
    return s !== undefined ? s : prevToString.call(this);
  };
  fakeSource.set(patchedToString, prevToString.call(prevToString));
  Object.defineProperty(Function.prototype, "toString", {
    value: patchedToString,
    writable: true,
    configurable: true,
  });

  function hook(obj, prop, make) {
    if (!obj) return;
    const desc = Object.getOwnPropertyDescriptor(obj, prop);
    if (!desc || typeof desc.value !== "function") return;
    const orig = desc.value;
    const fn = make(orig);
    try {
      Object.defineProperty(fn, "name", { value: orig.name, configurable: true });
      Object.defineProperty(fn, "length", { value: orig.length, configurable: true });
    } catch (_) {}
    fakeSource.set(fn, prevToString.call(orig));
    Object.defineProperty(obj, prop, { ...desc, value: fn });
  }

  // --- tell the extension (via relay.js) that a read was blocked -----------
  let notified = false;
  function notify() {
    if (notified) return;
    notified = true;
    try { document.dispatchEvent(new CustomEvent(EVENT)); } catch (_) {}
  }

  // --- blank (white) stand-ins ----------------------------------------------
  function blankCanvas(src) {
    const c = document.createElement("canvas");
    c.width = src.width;
    c.height = src.height;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    return c;
  }

  function blankOffscreen(src) {
    const c = new OffscreenCanvas(src.width, src.height);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    return c;
  }

  // HTMLCanvasElement exports
  for (const method of ["toDataURL", "toBlob"]) {
    hook(HTMLCanvasElement.prototype, method, (orig) => function () {
      if (!(this instanceof HTMLCanvasElement)) return orig.apply(this, arguments);
      notify();
      return orig.apply(blankCanvas(this), arguments);
    });
  }

  // OffscreenCanvas export
  if (typeof OffscreenCanvas !== "undefined") {
    hook(OffscreenCanvas.prototype, "convertToBlob", (orig) => function () {
      if (!(this instanceof OffscreenCanvas)) return orig.apply(this, arguments);
      notify();
      return orig.apply(blankOffscreen(this), arguments);
    });
  }

  // 2D pixel reads: run the real call first so argument validation and
  // SecurityErrors behave natively, then whiten the result.
  const hookGetImageData = (proto) =>
    hook(proto, "getImageData", (orig) => function () {
      const img = orig.apply(this, arguments);
      notify();
      img.data.fill(255);
      return img;
    });
  hookGetImageData(CanvasRenderingContext2D.prototype);
  if (typeof OffscreenCanvasRenderingContext2D !== "undefined") {
    hookGetImageData(OffscreenCanvasRenderingContext2D.prototype);
  }

  // WebGL pixel reads (rendering itself is untouched)
  const glProtos = [WebGLRenderingContext.prototype];
  if (typeof WebGL2RenderingContext !== "undefined") glProtos.push(WebGL2RenderingContext.prototype);
  for (const proto of glProtos) {
    hook(proto, "readPixels", (orig) => function () {
      const r = orig.apply(this, arguments);
      const pixels = arguments[6];
      if (pixels && ArrayBuffer.isView(pixels)) {
        notify();
        new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength).fill(255);
      }
      return r;
    });
  }
})();
