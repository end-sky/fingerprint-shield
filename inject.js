// Fingerprint Shield - runs in the page's MAIN world at document_start,
// i.e. before any page script executes (in the top frame and every iframe).

(() => {
  "use strict";

  const CONFIG = {
    timezone: "UTC",
    locale: "en-US",
    languages: ["en-US", "en"],
    webgl: {
      // "spoof": generic vendor/renderer strings (fewer broken sites; pixel reads are handled by canvas.js)
      // "block": WebGL contexts are refused entirely (getContext returns null)
      mode: "spoof",
      vendor: "Google Inc. (Intel)",
      renderer: "ANGLE (Intel, Intel(R) HD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    },
  };

  // ---------------------------------------------------------------------
  // Helpers: patch functions while keeping them looking native.
  // ---------------------------------------------------------------------
  const nativeToString = Function.prototype.toString;
  const fakeSource = new WeakMap();

  const patchedToString = function toString() {
    const s = fakeSource.get(this);
    return s !== undefined ? s : nativeToString.call(this);
  };
  fakeSource.set(patchedToString, nativeToString.call(nativeToString));
  Object.defineProperty(Function.prototype, "toString", {
    value: patchedToString,
    writable: true,
    configurable: true,
  });

  function disguise(fn, original, name) {
    try {
      Object.defineProperty(fn, "name", { value: name, configurable: true });
      Object.defineProperty(fn, "length", { value: original.length, configurable: true });
    } catch (_) {}
    fakeSource.set(fn, nativeToString.call(original));
    return fn;
  }

  function hook(obj, prop, make) {
    if (!obj) return;
    const desc = Object.getOwnPropertyDescriptor(obj, prop);
    if (!desc || typeof desc.value !== "function") return;
    const orig = desc.value;
    const fn = disguise(make(orig), orig, orig.name);
    Object.defineProperty(obj, prop, { ...desc, value: fn });
  }

  function hookGetter(obj, prop, make) {
    if (!obj) return;
    const desc = Object.getOwnPropertyDescriptor(obj, prop);
    if (!desc || typeof desc.get !== "function") return;
    const orig = desc.get;
    const fn = disguise(make(orig), orig, "get " + prop);
    Object.defineProperty(obj, prop, { ...desc, get: fn });
  }

  function replaceGlobal(obj, name, value, original) {
    fakeSource.set(value, nativeToString.call(original));
    const desc = Object.getOwnPropertyDescriptor(obj, name);
    Object.defineProperty(obj, name, { ...desc, value });
  }

  // ---------------------------------------------------------------------
  // Language: navigator.language / navigator.languages
  // ---------------------------------------------------------------------
  const frozenLanguages = Object.freeze(CONFIG.languages.slice());
  hookGetter(Navigator.prototype, "language", () => function () { return CONFIG.languages[0]; });
  hookGetter(Navigator.prototype, "languages", () => function () { return frozenLanguages; });

  // Locale-sensitive formatting defaults to en-US instead of the browser UI language.
  const withLocale = (l) => (l === undefined ? CONFIG.locale : l);

  hook(Number.prototype, "toLocaleString", (orig) => function (l, o) {
    return orig.call(this, withLocale(l), o);
  });
  if (typeof BigInt !== "undefined") {
    hook(BigInt.prototype, "toLocaleString", (orig) => function (l, o) {
      return orig.call(this, withLocale(l), o);
    });
  }
  hook(String.prototype, "localeCompare", (orig) => function (that, l, o) {
    return orig.call(this, that, withLocale(l), o);
  });

  // ---------------------------------------------------------------------
  // Timezone: make every local-time API behave as UTC (+00:00).
  // ---------------------------------------------------------------------
  const NativeDate = Date;
  const DP = NativeDate.prototype;
  const origTZO = DP.getTimezoneOffset;

  const withTZ = (o) => {
    if (o === undefined || o === null) return { timeZone: CONFIG.timezone };
    if (typeof o !== "object") return o;
    if (o.timeZone !== undefined) return o;
    return Object.assign({}, o, { timeZone: CONFIG.timezone });
  };

  hook(DP, "getTimezoneOffset", (orig) => function () {
    const v = orig.call(this);
    return v !== v ? NaN : 0;
  });

  const localToUtc = {
    getFullYear: "getUTCFullYear",
    getMonth: "getUTCMonth",
    getDate: "getUTCDate",
    getDay: "getUTCDay",
    getHours: "getUTCHours",
    getMinutes: "getUTCMinutes",
    getSeconds: "getUTCSeconds",
    getMilliseconds: "getUTCMilliseconds",
    setFullYear: "setUTCFullYear",
    setMonth: "setUTCMonth",
    setDate: "setUTCDate",
    setHours: "setUTCHours",
    setMinutes: "setUTCMinutes",
    setSeconds: "setUTCSeconds",
    setMilliseconds: "setUTCMilliseconds",
  };
  for (const [local, utc] of Object.entries(localToUtc)) {
    const target = DP[utc];
    hook(DP, local, () => function () { return target.apply(this, arguments); });
  }
  hook(DP, "getYear", (orig) => function () {
    const y = DP.getUTCFullYear.call(this);
    orig.call(this); // keep native brand-check behaviour
    return y !== y ? NaN : y - 1900;
  });

  const utcParts = (d) => {
    const t = DP.getTime.call(d);
    if (t !== t) return null;
    return DP.toUTCString.call(d).split(" "); // ["Wed,","14","Oct","2026","01:01:00","GMT"]
  };
  const TZ_NAME = "GMT+0000 (Coordinated Universal Time)";
  hook(DP, "toString", () => function () {
    const p = utcParts(this);
    return p ? `${p[0].slice(0, 3)} ${p[2]} ${p[1]} ${p[3]} ${p[4]} ${TZ_NAME}` : "Invalid Date";
  });
  hook(DP, "toDateString", () => function () {
    const p = utcParts(this);
    return p ? `${p[0].slice(0, 3)} ${p[2]} ${p[1]} ${p[3]}` : "Invalid Date";
  });
  hook(DP, "toTimeString", () => function () {
    const p = utcParts(this);
    return p ? `${p[4]} ${TZ_NAME}` : "Invalid Date";
  });
  for (const k of ["toLocaleString", "toLocaleDateString", "toLocaleTimeString"]) {
    hook(DP, k, (orig) => function (l, o) {
      return orig.call(this, withLocale(l), withTZ(o));
    });
  }

  // Strings without an explicit zone are parsed as *local* time; re-anchor them to UTC.
  const hasZone = /(?:z|gmt|utc|[+-]\d{2}:?\d{2})\s*(?:\(.*\))?\s*$/i;
  const dateOnlyISO = /^\s*[+-]?\d{4,6}(?:-\d{2}(?:-\d{2})?)?\s*$/;
  const origParse = NativeDate.parse;
  function parseAsUtc(s) {
    const t = origParse.call(NativeDate, s);
    if (t !== t || hasZone.test(s) || dateOnlyISO.test(s)) return t;
    const offsetMin = origTZO.call(new NativeDate(t)); // real UTC - local, in minutes
    return t - offsetMin * 60000;
  }
  hook(NativeDate, "parse", (orig) => function (s) {
    return typeof s === "string" ? parseAsUtc(s) : orig.apply(this, arguments);
  });

  const DateProxy = new Proxy(NativeDate, {
    construct(target, args, newTarget) {
      if (args.length >= 2) {
        return Reflect.construct(target, [NativeDate.UTC.apply(NativeDate, args)], newTarget);
      }
      if (args.length === 1 && typeof args[0] === "string") {
        return Reflect.construct(target, [parseAsUtc(args[0])], newTarget);
      }
      return Reflect.construct(target, args, newTarget);
    },
    apply() {
      return new DateProxy().toString();
    },
  });
  replaceGlobal(globalThis, "Date", DateProxy, NativeDate);
  Object.defineProperty(DP, "constructor", { value: DateProxy, writable: true, configurable: true });

  // Intl.*: default locale -> en-US, default timeZone -> UTC.
  for (const name of [
    "DateTimeFormat", "NumberFormat", "Collator", "PluralRules",
    "RelativeTimeFormat", "ListFormat", "Segmenter",
  ]) {
    const Native = Intl[name];
    if (typeof Native !== "function") continue;
    const patchArgs = (args) => {
      const a = Array.from(args);
      if (a[0] === undefined) a[0] = CONFIG.locale;
      if (name === "DateTimeFormat") a[1] = withTZ(a[1]);
      return a;
    };
    const proxy = new Proxy(Native, {
      construct: (t, args, nt) => Reflect.construct(t, patchArgs(args), nt),
      apply: (t, thisArg, args) => Reflect.apply(t, thisArg, patchArgs(args)),
    });
    replaceGlobal(Intl, name, proxy, Native);
    Object.defineProperty(Native.prototype, "constructor", {
      value: proxy, writable: true, configurable: true,
    });
  }

  // ---------------------------------------------------------------------
  // WebGL fingerprinting
  // ---------------------------------------------------------------------
  const isWebGLType = (t) => /webgl/i.test(String(t));

  if (CONFIG.webgl.mode === "block") {
    const blockCtx = (orig) => function (type) {
      return isWebGLType(type) ? null : orig.apply(this, arguments);
    };
    hook(HTMLCanvasElement.prototype, "getContext", blockCtx);
    if (typeof OffscreenCanvas !== "undefined") hook(OffscreenCanvas.prototype, "getContext", blockCtx);
  } else {
    const UNMASKED_VENDOR = 0x9245;
    const UNMASKED_RENDERER = 0x9246;
    const protos = [WebGLRenderingContext.prototype];
    if (typeof WebGL2RenderingContext !== "undefined") protos.push(WebGL2RenderingContext.prototype);

    for (const proto of protos) {
      hook(proto, "getParameter", (orig) => function (pname) {
        if (pname === UNMASKED_VENDOR) return CONFIG.webgl.vendor;
        if (pname === UNMASKED_RENDERER) return CONFIG.webgl.renderer;
        return orig.apply(this, arguments);
      });
    }
  }
})();
