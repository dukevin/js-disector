(() => {
  "use strict";

  const KEY = "__JAVASCREEN__";
  const VERSION = "0.8.6";
  const FRAME_CHANNEL = "__JAVASCREEN_FRAME_CHANNEL__";
  const FRAME_FEED_KEY = "__JAVASCREEN_FRAME_FEED__";
  const MAX_BUFFER = 1000;
  const MAX_CALLS_PER_FUNCTION = 99;
  const MAX_FRAME_FEED = 2000;
  const MAX_REPLAY_REFS = 500;
  const MAX_NETWORK_RECORDS = 300;
  const MAX_RENDERED_ARGS = 12;
  const MAX_SCAN_DEPTH = 2;
  const MAX_INTERESTING_SCAN_DEPTH = 2;
  const MAX_PROPERTIES_PER_OBJECT = 240;
  const MAX_VARIABLE_SCAN_DEPTH = 3;
  const MAX_INTERESTING_VARIABLE_SCAN_DEPTH = 6;
  const MAX_VARIABLES = 1500;
  const MAX_OBSERVED_VARIABLE_PROPERTIES = 18;
  const MAX_VARIABLE_PROPERTIES_PER_OBJECT = 160;
  const VARIABLE_SCAN_INTERVAL_MS = 3000;
  const VARIABLE_OBSERVE_BUDGET_PER_SECOND = 12;
  const MAX_OBSERVED_VARIABLE_DEPTH = 1;
  const MAX_OBSERVED_VARIABLES_PER_CALL = 24;
  const MAX_FRAMEWORK_EVENT_ELEMENTS = 800;
  const MAX_FRAMEWORK_COMPONENT_DEPTH = 5;
  const MAX_FRAMEWORK_COMPONENT_METHODS = 120;
  const SCAN_INTERVAL_MS = 1500;
  const CAPTURE_EVENT_LISTENERS = true;
  const HIGH_RISK_ROOT_NAMES = new Set([
    "$",
    "ES6Promise",
    "Optanon",
    "OneTrust",
    "SockJS",
    "Typed",
    "Zepto",
    "createjs",
    "detection",
    "faZepto",
    "fenster",
    "google",
    "google_tag_manager",
    "googlefc",
    "googletag",
    "ima",
    "lotame_sync_16589",
    "regeneratorRuntime"
  ]);
  const HIGH_RISK_FUNCTION_NAMES = new Set([
    "cancelAnimationFrame",
    "clearInterval",
    "clearTimeout",
    "fetch",
    "getComputedStyle",
    "gtag",
    "lerp",
    "limit",
    "OptanonWrapper",
    "__gpp",
    "__tcfapi",
    "lotameIsCompatible",
    "keydownFn",
    "requestAnimationFrame",
    "setInterval",
    "setTimeout",
    "tick",
    "wheelFn"
  ]);
  const VARIABLE_SKIP_ROOT_NAMES = new Set([
    ...HIGH_RISK_ROOT_NAMES,
    "__AMP__EXPERIMENT_TOGGLES",
    "Array",
    "ArrayBuffer",
    "__AMP_MODE",
    "__AMP_SERVICES",
    "AMP_CONFIG",
    "Atomics",
    "BigInt",
    "Boolean",
    "browser",
    "DataView",
    "Date",
    "Error",
    "EvalError",
    "FinalizationRegistry",
    "Float32Array",
    "Float64Array",
    "Function",
    "Infinity",
    "Intl",
    "JSON",
    "Map",
    "Math",
    "NaN",
    "Number",
    "Object",
    "Promise",
    "Proxy",
    "RangeError",
    "ReferenceError",
    "Reflect",
    "RegExp",
    "Set",
    "String",
    "Symbol",
    "SyntaxError",
    "TypeError",
    "URIError",
    "WeakMap",
    "WeakRef",
    "WeakSet",
    "WebAssembly",
    "chrome"
  ]);
  const NOISY_LIBRARY_EVENT_TYPES = new Set([
    "drawend",
    "drawstart",
    "mousemove",
    "pressmove",
    "rollout",
    "rollover",
    "tick",
    "ticker",
    "update"
  ]);
  const CAPTURED_DOM_EVENT_TYPES = new Set([
    "change",
    "click",
    "contextmenu",
    "dblclick",
    "input",
    "keydown",
    "keyup",
    "mousedown",
    "mouseup",
    "pointercancel",
    "pointerdown",
    "pointerup",
    "submit",
    "touchcancel",
    "touchend",
    "touchstart"
  ]);
  const CLICK_SEQUENCE_EVENT_TYPES = new Set([
    "click",
    "contextmenu",
    "dblclick",
    "mousedown",
    "mouseup",
    "pointerdown",
    "pointerup",
    "touchend",
    "touchstart"
  ]);
  const NOISY_DOM_EVENT_TYPES = new Set([
    "drag",
    "dragenter",
    "dragleave",
    "dragover",
    "dragstart",
    "mousemove",
    "mouseout",
    "mouseover",
    "pointerenter",
    "pointerleave",
    "pointermove",
    "pointerout",
    "pointerover",
    "touchmove",
    "wheel"
  ]);
  const SOURCE_HINT_SKIP_CALL_NAMES = new Set([
    "catch",
    "every",
    "filter",
    "find",
    "flatMap",
    "for",
    "forEach",
    "function",
    "if",
    "includes",
    "join",
    "map",
    "pop",
    "push",
    "reduce",
    "return",
    "slice",
    "some",
    "splice",
    "split",
    "switch",
    "while"
  ]);

  const previous = window[KEY];
  if (previous && previous.version === VERSION) {
    previous.start();
    return previous.snapshot();
  }

  const wrapperEntries = typeof WeakMap === "function" ? new WeakMap() : null;

  if (previous && typeof previous.stop === "function") {
    previous.stop();
  }

  const ignoredGlobalNames = new Set([
    KEY,
    FRAME_FEED_KEY,
    FRAME_CHANNEL,
    "window",
    "self",
    "globalThis",
    "document",
    "location",
    "history",
    "navigator",
    "console",
    "performance",
    "crypto",
    "customElements",
    "trustedTypes",
    "localStorage",
    "sessionStorage",
    "indexedDB",
    "caches",
    "origin",
    "name",
    "status",
    "frames",
    "parent",
    "top",
    "opener"
  ]);

  const state = {
    activeDomEventSequence: null,
    activeDomEventFrames: [],
    buffer: [],
    disabled: new Set(),
    callStack: [],
    functions: new Map(),
    frameworkHandlerSeq: 0,
    libraryEventHooks: [],
    libraryHookTimer: 0,
    libraryListenerRecords: [],
    replayRefs: new Map(),
    replayRefSeq: 0,
    suppressedEntries: new Map(),
    suppressLibraryHookDepth: 0,
    listenerRecords: [],
    listenerSeq: 0,
    nativeFetch: null,
    nativeXhr: null,
    nativeEventTarget: null,
    nativeEventProbeRecords: [],
    nativeFrameCommandListener: null,
    nativeFrameFeed: null,
    running: false,
    scanTimer: 0,
    seq: 0,
    captureMinifiedFunctions: false,
    continueTrackingAfterLimit: false,
    networkSeq: 0,
    networkRecords: new Map(),
    pauseNetworkRequests: false,
    pauseNetworkResponses: false,
    safeMode: false,
    wrapDomEventListeners: false,
    sourceFiles: [],
    sourceIndexStatus: "pending",
    startedAt: "",
    totalCalls: 0,
    variableRecords: new Map(),
    variableDisplayRefreshSeq: 0,
    variableDisplayRefreshTokens: new Map(),
    variableRefs: new Map(),
    variableObjectIds: typeof WeakMap === "function" ? new WeakMap() : null,
    variableObjectSeq: 0,
    variableObserveCount: 0,
    variableObserveWindowAt: 0,
    variableScanAt: 0,
    variableScanSeq: 0,
    variableWatchEnabled: false,
    frameId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  };

  function nowIso() {
    return new Date().toISOString();
  }

  function isTopWindow() {
    try {
      return window.top === window;
    } catch (error) {
      return false;
    }
  }

  function safeHref() {
    try {
      return String(window.location.href);
    } catch (error) {
      return "";
    }
  }

  function safeTitle() {
    try {
      return document && document.title ? document.title : "";
    } catch (error) {
      return "";
    }
  }

  function shouldSkipVariableFrame() {
    const href = safeHref().toLowerCase();
    return /(?:doubleclick|googlesyndication|googleads|recaptcha|criteo|casalemedia|adscale|openx|safeframe|adtrafficquality|sodar|pubmatic|adnxs|adsystem)/.test(href);
  }

  function fileLabel(url) {
    if (!url) {
      return "";
    }

    try {
      const parsed = new URL(url);
      const parts = parsed.pathname.split("/").filter(Boolean);
      return parts[parts.length - 1] || parsed.hostname;
    } catch (error) {
      return url;
    }
  }

  function ownFrameInfo() {
    const href = safeHref();
    return {
      frameId: state.frameId,
      label: isTopWindow() ? "top" : `frame ${fileLabel(href) || state.frameId.slice(0, 8)}`,
      title: safeTitle(),
      url: href
    };
  }

  function toArray(value) {
    return Array.prototype.slice.call(value);
  }

  function safeGetOwnPropertyNames(value) {
    try {
      return Object.getOwnPropertyNames(value);
    } catch (error) {
      return [];
    }
  }

  function safeObjectKeys(value) {
    try {
      return Object.keys(value);
    } catch (error) {
      return [];
    }
  }

  function safeGetOwnPropertyDescriptor(owner, key) {
    try {
      return Object.getOwnPropertyDescriptor(owner, key);
    } catch (error) {
      return null;
    }
  }

  function safeFunctionSource(fn) {
    try {
      return Function.prototype.toString.call(fn);
    } catch (error) {
      return "";
    }
  }

  function isNativeFunction(fn) {
    return /\{\s*\[native code\]\s*\}/.test(safeFunctionSource(fn));
  }

  function isBoundFunction(fn) {
    try {
      return /^bound\s+/.test(String(fn && fn.name || ""));
    } catch (error) {
      return false;
    }
  }

  function isClass(fn) {
    return /^class\s/.test(safeFunctionSource(fn));
  }

  function canInspectObject(value) {
    if (!value) {
      return false;
    }

    try {
      if (value.__javascreenInternal) {
        return false;
      }
    } catch (error) {
      return false;
    }

    const type = typeof value;
    if (type !== "object" && type !== "function") {
      return false;
    }

    if (value === window || value === document || value === document.documentElement) {
      return false;
    }

    try {
      if (value instanceof Node || value instanceof Window) {
        return false;
      }
    } catch (error) {
      return false;
    }

    const tag = Object.prototype.toString.call(value);
    return tag === "[object Object]" || tag === "[object Function]" || tag === "[object Module]";
  }

  function shouldSkipName(name) {
    if (!name || ignoredGlobalNames.has(name)) {
      return true;
    }

    if (isSingleLetterFunctionName(name) && !state.captureMinifiedFunctions && state.safeMode) {
      return true;
    }

    return name.startsWith("webkit") ||
      name.startsWith("__JAVASCREEN") ||
      name.startsWith("moz") ||
      (state.safeMode && name.startsWith("on")) ||
      name.includes("jQuery") ||
      name.includes("webpack");
  }

  function rootName(path) {
    return String(path || "").split(".")[0];
  }

  function shouldSkipCapturePath(path, name) {
    const text = String(path || name || "");
    const key = String(name || text);
    const root = rootName(text);

    if (HIGH_RISK_ROOT_NAMES.has(root) || HIGH_RISK_FUNCTION_NAMES.has(key) || HIGH_RISK_FUNCTION_NAMES.has(text)) {
      return true;
    }

    if (/^(?:ad|ads|analytics|beacon|metrics|telemetry|tracking)_/i.test(text) ||
        /^Goog_/i.test(text) ||
        /^sync\d+_/i.test(text)) {
      return true;
    }

    return state.safeMode &&
      /(?:^|\.|_)(?:key|mouse|pointer|touch|wheel)(?:down|up|move|over|out|enter|leave|cancel|press)?(?:Fn|Handler|Listener)?$/i.test(text);
  }

  function shouldScanPrototypePath(path) {
    const text = String(path || "");
    const lastSegment = text.split(".").pop() || text;
    if (state.safeMode && /(?:animation|atlas|bitmap|button|buttons|canvas|container|display|frame|graphics|layer|loader|logo|preloader|shape|sound|sprite|text|tween)$/i.test(lastSegment)) {
      return false;
    }

    if (state.captureMinifiedFunctions && isSingleLetterFunctionName(lastSegment)) {
      return true;
    }

    if (!state.safeMode) {
      return text.length < 220 && /^[A-Za-z_$][\w$]*(?:[.#][A-Za-z_$][\w$]*)*$/.test(text);
    }

    return /^[A-Za-z_$][\w$]{2,60}$/.test(lastSegment) &&
      !/^(?:config|constants?|defaults?|elements?|helpers?|icons?|images?|styles?|templates?|utils?)$/i.test(lastSegment);
  }

  function shouldWrapPrototypeFunctionName(name) {
    if (state.captureMinifiedFunctions && isSingleLetterFunctionName(name)) {
      return true;
    }

    if (!state.safeMode && /^[A-Za-z_$][\w$]{0,80}$/.test(String(name || ""))) {
      return true;
    }

    return /(?:add|apply|change|choose|click|close|create|delete|destroy|dispatch|draw|finish|get|handle|load|open|process|read|refresh|remove|render|reset|run|save|select|send|set|show|start|submit|toggle|undo|update|validate|write)/i.test(String(name || ""));
  }

  function shouldWrapScannedFunction(path, name, depth) {
    if (state.captureMinifiedFunctions && isSingleLetterFunctionName(name)) {
      return true;
    }

    if (!state.safeMode) {
      return true;
    }

    if (depth <= MAX_SCAN_DEPTH) {
      return true;
    }

    return shouldWrapPrototypeFunctionName(name) ||
      /(?:add|apply|change|choose|click|close|create|delete|destroy|dispatch|draw|finish|get|handle|load|open|process|read|refresh|remove|render|reset|run|save|select|send|set|show|start|submit|toggle|undo|update|validate|write)$/i.test(String(path || ""));
  }

  function captureScanDepthLimit(path) {
    const text = String(path || "");
    if (!state.safeMode &&
        text.length < 220 &&
        text.split(".").filter(Boolean).every((segment) => /^[A-Za-z_$][\w$]{1,80}$/.test(segment))) {
      return MAX_INTERESTING_SCAN_DEPTH + 1;
    }

    if (text.length < 180 && text.split(".").filter(Boolean).every((segment) => /^[A-Za-z_$][\w$]{2,60}$/.test(segment))) {
      return MAX_INTERESTING_SCAN_DEPTH;
    }

    return MAX_SCAN_DEPTH;
  }

  function suppressionReasonForPath(path, name) {
    const text = String(path || name || "");
    const key = String(name || text);

    if (state.safeMode && (key === "lerp" || key === "limit" || key === "tick" || /^(?:get)?(?:atlas|asset|bitmap|sprite|spritesheet|texture)$/i.test(key))) {
      return "Tracking disabled: this high-frequency function fires extremely often and would flood the log.";
    }

    if (isSingleLetterFunctionName(key) && !state.captureMinifiedFunctions && state.safeMode) {
      return "Tracking disabled: minified single-letter functions are too ambiguous and often fire too frequently to track usefully.";
    }

    return "";
  }

  function isSingleLetterFunctionName(name) {
    return /^[A-Za-z_$][\w$]?$/.test(String(name || ""));
  }

  function suppressedFunctionNoticeId(path, name) {
    if (isSingleLetterFunctionName(name)) {
      return "suppressed:minified-single-letter-functions";
    }

    return `suppressed:${path}`;
  }

  function suppressedFunctionNoticeName(name) {
    if (isSingleLetterFunctionName(name)) {
      return "Minified single-letter functions";
    }

    return String(name);
  }

  function ensureSuppressedEntry(id, name, path, note, kind = "suppressed-function") {
    const existing = state.functions.get(id);
    if (existing) {
      return existing;
    }

    const entry = {
      blockedCount: 0,
      callCount: 1,
      disabled: true,
      id,
      kind,
      lastCalledAt: nowIso(),
      name,
      note,
      originalName: "",
      path,
      source: null,
      suppressed: true
    };

    state.functions.set(id, entry);
    return entry;
  }

  function addSuppressedNotice(id, name, path, note, kind) {
    if (!note || state.suppressedEntries.has(id)) {
      return;
    }

    state.suppressedEntries.set(id, true);
    const entry = ensureSuppressedEntry(id, name, path, note, kind);
    state.totalCalls += 1;
    state.seq += 1;
    const callId = state.seq;
    const call = {
      args: [note],
      blocked: false,
      depth: 0,
      functionId: entry.id,
      id: callId,
      name: entry.name,
      note,
      parentCallId: null,
      path: entry.path,
      returnValue: "tracking disabled",
      source: null,
      suppressed: true,
      treeId: callId,
      time: entry.lastCalledAt
    };

    state.buffer.push(call);
    if (state.buffer.length > MAX_BUFFER) {
      state.buffer.splice(0, state.buffer.length - MAX_BUFFER);
    }

    postFrameCall(call, entry);
  }

  function cleanName(key, fn, options = {}) {
    if (options.preferKeyName) {
      return String(key);
    }

    if (fn && fn.name) {
      return fn.name;
    }

    return String(key);
  }

  function isLowValueFunctionName(name) {
    const normalized = String(name || "").trim();
    return !normalized ||
      normalized === "anonymous" ||
      normalized === "bound" ||
      normalized === "callback" ||
      normalized === "handler" ||
      normalized === "listener" ||
      normalized === "wrapped" ||
      /^[A-Za-z_$][\w$]?$/.test(normalized);
  }

  function readableElementName(description) {
    const text = String(description || "target");
    const objectMatch = /^\[object\s+(.+)\]$/.exec(text);
    if (objectMatch) {
      return objectMatch[1];
    }

    return text
      .replace(/^<|>$/g, "")
      .replace(/[#.]/g, " ")
      .trim() || "target";
  }

  function eventListenerName(callback, eventType, targetDescription) {
    const callbackName = callback && callback.name ? String(callback.name).trim() : "";
    if (!isLowValueFunctionName(callbackName)) {
      return callbackName;
    }

    return `${readableElementName(targetDescription)} ${eventType} listener`;
  }

  function stableId(path) {
    return path;
  }

  function safeSetFunctionName(wrapper, name) {
    try {
      Object.defineProperty(wrapper, "name", {
        configurable: true,
        value: name || "javascreenWrappedFunction"
      });
    } catch (error) {
      // Function names are cosmetic; some engines make them read-only.
    }
  }

  function safeGetOwnPropertySymbols(value) {
    try {
      return Object.getOwnPropertySymbols ? Object.getOwnPropertySymbols(value) : [];
    } catch (error) {
      return [];
    }
  }

  function copyFunctionOwnProperties(source, target) {
    if (!source || !target) {
      return;
    }

    const skipped = new Set([
      "__javascreenEntryId",
      "__javascreenWrapped",
      "arguments",
      "caller",
      "length",
      "name",
      "prototype"
    ]);
    const keys = safeGetOwnPropertyNames(source).concat(safeGetOwnPropertySymbols(source));

    for (const key of keys) {
      if (typeof key === "string" && skipped.has(key)) {
        continue;
      }

      const descriptor = safeGetOwnPropertyDescriptor(source, key);
      if (!descriptor) {
        continue;
      }

      const copied = Object.assign({}, descriptor);
      if (Object.prototype.hasOwnProperty.call(copied, "value") && copied.value === source) {
        copied.value = target;
      }

      try {
        Object.defineProperty(target, key, copied);
      } catch (error) {
        // Some function properties are engine-managed or locked down.
      }
    }
  }

  function markWrapper(wrapper, entry, writeProperties = true) {
    if (wrapperEntries) {
      try {
        wrapperEntries.set(wrapper, entry);
      } catch (error) {
        // WeakMap marking is best effort; property markers are the fallback.
      }
    }

    if (!writeProperties) {
      return;
    }

    try {
      Object.defineProperty(wrapper, "__javascreenWrapped", {
        value: true
      });
      Object.defineProperty(wrapper, "__javascreenEntryId", {
        value: entry.id
      });
    } catch (error) {
      // Non-critical marker metadata.
    }
  }

  function isJavascreenWrapper(fn) {
    return Boolean(fn && (fn.__javascreenWrapped || (wrapperEntries && wrapperEntries.has(fn))));
  }

  function describeElement(value) {
    if (!value || !value.tagName) {
      return "";
    }

    const tag = value.tagName.toLowerCase();
    const id = value.id ? `#${value.id}` : "";
    const classes = typeof value.className === "string" && value.className
      ? `.${value.className.trim().split(/\s+/).slice(0, 3).join(".")}`
      : "";

    return `<${tag}${id}${classes}>`;
  }

  function truncate(text, maxLength) {
    if (text.length <= maxLength) {
      return text;
    }

    return `${text.slice(0, maxLength - 3)}...`;
  }

  function describeTarget(value) {
    if (value === window) {
      return "window";
    }

    if (value === document) {
      return "document";
    }

    return describeElement(value) || Object.prototype.toString.call(value);
  }

  function describeEvent(value) {
    let target = "";
    let currentTarget = "";

    try {
      target = describeTarget(value.target);
    } catch (error) {
      target = "unknown";
    }

    try {
      currentTarget = describeTarget(value.currentTarget);
    } catch (error) {
      currentTarget = "unknown";
    }

    return `{type: ${JSON.stringify(value.type)}, target: ${JSON.stringify(target)}, currentTarget: ${JSON.stringify(currentTarget)}}`;
  }

  function serializeValue(value, depth = 0, seen = []) {
    if (value === undefined) {
      return "undefined";
    }

    if (value === null) {
      return "null";
    }

    const type = typeof value;
    if (type === "string") {
      return JSON.stringify(truncate(value, 220));
    }

    if (type === "number" || type === "boolean") {
      return String(value);
    }

    if (type === "bigint") {
      return `${value.toString()}n`;
    }

    if (type === "symbol") {
      return value.toString();
    }

    if (type === "function") {
      return `[Function ${value.name || "anonymous"}]`;
    }

    try {
      if (value instanceof Error) {
        return `${value.name || "Error"}: ${truncate(value.message || String(value), 220)}`;
      }
    } catch (error) {
      return Object.prototype.toString.call(value);
    }

    try {
      if (value && typeof value.then === "function") {
        return "[Promise]";
      }
    } catch (error) {
      return Object.prototype.toString.call(value);
    }

    try {
      if (value instanceof Event) {
        return describeEvent(value);
      }
    } catch (error) {
      return Object.prototype.toString.call(value);
    }

    try {
      if (value instanceof Element) {
        return describeElement(value);
      }
    } catch (error) {
      return Object.prototype.toString.call(value);
    }

    if (seen.includes(value)) {
      return "[Circular]";
    }

    if (depth >= 2) {
      return Object.prototype.toString.call(value);
    }

    const nextSeen = seen.concat(value);

    if (Array.isArray(value)) {
      const items = value.slice(0, 8).map((item) => serializeValue(item, depth + 1, nextSeen));
      const suffix = value.length > 8 ? ", ..." : "";
      return `[${items.join(", ")}${suffix}]`;
    }

    const keys = Object.keys(value).slice(0, 8);
    const parts = keys.map((key) => {
      let child;
      try {
        child = value[key];
      } catch (error) {
        child = "[Thrown getter]";
      }

      return `${key}: ${serializeValue(child, depth + 1, nextSeen)}`;
    });
    const suffix = Object.keys(value).length > 8 ? ", ..." : "";
    return `{${parts.join(", ")}${suffix}}`;
  }

  function serializeSafely(value) {
    try {
      return serializeValue(value);
    } catch (error) {
      try {
        return Object.prototype.toString.call(value);
      } catch (innerError) {
        return "[Unserializable]";
      }
    }
  }

  function serializeArguments(args) {
    try {
      return toArray(args)
        .slice(0, MAX_RENDERED_ARGS)
        .map((arg) => serializeSafely(arg));
    } catch (error) {
      return ["[Arguments unavailable]"];
    }
  }

  function isVariablePrimitive(value) {
    return value === null ||
      value === undefined ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      typeof value === "bigint";
  }

  function variableKind(value) {
    if (value === null) {
      return "null";
    }

    if (Array.isArray(value)) {
      return "array";
    }

    return typeof value;
  }

  function variableComparable(value) {
    const kind = variableKind(value);
    if (kind === "number" && Number.isNaN(value)) {
      return "number:NaN";
    }
    if (kind === "bigint") {
      return `bigint:${value.toString()}`;
    }
    if (kind === "undefined") {
      return "undefined";
    }
    if (kind === "null") {
      return "null";
    }

    return `${kind}:${String(value)}`;
  }

  function variableJsonValue(value) {
    const kind = variableKind(value);
    if (kind === "bigint" || kind === "undefined") {
      return null;
    }

    if (kind === "number" && !Number.isFinite(value)) {
      return null;
    }

    return value;
  }

  function shouldTrackVariableValue(value) {
    return isVariablePrimitive(value) && value !== undefined;
  }

  function canEditVariableValue(value, descriptor) {
    const kind = variableKind(value);
    if (kind === "bigint" || kind === "undefined" || (kind === "number" && !Number.isFinite(value))) {
      return false;
    }

    return Boolean(descriptor && (descriptor.writable || typeof descriptor.set === "function"));
  }

  function variablePath(parentPath, key) {
    const text = String(key);
    if (/^\d+$/.test(text)) {
      return `${parentPath || "window"}[${text}]`;
    }

    if (/^[A-Za-z_$][\w$]*$/.test(text)) {
      return parentPath ? `${parentPath}.${text}` : text;
    }

    return `${parentPath || "window"}[${JSON.stringify(text)}]`;
  }

  function isNoisyVariableName(name) {
    const text = String(name || "");
    return !text ||
      text === "undefined" ||
      text === "prototype" ||
      text === "constructor" ||
      text === "__proto__" ||
      text === "arguments" ||
      text === "caller" ||
      text === "length" ||
      text === "name" ||
      /^__/.test(text) ||
      text.startsWith("__JAVASCREEN") ||
      text.startsWith("webkit") ||
      text.startsWith("moz") ||
      text.startsWith("on") ||
      text.includes("webpack") ||
      text.includes("jQuery") ||
      /^[A-Za-z_$][\w$]?$/.test(text);
  }

  function variableNamePriority(name) {
    const text = String(name || "");
    let priority = 0;
    if (!text) {
      return 100;
    }
    if (/^(?:alpha|bounds|cacheCanvas|cacheID|children|compositeOperation|cursor|filters|framerate|hitArea|mask|mouseChildren|mouseEnabled|parent|regX|regY|rotation|scaleX|scaleY|shadow|skewX|skewY|snapToPixel|snapToPixelEnabled|sprite|tickEnabled|transformMatrix|visible|x|y)$/i.test(text)) {
      priority += 24;
    }
    if (/^[_$]/.test(text)) {
      priority += 20;
    }
    if (/^[A-Z][A-Z0-9_$]*$/.test(text)) {
      priority += 8;
    }
    if (/^[A-Za-z_$][\w$]{2,48}$/.test(text)) {
      priority -= 6;
    }
    if (/^(?:answer|answered|answers|correct|currentQuestion|localQuestion|question|questions|selectedAnswer|selected|score|state)$/i.test(text)) {
      priority -= 8;
    }
    if (/[a-z][A-Z]|[_-]/.test(text)) {
      priority -= 2;
    }
    if (/^(?:config|data|model|state|store|controller|manager|service|app|application|runtime|session|settings|options|cache|view|ui)$/i.test(text)) {
      priority -= 4;
    }
    return priority;
  }

  function pathSegmentCount(path) {
    const text = String(path || "");
    if (!text) {
      return 0;
    }
    return text.split(/[.[\]]+/).filter(Boolean).length;
  }

  function variableScanDepthLimit(path) {
    const text = String(path || "");
    return text.length < 160 && pathSegmentCount(text) <= 8
      ? MAX_INTERESTING_VARIABLE_SCAN_DEPTH
      : MAX_VARIABLE_SCAN_DEPTH;
  }

  function prioritizedVariableNames(owner, limit) {
    const names = safeGetOwnPropertyNames(owner);
    return names
      .slice()
      .sort((first, second) => variableNamePriority(first) - variableNamePriority(second) || String(first).localeCompare(String(second)))
      .slice(0, limit);
  }

  function variableBudgetLimit(budget) {
    return Math.min(MAX_VARIABLES, Number.isFinite(budget && budget.limit) ? budget.limit : MAX_VARIABLES);
  }

  function variableChildBudget(depth) {
    if (depth <= 1) {
      return 160;
    }
    if (depth === 2) {
      return 120;
    }
    return 90;
  }

  function shouldSkipVariableRoot(name, value) {
    const text = String(name || "");
    if (ignoredGlobalNames.has(text) || VARIABLE_SKIP_ROOT_NAMES.has(text) || isNoisyVariableName(text)) {
      return true;
    }

    if (/^\d+$/.test(text)) {
      return true;
    }

    if (/^(?:CSS|HTML|SVG|WebGL|Audio|Video|Media|IDB|RTC|GPU|XML|XPath|XSLT|FontFace|File|Blob|URL|Worker|Readable|Writable|Transform)/.test(text)) {
      return true;
    }

    if (/^(?:google_|goog|criteo|ad_|ads?|__tcfapi|__gpp)/i.test(text)) {
      return true;
    }

    if (typeof value === "function" && (isNativeFunction(value) || isClass(value))) {
      return true;
    }

    return false;
  }

  function canInspectVariableContainer(value) {
    if (!value || value === window || value === document) {
      return false;
    }

    const type = typeof value;
    if (type !== "object" && type !== "function") {
      return false;
    }

    if (type === "function" && (isNativeFunction(value) || isClass(value))) {
      return false;
    }

    try {
      if (value instanceof Node || value instanceof Window || value instanceof Event || value instanceof Promise) {
        return false;
      }
    } catch (error) {
      return false;
    }

    const tag = Object.prototype.toString.call(value);
    return tag === "[object Object]" ||
      tag === "[object Function]" ||
      tag === "[object Module]" ||
      tag === "[object Array]";
  }

  function variableImportance(path, value) {
    const text = String(path || "").toLowerCase();
    const lastSegment = text.split(".").pop() || text;
    let rank = 0;
    if (typeof value === "number") {
      rank += 5;
    }
    if (typeof value === "boolean") {
      rank += 3;
    }
    if (typeof value === "string" && String(value).length <= 120) {
      rank += 3;
    }
    if (text.includes(".") && text.length < 80) {
      rank += 2;
    }
    if (/^[a-z_$][\w$]{2,48}$/i.test(lastSegment) && !/^[_$]/.test(lastSegment)) {
      rank += 2;
    }
    if (/(?:value|text|label|title|name|id|index|size|length|count|total|current|selected|active|visible|enabled|disabled|complete|status)$/i.test(lastSegment)) {
      rank += 2;
    }
    return rank;
  }

  function isLowValueVariablePath(path) {
    const text = String(path || "");
    const lastSegment = text.split(".").pop() || text;
    if (/(?:^|\.)(?:alpha|cacheID|currentAnimationFrame|currentFrame|framerate|loadTimeout|mouseEnabled|regX|regY|rotation|scaleX|scaleY|skewX|skewY|snapToPixel|tickEnabled|visible|zOrder|_cacheDataURLID|_cacheOffsetX|_cacheOffsetY|_cacheScale|_filterOffsetX|_filterOffsetY|_loadCount)$/.test(text) ||
      /\.(?:sprite|shape|logo|button|buttons|lastClickable)\.(?:x|y|alpha|cacheID|currentAnimationFrame|currentFrame|framerate|regX|regY|rotation|scaleX|scaleY|skewX|skewY)$/i.test(text)) {
      return true;
    }

    if (/(?:value|text|label|title|name|id|index|count|total|current|selected|active|visible|enabled|disabled|complete|status)$/i.test(lastSegment)) {
      return false;
    }

    return false;
  }

  function rememberVariable(owner, key, path, value, descriptor, source = "scan", options = {}) {
    const now = nowIso();
    const id = path;
    const comparable = variableComparable(value);
    const previous = state.variableRecords.get(id);
    const changed = !previous || previous.comparable !== comparable;
    const editable = Object.prototype.hasOwnProperty.call(options, "canEdit")
      ? Boolean(options.canEdit)
      : canEditVariableValue(value, descriptor);
    const record = {
      canEdit: editable,
      comparable,
      displayValue: serializeSafely(value),
      frame: ownFrameInfo(),
      id,
      importance: variableImportance(path, value),
      kind: variableKind(value),
      lastChangedAt: changed ? now : previous.lastChangedAt,
      lastSeenAt: now,
      path,
      scanSeq: state.variableScanSeq,
      source,
      value: variableJsonValue(value)
    };

    state.variableRecords.set(id, record);
    state.variableRefs.set(id, {
      assign: typeof options.assign === "function" ? options.assign : null,
      key,
      owner,
      path,
      read: typeof options.read === "function" ? options.read : null,
      source
    });
  }

  function scanVariableObject(owner, path, depth, seen, budget, options = {}) {
    if (!canInspectVariableContainer(owner) || budget.count >= variableBudgetLimit(budget)) {
      return;
    }

    if ((typeof owner === "object" || typeof owner === "function") && seen.has(owner)) {
      return;
    }

    if (typeof owner === "object" || typeof owner === "function") {
      seen.add(owner);
    }

    const names = prioritizedVariableNames(owner, MAX_VARIABLE_PROPERTIES_PER_OBJECT);
    const childContainers = [];
    const includeArrayIndices = Boolean(options.includeArrayIndices);
    const includeFrameworkKeys = Boolean(options.includeFrameworkKeys);
    const source = options.source || "scan";
    for (const name of names) {
      const noisyName = isNoisyVariableName(name) && !(includeFrameworkKeys && /^(?:id)$/i.test(String(name)));
      if (budget.count >= variableBudgetLimit(budget) || noisyName || (Array.isArray(owner) && /^\d+$/.test(String(name)) && !includeArrayIndices)) {
        continue;
      }

      const descriptor = safeGetOwnPropertyDescriptor(owner, name);
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, "value")) {
        continue;
      }

      const value = descriptor.value;
      const childPath = variablePath(path, name);
      if (shouldTrackVariableValue(value)) {
        if (isLowValueVariablePath(childPath)) {
          continue;
        }
        rememberVariable(owner, name, childPath, value, descriptor, source);
        budget.count += 1;
      } else if (value !== undefined && depth < variableScanDepthLimit(childPath) && canInspectVariableContainer(value)) {
        childContainers.push({
          path: childPath,
          value
        });
      }
    }

    for (const child of childContainers) {
      if (budget.count >= variableBudgetLimit(budget)) {
        break;
      }

      const previousLimit = budget.limit;
      budget.limit = Math.min(variableBudgetLimit({ limit: previousLimit }), budget.count + variableChildBudget(depth));
      try {
        scanVariableObject(child.value, child.path, depth + 1, seen, budget, options);
      } finally {
        budget.limit = previousLimit;
      }
    }
  }

  function freshWeakSet() {
    return typeof WeakSet === "function" ? new WeakSet() : {
      add() {},
      has() {
        return false;
      }
    };
  }

  function scanFrameworkVariableOwner(owner, path, budget, options = {}) {
    if (!canInspectVariableContainer(owner) || budget.count >= variableBudgetLimit(budget)) {
      return 0;
    }

    const before = budget.count;
    scanVariableObject(owner, path, 1, freshWeakSet(), budget, {
      includeArrayIndices: true,
      includeFrameworkKeys: true,
      source: "framework",
      ...options
    });
    return budget.count - before;
  }

  function frameworkVariableBasePath(component, rootLabel, depth) {
    const name = componentDisplayName(component);
    const uid = component && (component.uid || component.uid === 0) ? component.uid : "";
    const suffix = uid !== "" ? `[${uid}]` : "";
    return depth > 0
      ? `${rootLabel}.${name}${suffix}`
      : `${rootLabel}.${name}${suffix}`;
  }

  function scanVueComponentStateVariables(component, rootLabel, depth, seenComponents, seenOwners, budget) {
    if (!isVueComponentInstance(component) || seenComponents.has(component) || budget.count >= variableBudgetLimit(budget)) {
      return 0;
    }

    seenComponents.add(component);
    const basePath = frameworkVariableBasePath(component, rootLabel, depth);
    let scanned = 0;

    function scanOwner(owner, path) {
      scanned += scanFrameworkVariableOwner(owner, path, budget);
    }

    try {
      scanOwner(component.data, basePath);
    } catch (error) {
      // Options API data can be guarded.
    }

    try {
      scanOwner(component.setupState, `${basePath}.setupState`);
    } catch (error) {
      // Composition API setup state can be guarded.
    }

    try {
      scanOwner(component.exposed, `${basePath}.exposed`);
    } catch (error) {
      // Exposed component state can be guarded.
    }

    try {
      scanOwner(component.props, `${basePath}.props`);
    } catch (error) {
      // Props are useful but not always writable.
    }

    return scanned;
  }

  function scanVueVNodeStateVariables(vnode, rootLabel, depth, seenComponents, seenOwners, seenVNodes, budget) {
    if (!vnode || typeof vnode !== "object" || seenVNodes.has(vnode) || depth > MAX_FRAMEWORK_COMPONENT_DEPTH || budget.count >= variableBudgetLimit(budget)) {
      return;
    }

    seenVNodes.add(vnode);

    try {
      if (isVueComponentInstance(vnode.component)) {
        scanVueComponentStateVariableTree(vnode.component, rootLabel, depth, seenComponents, seenOwners, seenVNodes, budget);
      }
    } catch (error) {
      // Keep walking other vnode branches.
    }

    try {
      const children = vnode.children;
      if (Array.isArray(children)) {
        for (const child of children) {
          scanVueVNodeStateVariables(child, rootLabel, depth, seenComponents, seenOwners, seenVNodes, budget);
        }
      } else if (children && typeof children === "object") {
        for (const child of safeObjectKeys(children).map((key) => children[key])) {
          scanVueVNodeStateVariables(child, rootLabel, depth, seenComponents, seenOwners, seenVNodes, budget);
        }
      }
    } catch (error) {
      // Children collections vary by renderer/build.
    }

    try {
      if (vnode.suspense && vnode.suspense.activeBranch) {
        scanVueVNodeStateVariables(vnode.suspense.activeBranch, rootLabel, depth, seenComponents, seenOwners, seenVNodes, budget);
      }
    } catch (error) {
      // Suspense branches are optional.
    }
  }

  function scanVueComponentStateVariableTree(component, rootLabel, depth, seenComponents, seenOwners, seenVNodes, budget) {
    if (!isVueComponentInstance(component) || seenComponents.has(component) || depth > MAX_FRAMEWORK_COMPONENT_DEPTH || budget.count >= variableBudgetLimit(budget)) {
      return;
    }

    scanVueComponentStateVariables(component, rootLabel, depth, seenComponents, seenOwners, budget);
    try {
      scanVueVNodeStateVariables(component.subTree, rootLabel, depth + 1, seenComponents, seenOwners, seenVNodes, budget);
    } catch (error) {
      // Subtree traversal is best-effort.
    }
  }

  function isReactFiber(value) {
    return Boolean(value) &&
      typeof value === "object" &&
      (Object.prototype.hasOwnProperty.call(value, "tag") ||
        Object.prototype.hasOwnProperty.call(value, "elementType")) &&
      (Object.prototype.hasOwnProperty.call(value, "memoizedProps") ||
        Object.prototype.hasOwnProperty.call(value, "memoizedState") ||
        Object.prototype.hasOwnProperty.call(value, "stateNode")) &&
      (Object.prototype.hasOwnProperty.call(value, "child") ||
        Object.prototype.hasOwnProperty.call(value, "sibling") ||
        Object.prototype.hasOwnProperty.call(value, "return"));
  }

  function isReactFiberKey(key) {
    const text = propertyKeyText(key).toLowerCase();
    return text.includes("__reactfiber$") ||
      text.includes("__reactcontainer$") ||
      text.includes("_reactrootcontainer");
  }

  function reactFiberRoots(value) {
    const roots = [];
    if (!value || (typeof value !== "object" && typeof value !== "function")) {
      return roots;
    }

    const candidates = [];
    if (isReactFiber(value)) {
      candidates.push(value);
    }
    try {
      candidates.push(value.current);
    } catch (error) {
      // React FiberRoot objects expose current in most builds.
    }
    try {
      candidates.push(value._internalRoot && value._internalRoot.current);
    } catch (error) {
      // Legacy React root containers can hide the internal root.
    }
    try {
      candidates.push(value.stateNode && value.stateNode.current);
    } catch (error) {
      // HostRoot fibers sometimes point at the FiberRoot through stateNode.
    }

    for (const candidate of candidates) {
      if (isReactFiber(candidate) && !roots.includes(candidate)) {
        roots.push(candidate);
      }
    }
    return roots;
  }

  function reactFiberDisplayName(fiber) {
    let type = null;
    let elementType = null;
    try {
      type = fiber && fiber.type;
      elementType = fiber && fiber.elementType;
    } catch (error) {
      type = null;
      elementType = null;
    }

    const candidates = [
      type && type.displayName,
      type && type.name,
      elementType && elementType.displayName,
      elementType && elementType.name,
      fiber && fiber._debugOwner && fiber._debugOwner.type && fiber._debugOwner.type.name
    ];

    for (const candidate of candidates) {
      const text = String(candidate || "").trim();
      if (text) {
        return text.replace(/[^\w$-]+/g, "_").slice(0, 60);
      }
    }

    if (typeof type === "string" && type) {
      return type.replace(/[^\w$-]+/g, "_").slice(0, 60);
    }

    return "ReactComponent";
  }

  function reactFiberBasePath(fiber, rootLabel) {
    return `${rootLabel}.${reactFiberDisplayName(fiber)}[${variableObjectId(fiber)}]`;
  }

  function isReactComponentFiber(fiber) {
    if (!isReactFiber(fiber)) {
      return false;
    }

    let type = null;
    let elementType = null;
    try {
      type = fiber.type || fiber.elementType;
      elementType = fiber.elementType;
    } catch (error) {
      type = null;
      elementType = null;
    }

    return typeof type === "function" || typeof elementType === "function";
  }

  function isReactHook(value) {
    return Boolean(value) &&
      typeof value === "object" &&
      Object.prototype.hasOwnProperty.call(value, "memoizedState") &&
      (Object.prototype.hasOwnProperty.call(value, "next") ||
        Object.prototype.hasOwnProperty.call(value, "queue") ||
        Object.prototype.hasOwnProperty.call(value, "baseState"));
  }

  function isReactInternalHookState(value) {
    if (!value || typeof value !== "object") {
      return false;
    }

    if (isReactFiber(value) || isReactHook(value)) {
      return true;
    }

    const hasTagNext = Object.prototype.hasOwnProperty.call(value, "tag") &&
      Object.prototype.hasOwnProperty.call(value, "next");
    if (hasTagNext &&
        (Object.prototype.hasOwnProperty.call(value, "create") ||
          Object.prototype.hasOwnProperty.call(value, "destroy") ||
          Object.prototype.hasOwnProperty.call(value, "deps") ||
          Object.prototype.hasOwnProperty.call(value, "inst"))) {
      return true;
    }

    return false;
  }

  function isReactStateHook(hook) {
    if (!hook || typeof hook !== "object") {
      return false;
    }

    try {
      if (hook.queue && typeof hook.queue.dispatch === "function") {
        const reducer = hook.queue.lastRenderedReducer;
        const reducerName = reducer && reducer.name ? String(reducer.name) : "";
        const reducerText = typeof reducer === "function" ? functionSource(reducer).slice(0, 240) : "";
        return !reducer ||
          typeof hook.queue.lastRenderedState !== "undefined" ||
          reducerName === "basicStateReducer" ||
          reducerText.includes("typeof action") ||
          reducerText.includes("basicStateReducer");
      }
    } catch (error) {
      return false;
    }

    return false;
  }

  function reactHookDispatch(hook) {
    try {
      return hook && hook.queue && typeof hook.queue.dispatch === "function"
        ? hook.queue.dispatch
        : null;
    } catch (error) {
      return null;
    }
  }

  function rememberReactHookStateVariable(hook, path, value, budget) {
    const descriptor = safeGetOwnPropertyDescriptor(hook, "memoizedState") || {
      configurable: true,
      enumerable: true,
      value,
      writable: true
    };
    const canDispatch = Boolean(reactHookDispatch(hook));
    rememberVariable(hook, "memoizedState", path, value, descriptor, "framework", {
      canEdit: canDispatch || isReactStateHook(hook) || canEditVariableValue(value, descriptor),
      assign(nextValue) {
        const dispatch = reactHookDispatch(hook);
        if (dispatch) {
          Reflect.apply(dispatch, null, [nextValue]);
        } else {
          hook.memoizedState = nextValue;
        }
      },
      read() {
        return hook.memoizedState;
      }
    });
    budget.count += 1;
  }

  function scanReactHookVariables(firstHook, basePath, budget) {
    let hook = firstHook;
    const seenHooks = freshWeakSet();
    for (let index = 0; hook && typeof hook === "object" && index < 80 && budget.count < variableBudgetLimit(budget); index += 1) {
      if (seenHooks.has(hook) || !isReactHook(hook)) {
        break;
      }
      seenHooks.add(hook);

      let value;
      try {
        value = hook.memoizedState;
      } catch (error) {
        value = undefined;
      }

      const hookPath = `${basePath}[${index}]`;
      if (shouldTrackVariableValue(value)) {
        rememberReactHookStateVariable(hook, `${hookPath}.state`, value, budget);
      } else if (value && typeof value === "object") {
        try {
          if (Object.prototype.hasOwnProperty.call(value, "current") && shouldTrackVariableValue(value.current)) {
            const descriptor = safeGetOwnPropertyDescriptor(value, "current");
            rememberVariable(value, "current", `${hookPath}.ref.current`, value.current, descriptor, "framework");
            budget.count += 1;
          }
        } catch (error) {
          // Ref-like values are best-effort.
        }
        if (!isReactInternalHookState(value)) {
          scanFrameworkVariableOwner(value, `${hookPath}.state`, budget);
        }
      }

      try {
        hook = hook.next;
      } catch (error) {
        break;
      }
    }
  }

  function scanReactFiberStateVariables(fiber, rootLabel, seenFibers, budget) {
    if (!isReactFiber(fiber) || seenFibers.has(fiber) || budget.count >= variableBudgetLimit(budget)) {
      return;
    }

    seenFibers.add(fiber);
    if (isReactComponentFiber(fiber)) {
      const basePath = reactFiberBasePath(fiber, rootLabel);
      try {
        scanFrameworkVariableOwner(fiber.memoizedProps, `${basePath}.props`, budget);
      } catch (error) {
        // Props can be guarded by framework internals.
      }

      try {
        if (fiber.stateNode && typeof fiber.stateNode === "object" && !(fiber.stateNode instanceof Node)) {
          scanFrameworkVariableOwner(fiber.stateNode.state, `${basePath}.state`, budget);
          scanFrameworkVariableOwner(fiber.stateNode.props, `${basePath}.instance.props`, budget);
        }
      } catch (error) {
        // Class instances are optional.
      }

      try {
        scanReactHookVariables(fiber.memoizedState, `${basePath}.hooks`, budget);
      } catch (error) {
        // Hook list layout is React-version-dependent.
      }
    }

    try {
      if (fiber.child) {
        scanReactFiberStateVariables(fiber.child, rootLabel, seenFibers, budget);
      }
    } catch (error) {
      // Keep walking siblings when possible.
    }

    try {
      if (fiber.sibling) {
        scanReactFiberStateVariables(fiber.sibling, rootLabel, seenFibers, budget);
      }
    } catch (error) {
      // Best effort.
    }
  }

  function isAngularContextKey(key) {
    return propertyKeyText(key).toLowerCase().includes("__ngcontext__");
  }

  function isAngularCandidateObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }

    try {
      if (value instanceof Node || value instanceof Window || value instanceof Event || value instanceof Promise) {
        return false;
      }
    } catch (error) {
      return false;
    }

    const constructorName = value.constructor && value.constructor.name ? String(value.constructor.name) : "";
    if (/^(?:Object|Array|Map|Set|WeakMap|WeakSet|Promise|Event|Node|Window|Document)$/i.test(constructorName)) {
      const ownNames = prioritizedVariableNames(value, 40);
      return ownNames.some((name) => !isNoisyVariableName(name) && !/^[_$]/.test(String(name)));
    }

    return true;
  }

  function collectAngularContextObjects(value, out, seen, depth = 0) {
    if (!value || (typeof value !== "object" && typeof value !== "function") || seen.has(value) || depth > 3 || out.length >= 80) {
      return;
    }

    seen.add(value);
    if (isAngularCandidateObject(value)) {
      out.push(value);
    }

    if (!Array.isArray(value)) {
      return;
    }

    const limit = Array.isArray(value) ? Math.min(value.length, 220) : 80;
    for (let index = 0; index < limit && out.length < 80; index += 1) {
      let child;
      try {
        child = value[index];
      } catch (error) {
        continue;
      }

      if (child && (typeof child === "object" || typeof child === "function")) {
        collectAngularContextObjects(child, out, seen, depth + 1);
      }
    }
  }

  function angularComponentName(component) {
    const constructorName = component && component.constructor && component.constructor.name
      ? String(component.constructor.name)
      : "";
    return (constructorName || "AngularComponent").replace(/[^\w$-]+/g, "_").slice(0, 60);
  }

  function angularComponentCandidates(element) {
    const candidates = [];
    const add = (value) => {
      if (!value) {
        return;
      }
      if (Array.isArray(value)) {
        for (const item of value) {
          add(item);
        }
        return;
      }
      if (isAngularCandidateObject(value) && !candidates.includes(value)) {
        candidates.push(value);
      }
    };

    try {
      if (window.ng && typeof window.ng.getComponent === "function") {
        add(window.ng.getComponent(element));
      }
    } catch (error) {
      // Angular debug helpers are optional.
    }
    try {
      if (window.ng && typeof window.ng.getOwningComponent === "function") {
        add(window.ng.getOwningComponent(element));
      }
    } catch (error) {
      // Optional.
    }
    try {
      if (window.ng && typeof window.ng.getDirectives === "function") {
        add(window.ng.getDirectives(element));
      }
    } catch (error) {
      // Optional.
    }

    const ownKeys = safeGetOwnPropertyNames(element).concat(safeGetOwnPropertySymbols(element));
    for (const key of ownKeys) {
      if (!isAngularContextKey(key)) {
        continue;
      }

      let context;
      try {
        context = element[key];
      } catch (error) {
        continue;
      }

      const contextCandidates = [];
      collectAngularContextObjects(context, contextCandidates, freshWeakSet());
      for (const candidate of contextCandidates) {
        add(candidate);
      }
    }

    return candidates;
  }

  function scanAngularComponentStateVariables(component, rootLabel, seenComponents, budget) {
    if (!isAngularCandidateObject(component) || seenComponents.has(component) || budget.count >= variableBudgetLimit(budget)) {
      return;
    }

    seenComponents.add(component);
    const basePath = `${rootLabel}.${angularComponentName(component)}[${variableObjectId(component)}]`;
    scanFrameworkVariableOwner(component, basePath, budget);
  }

  function scanFrameworkStateVariables(budget) {
    if (!document || typeof document.querySelectorAll !== "function" || budget.count >= variableBudgetLimit(budget)) {
      return;
    }

    let elements;
    try {
      elements = Array.prototype.slice.call(document.querySelectorAll("*"), 0, MAX_FRAMEWORK_EVENT_ELEMENTS);
    } catch (error) {
      return;
    }

    const seenComponents = freshWeakSet();
    const seenOwners = freshWeakSet();
    const seenReactFibers = freshWeakSet();
    const seenAngularComponents = freshWeakSet();

    for (const element of elements) {
      if (budget.count >= variableBudgetLimit(budget)) {
        break;
      }

      const ownKeys = safeGetOwnPropertyNames(element).concat(safeGetOwnPropertySymbols(element));
      for (const elementKey of ownKeys) {
        if (!isVueComponentKey(elementKey)) {
          continue;
        }

        let value;
        try {
          value = element[elementKey];
        } catch (error) {
          continue;
        }

        const rootLabel = propertyKeyText(elementKey).toLowerCase() === "__vue_app__"
          ? "vue.app"
          : "vue.component";

        for (const rootComponent of vueComponentRoots(value)) {
          const seenVNodes = typeof WeakSet === "function" ? new WeakSet() : {
            add() {},
            has() {
              return false;
            }
          };
          scanVueComponentStateVariableTree(rootComponent, rootLabel, 0, seenComponents, seenOwners, seenVNodes, budget);
        }
      }

      for (const elementKey of ownKeys) {
        if (!isReactFiberKey(elementKey)) {
          continue;
        }

        let value;
        try {
          value = element[elementKey];
        } catch (error) {
          continue;
        }

        for (const rootFiber of reactFiberRoots(value)) {
          scanReactFiberStateVariables(rootFiber, "react.fiber", seenReactFibers, budget);
        }
      }

      for (const component of angularComponentCandidates(element)) {
        scanAngularComponentStateVariables(component, "angular.component", seenAngularComponents, budget);
      }
    }
  }

  function scanVariables(force = false) {
    if (!state.running) {
      return;
    }

    const elapsed = Date.now() - state.variableScanAt;
    if (!force && elapsed < VARIABLE_SCAN_INTERVAL_MS && state.variableRecords.size) {
      return;
    }

    state.variableScanAt = Date.now();

    state.variableScanSeq += 1;
    const scanSeq = state.variableScanSeq;
    const seen = typeof WeakSet === "function" ? new WeakSet() : {
      add() {},
      has() {
        return false;
      }
    };
    const budget = {
      count: 0,
      limit: MAX_VARIABLES
    };

    scanFrameworkStateVariables(budget);

    const enumerableNames = safeObjectKeys(window);
    const names = Array.from(new Set(prioritizedVariableNames(window, 800).concat(enumerableNames)));
    for (const name of names) {
      if (budget.count >= MAX_VARIABLES) {
        break;
      }

      const descriptor = safeGetOwnPropertyDescriptor(window, name);
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, "value")) {
        continue;
      }

      const value = descriptor.value;
      if (shouldSkipVariableRoot(name, value)) {
        continue;
      }

      const path = String(name);
      if (shouldTrackVariableValue(value)) {
        rememberVariable(window, name, path, value, descriptor);
        budget.count += 1;
      } else if (value !== undefined && canInspectVariableContainer(value)) {
        scanVariableObject(value, path, 1, seen, budget);
      }
    }

    for (const [id, record] of Array.from(state.variableRecords)) {
      if (record.source !== "observed" && record.scanSeq !== scanSeq) {
        state.variableRecords.delete(id);
        state.variableRefs.delete(id);
      }
    }
  }

  function refreshVariableRecords() {
    if (!state.variableRecords.size) {
      return;
    }

    for (const [id, ref] of Array.from(state.variableRefs)) {
      if (typeof ref.read === "function") {
        let value;
        try {
          value = ref.read();
        } catch (error) {
          state.variableRecords.delete(id);
          state.variableRefs.delete(id);
          continue;
        }
        const descriptor = safeGetOwnPropertyDescriptor(ref.owner, ref.key) || {
          configurable: true,
          enumerable: true,
          value,
          writable: true
        };
        rememberVariable(ref.owner, ref.key, ref.path, value, descriptor, ref.source || "scan", {
          assign: ref.assign,
          canEdit: Boolean(ref.assign) || canEditVariableValue(value, descriptor),
          read: ref.read
        });
        continue;
      }

      const descriptor = safeGetOwnPropertyDescriptor(ref.owner, ref.key);
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, "value")) {
        state.variableRecords.delete(id);
        state.variableRefs.delete(id);
        continue;
      }

      rememberVariable(ref.owner, ref.key, ref.path, descriptor.value, descriptor, ref.source || "scan");
    }
  }

  function observedVariableKeyName(key) {
    const text = String(key);
    return /^[A-Za-z_$][\w$]*$/.test(text) ? text : `[${JSON.stringify(text)}]`;
  }

  function isNoisyObservedVariableName(name) {
    const text = String(name || "");
    return !text ||
      text === "prototype" ||
      text === "constructor" ||
      text === "__proto__" ||
      text === "arguments" ||
      text === "caller" ||
      text === "length" ||
      text === "name" ||
      text.startsWith("__JAVASCREEN") ||
      text.startsWith("webkit") ||
      text.startsWith("moz") ||
      text.startsWith("on") ||
      text.includes("webpack") ||
      text.includes("jQuery");
  }

  function variableObjectId(owner) {
    if (!state.variableObjectIds || !owner || (typeof owner !== "object" && typeof owner !== "function")) {
      return "object";
    }

    try {
      const existing = state.variableObjectIds.get(owner);
      if (existing) {
        return existing;
      }

      state.variableObjectSeq += 1;
      state.variableObjectIds.set(owner, state.variableObjectSeq);
      return state.variableObjectSeq;
    } catch (error) {
      return "object";
    }
  }

  function observeVariableObject(owner, path, entry, depth, seen, budget) {
    if (!canInspectVariableContainer(owner) || budget.count >= MAX_OBSERVED_VARIABLES_PER_CALL) {
      return;
    }

    if ((typeof owner === "object" || typeof owner === "function") && seen.has(owner)) {
      return;
    }

    if (typeof owner === "object" || typeof owner === "function") {
      seen.add(owner);
    }

    const names = safeGetOwnPropertyNames(owner).slice(0, MAX_OBSERVED_VARIABLE_PROPERTIES);
    const entryLabel = truncate(String(entry && (entry.name || entry.path) || "call"), 70);

    for (const name of names) {
      if (budget.count >= MAX_OBSERVED_VARIABLES_PER_CALL || isNoisyObservedVariableName(name) || (Array.isArray(owner) && /^\d+$/.test(String(name)))) {
        continue;
      }

      const descriptor = safeGetOwnPropertyDescriptor(owner, name);
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, "value")) {
        continue;
      }

      const value = descriptor.value;
      const childPath = `${path}.${observedVariableKeyName(name)}`;
      if (!shouldTrackVariableValue(value)) {
        if (depth < MAX_OBSERVED_VARIABLE_DEPTH && canInspectVariableContainer(value)) {
          observeVariableObject(value, childPath, entry, depth + 1, seen, budget);
        }
        continue;
      }

      rememberVariable(owner, name, `${childPath} @ ${entryLabel}`, value, descriptor, "observed");
      budget.count += 1;
    }
  }

  function observeVariableContainer(owner, label, entry, seen, budget) {
    if (!state.variableWatchEnabled || !canInspectVariableContainer(owner)) {
      return;
    }

    observeVariableObject(owner, `${label}#${variableObjectId(owner)}`, entry, 0, seen, budget);
  }

  function observeCallVariables(entry, thisValue, args, result) {
    if (!state.variableWatchEnabled) {
      return;
    }

    const now = Date.now();
    if (now - state.variableObserveWindowAt > 1000) {
      state.variableObserveWindowAt = now;
      state.variableObserveCount = 0;
    }

    if (state.variableObserveCount >= VARIABLE_OBSERVE_BUDGET_PER_SECOND) {
      return;
    }
    state.variableObserveCount += 1;

    const seen = typeof WeakSet === "function" ? new WeakSet() : {
      add() {},
      has() {
        return false;
      }
    };
    const budget = {
      count: 0
    };

    observeVariableContainer(thisValue, "this", entry, seen, budget);

    if (result && (typeof result === "object" || typeof result === "function")) {
      observeVariableContainer(result, "return", entry, seen, budget);
    }

    const values = toArray(args).slice(0, 4);
    for (let index = 0; index < values.length; index += 1) {
      observeVariableContainer(values[index], `arg${index}`, entry, seen, budget);
    }
  }

  function variableSnapshot(force = false, allowScan = false) {
    if (!state.variableWatchEnabled) {
      return [];
    }

    if (allowScan) {
      scanVariables(force);
    } else {
      refreshVariableRecords();
    }
    if (state.variableRecords.size > MAX_VARIABLES * 2) {
      const staleRecords = Array.from(state.variableRecords.values())
        .sort((first, second) => String(first.lastSeenAt || "").localeCompare(String(second.lastSeenAt || "")))
        .slice(0, state.variableRecords.size - MAX_VARIABLES);
      for (const record of staleRecords) {
        state.variableRecords.delete(record.id);
        state.variableRefs.delete(record.id);
      }
    }

    return Array.from(state.variableRecords.values())
      .sort((first, second) => {
        const importance = (second.importance || 0) - (first.importance || 0);
        if (importance) {
          return importance;
        }
        const changed = String(second.lastChangedAt || "").localeCompare(String(first.lastChangedAt || ""));
        if (changed) {
          return changed;
        }
        return first.path.localeCompare(second.path);
      })
      .slice(0, MAX_VARIABLES)
      .map((record) => ({
        canEdit: Boolean(record.canEdit),
        displayValue: record.displayValue,
        frame: record.frame,
        id: record.id,
        importance: record.importance || 0,
        kind: record.kind,
        lastChangedAt: record.lastChangedAt,
        lastSeenAt: record.lastSeenAt,
        path: record.path,
        source: record.source || "scan",
        value: record.value
      }));
  }

  function replayCloneValue(value, depth = 0, seen = []) {
    if (value === null) {
      return {
        replayable: true,
        value: null
      };
    }

    const type = typeof value;
    if (type === "string" || type === "boolean") {
      return {
        replayable: true,
        value
      };
    }

    if (type === "number") {
      return Number.isFinite(value)
        ? {
          replayable: true,
          value
        }
        : {
          reason: "non-finite numbers cannot be edited as JSON",
          replayable: false
        };
    }

    if (type === "undefined") {
      return {
        reason: "undefined cannot be edited as JSON",
        replayable: false
      };
    }

    if (type === "bigint" || type === "symbol" || type === "function") {
      return {
        reason: `${type} arguments cannot be replayed from JSON`,
        replayable: false
      };
    }

    try {
      if (value instanceof Event) {
        return {
          reason: "Event objects are live browser objects and cannot be replayed from the log",
          replayable: false
        };
      }
    } catch (error) {
      return {
        reason: "browser event arguments cannot be replayed from the log",
        replayable: false
      };
    }

    try {
      if (value instanceof Element || value === window || value === document) {
        return {
          reason: "DOM/window/document arguments are live browser objects and cannot be replayed from the log",
          replayable: false
        };
      }
    } catch (error) {
      return {
        reason: "DOM arguments cannot be replayed from the log",
        replayable: false
      };
    }

    if (seen.includes(value)) {
      return {
        reason: "circular arguments cannot be replayed from JSON",
        replayable: false
      };
    }

    if (depth >= 6) {
      return {
        reason: "argument nesting is too deep to replay safely",
        replayable: false
      };
    }

    const nextSeen = seen.concat(value);

    if (Array.isArray(value)) {
      const cloned = [];
      for (const item of value) {
        const child = replayCloneValue(item, depth + 1, nextSeen);
        if (!child.replayable) {
          return child;
        }
        cloned.push(child.value);
      }

      return {
        replayable: true,
        value: cloned
      };
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return {
        reason: `${Object.prototype.toString.call(value)} arguments are not plain JSON objects`,
        replayable: false
      };
    }

    const cloned = {};
    for (const key of Object.keys(value)) {
      let childValue;
      try {
        childValue = value[key];
      } catch (error) {
        return {
          reason: `property ${key} threw while preparing replay arguments`,
          replayable: false
        };
      }

      const child = replayCloneValue(childValue, depth + 1, nextSeen);
      if (!child.replayable) {
        return child;
      }
      cloned[key] = child.value;
    }

    return {
      replayable: true,
      value: cloned
    };
  }

  function replayArguments(args) {
    try {
      const values = [];
      for (const arg of toArray(args)) {
        const cloned = replayCloneValue(arg);
        if (!cloned.replayable) {
          return {
            reason: cloned.reason || "arguments cannot be replayed from the log",
            replayable: false
          };
        }
        values.push(cloned.value);
      }

      return {
        replayable: true,
        values
      };
    } catch (error) {
      return {
        reason: "arguments were unavailable for replay",
        replayable: false
      };
    }
  }

  function rememberReplayRef(value) {
    state.replayRefSeq += 1;
    const refId = `ref:${state.replayRefSeq}`;
    state.replayRefs.set(refId, {
      preview: serializeSafely(value),
      storedAt: nowIso(),
      value
    });

    while (state.replayRefs.size > MAX_REPLAY_REFS) {
      const firstKey = state.replayRefs.keys().next().value;
      state.replayRefs.delete(firstKey);
    }

    return {
      preview: state.replayRefs.get(refId).preview,
      refId,
      type: "ref"
    };
  }

  function replayPrimitiveDescriptor(value) {
    if (value === null) {
      return {
        type: "json",
        value: null
      };
    }

    const type = typeof value;
    if (type === "string" || type === "boolean") {
      return {
        type: "json",
        value
      };
    }

    if (type === "number") {
      if (Number.isNaN(value)) {
        return {
          type: "number",
          value: "NaN"
        };
      }

      if (value === Infinity) {
        return {
          type: "number",
          value: "Infinity"
        };
      }

      if (value === -Infinity) {
        return {
          type: "number",
          value: "-Infinity"
        };
      }

      return {
        type: "json",
        value
      };
    }

    if (type === "undefined") {
      return {
        type: "undefined"
      };
    }

    if (type === "bigint") {
      return {
        type: "bigint",
        value: value.toString()
      };
    }

    return null;
  }

  function forceReplayDescriptor(value) {
    const primitive = replayPrimitiveDescriptor(value);
    if (primitive) {
      return primitive;
    }

    if (typeof Event === "function" && value instanceof Event) {
      return domEventForceReplayDescriptor(value, describeTarget(value.target));
    }

    return rememberReplayRef(value);
  }

  function forceReplayArguments(args, replay) {
    try {
      if (replay && replay.replayable && Array.isArray(replay.values)) {
        return {
          forceReplayable: true,
          values: replay.values.map((value) => ({
            type: "json",
            value
          }))
        };
      }

      return {
        forceReplayable: true,
        values: toArray(args).map(forceReplayDescriptor)
      };
    } catch (error) {
      return {
        forceReplayable: false,
      reason: "force replay arguments could not be stored"
      };
    }
  }

  function shouldRememberReplayThis(thisValue, constructTarget = null) {
    if (constructTarget) {
      return false;
    }

    if (!thisValue || thisValue === window) {
      return false;
    }

    const type = typeof thisValue;
    return type === "object" || type === "function";
  }

  function forceReplayThisDescriptor(thisValue, constructTarget = null) {
    if (!shouldRememberReplayThis(thisValue, constructTarget)) {
      return null;
    }

    try {
      return forceReplayDescriptor(thisValue);
    } catch (error) {
      return null;
    }
  }

  function resolveReplayRef(refId) {
    const record = state.replayRefs.get(String(refId || ""));
    if (!record) {
      throw new Error("Live replay reference is no longer available.");
    }

    return record.value;
  }

  function resolveSpecialReplayValue(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    if (Object.prototype.hasOwnProperty.call(value, "$javascreenRef")) {
      return {
        matched: true,
        value: resolveReplayRef(value.$javascreenRef)
      };
    }

    if (Object.prototype.hasOwnProperty.call(value, "$javascreenUndefined")) {
      return {
        matched: true,
        value: undefined
      };
    }

    if (Object.prototype.hasOwnProperty.call(value, "$javascreenNumber")) {
      const numberValue = String(value.$javascreenNumber || "");
      if (numberValue === "NaN") {
        return {
          matched: true,
          value: NaN
        };
      }
      if (numberValue === "Infinity") {
        return {
          matched: true,
          value: Infinity
        };
      }
      if (numberValue === "-Infinity") {
        return {
          matched: true,
          value: -Infinity
        };
      }
      return {
        matched: true,
        value: Number(numberValue)
      };
    }

    if (Object.prototype.hasOwnProperty.call(value, "$javascreenBigInt")) {
      return {
        matched: true,
        value: BigInt(String(value.$javascreenBigInt || "0"))
      };
    }

    return null;
  }

  function resolveReplayValue(value) {
    const special = resolveSpecialReplayValue(value);
    if (special && special.matched) {
      return special.value;
    }

    if (Array.isArray(value)) {
      return value.map(resolveReplayValue);
    }

    if (!value || typeof value !== "object") {
      return value;
    }

    const resolved = {};
    for (const key of Object.keys(value)) {
      resolved[key] = resolveReplayValue(value[key]);
    }
    return resolved;
  }

  function resolveForceReplayDescriptor(descriptor) {
    if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)) {
      return resolveReplayValue(descriptor);
    }

    switch (descriptor.type) {
      case "json":
        return resolveReplayValue(descriptor.value);
      case "undefined":
        return undefined;
      case "number":
        if (descriptor.value === "NaN") {
          return NaN;
        }
        if (descriptor.value === "Infinity") {
          return Infinity;
        }
        if (descriptor.value === "-Infinity") {
          return -Infinity;
        }
        return Number(descriptor.value);
      case "bigint":
        return BigInt(String(descriptor.value || "0"));
      case "ref":
        return resolveReplayRef(descriptor.refId);
      case "dom-event":
        return makeReplayDomEvent(descriptor.eventType, eventInitForSequence(resolveReplayValue(descriptor.init || {}), descriptor.eventType));
      default:
        return resolveReplayValue(descriptor);
    }
  }

  function resolveReplayArguments(args, options = {}) {
    if (!Array.isArray(args)) {
      throw new Error("Replay arguments must be a JSON array.");
    }

    return options && options.forceDescriptors
      ? args.map(resolveForceReplayDescriptor)
      : args.map(resolveReplayValue);
  }

  function resolveReplayThis(options = {}) {
    if (!options || !Object.prototype.hasOwnProperty.call(options, "forceThis")) {
      return {
        matched: false,
        value: null
      };
    }

    return {
      matched: true,
      value: options.forceThisDescriptor
        ? resolveForceReplayDescriptor(options.forceThis)
        : resolveReplayValue(options.forceThis)
    };
  }

  function eventInitFromEvent(event) {
    const init = {};
    const props = [
      "bubbles",
      "button",
      "buttons",
      "cancelable",
      "clientX",
      "clientY",
      "composed",
      "ctrlKey",
      "detail",
      "height",
      "isComposing",
      "key",
      "location",
      "metaKey",
      "movementX",
      "movementY",
      "offsetX",
      "offsetY",
      "pageX",
      "pageY",
      "pointerId",
      "pointerType",
      "pressure",
      "relatedTarget",
      "screenX",
      "screenY",
      "shiftKey",
      "tiltX",
      "tiltY",
      "twist",
      "width"
    ];

    for (const prop of props) {
      try {
        const value = event[prop];
        if (value === undefined || typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
          continue;
        }

        if (prop === "relatedTarget" && value) {
          continue;
        }

        init[prop] = value;
      } catch (error) {
        // Some event properties are host-backed and can throw after dispatch.
      }
    }

    return init;
  }

  function domEventForceReplayDescriptor(event, targetDescription) {
    return {
      eventType: String(event && event.type || "event"),
      init: eventInitFromEvent(event),
      preview: describeEvent(event),
      target: rememberReplayRef(event && event.target || window),
      targetDescription,
      type: "dom-event"
    };
  }

  function makeReplayDomEvent(type, init = {}) {
    const eventType = String(type || "event");
    const lowerType = eventType.toLowerCase();

    try {
      if (lowerType.startsWith("pointer") && typeof PointerEvent === "function") {
        return new PointerEvent(eventType, init);
      }
    } catch (error) {
      // Fall through to broader event constructors.
    }

    try {
      if ((lowerType.includes("mouse") || lowerType === "click" || lowerType === "dblclick" || lowerType === "contextmenu") &&
          typeof MouseEvent === "function") {
        return new MouseEvent(eventType, init);
      }
    } catch (error) {
      // Fall through.
    }

    try {
      if (lowerType.startsWith("key") && typeof KeyboardEvent === "function") {
        return new KeyboardEvent(eventType, init);
      }
    } catch (error) {
      // Fall through.
    }

    try {
      if ((lowerType === "input" || lowerType === "beforeinput") && typeof InputEvent === "function") {
        return new InputEvent(eventType, init);
      }
    } catch (error) {
      // Fall through.
    }

    return new Event(eventType, init);
  }

  function shouldReplayClickSequence(type) {
    const lowerType = String(type || "").toLowerCase();
    return lowerType === "click" ||
      lowerType === "mousedown" ||
      lowerType === "mouseup" ||
      lowerType === "pointerdown" ||
      lowerType === "pointerup";
  }

  function eventInitForSequence(baseInit, type) {
    const lowerType = String(type || "").toLowerCase();
    const init = Object.assign({}, baseInit, {
      bubbles: true,
      cancelable: true,
      composed: true
    });

    if (lowerType === "pointerdown" || lowerType === "mousedown") {
      init.button = 0;
      init.buttons = 1;
    } else if (lowerType === "pointerup" || lowerType === "mouseup" || lowerType === "click") {
      init.button = 0;
      init.buttons = 0;
    }

    if (lowerType.startsWith("pointer") && !init.pointerType) {
      init.pointerType = "mouse";
    }

    return init;
  }

  function dispatchReplayDomEvent(target, type, init) {
    return target.dispatchEvent(makeReplayDomEvent(type, eventInitForSequence(init, type)));
  }

  function replayClickSequence(target, init) {
    let result = true;
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      result = dispatchReplayDomEvent(target, type, init) && result;
    }

    return result;
  }

  function replayObservedDomEvent(args) {
    const descriptor = args && args[0];
    if (!descriptor || descriptor.type !== "dom-event") {
      throw new Error("Observed event replay data is unavailable.");
    }

    const target = resolveForceReplayDescriptor(descriptor.target);
    if (!target || typeof target.dispatchEvent !== "function") {
      throw new Error("Observed event target is no longer available.");
    }

    const init = resolveReplayValue(descriptor.init || {});
    if (shouldReplayClickSequence(descriptor.eventType)) {
      return replayClickSequence(target, init);
    }

    return dispatchReplayDomEvent(target, descriptor.eventType, init);
  }

  function makeDirectReplayDomEvent(descriptor) {
    const target = resolveForceReplayDescriptor(descriptor && descriptor.target);
    const init = eventInitForSequence(resolveReplayValue(descriptor && descriptor.init || {}), descriptor && descriptor.eventType);
    const event = makeReplayDomEvent(descriptor && descriptor.eventType || "event", init);

    for (const [key, value] of [
      ["target", target || window],
      ["currentTarget", target || window],
      ["srcElement", target || window]
    ]) {
      try {
        Object.defineProperty(event, key, {
          configurable: true,
          value
        });
      } catch (error) {
        // Some Event host properties cannot be overridden; a plain fallback below covers those pages.
      }
    }

    try {
      Object.defineProperty(event, "composedPath", {
        configurable: true,
        value() {
          const path = [];
          let node = target || null;
          while (node) {
            path.push(node);
            node = node.parentNode || node.host || null;
          }
          path.push(document, window);
          return path;
        }
      });
      return event;
    } catch (error) {
      return Object.assign({}, init, {
        bubbles: init.bubbles !== false,
        cancelable: init.cancelable !== false,
        composedPath() {
          return [target || window, document, window];
        },
        currentTarget: target || window,
        defaultPrevented: false,
        preventDefault() {
          this.defaultPrevented = true;
        },
        stopImmediatePropagation() {},
        stopPropagation() {},
        target: target || window,
        type: descriptor && descriptor.eventType || "event"
      });
    }
  }

  function resolveDirectHandlerReplayDescriptor(descriptor) {
    if (descriptor && typeof descriptor === "object" && !Array.isArray(descriptor) && descriptor.type === "dom-event") {
      return makeDirectReplayDomEvent(descriptor);
    }

    return resolveForceReplayDescriptor(descriptor);
  }

  function resolveDirectHandlerReplayArguments(args, options = {}) {
    if (!Array.isArray(args)) {
      throw new Error("Replay arguments must be a JSON array.");
    }

    return options && options.forceDescriptors
      ? args.map(resolveDirectHandlerReplayDescriptor)
      : args.map(resolveReplayValue);
  }

  function frameMessage(type, payload = {}) {
    return Object.assign({
      channel: FRAME_CHANNEL,
      frameId: state.frameId,
      frameInfo: ownFrameInfo(),
      type,
      version: VERSION
    }, payload);
  }

  function postToTop(type, payload = {}) {
    if (isTopWindow()) {
      return;
    }

    try {
      if (window.top && window.top[KEY]) {
        return;
      }
    } catch (error) {
      // Cross-origin frames cannot be drained directly, so they should post reports.
    }

    try {
      window.top.postMessage(frameMessage(type, payload), "*");
    } catch (error) {
      // Cross-frame reporting is best effort; direct same-origin draining may still work.
    }
  }

  function postFrameSnapshot(includeFunctions = true) {
    postToTop("snapshot", {
      snapshot: snapshot(includeFunctions)
    });
  }

  function postFrameCall(call, entry) {
    postToTop("calls", {
      calls: [call],
      functions: [entrySnapshot(entry)],
      snapshot: snapshot(false)
    });
  }

  function installFrameFeed() {
    if (!isTopWindow() || state.nativeFrameFeed) {
      return;
    }

    const previousFeed = window[FRAME_FEED_KEY];
    if (previousFeed && typeof previousFeed.stop === "function") {
      previousFeed.stop();
    }

    const messages = [];

    function handleFrameMessage(event) {
      const data = event && event.data;
      if (!data || data.channel !== FRAME_CHANNEL || data.frameId === state.frameId) {
        return;
      }

      if (data.type !== "calls" && data.type !== "snapshot") {
        return;
      }

      messages.push(data);
      if (messages.length > MAX_FRAME_FEED) {
        messages.splice(0, messages.length - MAX_FRAME_FEED);
      }
    }

    const feed = {
      __javascreenInternal: true,
      drain() {
        return messages.splice(0, messages.length);
      },
      stop() {
        window.removeEventListener("message", handleFrameMessage, true);
      },
      version: VERSION
    };

    try {
      Object.defineProperty(window, FRAME_FEED_KEY, {
        configurable: true,
        value: feed
      });
    } catch (error) {
      window[FRAME_FEED_KEY] = feed;
    }

    window.addEventListener("message", handleFrameMessage, true);
    state.nativeFrameFeed = feed;
  }

  function forwardFrameCommand(message) {
    let length = 0;
    try {
      length = window.frames.length;
    } catch (error) {
      return;
    }

    for (let index = 0; index < length; index += 1) {
      try {
        window.frames[index].postMessage(message, "*");
      } catch (error) {
        // A child frame may be detached or reject the message.
      }
    }
  }

  function runFrameCommand(action, args) {
    if (action === "setDisabled") {
      setDisabled(String(args && args[0] || ""), Boolean(args && args[1]));
      postFrameSnapshot(false);
      return;
    }

    if (action === "replay") {
      replay(String(args && args[0] || ""), Array.isArray(args && args[1]) ? args[1] : [], args && args[2] || {});
      postFrameSnapshot(false);
      return;
    }

    if (action === "setVariable") {
      setVariable(String(args && args[0] || ""), args && args[1]);
      postFrameSnapshot(false);
      return;
    }

    if (action === "setVariableWatch") {
      setVariableWatch(Boolean(args && args[0]), args && args[1] || {});
      postFrameSnapshot(false);
      return;
    }

    if (action === "setOptions") {
      setOptions(args && args[0] || {});
      postFrameSnapshot(true);
      return;
    }

    if (action === "networkContinue") {
      networkContinue(String(args && args[0] || ""), String(args && args[1] || ""), args && args[2] || {});
      postFrameSnapshot(false);
      return;
    }

    if (action === "networkReplay") {
      networkReplay(String(args && args[0] || ""), args && args[1] || {});
      postFrameSnapshot(false);
      return;
    }

    if (action === "clear") {
      clear();
      postFrameSnapshot(false);
      return;
    }

    if (action === "rescan") {
      scan();
      postFrameSnapshot(true);
      return;
    }

    if (action === "stop") {
      stop();
      postFrameSnapshot(false);
    }
  }

  function installFrameCommandListener() {
    if (state.nativeFrameCommandListener) {
      return;
    }

    state.nativeFrameCommandListener = function handleFrameCommand(event) {
      const data = event && event.data;
      if (!data || data.channel !== FRAME_CHANNEL || data.type !== "command") {
        return;
      }

      const targetFrameId = data.targetFrameId || "";
      if (!targetFrameId || targetFrameId === state.frameId) {
        runFrameCommand(data.action, data.args || []);
      }

      if (!targetFrameId || targetFrameId !== state.frameId) {
        forwardFrameCommand(data);
      }
    };

    window.addEventListener("message", state.nativeFrameCommandListener, true);
  }

  function broadcastFrameCommand(action, args = [], targetFrameId = "") {
    forwardFrameCommand(frameMessage("command", {
      action,
      args,
      targetFrameId
    }));
  }

  function escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function countNewlines(text) {
    const matches = text.match(/\n/g);
    return matches ? matches.length : 0;
  }

  function lineAndColumnFromIndex(text, index, lineOffset = 0) {
    const prefix = text.slice(0, index);
    const line = lineOffset + countNewlines(prefix) + 1;
    const lastBreak = prefix.lastIndexOf("\n");
    const column = lastBreak === -1 ? prefix.length + 1 : prefix.length - lastBreak;
    return { line, column };
  }

  function buildDefinitionPatterns(name) {
    const escaped = escapeRegExp(name);
    return [
      new RegExp(`function\\s+${escaped}\\s*\\(`),
      new RegExp(`(?:const|let|var)\\s+${escaped}\\s*=\\s*(?:async\\s*)?(?:function\\b|\\([^)]*\\)\\s*=>|[A-Za-z_$][\\w$]*\\s*=>)`),
      new RegExp(`${escaped}\\s*[:=]\\s*(?:async\\s*)?function\\b`),
      new RegExp(`${escaped}\\s*\\([^)]*\\)\\s*\\{`)
    ];
  }

  function locateDefinition(name) {
    if (!name || !state.sourceFiles.length) {
      return null;
    }

    const patterns = buildDefinitionPatterns(name);

    for (const sourceFile of state.sourceFiles) {
      for (const pattern of patterns) {
        const match = pattern.exec(sourceFile.text);
        if (match && match.index >= 0) {
          const position = lineAndColumnFromIndex(sourceFile.text, match.index, sourceFile.lineOffset);
          return {
            column: position.column,
            kind: "definition",
            line: position.line,
            url: sourceFile.url
          };
        }
      }
    }

    return null;
  }

  function sourceFromScripts(name) {
    const scripts = toArray(document.scripts);
    for (const script of scripts) {
      const text = script.textContent || "";
      const location = findInlineDefinition(text, name);
      if (location) {
        return {
          column: location.column,
          kind: "inline-definition",
          line: location.line,
          url: window.location.href
        };
      }
    }

    return null;
  }

  function findInlineDefinition(text, name) {
    if (!text || !name) {
      return null;
    }

    for (const pattern of buildDefinitionPatterns(name)) {
      const match = pattern.exec(text);
      if (match && match.index >= 0) {
        return lineAndColumnFromIndex(text, match.index);
      }
    }

    return null;
  }

  function parseStackLocation(stack, ownPath) {
    if (!stack) {
      return null;
    }

    const lines = String(stack).split("\n").slice(1);
    for (const line of lines) {
      if (line.includes(KEY) || line.includes("javascreen") || line.includes(ownPath)) {
        continue;
      }

      const match = /(?:@|\()((?:https?|file|moz-extension):\/\/.*?):(\d+):(\d+)\)?$/.exec(line.trim());
      if (match) {
        return {
          column: Number(match[3]),
          kind: "call-site",
          line: Number(match[2]),
          url: match[1]
        };
      }
    }

    return null;
  }

  function refreshSourceIndex() {
    if (state.sourceIndexStatus === "indexing") {
      return;
    }

    state.sourceIndexStatus = "indexing";
    const scripts = toArray(document.scripts);
    const inlineFiles = [];
    const html = document.documentElement ? document.documentElement.outerHTML : "";

    for (const script of scripts) {
      if (script.src) {
        continue;
      }

      const text = script.textContent || "";
      if (!text.trim()) {
        continue;
      }

      const sample = text.trim().slice(0, 80);
      const htmlIndex = sample ? html.indexOf(sample) : -1;
      const lineOffset = htmlIndex >= 0 ? countNewlines(html.slice(0, htmlIndex)) : 0;
      inlineFiles.push({
        inline: true,
        lineOffset,
        text,
        url: window.location.href
      });
    }

    const externalFetches = scripts
      .filter((script) => script.src)
      .slice(0, 80)
      .map((script) => fetch(script.src, { cache: "force-cache" })
        .then((response) => {
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          return response.text();
        })
        .then((text) => ({
          inline: false,
          lineOffset: 0,
          text,
          url: script.src
        }))
      );

    Promise.allSettled(externalFetches).then((results) => {
      state.sourceFiles = inlineFiles.concat(
        results
          .filter((result) => result.status === "fulfilled")
          .map((result) => result.value)
      );
      state.sourceIndexStatus = "ready";
      refreshEntrySources();
    }).catch(() => {
      state.sourceFiles = inlineFiles;
      state.sourceIndexStatus = inlineFiles.length ? "partial" : "blocked";
      refreshEntrySources();
    });
  }

  function refreshEntrySources() {
    for (const entry of state.functions.values()) {
      const found = locateDefinition(entry.name);
      if (found) {
        entry.source = found;
      }
    }
  }

  function addCall(entry, callSite, blocked, options = {}) {
    entry.callCount += 1;
    entry.lastCalledAt = nowIso();

    const source = locateDefinition(entry.name) || entry.source || callSite;
    if (source && source.kind === "definition") {
      entry.source = source;
    }

    state.totalCalls += 1;
    state.seq += 1;
    const parent = options.forceRoot
      ? null
      : options.parent || state.callStack[state.callStack.length - 1] || state.activeDomEventFrames[state.activeDomEventFrames.length - 1] || null;
    const callId = state.seq;
    const call = {
      args: [],
      blocked,
      callSite,
      depth: parent ? parent.depth + 1 : 0,
      functionId: entry.id,
      id: callId,
      name: entry.name,
      parentCallId: parent ? parent.id : null,
      path: entry.path,
      source,
      treeId: parent ? parent.treeId : callId,
      time: entry.lastCalledAt
    };

    state.buffer.push(call);

    if (state.buffer.length > MAX_BUFFER) {
      state.buffer.splice(0, state.buffer.length - MAX_BUFFER);
    }

    return call;
  }

  function trimNetworkRecords() {
    if (state.networkRecords.size <= MAX_NETWORK_RECORDS) {
      return;
    }

    const removable = Array.from(state.networkRecords.values())
      .filter((record) => !record.paused)
      .sort((first, second) => Number(first.seq || 0) - Number(second.seq || 0))
      .slice(0, state.networkRecords.size - MAX_NETWORK_RECORDS);
    for (const record of removable) {
      state.networkRecords.delete(record.id);
    }
  }

  function cloneJson(value) {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (error) {
      return value;
    }
  }

  function headersToObject(headers) {
    const out = {};
    if (!headers) {
      return out;
    }

    try {
      const normalized = typeof Headers === "function" && headers instanceof Headers
        ? headers
        : new Headers(headers);
      normalized.forEach((value, key) => {
        out[key] = value;
      });
      return out;
    } catch (error) {
      if (Array.isArray(headers)) {
        for (const item of headers) {
          if (Array.isArray(item) && item.length >= 2) {
            out[String(item[0])] = String(item[1]);
          }
        }
      } else if (headers && typeof headers === "object") {
        for (const key of safeObjectKeys(headers)) {
          try {
            out[key] = String(headers[key]);
          } catch (error) {
            // Skip guarded header values.
          }
        }
      }
      return out;
    }
  }

  function bodyPreview(body) {
    if (body === undefined || body === null) {
      return null;
    }

    if (typeof body === "string") {
      return body;
    }

    if (body instanceof URLSearchParams) {
      return body.toString();
    }

    if (typeof FormData === "function" && body instanceof FormData) {
      const values = {};
      try {
        body.forEach((value, key) => {
          values[key] = typeof value === "string" ? value : `[${value && value.constructor && value.constructor.name || "File"}]`;
        });
        return JSON.stringify(values);
      } catch (error) {
        return "[FormData]";
      }
    }

    if (typeof Blob === "function" && body instanceof Blob) {
      return `[Blob ${body.type || "application/octet-stream"} ${body.size} bytes]`;
    }

    if (body && typeof body === "object" && typeof body.byteLength === "number") {
      return `[Binary ${body.byteLength} bytes]`;
    }

    return serializeSafely(body);
  }

  function requestFromFetchArgs(input, init = {}) {
    let url = "";
    let method = "GET";
    let headers = {};
    let body = null;

    try {
      if (typeof Request === "function" && input instanceof Request) {
        url = input.url;
        method = input.method || method;
        headers = headersToObject(input.headers);
      } else {
        url = String(input);
      }
    } catch (error) {
      url = String(input || "");
    }

    if (init && typeof init === "object") {
      if (init.method) {
        method = String(init.method).toUpperCase();
      }
      if (init.headers) {
        headers = Object.assign({}, headers, headersToObject(init.headers));
      }
      if (Object.prototype.hasOwnProperty.call(init, "body")) {
        body = bodyPreview(init.body);
      }
    }

    return {
      body,
      headers,
      method: String(method || "GET").toUpperCase(),
      url
    };
  }

  function initFromNetworkRequest(request, originalInit = {}) {
    const init = Object.assign({}, originalInit || {});
    init.method = request.method || "GET";
    init.headers = request.headers || {};
    if (request.body !== null && typeof request.body !== "undefined" && !/^(?:GET|HEAD)$/i.test(init.method)) {
      init.body = String(request.body);
    } else {
      delete init.body;
    }
    return init;
  }

  function currentNetworkParent() {
    return state.callStack[state.callStack.length - 1] || state.activeDomEventFrames[state.activeDomEventFrames.length - 1] || null;
  }

  function networkFunctionEntry(phase) {
    const id = `network:${phase}`;
    let entry = state.functions.get(id);
    if (!entry) {
      entry = {
        blockedCount: 0,
        callCount: 0,
        disabled: false,
        id,
        kind: `network-${phase}`,
        lastCalledAt: "",
        name: phase === "request" ? "network request" : "network response",
        original: null,
        path: `network.${phase}`,
        source: null,
        suppressed: false
      };
      state.functions.set(id, entry);
    }
    return entry;
  }

  function networkCallName(record, phase) {
    const request = record.request || {};
    if (phase === "response") {
      const status = record.response && record.response.status ? record.response.status : "response";
      return `${request.method || "GET"} ${status} response`;
    }
    return `${request.method || "GET"} request`;
  }

  function networkCallPath(record, phase) {
    const request = record.request || {};
    return `${record.protocol || "network"} ${request.method || "GET"} ${request.url || ""} ${phase}`.trim();
  }

  function addNetworkCall(record, phase, parent, extra = {}) {
    const entry = networkFunctionEntry(phase);
    const call = addCall(entry, null, false, {
      forceRoot: !parent,
      parent
    });
    call.args = [phase === "request" ? serializeSafely(record.request) : serializeSafely(record.response)];
    call.forceReplayable = false;
    call.name = networkCallName(record, phase);
    call.network = {
      id: record.id,
      method: record.request && record.request.method || "",
      paused: Boolean(record.paused && record.pausedPhase === phase),
      phase,
      protocol: record.protocol || "network",
      status: record.response && record.response.status || 0,
      url: record.request && record.request.url || ""
    };
    call.path = networkCallPath(record, phase);
    call.returnValue = phase === "request"
      ? (record.paused && record.pausedPhase === "request" ? "paused request" : "request")
      : (record.paused && record.pausedPhase === "response" ? "paused response" : serializeSafely(record.response && record.response.body));
    if (extra.note) {
      call.note = extra.note;
    }
    if (phase === "request") {
      record.requestCallId = call.id;
    } else {
      record.responseCallId = call.id;
    }
    postFrameCall(call, entry);
    return call;
  }

  function createNetworkRecord(protocol, request, originalInit = {}) {
    state.networkSeq += 1;
    const id = `network:${state.frameId}:${state.networkSeq}`;
    const parent = currentNetworkParent();
    const record = {
      id,
      originalInit,
      parent,
      protocol,
      request: Object.assign({}, request, {
        headers: Object.assign({}, request.headers || {})
      }),
      response: null,
      seq: state.networkSeq,
      time: nowIso()
    };
    state.networkRecords.set(id, record);
    trimNetworkRecords();
    return record;
  }

  function networkRecordSnapshot(record) {
    return {
      id: record.id,
      paused: Boolean(record.paused),
      pausedPhase: record.pausedPhase || "",
      protocol: record.protocol,
      request: cloneJson(record.request),
      requestCallId: record.requestCallId || null,
      response: cloneJson(record.response || null),
      responseCallId: record.responseCallId || null,
      time: record.time
    };
  }

  function responseEditorPayload(response, body) {
    return {
      body,
      headers: headersToObject(response && response.headers),
      status: response && response.status || 200,
      statusText: response && response.statusText || "OK"
    };
  }

  function makeSyntheticResponse(payload) {
    const responsePayload = payload || {};
    return new Response(
      Object.prototype.hasOwnProperty.call(responsePayload, "body") ? String(responsePayload.body || "") : "",
      {
        headers: responsePayload.headers || {},
        status: Number(responsePayload.status || 200),
        statusText: String(responsePayload.statusText || "")
      }
    );
  }

  function continuePausedNetwork(record, phase, payload) {
    if (!record || !record.paused || record.pausedPhase !== phase) {
      return false;
    }

    record.paused = false;
    record.pausedPhase = "";
    if (phase === "request" && typeof record.continueRequest === "function") {
      record.request = Object.assign({}, record.request, payload && payload.request || payload || {});
      record.continueRequest(record.request);
      return true;
    }
    if (phase === "response" && typeof record.continueResponse === "function") {
      record.response = Object.assign({}, record.response || {}, payload && payload.response || payload || {});
      record.continueResponse(record.response);
      return true;
    }
    return false;
  }

  function networkContinue(id, phase, payload) {
    const record = state.networkRecords.get(String(id || ""));
    continuePausedNetwork(record, String(phase || ""), payload || {});
    return snapshot(false);
  }

  function networkReplay(id, payload = {}) {
    const record = state.networkRecords.get(String(id || ""));
    if (!record || !state.nativeFetch) {
      return snapshot(false);
    }

    const request = Object.assign({}, record.request, payload.request || payload || {});
    const parent = currentNetworkParent();
    const replayRecord = createNetworkRecord("fetch-replay", request, {});
    addNetworkCall(replayRecord, "request", parent);
    state.nativeFetch.call(window, request.url, initFromNetworkRequest(request, {}))
      .then((response) => {
        const responseClone = response.clone();
        return responseClone.text()
          .catch(() => "")
          .then((body) => {
            replayRecord.response = responseEditorPayload(response, body);
            const requestParent = {
              depth: parent ? parent.depth + 1 : 0,
              id: replayRecord.requestCallId,
              treeId: parent ? parent.treeId : replayRecord.requestCallId
            };
            addNetworkCall(replayRecord, "response", requestParent);
          });
      })
      .catch((error) => {
        replayRecord.response = {
          body: serializeSafely(error),
          headers: {},
          status: 0,
          statusText: "Replay failed"
        };
        const requestParent = {
          depth: parent ? parent.depth + 1 : 0,
          id: replayRecord.requestCallId,
          treeId: parent ? parent.treeId : replayRecord.requestCallId
        };
        addNetworkCall(replayRecord, "response", requestParent, { note: "Network replay failed." });
      });
    return snapshot(false);
  }

  function performFetchRecord(record) {
    if (!record.requestCallId) {
      addNetworkCall(record, "request", record.parent);
    }
    const request = record.request;
    return state.nativeFetch.call(window, request.url, initFromNetworkRequest(request, record.originalInit))
      .then((response) => {
        if (!state.running) {
          return response;
        }

        const clone = response.clone();
        return clone.text()
          .catch(() => "")
          .then((body) => {
            record.response = responseEditorPayload(response, body);
            const requestParent = {
              depth: record.parent ? record.parent.depth + 1 : 0,
              id: record.requestCallId,
              treeId: record.parent ? record.parent.treeId : record.requestCallId
            };
            if (state.pauseNetworkResponses) {
              record.paused = true;
              record.pausedPhase = "response";
              addNetworkCall(record, "response", requestParent);
              return new Promise((resolve) => {
                record.continueResponse = (payload) => {
                  resolve(makeSyntheticResponse(payload));
                };
              });
            }
            addNetworkCall(record, "response", requestParent);
            return response;
          });
      });
  }

  function invokeOriginalFunction(entry, original, thisValue, args, constructTarget = null) {
    if (entry.wrapper && !entry.proxyWrapper) {
      copyFunctionOwnProperties(entry.wrapper, original);
    }

    try {
      const result = constructTarget
        ? Reflect.construct(original, args, constructTarget === entry.wrapper ? original : constructTarget)
        : Reflect.apply(original, thisValue, args);
      if (entry.wrapper && !entry.proxyWrapper) {
        copyFunctionOwnProperties(original, entry.wrapper);
      }
      return result;
    } catch (error) {
      if (entry.wrapper && !entry.proxyWrapper) {
        copyFunctionOwnProperties(original, entry.wrapper);
      }
      throw error;
    }
  }

  function canAutoSuppressEntry(entry) {
    return Boolean(entry) && (
      entry.kind === "function" ||
      entry.kind === "event-listener" ||
      entry.kind === "framework-event-handler" ||
      entry.kind === "library-event-dispatch" ||
      entry.kind === "library-event-listener"
    );
  }

  function autoSuppressReason(entry) {
    if (state.continueTrackingAfterLimit ||
      !canAutoSuppressEntry(entry) ||
      entry.callCount < MAX_CALLS_PER_FUNCTION) {
      return "";
    }

    return `Tracking disabled: ${entry.name || entry.path} has already been logged ${MAX_CALLS_PER_FUNCTION}+ times and would flood the log.`;
  }

  function addAutoSuppressNotice(entry, kind = "suppressed-function") {
    const autoSuppression = autoSuppressReason(entry);
    if (!autoSuppression) {
      return false;
    }

    addSuppressedNotice(
      `suppressed:auto:${entry.id}`,
      entry.name,
      entry.path,
      autoSuppression,
      kind
    );
    return true;
  }

  function sourceCallHintAllowed(name) {
    const normalized = String(name || "").trim();
    if (!normalized || SOURCE_HINT_SKIP_CALL_NAMES.has(normalized)) {
      return false;
    }

    return state.captureMinifiedFunctions || !state.safeMode || !isSingleLetterFunctionName(normalized);
  }

  function extractSourceCallHints(fn) {
    const source = safeFunctionSource(fn);
    if (!source || source.includes("[native code]")) {
      return [];
    }

    const hints = [];
    const seen = new Set();
    const remember = (name, snippet) => {
      if (!sourceCallHintAllowed(name)) {
        return;
      }

      const cleanSnippet = truncate(String(snippet || name).replace(/\s+/g, " ").trim(), 120);
      const key = `${name}\u0000${cleanSnippet}`;
      if (seen.has(key)) {
        return;
      }

      seen.add(key);
      hints.push({
        name,
        snippet: cleanSnippet
      });
    };

    const memberPattern = /\b(?:this|[A-Za-z_$][\w$]*)\s*(?:\?\.|\.)\s*([A-Za-z_$][\w$]*)\s*\(([^)]{0,120})\)/g;
    let match = memberPattern.exec(source);
    while (match && hints.length < 8) {
      remember(match[1], match[0]);
      match = memberPattern.exec(source);
    }

    if (hints.length < 8) {
      const barePattern = /(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(([^)]{0,120})\)/g;
      match = barePattern.exec(source);
      while (match && hints.length < 8) {
        remember(match[2], match[0].trim());
        match = barePattern.exec(source);
      }
    }

    return hints.slice(0, 8);
  }

  function splitTopLevelArguments(text) {
    const source = String(text || "");
    const args = [];
    let depth = 0;
    let quote = "";
    let start = 0;

    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      const previous = source[index - 1];

      if (quote) {
        if (char === quote && previous !== "\\") {
          quote = "";
        }
        continue;
      }

      if (char === "\"" || char === "'" || char === "`") {
        quote = char;
        continue;
      }

      if (char === "(" || char === "[" || char === "{") {
        depth += 1;
        continue;
      }

      if (char === ")" || char === "]" || char === "}") {
        depth = Math.max(0, depth - 1);
        continue;
      }

      if (char === "," && depth === 0) {
        const arg = source.slice(start, index).trim();
        if (arg) {
          args.push(arg);
        }
        start = index + 1;
      }
    }

    const last = source.slice(start).trim();
    if (last) {
      args.push(last);
    }

    return args;
  }

  function callArgumentExpressions(snippet) {
    const source = String(snippet || "");
    const open = source.indexOf("(");
    if (open < 0) {
      return [];
    }

    let depth = 0;
    let quote = "";
    for (let index = open; index < source.length; index += 1) {
      const char = source[index];
      const previous = source[index - 1];

      if (quote) {
        if (char === quote && previous !== "\\") {
          quote = "";
        }
        continue;
      }

      if (char === "\"" || char === "'" || char === "`") {
        quote = char;
        continue;
      }

      if (char === "(") {
        depth += 1;
      } else if (char === ")") {
        depth -= 1;
        if (depth === 0) {
          return splitTopLevelArguments(source.slice(open + 1, index));
        }
      }
    }

    return [];
  }

  function simpleArgumentBindingName(expression) {
    const text = String(expression || "").trim().replace(/^\.\.\./, "").trim();
    return /^[A-Za-z_$][\w$]*$/.test(text) ? text : "";
  }

  function functionParameterNames(fn) {
    const source = safeFunctionSource(fn).trim();
    if (!source || source.includes("[native code]")) {
      return [];
    }

    let params = "";
    const functionMatch = /^(?:async\s+)?function(?:\s+[A-Za-z_$][\w$]*)?\s*\(([^)]*)\)/.exec(source);
    if (functionMatch) {
      params = functionMatch[1];
    } else {
      const arrowMatch = /^(?:async\s*)?(?:\(([^)]*)\)|([A-Za-z_$][\w$]*))\s*=>/.exec(source);
      if (arrowMatch) {
        params = arrowMatch[1] || arrowMatch[2] || "";
      }
    }

    if (!params) {
      return [];
    }

    return splitTopLevelArguments(params)
      .map((param) => param.replace(/=.*$/g, "").replace(/^\.\.\./, "").trim())
      .filter((param) => /^[A-Za-z_$][\w$]*$/.test(param));
  }

  function sourceHintTargetText(entry) {
    const candidates = [
      entry && entry.targetDescription,
      entry && entry.path,
      entry && entry.name
    ];

    for (const candidate of candidates) {
      const match = />\s*"([^"]{1,120})"/.exec(String(candidate || ""));
      if (match) {
        return match[1];
      }
    }

    return "";
  }

  function sourceHintContext(entry, original, runtimeArgs) {
    const bindings = {};
    const params = functionParameterNames(original);
    const values = toArray(runtimeArgs || []);
    for (let index = 0; index < params.length && index < values.length; index += 1) {
      bindings[params[index]] = {
        source: "argument",
        value: serializeSafely(values[index])
      };
    }

    const targetText = sourceHintTargetText(entry);
    return {
      bindings,
      preferTargetTextForShortNames: Boolean(targetText && entry && entry.kind === "framework-event-handler"),
      targetText: targetText ? serializeSafely(targetText) : ""
    };
  }

  function sourceHintDisplayArguments(hint, context) {
    const display = [hint.snippet];
    const expressions = callArgumentExpressions(hint.snippet);
    const seen = new Set();
    const bindings = context && context.bindings || {};
    const targetText = context && context.targetText || "";
    const preferTargetTextForShortNames = Boolean(context && context.preferTargetTextForShortNames);

    for (const expression of expressions) {
      const name = simpleArgumentBindingName(expression);
      if (!name || seen.has(name)) {
        continue;
      }

      seen.add(name);
      const binding = bindings[name];
      const isShortName = /^[A-Za-z_$][\w$]?$/.test(name);
      if (targetText && (preferTargetTextForShortNames && isShortName || !binding)) {
        display.push(`${name} ~= ${targetText}`);
      } else if (binding) {
        display.push(`${name} = ${binding.value}`);
      }
    }

    return display;
  }

  function sourceHintReceiver(snippet) {
    const match = /\b([A-Za-z_$][\w$]*)\s*(?:\?\.|\.)\s*([A-Za-z_$][\w$]*)\s*\(/.exec(String(snippet || ""));
    return match ? {
      methodName: match[2],
      receiver: match[1]
    } : null;
  }

  function sourceRegionsAround(text, index) {
    const source = String(text || "");
    if (index < 0 || !source) {
      return [];
    }

    const regions = [];
    const functionStart = source.lastIndexOf("function ", index);
    if (functionStart >= 0 && index - functionStart < 12000) {
      const nextFunction = source.indexOf("function ", index + 1);
      const end = nextFunction > index
        ? Math.min(source.length, nextFunction)
        : Math.min(source.length, index + 2600);
      regions.push(source.slice(functionStart, end));
    }

    const start = Math.max(0, index - 2200);
    const end = Math.min(source.length, index + 2600);
    regions.push(source.slice(start, end));

    return regions.filter((region, regionIndex) => region && regions.indexOf(region) === regionIndex);
  }

  function relatedSourceFiles() {
    const files = state.sourceFiles.slice();
    const inlineScripts = toArray(document.scripts)
      .filter((script) => !script.src && script.textContent && script.textContent.trim())
      .map((script) => ({
        lineOffset: 0,
        text: script.textContent || "",
        url: window.location.href
      }));

    for (const inlineFile of inlineScripts) {
      if (!files.some((file) => file.text === inlineFile.text && file.url === inlineFile.url)) {
        files.push(inlineFile);
      }
    }

    return files;
  }

  function extractRelatedSourceCallHints(primaryHint) {
    const receiverInfo = sourceHintReceiver(primaryHint && primaryHint.snippet);
    if (!receiverInfo) {
      return [];
    }

    const related = [];
    const seen = new Set([receiverInfo.methodName]);
    const snippet = String(primaryHint.snippet || "");
    const receiver = escapeRegExp(receiverInfo.receiver);
    const relatedPattern = new RegExp(`\\b${receiver}\\s*(?:\\?\\.|\\.)\\s*([A-Za-z_$][\\w$]*)\\s*\\(([^)]{0,120})\\)`, "g");
    const handlerReferencePattern = new RegExp(`\\bon[A-Z][A-Za-z_$]*\\s*:\\s*${receiver}\\s*(?:\\?\\.|\\.)\\s*([A-Za-z_$][\\w$]*)\\b`, "g");
    const rememberRelated = (name, rawSnippet, sourceFile, searchStart) => {
      const cleanSnippet = truncate(String(rawSnippet || name).replace(/\s+/g, " ").trim(), 120);
      if (!sourceCallHintAllowed(name) || seen.has(name)) {
        return;
      }

      seen.add(name);
      related.push({
        name,
        snippet: cleanSnippet,
        source: (() => {
          const absoluteIndex = sourceFile.text.indexOf(rawSnippet, Math.max(0, searchStart));
          if (absoluteIndex < 0) {
            return null;
          }

          const position = lineAndColumnFromIndex(sourceFile.text, absoluteIndex, sourceFile.lineOffset || 0);
          return {
            column: position.column,
            kind: "source-related",
            line: position.line,
            url: sourceFile.url
          };
        })()
      });
    };

    for (const sourceFile of relatedSourceFiles()) {
      const sourceText = String(sourceFile.text || "");
      let index = snippet ? sourceText.indexOf(snippet) : -1;
      if (index < 0) {
        const methodPattern = new RegExp(`\\b${receiver}\\s*(?:\\?\\.|\\.)\\s*${escapeRegExp(receiverInfo.methodName)}\\s*\\(`);
        const match = methodPattern.exec(sourceText);
        index = match ? match.index : -1;
      }

      if (index < 0) {
        continue;
      }

      for (const region of sourceRegionsAround(sourceText, index)) {
        const countBeforeRegion = related.length;
        relatedPattern.lastIndex = 0;
        let match = relatedPattern.exec(region);
        while (match && related.length < 10) {
          rememberRelated(match[1], match[0], sourceFile, index - 5000);
          match = relatedPattern.exec(region);
        }

        handlerReferencePattern.lastIndex = 0;
        match = handlerReferencePattern.exec(region);
        while (match && related.length < 10) {
          rememberRelated(match[1], `${receiverInfo.receiver}.${match[1]}`, sourceFile, index - 5000);
          match = handlerReferencePattern.exec(region);
        }

        if (related.length > countBeforeRegion) {
          break;
        }
      }

      if (related.length) {
        break;
      }
    }

    return related;
  }

  function addSourceHintCall(entry, parentCall, hint, options = {}) {
    const id = `source-hint:${entry.id}:${hint.name}:${hint.snippet}`;
    let hintEntry = state.functions.get(id);
    if (!hintEntry) {
      hintEntry = {
        blockedCount: 0,
        callCount: 0,
        disabled: false,
        id,
        kind: "source-call-hint",
        lastCalledAt: "",
        name: `${hint.name}() inferred`,
        originalName: hint.name,
        path: options.path || `${entry.path} -> ${hint.snippet}`,
        source: hint.source || entry.source,
        suppressed: false
      };
      state.functions.set(id, hintEntry);
    }

    const call = addCall(hintEntry, hint.source || entry.source || null, false, {
      parent: parentCall
    });
    const replaySource = parentCall.enclosingReplay || parentCall;
    const sourceHintContextValue = options.context || parentCall.sourceHintContext || null;
    call.args = sourceHintDisplayArguments(hint, sourceHintContextValue);
    if (sourceHintContextValue) {
      call.sourceHintContext = sourceHintContextValue;
    }
    call.enclosingReplay = {
      constructed: Boolean(replaySource.constructed),
      forceReplayArgs: Array.isArray(replaySource.forceReplayArgs) ? replaySource.forceReplayArgs : null,
      forceReplayError: replaySource.forceReplayError || "",
      forceReplayThis: replaySource.forceReplayThis || null,
      forceReplayable: Boolean(replaySource.forceReplayable),
      functionId: replaySource.functionId,
      name: replaySource.name,
      replayArgs: Array.isArray(replaySource.replayArgs) ? replaySource.replayArgs : null,
      replayError: replaySource.replayError || "",
      replayable: Boolean(replaySource.replayable)
    };
    call.note = options.note || "Inferred from handler source. This call is closure-local, so JS Disector could not wrap or replay it directly.";
    call.replayable = false;
    call.replayError = "Source-call hints are not directly replayable.";
    call.returnValue = options.returnValue || "source hint";
    call.sourceHint = true;
    postFrameCall(call, hintEntry);
    return call;
  }

  function addRelatedSourceHintsForCall(entry, parentHint, parentCall) {
    if (!entry || !parentHint || !parentCall || parentCall.relatedSourceHintsComplete) {
      return false;
    }

    const relatedHints = extractRelatedSourceCallHints(parentHint);
    if (!relatedHints.length) {
      return false;
    }

    parentCall.relatedSourceHintsComplete = true;
    for (const relatedHint of relatedHints) {
      addSourceHintCall(entry, parentCall, relatedHint, {
        note: "Related call inferred from the same framework render/source region. It may run during the framework update after the handler changes state, not directly inside the parent call.",
        path: `${entry.path} -> ${parentHint.snippet} -> ${relatedHint.snippet}`,
        returnValue: "related source hint"
      });
    }

    return true;
  }

  function scheduleRelatedSourceHints(entry, parentHint, parentCall, attempt = 0) {
    if (!entry || !parentHint || !parentCall || parentCall.relatedSourceHintsComplete || attempt > 8) {
      return;
    }

    const shouldRetry = state.sourceIndexStatus === "indexing" || !state.sourceFiles.length;
    if (!shouldRetry && attempt > 0) {
      return;
    }

    window.setTimeout(() => {
      if (addRelatedSourceHintsForCall(entry, parentHint, parentCall)) {
        return;
      }

      if (state.sourceIndexStatus === "indexing" || !state.sourceFiles.length) {
        scheduleRelatedSourceHints(entry, parentHint, parentCall, attempt + 1);
      }
    }, attempt === 0 ? 250 : 600);
  }

  function addSourceCallHints(entry, original, parentCall, runtimeArgs) {
    const canHint = entry &&
      (entry.kind === "framework-event-handler" || (!state.safeMode && entry.kind === "event-listener"));
    if (!canHint || !parentCall) {
      return;
    }

    const hints = extractSourceCallHints(original);
    if (!hints.length) {
      return;
    }

    const context = sourceHintContext(entry, original, runtimeArgs);
    for (const hint of hints) {
      const call = addSourceHintCall(entry, parentCall, hint, { context });
      if (!addRelatedSourceHintsForCall(entry, hint, call)) {
        scheduleRelatedSourceHints(entry, hint, call);
      }
    }
  }

  function callEntry(entry, original, thisValue, args, path, constructTarget = null) {
    const blocked = state.disabled.has(entry.id);
    if (blocked) {
      entry.blockedCount = (entry.blockedCount || 0) + 1;
      return undefined;
    }

    if (addAutoSuppressNotice(entry, "suppressed-function")) {
      return invokeOriginalFunction(entry, original, thisValue, args, constructTarget);
    }

    const callSite = parseStackLocation(new Error().stack, path || entry.path);
    const call = addCall(entry, callSite, false);
    const frame = {
      depth: call.depth,
      id: call.id,
      treeId: call.treeId
    };
    const seqBeforeChildren = state.seq;

    state.callStack.push(frame);

    let result;
    try {
      result = invokeOriginalFunction(entry, original, thisValue, args, constructTarget);
      call.returnValue = serializeSafely(result);
      return result;
    } catch (error) {
      call.threw = true;
      call.error = serializeSafely(error);
      throw error;
    } finally {
      const replay = replayArguments(args);
      const forceReplay = entry.kind === "event-listener" && typeof Event === "function" && args && args[0] instanceof Event
        ? {
          forceReplayable: true,
          values: [domEventForceReplayDescriptor(args[0], entry.targetDescription || describeTarget(args[0].target))]
        }
        : forceReplayArguments(args, replay);
      const forceThis = forceReplayThisDescriptor(thisValue, constructTarget);
      call.args = serializeArguments(args);
      call.constructed = Boolean(constructTarget);
      call.forceReplayable = forceReplay.forceReplayable;
      if (forceReplay.forceReplayable) {
        call.forceReplayArgs = forceReplay.values;
      } else {
        call.forceReplayError = forceReplay.reason || "force replay arguments could not be stored";
      }
      call.replayable = replay.replayable;
      if (replay.replayable) {
        call.replayArgs = replay.values;
      } else {
        call.replayError = replay.reason || "arguments cannot be replayed from the log";
      }
      if (forceThis) {
        call.forceReplayThis = forceThis;
        entry.lastReplayThisValue = thisValue;
      }
      observeCallVariables(entry, thisValue, args, result);
      postFrameCall(call, entry);
      if (state.seq === seqBeforeChildren || !state.safeMode) {
        addSourceCallHints(entry, original, call, args);
      }
      const popped = state.callStack.pop();
      if (popped !== frame) {
        const index = state.callStack.lastIndexOf(frame);
        if (index >= 0) {
          state.callStack.splice(index, 1);
        }
      }
    }
  }

  function restoreEntry(entry) {
    if (typeof entry.restore === "function") {
      entry.restore();
      return;
    }

    const descriptor = safeGetOwnPropertyDescriptor(entry.owner, entry.key);
    if (!descriptor || descriptor.value !== entry.wrapper) {
      return;
    }

    try {
      Object.defineProperty(entry.owner, entry.key, {
        configurable: entry.configurable,
        enumerable: entry.enumerable,
        value: entry.original,
        writable: entry.writable
      });
    } catch (error) {
      try {
        entry.owner[entry.key] = entry.original;
      } catch (assignmentError) {
        // Some properties cannot be restored after page code locks them down.
      }
    }
  }

  function wrapFunction(owner, key, path, options = {}) {
    if (shouldSkipName(String(key))) {
      return false;
    }

    const descriptor = safeGetOwnPropertyDescriptor(owner, key);
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, "value")) {
      return false;
    }

    const original = descriptor.value;
    const allowBoundNative = Boolean(options.allowBoundNative && isBoundFunction(original));
    if (typeof original !== "function" || isJavascreenWrapper(original) || (isNativeFunction(original) && !allowBoundNative) || isClass(original)) {
      return false;
    }

    if (descriptor.writable === false && descriptor.configurable === false) {
      return false;
    }

    let name = cleanName(key, original, options);
    if ((!name || name === "anonymous") && !state.safeMode) {
      name = String(key || path || "anonymous");
    }
    if (!name || (name === "anonymous" && state.safeMode)) {
      return false;
    }

    const id = stableId(path);
    const existing = state.functions.get(id);
    if (existing && existing.original === original) {
      if (!existing.proxyWrapper) {
        copyFunctionOwnProperties(original, existing.wrapper);
      }
      try {
        Object.defineProperty(owner, key, {
          configurable: descriptor.configurable,
          enumerable: descriptor.enumerable,
          value: existing.wrapper,
          writable: descriptor.writable !== false
        });
        return true;
      } catch (error) {
        try {
          owner[key] = existing.wrapper;
          return true;
        } catch (assignmentError) {
          return false;
        }
      }
    }

    if (existing) {
      restoreEntry(existing);
    }

    const entry = {
      blockedCount: 0,
      callCount: 0,
      configurable: descriptor.configurable,
      disabled: state.disabled.has(id),
      enumerable: descriptor.enumerable,
      id,
      key,
      kind: "function",
      lastCalledAt: "",
      name,
      original,
      owner,
      path,
      proxyWrapper: false,
      source: locateDefinition(name) || sourceFromScripts(name),
      wrapper: null,
      writable: descriptor.writable !== false
    };

    let wrapper;
    if (typeof Proxy === "function" && typeof Reflect === "object" && typeof Reflect.apply === "function" && typeof Reflect.construct === "function") {
      wrapper = new Proxy(original, {
        apply(target, thisValue, args) {
          return callEntry(entry, target, thisValue, toArray(args), path, null);
        },
        construct(target, args, newTarget) {
          return callEntry(entry, target, null, toArray(args), path, newTarget === wrapper ? target : newTarget);
        }
      });
      entry.proxyWrapper = true;
    } else {
      wrapper = function javascreenWrappedFunction(...args) {
        return callEntry(entry, original, this, args, path, new.target || null);
      };
    }

    entry.wrapper = wrapper;
    if (entry.proxyWrapper) {
      markWrapper(wrapper, entry, false);
    } else {
      safeSetFunctionName(wrapper, name);
      try {
        if (Object.prototype.hasOwnProperty.call(original, "prototype")) {
          wrapper.prototype = original.prototype;
        }
      } catch (error) {
        // Prototype forwarding is best effort; ordinary calls do not need it.
      }
      copyFunctionOwnProperties(original, wrapper);
      markWrapper(wrapper, entry);
    }

    try {
      Object.defineProperty(owner, key, {
        configurable: descriptor.configurable,
        enumerable: descriptor.enumerable,
        value: wrapper,
        writable: descriptor.writable !== false
      });
    } catch (error) {
      try {
        owner[key] = wrapper;
      } catch (assignmentError) {
        return false;
      }
    }

    state.functions.set(id, entry);
    return true;
  }

  function captureFromOptions(options) {
    if (options === true) {
      return true;
    }

    if (options && typeof options === "object") {
      return Boolean(options.capture);
    }

    return false;
  }

  function onceFromOptions(options) {
    return Boolean(options && typeof options === "object" && options.once);
  }

  function listenerCallback(listener) {
    if (typeof listener === "function") {
      return listener;
    }

    if (listener && typeof listener.handleEvent === "function") {
      return listener.handleEvent;
    }

    return null;
  }

  function matchingListenerRecord(target, type, listener, capture) {
    return state.listenerRecords.find((record) => record.active &&
      record.target === target &&
      record.type === type &&
      record.listener === listener &&
      record.capture === capture);
  }

  function shouldObserveDomListenerOnly(target, type) {
    return isCapturedDomEventType(type) && (state.safeMode || !state.wrapDomEventListeners);
  }

  function isCapturedDomEventType(type) {
    return CAPTURED_DOM_EVENT_TYPES.has(String(type || "").toLowerCase());
  }

  function isNoisyDomEventType(type) {
    return NOISY_DOM_EVENT_TYPES.has(String(type || "").toLowerCase());
  }

  function assignListenerWrapper(record) {
    const callback = listenerCallback(record && record.listener);
    const entry = record && record.entry;
    if (!record || !entry || !callback) {
      return null;
    }

    if (record.wrapper) {
      entry.wrapper = record.wrapper;
      return record.wrapper;
    }

    if (typeof record.listener === "function") {
      record.wrapper = function javascreenEventListener(...args) {
        if (record.once) {
          record.active = false;
        }

        return callEntry(entry, record.listener, this, args, entry.path);
      };
      safeSetFunctionName(record.wrapper, entry.name);
    } else {
      record.wrapper = {
        handleEvent(...args) {
          if (record.once) {
            record.active = false;
          }

          return callEntry(entry, callback, record.listener, args, entry.path);
        }
      };
    }

    entry.wrapper = record.wrapper;
    markWrapper(record.wrapper, entry);
    return record.wrapper;
  }

  function createListenerRecord(target, type, listener, options, observedOnly = false) {
    const callback = listenerCallback(listener);
    if (!callback || isJavascreenWrapper(listener) || isJavascreenWrapper(callback)) {
      return null;
    }

    state.listenerSeq += 1;

    const targetDescription = describeTarget(target);
    const eventType = String(type);
    const originalName = callback.name ? String(callback.name).trim() : "";
    const listenerName = eventListenerName(callback, eventType, targetDescription);
    const source = parseStackLocation(new Error().stack, "addEventListener");
    const id = `event:${state.listenerSeq}:${eventType}:${listenerName}`;
    const entry = {
      blockedCount: 0,
      callCount: 0,
      disabled: state.disabled.has(id),
      eventType,
      id,
      kind: "event-listener",
      lastCalledAt: "",
      listenerObject: typeof listener === "function" ? null : listener,
      name: listenerName,
      original: callback,
      originalName,
      path: `${targetDescription}.addEventListener("${eventType}")`,
      source: locateDefinition(listenerName) || source,
      target,
      targetDescription,
      wrapper: null
    };

    const record = {
      active: true,
      capture: captureFromOptions(options),
      entry,
      listener,
      observedOnly,
      once: onceFromOptions(options),
      options,
      target,
      type,
      wrapper: null
    };

    if (!observedOnly) {
      assignListenerWrapper(record);
    }
    state.listenerRecords.push(record);
    state.functions.set(id, entry);
    return record;
  }

  function eventPath(event) {
    try {
      if (event && typeof event.composedPath === "function") {
        return event.composedPath();
      }
    } catch (error) {
      // Fall back to a parent walk below.
    }

    const path = [];
    let node = event && event.target;
    while (node) {
      path.push(node);
      node = node.parentNode || node.host || null;
    }

    path.push(document, window);
    return path;
  }

  function observedListenerRecordsForEvent(event) {
    const type = String(event && event.type || "");
    const path = eventPath(event);
    const seen = new Set();
    const records = [];

    for (const record of state.listenerRecords) {
      if (!record.active || !record.observedOnly || record.type !== type || seen.has(record.entry.id)) {
        continue;
      }

      if (path.includes(record.target)) {
        seen.add(record.entry.id);
        records.push(record);
      }
    }

    return records.slice(0, 12);
  }

  function ensureObservedEventEntry(type, targetDescription) {
    const id = `observed-event:${type}:${targetDescription}`;
    const existing = state.functions.get(id);
    if (existing) {
      return existing;
    }

    const entry = {
      blockedCount: 0,
      callCount: 0,
      disabled: false,
      eventType: type,
      id,
      kind: "observed-dom-event",
      lastCalledAt: "",
      name: `${readableElementName(targetDescription)} ${type} event`,
      originalName: "",
      path: `${targetDescription}.${type}`,
      source: null,
      targetDescription
    };

    state.functions.set(id, entry);
    return entry;
  }

  function ensureObservedSequenceEntry(targetDescription) {
    const id = `observed-sequence:${targetDescription}`;
    const existing = state.functions.get(id);
    if (existing) {
      return existing;
    }

    const entry = {
      blockedCount: 0,
      callCount: 0,
      disabled: false,
      id,
      kind: "observed-dom-sequence",
      lastCalledAt: "",
      name: `${readableElementName(targetDescription)} browser click sequence`,
      originalName: "",
      path: `${targetDescription}.browser-click-sequence`,
      source: null,
      targetDescription
    };

    state.functions.set(id, entry);
    return entry;
  }

  function isClickSequenceEvent(type) {
    return CLICK_SEQUENCE_EVENT_TYPES.has(String(type || "").toLowerCase());
  }

  function finishObservedDomEventSequence(sequence) {
    if (!sequence) {
      return;
    }

    if (sequence.timer) {
      window.clearTimeout(sequence.timer);
      sequence.timer = 0;
    }

    if (state.activeDomEventSequence === sequence) {
      state.activeDomEventSequence = null;
    }
  }

  function scheduleObservedDomEventSequenceEnd(sequence, type) {
    if (!sequence) {
      return;
    }

    if (sequence.timer) {
      window.clearTimeout(sequence.timer);
      sequence.timer = 0;
    }

    const lowerType = String(type || "").toLowerCase();
    const delay = lowerType === "click" || lowerType === "dblclick" || lowerType === "contextmenu" || lowerType === "touchend"
      ? 120
      : 900;

    sequence.timer = window.setTimeout(() => {
      if (state.activeDomEventSequence === sequence && Date.now() - sequence.lastSeenAt >= delay - 5) {
        finishObservedDomEventSequence(sequence);
      }
    }, delay);
  }

  function ensureObservedDomEventSequence(observation) {
    if (!observation || !isClickSequenceEvent(observation.type)) {
      return null;
    }

    const now = Date.now();
    const current = state.activeDomEventSequence;
    if (current && current.targetDescription === observation.targetDescription && now - current.lastSeenAt <= 1200) {
      current.lastSeenAt = now;
      scheduleObservedDomEventSequenceEnd(current, observation.type);
      return current.frame;
    }

    finishObservedDomEventSequence(current);

    const entry = ensureObservedSequenceEntry(observation.targetDescription);
    const call = addCall(entry, null, false, { forceRoot: true });
    call.args = [`${observation.type} on ${observation.targetDescription}`];
    call.note = "Observed browser input sequence; low-level DOM events are grouped below in the order the browser delivered them.";
    call.returnValue = "observed";
    postFrameCall(call, entry);

    const sequence = {
      frame: {
        depth: call.depth,
        id: call.id,
        treeId: call.treeId
      },
      lastSeenAt: now,
      targetDescription: observation.targetDescription,
      timer: 0
    };

    state.activeDomEventSequence = sequence;
    scheduleObservedDomEventSequenceEnd(sequence, observation.type);
    return sequence.frame;
  }

  function observedDomEventSnapshot(event) {
    if (!state.running || !event || !isCapturedDomEventType(event.type)) {
      return null;
    }

    let targetDescription = "target";
    try {
      targetDescription = describeTarget(event.target);
    } catch (error) {
      targetDescription = "target";
    }

    return {
      args: [describeEvent(event)],
      event,
      records: observedListenerRecordsForEvent(event),
      targetDescription,
      type: String(event.type || "event")
    };
  }

  function beginObservedDomEventCapture(observation) {
    const sequenceFrame = ensureObservedDomEventSequence(observation);
    const rootEntry = ensureObservedEventEntry(observation.type, observation.targetDescription);
    const rootCall = addCall(rootEntry, null, false, sequenceFrame ? { parent: sequenceFrame } : { forceRoot: true });
    rootCall.args = observation.args;
    rootCall.forceReplayable = true;
    rootCall.forceReplayArgs = [domEventForceReplayDescriptor(observation.event, observation.targetDescription)];
    rootCall.note = "Observed DOM event; functions called while this event is handled are grouped below without wrapping the page listener.";
    rootCall.replayError = "Observed events use Force Resend to dispatch a synthetic browser event.";
    rootCall.replayable = false;
    rootCall.returnValue = "observed";
    postFrameCall(rootCall, rootEntry);

    const frame = {
      depth: rootCall.depth,
      id: rootCall.id,
      treeId: rootCall.treeId
    };

    state.activeDomEventFrames.push(frame);

    return {
      frame,
      observation
    };
  }

  function finishObservedDomEventCapture(context) {
    if (!context || !context.observation) {
      return;
    }

    const { frame, observation } = context;
    const activeIndex = state.activeDomEventFrames.lastIndexOf(frame);
    if (activeIndex >= 0) {
      state.activeDomEventFrames.splice(activeIndex, 1);
    }

    state.callStack.push(frame);

    try {
      for (const record of state.running ? observation.records || [] : []) {
        const forceReplay = forceReplayArguments([observation.event]);
        const call = addCall(record.entry, record.entry.source, false);
        call.args = observation.args;
        call.forceReplayable = forceReplay.forceReplayable;
        if (forceReplay.forceReplayable) {
          call.forceReplayArgs = forceReplay.values;
        } else {
          call.forceReplayError = forceReplay.reason || "force replay arguments could not be stored";
        }
        call.note = "Observed listener; not wrapped to avoid interfering with page input.";
        call.replayError = "Observed listeners use Force Resend to call the original listener with a captured live event.";
        call.replayable = false;
        call.returnValue = "observed";
        postFrameCall(call, record.entry);
      }
    } finally {
      const index = state.callStack.lastIndexOf(frame);
      if (index >= 0) {
        state.callStack.splice(index, 1);
      }
    }
  }

  function installDomEventProbes(nativeAdd) {
    if (state.nativeEventProbeRecords.length) {
      return;
    }

    for (const type of CAPTURED_DOM_EVENT_TYPES) {
      const listener = function javascreenDomEventProbe(event) {
        const observation = observedDomEventSnapshot(event);
        if (!observation) {
          return;
        }

        const context = beginObservedDomEventCapture(observation);
        window.setTimeout(() => {
          finishObservedDomEventCapture(context);
        }, 0);
      };

      try {
        nativeAdd.call(window, type, listener, true);
        state.nativeEventProbeRecords.push({
          listener,
          target: window,
          type
        });
      } catch (error) {
        // Some event types may be blocked in unusual frames.
      }
    }
  }

  function syncDomListenerWrapping() {
    const native = state.nativeEventTarget;
    if (!native) {
      return;
    }

    for (const record of state.listenerRecords) {
      if (!record.active || !isCapturedDomEventType(record.type) || isNoisyDomEventType(record.type)) {
        continue;
      }

      const wantsObservedOnly = shouldObserveDomListenerOnly(record.target, record.type);
      if (record.observedOnly === wantsObservedOnly) {
        continue;
      }

      try {
        if (wantsObservedOnly) {
          if (record.wrapper) {
            native.nativeRemove.call(record.target, record.type, record.wrapper, record.options);
          }
          native.nativeAdd.call(record.target, record.type, record.listener, record.options);
          record.observedOnly = true;
          continue;
        }

        const wrapper = assignListenerWrapper(record);
        if (!wrapper) {
          continue;
        }
        native.nativeRemove.call(record.target, record.type, record.listener, record.options);
        native.nativeAdd.call(record.target, record.type, wrapper, record.options);
        record.observedOnly = false;
      } catch (error) {
        // Some pages reject listener replacement on detached targets; keep capture best-effort.
      }
    }
  }

  function propertyKeyText(key) {
    if (typeof key === "symbol") {
      return key.description || key.toString();
    }

    return String(key || "");
  }

  function normalizedEventNameFromKey(key) {
    const text = propertyKeyText(key).trim();
    if (!text) {
      return "";
    }

    let candidate = text;
    if (/^on[A-Z]/.test(candidate)) {
      candidate = candidate.slice(2);
    } else {
      candidate = candidate.replace(/^on[:_-]?/i, "");
    }

    candidate = candidate
      .replace(/(?:Once|Passive|Capture)$/g, "")
      .replace(/[_:.-]/g, "")
      .toLowerCase();

    return isCapturedDomEventType(candidate) || isNoisyDomEventType(candidate) ? candidate : "";
  }

  function isFrameworkEventStoreKey(key) {
    const text = propertyKeyText(key).toLowerCase();
    return text.includes("_vei") ||
      text.includes("reactprops") ||
      text.includes("reactevent") ||
      text.includes("eventhandler") ||
      text.includes("event_handler");
  }

  function frameworkTargetDescription(target) {
    const description = describeTarget(target);
    let label = "";
    try {
      label = target && typeof target.textContent === "string"
        ? target.textContent.replace(/\s+/g, " ").trim()
        : "";
    } catch (error) {
      label = "";
    }

    if (!label || label.length > 36) {
      return description;
    }

    return `${description} "${label.replace(/"/g, "'")}"`;
  }

  function frameworkHandlerName(original, eventType, targetDescription, propPath) {
    const originalName = original && original.name ? String(original.name).trim() : "";
    if (!isLowValueFunctionName(originalName) && originalName !== "onClick" && originalName !== "onInput") {
      return originalName;
    }

    const propName = propPath.split(".").filter(Boolean).slice(-2).join(".");
    const eventLabel = propName || `on${eventType ? eventType[0].toUpperCase() + eventType.slice(1) : "Event"}`;
    return `${readableElementName(targetDescription)} ${eventLabel} handler`;
  }

  function canAssignFrameworkHandler(owner, key) {
    const descriptor = safeGetOwnPropertyDescriptor(owner, key);
    return !descriptor || descriptor.writable !== false || typeof descriptor.set === "function";
  }

  function wrapFrameworkHandlerSlot(owner, key, original, targetDescription, propPath, eventType) {
    if (typeof original !== "function" ||
        isJavascreenWrapper(original) ||
        isNativeFunction(original) ||
        isClass(original) ||
        !canAssignFrameworkHandler(owner, key)) {
      return 0;
    }

    state.frameworkHandlerSeq += 1;
    const name = frameworkHandlerName(original, eventType, targetDescription, propPath);
    const id = `framework:${state.frameworkHandlerSeq}:${propPath}:${name}`;
    const entry = {
      blockedCount: 0,
      callCount: 0,
      disabled: state.disabled.has(id),
      eventType,
      id,
      kind: "framework-event-handler",
      lastCalledAt: "",
      name,
      original,
      originalName: original.name || "",
      owner,
      path: `${targetDescription}.${propPath}`,
      source: null,
      targetDescription,
      wrapper: null
    };

    const wrapper = function javascreenFrameworkEventHandler(...args) {
      return callEntry(entry, original, this, args, entry.path);
    };
    safeSetFunctionName(wrapper, name);
    entry.wrapper = wrapper;
    markWrapper(wrapper, entry);

    try {
      owner[key] = wrapper;
    } catch (error) {
      return 0;
    }

    state.functions.set(id, entry);
    return 1;
  }

  function wrapFrameworkHandlerValue(owner, key, targetDescription, propPath, eventType, depth = 0) {
    if (!owner || depth > 2) {
      return 0;
    }

    let value;
    try {
      value = owner[key];
    } catch (error) {
      return 0;
    }

    if (typeof value === "function") {
      const descriptor = safeGetOwnPropertyDescriptor(value, "value");
      if (descriptor && typeof value.value === "function") {
        return wrapFrameworkHandlerValue(value, "value", targetDescription, `${propPath}.value`, eventType, depth + 1);
      }

      if (descriptor && Array.isArray(value.value)) {
        let wrapped = 0;
        for (let index = 0; index < value.value.length; index += 1) {
          wrapped += wrapFrameworkHandlerValue(value.value, String(index), targetDescription, `${propPath}.value[${index}]`, eventType, depth + 1);
        }
        return wrapped;
      }

      return wrapFrameworkHandlerSlot(owner, key, value, targetDescription, propPath, eventType);
    }

    if (Array.isArray(value)) {
      let wrapped = 0;
      for (let index = 0; index < value.length; index += 1) {
        wrapped += wrapFrameworkHandlerValue(value, String(index), targetDescription, `${propPath}[${index}]`, eventType, depth + 1);
      }
      return wrapped;
    }

    return 0;
  }

  function scanFrameworkEventHandlers() {
    if (!state.wrapDomEventListeners || !document || typeof document.querySelectorAll !== "function") {
      return 0;
    }

    let elements;
    try {
      elements = Array.prototype.slice.call(document.querySelectorAll("*"), 0, MAX_FRAMEWORK_EVENT_ELEMENTS);
    } catch (error) {
      return 0;
    }

    let wrapped = 0;
    for (const element of elements) {
      const targetDescription = frameworkTargetDescription(element);
      const ownKeys = safeGetOwnPropertyNames(element).concat(safeGetOwnPropertySymbols(element));

      for (const elementKey of ownKeys) {
        let store;
        try {
          store = element[elementKey];
        } catch (error) {
          continue;
        }

        const directEventType = normalizedEventNameFromKey(elementKey);
        if (directEventType && typeof store === "function") {
          wrapped += wrapFrameworkHandlerValue(element, elementKey, targetDescription, propertyKeyText(elementKey), directEventType);
          continue;
        }

        if (!store || (typeof store !== "object" && typeof store !== "function") || !isFrameworkEventStoreKey(elementKey)) {
          continue;
        }

        const storeKeys = safeObjectKeys(store).concat(safeGetOwnPropertySymbols(store));
        for (const storeKey of storeKeys) {
          const eventType = normalizedEventNameFromKey(storeKey);
          if (!eventType) {
            continue;
          }

          const propPath = `${propertyKeyText(elementKey)}.${propertyKeyText(storeKey)}`;
          wrapped += wrapFrameworkHandlerValue(store, storeKey, targetDescription, propPath, eventType);
        }
      }
    }

    return wrapped;
  }

  function isVueComponentKey(key) {
    const text = propertyKeyText(key).toLowerCase();
    return text === "__vueparentcomponent" ||
      text === "__vue_app__" ||
      text.includes("vueparentcomponent");
  }

  function isVueComponentInstance(value) {
    return Boolean(value) &&
      typeof value === "object" &&
      (Object.prototype.hasOwnProperty.call(value, "ctx") ||
        Object.prototype.hasOwnProperty.call(value, "proxy") ||
        Object.prototype.hasOwnProperty.call(value, "setupState")) &&
      (Object.prototype.hasOwnProperty.call(value, "type") ||
        Object.prototype.hasOwnProperty.call(value, "uid") ||
        Object.prototype.hasOwnProperty.call(value, "vnode"));
  }

  function componentDisplayName(component) {
    let type = null;
    try {
      type = component && component.type;
    } catch (error) {
      type = null;
    }

    const candidates = [
      type && type.name,
      type && type.__name,
      type && type.displayName,
      component && component.name
    ];

    for (const candidate of candidates) {
      const text = String(candidate || "").trim();
      if (text) {
        return text.replace(/[^\w$-]+/g, "_").slice(0, 60);
      }
    }

    return "VueComponent";
  }

  function componentMethodNameAllowed(name) {
    const text = propertyKeyText(name);
    return Boolean(text) &&
      text !== "constructor" &&
      !text.startsWith("$") &&
      !text.startsWith("_") &&
      !shouldSkipName(text);
  }

  function functionNamesFromOwner(owner) {
    const names = [];
    for (const name of safeGetOwnPropertyNames(owner).slice(0, MAX_FRAMEWORK_COMPONENT_METHODS)) {
      if (!componentMethodNameAllowed(name)) {
        continue;
      }

      const descriptor = safeGetOwnPropertyDescriptor(owner, name);
      if (descriptor && Object.prototype.hasOwnProperty.call(descriptor, "value") && typeof descriptor.value === "function") {
        names.push(name);
      }
    }

    return names;
  }

  function vueComponentMethodNames(component) {
    const names = new Set();
    let type = null;
    try {
      type = component && component.type;
    } catch (error) {
      type = null;
    }

    const methodOwners = [
      type && type.methods,
      component && component.ctx,
      component && component.setupState,
      component && component.exposed
    ];

    for (const owner of methodOwners) {
      if (!owner || (typeof owner !== "object" && typeof owner !== "function")) {
        continue;
      }

      for (const name of functionNamesFromOwner(owner)) {
        names.add(name);
        if (names.size >= MAX_FRAMEWORK_COMPONENT_METHODS) {
          return Array.from(names);
        }
      }
    }

    return Array.from(names);
  }

  function scanComponentFunctionOwner(owner, label, names, seenOwners) {
    if (!owner || (typeof owner !== "object" && typeof owner !== "function") || seenOwners.has(owner)) {
      return 0;
    }

    seenOwners.add(owner);
    let wrapped = 0;
    const candidateNames = (names && names.length ? names : functionNamesFromOwner(owner))
      .slice(0, MAX_FRAMEWORK_COMPONENT_METHODS);

    for (const name of candidateNames) {
      if (!componentMethodNameAllowed(name)) {
        continue;
      }

      const path = `${label}.${String(name)}`;
      const descriptor = safeGetOwnPropertyDescriptor(owner, name);
      const hasValue = descriptor && Object.prototype.hasOwnProperty.call(descriptor, "value");
      const value = hasValue ? descriptor.value : undefined;
      const suppressionNote = typeof value === "function" ? suppressionReasonForPath(path, name) : "";
      if (suppressionNote) {
        addSuppressedNotice(
          suppressedFunctionNoticeId(path, name),
          suppressedFunctionNoticeName(name),
          path,
          suppressionNote,
          "suppressed-function"
        );
        continue;
      }

      if (!hasValue || typeof value !== "function" || shouldSkipCapturePath(path, name)) {
        continue;
      }

      wrapped += wrapFunction(owner, name, path, {
        allowBoundNative: true,
        preferKeyName: true
      }) ? 1 : 0;
    }

    return wrapped;
  }

  function scanComponentPrototypeFunctionOwners(instance, label, seenOwners) {
    if (!instance || (typeof instance !== "object" && typeof instance !== "function")) {
      return 0;
    }

    let wrapped = scanComponentFunctionOwner(instance, label, null, seenOwners);
    let proto = null;
    try {
      proto = Object.getPrototypeOf(instance);
    } catch (error) {
      proto = null;
    }

    for (let depth = 0; proto && proto !== Object.prototype && depth < 3; depth += 1) {
      wrapped += scanComponentFunctionOwner(proto, `${label}.prototype${depth ? `.parent${depth}` : ""}`, null, seenOwners);
      try {
        proto = Object.getPrototypeOf(proto);
      } catch (error) {
        break;
      }
    }

    return wrapped;
  }

  function scanVueComponent(component, targetDescription, componentDepth, seenComponents, seenOwners) {
    if (!isVueComponentInstance(component) || seenComponents.has(component)) {
      return 0;
    }

    seenComponents.add(component);
    const componentName = componentDisplayName(component);
    const baseLabel = `${targetDescription}.__vueParentComponent${componentDepth ? `.parent${componentDepth}` : ""}.${componentName}`;
    const methodNames = vueComponentMethodNames(component);
    let wrapped = 0;

    wrapped += scanComponentFunctionOwner(component.ctx, `${baseLabel}.ctx`, null, seenOwners);
    wrapped += scanComponentFunctionOwner(component.setupState, `${baseLabel}.setupState`, null, seenOwners);
    wrapped += scanComponentFunctionOwner(component.exposed, `${baseLabel}.exposed`, null, seenOwners);
    wrapped += scanComponentFunctionOwner(component.proxy, `${baseLabel}.proxy`, methodNames, seenOwners);

    try {
      wrapped += scanComponentFunctionOwner(component.type && component.type.methods, `${baseLabel}.type.methods`, null, seenOwners);
    } catch (error) {
      // Some framework internals expose guarded component type objects.
    }

    return wrapped;
  }

  function collectVueComponentsFromVNode(vnode, components, seenVNodes, depth = 0) {
    if (!vnode || typeof vnode !== "object" || seenVNodes.has(vnode) || depth > MAX_FRAMEWORK_COMPONENT_DEPTH + 2) {
      return;
    }

    seenVNodes.add(vnode);

    try {
      if (isVueComponentInstance(vnode.component)) {
        components.push(vnode.component);
      }
    } catch (error) {
      // Some vnode component getters may be guarded by framework internals.
    }

    try {
      const children = vnode.children;
      if (Array.isArray(children)) {
        for (const child of children) {
          collectVueComponentsFromVNode(child, components, seenVNodes, depth + 1);
        }
      } else if (children && typeof children === "object") {
        for (const child of safeObjectKeys(children).map((key) => children[key])) {
          collectVueComponentsFromVNode(child, components, seenVNodes, depth + 1);
        }
      }
    } catch (error) {
      // Vnode children can be lazy or shape-specific; keep scanning siblings.
    }

    try {
      if (vnode.suspense && vnode.suspense.activeBranch) {
        collectVueComponentsFromVNode(vnode.suspense.activeBranch, components, seenVNodes, depth + 1);
      }
    } catch (error) {
      // Suspense internals are best-effort.
    }
  }

  function vueComponentRoots(value) {
    const roots = [];
    const seenVNodes = typeof WeakSet === "function" ? new WeakSet() : { has: () => false, add: () => {} };

    if (!value || (typeof value !== "object" && typeof value !== "function")) {
      return roots;
    }

    if (isVueComponentInstance(value)) {
      roots.push(value);
      return roots;
    }

    const candidates = [];
    try {
      candidates.push(value._instance);
    } catch (error) {
      // Vue app internals may be guarded.
    }
    try {
      candidates.push(value._container && value._container._vnode && value._container._vnode.component);
    } catch (error) {
      // Some Vue builds keep root vnodes behind guarded accessors.
    }
    try {
      candidates.push(value._vnode && value._vnode.component);
    } catch (error) {
      // Same as above.
    }

    for (const candidate of candidates) {
      if (isVueComponentInstance(candidate)) {
        roots.push(candidate);
      }
    }

    try {
      collectVueComponentsFromVNode(value._container && value._container._vnode, roots, seenVNodes);
    } catch (error) {
      // Best effort only.
    }
    try {
      collectVueComponentsFromVNode(value._vnode, roots, seenVNodes);
    } catch (error) {
      // Best effort only.
    }

    return roots;
  }

  function scanVueVNodeTree(vnode, targetDescription, componentDepth, seenComponents, seenOwners, seenVNodes) {
    if (!vnode || typeof vnode !== "object" || seenVNodes.has(vnode) || componentDepth > MAX_FRAMEWORK_COMPONENT_DEPTH) {
      return 0;
    }

    seenVNodes.add(vnode);
    let wrapped = 0;

    try {
      if (isVueComponentInstance(vnode.component)) {
        wrapped += scanVueComponentTree(vnode.component, targetDescription, componentDepth, seenComponents, seenOwners, seenVNodes);
      }
    } catch (error) {
      // Keep walking other vnode branches.
    }

    try {
      const children = vnode.children;
      if (Array.isArray(children)) {
        for (const child of children) {
          wrapped += scanVueVNodeTree(child, targetDescription, componentDepth, seenComponents, seenOwners, seenVNodes);
        }
      } else if (children && typeof children === "object") {
        for (const child of safeObjectKeys(children).map((key) => children[key])) {
          wrapped += scanVueVNodeTree(child, targetDescription, componentDepth, seenComponents, seenOwners, seenVNodes);
        }
      }
    } catch (error) {
      // Some children collections are not ordinary objects.
    }

    try {
      if (vnode.suspense && vnode.suspense.activeBranch) {
        wrapped += scanVueVNodeTree(vnode.suspense.activeBranch, targetDescription, componentDepth, seenComponents, seenOwners, seenVNodes);
      }
    } catch (error) {
      // Suspense branches are optional.
    }

    return wrapped;
  }

  function scanVueComponentTree(component, targetDescription, componentDepth, seenComponents, seenOwners, seenVNodes) {
    if (!isVueComponentInstance(component) || seenComponents.has(component) || componentDepth > MAX_FRAMEWORK_COMPONENT_DEPTH) {
      return 0;
    }

    let wrapped = scanVueComponent(component, targetDescription, componentDepth, seenComponents, seenOwners);
    try {
      wrapped += scanVueVNodeTree(component.subTree, targetDescription, componentDepth + 1, seenComponents, seenOwners, seenVNodes);
    } catch (error) {
      // Subtree traversal is best-effort.
    }
    return wrapped;
  }

  function scanReactFiberComponentMethods(fiber, targetDescription, componentDepth, seenFibers, seenOwners) {
    if (!isReactFiber(fiber) || seenFibers.has(fiber) || componentDepth > MAX_FRAMEWORK_COMPONENT_DEPTH) {
      return 0;
    }

    seenFibers.add(fiber);
    let wrapped = 0;

    if (isReactComponentFiber(fiber)) {
      const componentName = reactFiberDisplayName(fiber);
      const baseLabel = `${targetDescription}.__reactFiber${componentDepth ? `.child${componentDepth}` : ""}.${componentName}`;

      try {
        wrapped += scanComponentFunctionOwner(fiber.memoizedProps, `${baseLabel}.props`, null, seenOwners);
      } catch (error) {
        // Props are optional and sometimes frozen.
      }

      try {
        if (fiber.stateNode && typeof fiber.stateNode === "object" && !(fiber.stateNode instanceof Node)) {
          wrapped += scanComponentPrototypeFunctionOwners(fiber.stateNode, `${baseLabel}.instance`, seenOwners);
        }
      } catch (error) {
        // Function components do not have stateNode instances.
      }

      try {
        if (typeof fiber.type === "function" && fiber.type.prototype) {
          wrapped += scanComponentFunctionOwner(fiber.type.prototype, `${baseLabel}.type.prototype`, null, seenOwners);
        }
      } catch (error) {
        // Some component type objects are guarded.
      }
    }

    try {
      if (fiber.child) {
        wrapped += scanReactFiberComponentMethods(fiber.child, targetDescription, componentDepth + 1, seenFibers, seenOwners);
      }
    } catch (error) {
      // Best effort.
    }

    try {
      if (fiber.sibling) {
        wrapped += scanReactFiberComponentMethods(fiber.sibling, targetDescription, componentDepth, seenFibers, seenOwners);
      }
    } catch (error) {
      // Best effort.
    }

    return wrapped;
  }

  function scanAngularComponentMethods(component, targetDescription, depth, seenComponents, seenOwners) {
    if (!isAngularCandidateObject(component) || seenComponents.has(component) || depth > MAX_FRAMEWORK_COMPONENT_DEPTH) {
      return 0;
    }

    seenComponents.add(component);
    const baseLabel = `${targetDescription}.__ngContext${depth ? `.component${depth}` : ""}.${angularComponentName(component)}`;
    return scanComponentPrototypeFunctionOwners(component, baseLabel, seenOwners);
  }

  function scanFrameworkComponentMethods() {
    if (!state.wrapDomEventListeners || !document || typeof document.querySelectorAll !== "function") {
      return 0;
    }

    let elements;
    try {
      elements = Array.prototype.slice.call(document.querySelectorAll("*"), 0, MAX_FRAMEWORK_EVENT_ELEMENTS);
    } catch (error) {
      return 0;
    }

    const seenComponents = new WeakSet();
    const seenOwners = new WeakSet();
    const seenReactFibers = new WeakSet();
    const seenAngularComponents = new WeakSet();
    let wrapped = 0;

    for (const element of elements) {
      const targetDescription = frameworkTargetDescription(element);
      const ownKeys = safeGetOwnPropertyNames(element).concat(safeGetOwnPropertySymbols(element));

      for (const elementKey of ownKeys) {
        if (!isVueComponentKey(elementKey)) {
          continue;
        }

        let component;
        try {
          component = element[elementKey];
        } catch (error) {
          continue;
        }

        for (const rootComponent of vueComponentRoots(component)) {
          const seenVNodes = typeof WeakSet === "function" ? new WeakSet() : { has: () => false, add: () => {} };
          wrapped += scanVueComponentTree(rootComponent, targetDescription, 0, seenComponents, seenOwners, seenVNodes);

          let parent = rootComponent;
          for (let depth = 1; depth < MAX_FRAMEWORK_COMPONENT_DEPTH; depth += 1) {
            try {
              parent = parent && parent.parent;
            } catch (error) {
              break;
            }

            if (!isVueComponentInstance(parent)) {
              break;
            }
            wrapped += scanVueComponent(parent, targetDescription, depth, seenComponents, seenOwners);
          }
        }
      }

      for (const elementKey of ownKeys) {
        if (!isReactFiberKey(elementKey)) {
          continue;
        }

        let value;
        try {
          value = element[elementKey];
        } catch (error) {
          continue;
        }

        for (const rootFiber of reactFiberRoots(value)) {
          wrapped += scanReactFiberComponentMethods(rootFiber, targetDescription, 0, seenReactFibers, seenOwners);
        }
      }

      for (const component of angularComponentCandidates(element)) {
        wrapped += scanAngularComponentMethods(component, targetDescription, 0, seenAngularComponents, seenOwners);
      }
    }

    return wrapped;
  }

  function installEventHooks() {
    if (!CAPTURE_EVENT_LISTENERS || state.nativeEventTarget || typeof EventTarget !== "function") {
      return;
    }

    const proto = EventTarget.prototype;
    const addDescriptor = safeGetOwnPropertyDescriptor(proto, "addEventListener");
    const removeDescriptor = safeGetOwnPropertyDescriptor(proto, "removeEventListener");
    if (!addDescriptor || !removeDescriptor || typeof addDescriptor.value !== "function" || typeof removeDescriptor.value !== "function") {
      return;
    }

    const nativeAdd = addDescriptor.value;
    const nativeRemove = removeDescriptor.value;

    state.nativeEventTarget = {
      addDescriptor,
      nativeAdd,
      nativeRemove,
      proto,
      removeDescriptor
    };
    installDomEventProbes(nativeAdd);

    Object.defineProperty(proto, "addEventListener", {
      configurable: addDescriptor.configurable,
      enumerable: addDescriptor.enumerable,
      value(type, listener, options) {
        if (!state.running || !listener || !isCapturedDomEventType(type) || isNoisyDomEventType(type)) {
          return nativeAdd.call(this, type, listener, options);
        }

        const capture = captureFromOptions(options);
        let record = matchingListenerRecord(this, type, listener, capture);
        if (!record) {
          record = createListenerRecord(this, type, listener, options, shouldObserveDomListenerOnly(this, type));
        }

        if (record && record.observedOnly) {
          return nativeAdd.call(this, type, listener, options);
        }

        return nativeAdd.call(this, type, record ? record.wrapper : listener, options);
      },
      writable: addDescriptor.writable !== false
    });

    Object.defineProperty(proto, "removeEventListener", {
      configurable: removeDescriptor.configurable,
      enumerable: removeDescriptor.enumerable,
      value(type, listener, options) {
        if (!isCapturedDomEventType(type) || isNoisyDomEventType(type)) {
          return nativeRemove.call(this, type, listener, options);
        }

        const capture = captureFromOptions(options);
        const record = matchingListenerRecord(this, type, listener, capture);
        if (record) {
          record.active = false;
          if (record.observedOnly) {
            return nativeRemove.call(this, type, listener, options);
          }

          return nativeRemove.call(this, type, record.wrapper, options);
        }

        return nativeRemove.call(this, type, listener, options);
      },
      writable: removeDescriptor.writable !== false
    });
  }

  function restoreEventHooks() {
    const native = state.nativeEventTarget;
    if (!native) {
      return;
    }

    for (const record of state.listenerRecords) {
      if (!record.active) {
        continue;
      }

      try {
        if (!record.observedOnly) {
          native.nativeRemove.call(record.target, record.type, record.wrapper, record.options);
          native.nativeAdd.call(record.target, record.type, record.listener, record.options);
        }
      } catch (error) {
        // The target may be gone or may reject listener changes during teardown.
      }
      record.active = false;
    }

    for (const probe of state.nativeEventProbeRecords) {
      try {
        native.nativeRemove.call(probe.target, probe.type, probe.listener, true);
      } catch (error) {
        // Probe teardown is best effort.
      }
    }
    state.nativeEventProbeRecords = [];

    try {
      Object.defineProperty(native.proto, "addEventListener", native.addDescriptor);
      Object.defineProperty(native.proto, "removeEventListener", native.removeDescriptor);
    } catch (error) {
      native.proto.addEventListener = native.nativeAdd;
      native.proto.removeEventListener = native.nativeRemove;
    }

    state.nativeEventTarget = null;
  }

  function installNetworkHooks() {
    if (!state.nativeFetch && typeof window.fetch === "function") {
      state.nativeFetch = window.fetch;
      const wrappedFetch = function javascreenFetch(input, init = {}) {
        if (!state.running) {
          return state.nativeFetch.apply(this, arguments);
        }

        const request = requestFromFetchArgs(input, init || {});
        const record = createNetworkRecord("fetch", request, init || {});
        if (state.pauseNetworkRequests) {
          record.paused = true;
          record.pausedPhase = "request";
          addNetworkCall(record, "request", record.parent);
          return new Promise((resolve, reject) => {
            record.continueRequest = (nextRequest) => {
              performFetchRecord(Object.assign(record, {
                request: Object.assign({}, record.request, nextRequest || {})
              })).then(resolve, reject);
            };
          });
        }

        return performFetchRecord(record);
      };
      markWrapper(wrappedFetch, { id: "network:fetch-wrapper" }, false);
      try {
        Object.defineProperty(window, "fetch", {
          configurable: true,
          value: wrappedFetch,
          writable: true
        });
      } catch (error) {
        window.fetch = wrappedFetch;
      }
    }

    if (!state.nativeXhr && typeof XMLHttpRequest === "function" && XMLHttpRequest.prototype) {
      const proto = XMLHttpRequest.prototype;
      const open = proto.open;
      const send = proto.send;
      const setRequestHeader = proto.setRequestHeader;
      if (typeof open !== "function" || typeof send !== "function") {
        return;
      }

      const xhrRecords = typeof WeakMap === "function" ? new WeakMap() : null;
      state.nativeXhr = { open, proto, send, setRequestHeader };

      proto.open = function javascreenXhrOpen(method, url) {
        if (xhrRecords) {
          xhrRecords.set(this, {
            headers: {},
            method: String(method || "GET").toUpperCase(),
            url: String(url || "")
          });
        }
        return open.apply(this, arguments);
      };

      if (typeof setRequestHeader === "function") {
        proto.setRequestHeader = function javascreenXhrSetRequestHeader(name, value) {
          const meta = xhrRecords && xhrRecords.get(this);
          if (meta) {
            meta.headers[String(name)] = String(value);
          }
          return setRequestHeader.apply(this, arguments);
        };
      }

      proto.send = function javascreenXhrSend(body) {
        if (!state.running || !xhrRecords) {
          return send.apply(this, arguments);
        }

        const meta = xhrRecords.get(this) || {
          headers: {},
          method: "GET",
          url: ""
        };
        const request = {
          body: bodyPreview(body),
          headers: Object.assign({}, meta.headers || {}),
          method: meta.method || "GET",
          url: meta.url || ""
        };
        const record = createNetworkRecord("xhr", request, {});
        const xhr = this;

        function sendNow(nextRequest) {
          const finalRequest = Object.assign({}, request, nextRequest || {});
          record.request = finalRequest;
          if (!record.requestCallId) {
            addNetworkCall(record, "request", record.parent);
          }
          try {
            xhr.addEventListener("loadend", () => {
              let responseBody = "";
              try {
                responseBody = String(xhr.responseType && xhr.responseType !== "text" ? serializeSafely(xhr.response) : xhr.responseText || "");
              } catch (error) {
                responseBody = "";
              }
              record.response = {
                body: responseBody,
                headers: {},
                status: Number(xhr.status || 0),
                statusText: String(xhr.statusText || "")
              };
              const requestParent = {
                depth: record.parent ? record.parent.depth + 1 : 0,
                id: record.requestCallId,
                treeId: record.parent ? record.parent.treeId : record.requestCallId
              };
              addNetworkCall(record, "response", requestParent, {
                note: state.pauseNetworkResponses ? "XHR responses are logged, but native XHR response substitution is not available." : ""
              });
            }, { once: true });
          } catch (error) {
            // XHR may reject listener installation in unusual host objects.
          }
          return send.call(xhr, finalRequest.body === null || typeof finalRequest.body === "undefined" ? body : finalRequest.body);
        }

        if (state.pauseNetworkRequests) {
          record.paused = true;
          record.pausedPhase = "request";
          addNetworkCall(record, "request", record.parent);
          record.continueRequest = (nextRequest) => {
            sendNow(nextRequest);
          };
          return undefined;
        }

        return sendNow(request);
      };
    }
  }

  function restoreNetworkHooks() {
    if (state.nativeFetch) {
      try {
        window.fetch = state.nativeFetch;
      } catch (error) {
        // Best effort.
      }
      state.nativeFetch = null;
    }

    if (state.nativeXhr) {
      try {
        state.nativeXhr.proto.open = state.nativeXhr.open;
        state.nativeXhr.proto.send = state.nativeXhr.send;
        if (state.nativeXhr.setRequestHeader) {
          state.nativeXhr.proto.setRequestHeader = state.nativeXhr.setRequestHeader;
        }
      } catch (error) {
        // Best effort.
      }
      state.nativeXhr = null;
    }
  }

  function libraryListenerName(callback, eventType, targetDescription) {
    const callbackName = callback && callback.name ? String(callback.name).trim() : "";
    if (!isLowValueFunctionName(callbackName)) {
      return callbackName;
    }

    return `${readableElementName(targetDescription)} ${eventType} listener`;
  }

  function matchingLibraryListenerRecord(hook, target, type, listener, useCapture) {
    return state.libraryListenerRecords.find((record) => record.active &&
      record.hook === hook &&
      record.target === target &&
      record.type === type &&
      (record.listener === listener || record.nativeToken === listener) &&
      record.useCapture === useCapture);
  }

  function isNoisyLibraryEventType(type) {
    return NOISY_LIBRARY_EVENT_TYPES.has(String(type || "").toLowerCase());
  }

  function suppressedLibraryEventNotice(hook, type, methodName) {
    const eventType = String(type || "event").toLowerCase();
    if (!NOISY_LIBRARY_EVENT_TYPES.has(eventType)) {
      return;
    }

    addSuppressedNotice(
      `${hook.id}:suppressed:${eventType}`,
      `${hook.name} ${eventType} event`,
      `${hook.name}.${methodName}("${eventType}")`,
      `Tracking disabled: ${hook.name} "${eventType}" events fire extremely often and would flood the log.`,
      "suppressed-library-event"
    );
  }

  function createLibraryListenerRecord(hook, target, type, listener, useCapture) {
    const callback = listenerCallback(listener);
    if (!callback || isJavascreenWrapper(listener) || isJavascreenWrapper(callback)) {
      return null;
    }

    state.listenerSeq += 1;

    const eventType = String(type);
    const targetDescription = describeTarget(target);
    const listenerName = libraryListenerName(callback, eventType, targetDescription);
    const source = parseStackLocation(new Error().stack, `${hook.name}.addEventListener`);
    const id = `${hook.id}:${state.listenerSeq}:${eventType}:${listenerName}`;
    const entry = {
      blockedCount: 0,
      callCount: 0,
      disabled: state.disabled.has(id),
      eventType,
      id,
      kind: "library-event-listener",
      lastCalledAt: "",
      name: listenerName,
      original: callback,
      originalName: callback && callback.name ? String(callback.name).trim() : "",
      path: `${hook.name}.addEventListener("${eventType}")`,
      source: locateDefinition(listenerName) || source,
      targetDescription,
      wrapper: null
    };

    const record = {
      active: true,
      entry,
      hook,
      listener,
      nativeToken: null,
      observedOnly: true,
      once: false,
      target,
      type,
      useCapture,
      wrapper: null
    };

    state.libraryListenerRecords.push(record);
    state.functions.set(id, entry);
    return record;
  }

  function libraryListenerCollections(target, type) {
    const collections = [];
    const eventType = String(type || "");

    for (const item of [
      { key: "_listeners", useCapture: false },
      { key: "_captureListeners", useCapture: true },
      { key: "listeners", useCapture: false }
    ]) {
      const store = target && target[item.key];
      const listeners = store && store[eventType];
      if (Array.isArray(listeners)) {
        collections.push({
          listeners,
          useCapture: item.useCapture
        });
      }
    }

    return collections;
  }

  function syncLibraryListenerRecordsForDispatch(hook, target, type) {
    for (const collection of libraryListenerCollections(target, type)) {
      for (let index = 0; index < collection.listeners.length; index += 1) {
        const listener = collection.listeners[index];
        if (!listener || isJavascreenWrapper(listener)) {
          continue;
        }

        let record = matchingLibraryListenerRecord(hook, target, type, listener, collection.useCapture);
        if (!record) {
          record = createLibraryListenerRecord(hook, target, type, listener, collection.useCapture);
        }

        // Keep the page's listener array untouched; the dispatch frame will still
        // parent any separately wrapped functions called by this listener.
      }
    }
  }

  function observedLibraryRecordsForDispatch(hook, target, type) {
    return state.libraryListenerRecords
      .filter((record) => record.active &&
        record.hook === hook &&
        record.target === target &&
        record.type === type)
      .slice(0, 12);
  }

  function libraryDispatchEventType(event) {
    if (typeof event === "string") {
      return event;
    }

    try {
      return event && event.type ? String(event.type) : "";
    } catch (error) {
      return "";
    }
  }

  function libraryDispatchEntry(hook, type, original, methodName = "dispatchEvent") {
    const eventType = String(type || "event");
    const id = `${hook.id}:${methodName}:dispatch:${eventType}`;
    const existing = state.functions.get(id);
    if (existing) {
      return existing;
    }

    const name = methodName === "_dispatchEvent"
      ? `${hook.name} ${eventType} internal dispatch`
      : `${hook.name} ${eventType} dispatch`;
    const entry = {
      blockedCount: 0,
      callCount: 0,
      disabled: state.disabled.has(id),
      eventType,
      id,
      kind: "library-event-dispatch",
      lastCalledAt: "",
      name,
      original,
      originalName: methodName,
      path: `${hook.name}.${methodName}("${eventType}")`,
      source: null,
      wrapper: null
    };

    state.functions.set(id, entry);
    return entry;
  }

  function beginObservedLibraryDispatch(hook, target, type, args, methodName) {
    const original = hook.nativeMethods && hook.nativeMethods[methodName] || hook.nativeDispatch;
    const entry = libraryDispatchEntry(hook, type, original, methodName);
    const dispatchCall = addCall(entry, null, false);
    dispatchCall.args = serializeArguments(args);
    dispatchCall.note = "Observed library dispatch; functions called while this library event is handled are grouped below.";

    const frame = {
      depth: dispatchCall.depth,
      id: dispatchCall.id,
      treeId: dispatchCall.treeId
    };

    state.callStack.push(frame);

    return {
      dispatchCall,
      entry,
      frame,
      hook,
      target,
      type
    };
  }

  function finishObservedLibraryDispatch(context, result, thrownError) {
    if (!context) {
      return;
    }

    try {
      if (thrownError) {
        context.dispatchCall.threw = true;
        context.dispatchCall.error = thrownError && thrownError.message ? thrownError.message : String(thrownError);
        context.dispatchCall.returnValue = "[threw]";
      } else {
        context.dispatchCall.returnValue = serializeSafely(result);
      }

      for (const record of observedLibraryRecordsForDispatch(context.hook, context.target, String(context.type || "event")).filter((item) => item.observedOnly)) {
        const listenerCall = addCall(record.entry, record.entry.source, false);
        listenerCall.args = context.dispatchCall.args;
        listenerCall.note = "Observed library listener; not wrapped to avoid interfering with page events.";
        listenerCall.returnValue = "observed";
        postFrameCall(listenerCall, record.entry);
        if (record.once) {
          record.active = false;
        }
      }

      postFrameCall(context.dispatchCall, context.entry);
    } finally {
      const index = state.callStack.lastIndexOf(context.frame);
      if (index >= 0) {
        if (index === state.callStack.length - 1) {
          state.callStack.pop();
        } else {
          state.callStack.splice(index, 1);
        }
      }
    }
  }

  function observeNativeLibraryDispatch(hook, target, eventType, args, methodName, invoke) {
    if (!state.running || isNoisyLibraryEventType(eventType)) {
      return invoke();
    }

    syncLibraryListenerRecordsForDispatch(hook, target, eventType);
    const original = hook.nativeMethods && hook.nativeMethods[methodName] || hook.nativeDispatch;
    const entry = libraryDispatchEntry(hook, eventType, original, methodName);
    if (addAutoSuppressNotice(entry, "suppressed-library-event")) {
      return invoke();
    }

    const context = beginObservedLibraryDispatch(hook, target, eventType, args, methodName);
    try {
      const result = invoke();
      finishObservedLibraryDispatch(context, result, null);
      return result;
    } catch (error) {
      finishObservedLibraryDispatch(context, undefined, error);
      throw error;
    }
  }

  function libraryDispatchDescriptorMap(proto) {
    const descriptors = {};
    for (const methodName of ["dispatchEvent"]) {
      const descriptor = safeGetOwnPropertyDescriptor(proto, methodName);
      if (descriptor && typeof descriptor.value === "function") {
        descriptors[methodName] = descriptor;
      }
    }

    return descriptors;
  }

  function wrapLibraryDispatchMethod(hook, methodName, descriptor) {
    if (!descriptor || typeof descriptor.value !== "function") {
      return;
    }

    const nativeMethod = descriptor.value;
    hook.nativeMethods[methodName] = nativeMethod;

    Object.defineProperty(hook.proto, methodName, {
      configurable: descriptor.configurable,
      enumerable: descriptor.enumerable,
      value(event) {
        const eventType = libraryDispatchEventType(event);
        if (state.running && isNoisyLibraryEventType(eventType)) {
          suppressedLibraryEventNotice(hook, eventType, methodName);
        }

        return observeNativeLibraryDispatch(hook, this, eventType, arguments, methodName, () => nativeMethod.apply(this, arguments));
      },
      writable: descriptor.writable !== false
    });
  }

  function installOptionalLibraryDispatchHooks(hook) {
    for (const [methodName, descriptor] of Object.entries(hook.dispatchDescriptors || {})) {
      wrapLibraryDispatchMethod(hook, methodName, descriptor);
    }
  }

  function restoreLibraryDispatchMethods(hook) {
    for (const [methodName, descriptor] of Object.entries(hook.dispatchDescriptors || {})) {
      try {
        Object.defineProperty(hook.proto, methodName, descriptor);
      } catch (error) {
        if (hook.nativeMethods && hook.nativeMethods[methodName]) {
          hook.proto[methodName] = hook.nativeMethods[methodName];
        }
      }
    }
  }

  function installEventDispatcherHook(name, proto) {
    if (!proto || state.libraryEventHooks.some((hook) => hook.proto === proto)) {
      return false;
    }

    const addDescriptor = safeGetOwnPropertyDescriptor(proto, "addEventListener");
    const removeDescriptor = safeGetOwnPropertyDescriptor(proto, "removeEventListener");
    const dispatchDescriptors = libraryDispatchDescriptorMap(proto);
    const dispatchDescriptor = dispatchDescriptors.dispatchEvent;
    const onDescriptor = safeGetOwnPropertyDescriptor(proto, "on");
    const offDescriptor = safeGetOwnPropertyDescriptor(proto, "off");
    if (!addDescriptor || !removeDescriptor || typeof addDescriptor.value !== "function" || typeof removeDescriptor.value !== "function") {
      return false;
    }

    const hook = {
      addDescriptor,
      dispatchDescriptor,
      dispatchDescriptors,
      id: `library-event:${name}`,
      name,
      nativeAdd: addDescriptor.value,
      nativeDispatch: dispatchDescriptor && typeof dispatchDescriptor.value === "function" ? dispatchDescriptor.value : null,
      nativeMethods: {},
      nativeOff: offDescriptor && typeof offDescriptor.value === "function" ? offDescriptor.value : null,
      nativeOn: onDescriptor && typeof onDescriptor.value === "function" ? onDescriptor.value : null,
      nativeRemove: removeDescriptor.value,
      offDescriptor,
      onDescriptor,
      proto,
      removeDescriptor
    };

    Object.defineProperty(proto, "addEventListener", {
      configurable: addDescriptor.configurable,
      enumerable: addDescriptor.enumerable,
      value(type, listener, useCapture) {
        if (state.running && isNoisyLibraryEventType(type)) {
          suppressedLibraryEventNotice(hook, type, "addEventListener");
        }

        if (!state.running || state.suppressLibraryHookDepth || !listener || isNoisyLibraryEventType(type)) {
          return hook.nativeAdd.apply(this, arguments);
        }

        const capture = Boolean(useCapture);
        let record = matchingLibraryListenerRecord(hook, this, type, listener, capture);
        if (!record) {
          record = createLibraryListenerRecord(hook, this, type, listener, capture);
        }

        hook.nativeAdd.call(this, type, listener, useCapture);
        return listener;
      },
      writable: addDescriptor.writable !== false
    });

    Object.defineProperty(proto, "removeEventListener", {
      configurable: removeDescriptor.configurable,
      enumerable: removeDescriptor.enumerable,
      value(type, listener, useCapture) {
        if (isNoisyLibraryEventType(type)) {
          if (state.running) {
            suppressedLibraryEventNotice(hook, type, "removeEventListener");
          }
          return hook.nativeRemove.apply(this, arguments);
        }

        const capture = Boolean(useCapture);
        const record = matchingLibraryListenerRecord(hook, this, type, listener, capture);
        if (record) {
          record.active = false;
          return hook.nativeRemove.call(this, type, listener, useCapture);
        }

        return hook.nativeRemove.apply(this, arguments);
      },
      writable: removeDescriptor.writable !== false
    });

    if (hook.nativeOn) {
      Object.defineProperty(proto, "on", {
        configurable: onDescriptor.configurable,
        enumerable: onDescriptor.enumerable,
        value(type, listener, scope, once, data, useCapture) {
          if (state.running && isNoisyLibraryEventType(type)) {
            suppressedLibraryEventNotice(hook, type, "on");
          }

          if (!state.running || !listener || isNoisyLibraryEventType(type)) {
            return hook.nativeOn.apply(this, arguments);
          }

          const capture = Boolean(useCapture);
          let record = matchingLibraryListenerRecord(hook, this, type, listener, capture);
          if (!record) {
            record = createLibraryListenerRecord(hook, this, type, listener, capture);
          }
          if (record) {
            record.once = Boolean(once);
          }

          state.suppressLibraryHookDepth += 1;
          try {
            const token = hook.nativeOn.call(this, type, listener, scope, once, data, useCapture);
            if (record) {
              record.nativeToken = token;
            }
            return token;
          } finally {
            state.suppressLibraryHookDepth -= 1;
          }
        },
        writable: onDescriptor.writable !== false
      });
    }

    installOptionalLibraryDispatchHooks(hook);

    if (hook.nativeOff) {
      Object.defineProperty(proto, "off", {
        configurable: offDescriptor.configurable,
        enumerable: offDescriptor.enumerable,
        value(type, listener, useCapture) {
          const capture = Boolean(useCapture);
          const record = matchingLibraryListenerRecord(hook, this, type, listener, capture);
          if (record) {
            record.active = false;
          }
          return hook.nativeOff.apply(this, arguments);
        },
        writable: offDescriptor.writable !== false
      });
    }

    state.libraryEventHooks.push(hook);
    return true;
  }

  function installLibraryEventHooks() {
    let installed = false;

    try {
      const dispatcher = window.createjs && window.createjs.EventDispatcher;
      if (dispatcher && dispatcher.prototype) {
        installed = installEventDispatcherHook("createjs.EventDispatcher", dispatcher.prototype) || installed;
      }
    } catch (error) {
      // Optional library hook; pages without CreateJS/EaselJS do not need it.
    }

    return installed;
  }

  function stopLibraryHookPolling() {
    if (!state.libraryHookTimer) {
      return;
    }

    window.clearInterval(state.libraryHookTimer);
    state.libraryHookTimer = 0;
  }

  function startLibraryHookPolling() {
    if (state.libraryHookTimer) {
      return;
    }

    const startedAt = Date.now();
    state.libraryHookTimer = window.setInterval(() => {
      if (installLibraryEventHooks() || Date.now() - startedAt > 10000) {
        stopLibraryHookPolling();
      }
    }, 50);
  }

  function restoreLibraryEventHooks() {
    stopLibraryHookPolling();

    for (const record of state.libraryListenerRecords) {
      if (!record.active) {
        continue;
      }

      try {
        if (!record.observedOnly && record.wrapper) {
          record.hook.nativeRemove.call(record.target, record.type, record.wrapper, record.useCapture);
          record.hook.nativeAdd.call(record.target, record.type, record.listener, record.useCapture);
        }
      } catch (error) {
        // The event target may be gone or the page may have replaced the dispatcher.
      }

      record.active = false;
    }

    for (const hook of state.libraryEventHooks) {
      try {
        Object.defineProperty(hook.proto, "addEventListener", hook.addDescriptor);
        Object.defineProperty(hook.proto, "removeEventListener", hook.removeDescriptor);
        restoreLibraryDispatchMethods(hook);
        if (hook.onDescriptor) {
          Object.defineProperty(hook.proto, "on", hook.onDescriptor);
        }
        if (hook.offDescriptor) {
          Object.defineProperty(hook.proto, "off", hook.offDescriptor);
        }
      } catch (error) {
        hook.proto.addEventListener = hook.nativeAdd;
        hook.proto.removeEventListener = hook.nativeRemove;
        for (const [methodName, nativeMethod] of Object.entries(hook.nativeMethods || {})) {
          if (nativeMethod) {
            hook.proto[methodName] = nativeMethod;
          }
        }
        if (hook.nativeOn) {
          hook.proto.on = hook.nativeOn;
        }
        if (hook.nativeOff) {
          hook.proto.off = hook.nativeOff;
        }
      }
    }

    state.libraryEventHooks = [];
  }

  function scanPrototypeFunctions(owner, label, seen) {
    if (!shouldScanPrototypePath(label)) {
      return 0;
    }

    let proto;
    try {
      proto = Object.getPrototypeOf(owner);
    } catch (error) {
      return 0;
    }

    if (!proto || proto === Object.prototype || proto === Function.prototype || proto === Array.prototype || seen.has(proto)) {
      return 0;
    }

    seen.add(proto);
    let wrapped = 0;
    const names = safeGetOwnPropertyNames(proto).slice(0, MAX_PROPERTIES_PER_OBJECT);
    for (const name of names) {
      const path = `${label}#prototype.${String(name)}`;
      const descriptor = safeGetOwnPropertyDescriptor(proto, name);
      const hasValue = descriptor && Object.prototype.hasOwnProperty.call(descriptor, "value");
      const value = hasValue ? descriptor.value : undefined;
      const suppressionNote = typeof value === "function" ? suppressionReasonForPath(path, name) : "";
      if (suppressionNote) {
        addSuppressedNotice(
          suppressedFunctionNoticeId(path, name),
          suppressedFunctionNoticeName(name),
          path,
          suppressionNote,
          "suppressed-function"
        );
        continue;
      }

      if (String(name) === "constructor" ||
          !shouldWrapPrototypeFunctionName(name) ||
          shouldSkipName(String(name)) ||
          shouldSkipCapturePath(path, name)) {
        continue;
      }

      if (typeof value === "function") {
        wrapped += wrapFunction(proto, name, path) ? 1 : 0;
      }
    }

    return wrapped;
  }

  function scanObject(owner, label, depth, seen) {
    const depthLimit = captureScanDepthLimit(label);
    if (!state.running || depth > depthLimit || !canInspectObject(owner) || seen.has(owner)) {
      return 0;
    }

    seen.add(owner);
    let wrapped = 0;
    wrapped += scanPrototypeFunctions(owner, label, seen);
    const names = safeGetOwnPropertyNames(owner).slice(0, MAX_PROPERTIES_PER_OBJECT);

    for (const name of names) {
      const path = `${label}.${String(name)}`;
      const descriptor = safeGetOwnPropertyDescriptor(owner, name);
      const hasValue = descriptor && Object.prototype.hasOwnProperty.call(descriptor, "value");
      const value = hasValue ? descriptor.value : undefined;
      const suppressionNote = typeof value === "function" ? suppressionReasonForPath(path, name) : "";
      if (suppressionNote) {
        addSuppressedNotice(
          suppressedFunctionNoticeId(path, name),
          suppressedFunctionNoticeName(name),
          path,
          suppressionNote,
          "suppressed-function"
        );
        continue;
      }

      if (shouldSkipName(String(name)) || name === "prototype" || name === "constructor" || shouldSkipCapturePath(path, name)) {
        continue;
      }

      if (!hasValue) {
        continue;
      }

      if (typeof value === "function" && shouldWrapScannedFunction(path, name, depth)) {
        wrapped += wrapFunction(owner, name, path) ? 1 : 0;
      } else if (depth < captureScanDepthLimit(path) && canInspectObject(value)) {
        wrapped += scanObject(value, path, depth + 1, seen);
      }
    }

    return wrapped;
  }

  function scan() {
    if (!state.running) {
      return 0;
    }

    installLibraryEventHooks();

    const seen = new WeakSet();
    let wrapped = scanFrameworkEventHandlers();
    wrapped += scanFrameworkComponentMethods();
    const names = safeGetOwnPropertyNames(window).slice(0, 1600);

    for (const name of names) {
      const path = String(name);
      const descriptor = safeGetOwnPropertyDescriptor(window, name);
      const hasValue = descriptor && Object.prototype.hasOwnProperty.call(descriptor, "value");
      const value = hasValue ? descriptor.value : undefined;
      const suppressionNote = typeof value === "function" ? suppressionReasonForPath(path, name) : "";
      if (suppressionNote) {
        addSuppressedNotice(
          suppressedFunctionNoticeId(path, name),
          suppressedFunctionNoticeName(name),
          path,
          suppressionNote,
          "suppressed-function"
        );
        continue;
      }

      if (shouldSkipName(path) || shouldSkipCapturePath(path, name)) {
        continue;
      }

      if (!hasValue) {
        continue;
      }

      if (typeof value === "function") {
        wrapped += wrapFunction(window, name, path) ? 1 : 0;
      } else if (canInspectObject(value)) {
        wrapped += scanObject(value, path, 1, seen);
      }
    }

    return wrapped;
  }

  function entrySnapshot(entry) {
    return {
      blockedCount: entry.blockedCount || 0,
      callCount: entry.callCount,
      disabled: state.disabled.has(entry.id),
      id: entry.id,
      kind: entry.kind || "function",
      lastCalledAt: entry.lastCalledAt,
      note: entry.note || "",
      originalName: entry.originalName || "",
      name: entry.name,
      path: entry.path,
      source: entry.source,
      suppressed: Boolean(entry.suppressed)
    };
  }

  function listenerDiagnostics(records) {
    return records
      .filter((record) => record.active)
      .slice(0, 60)
      .map((record) => ({
        eventType: record.entry && record.entry.eventType || record.type || "",
        id: record.entry && record.entry.id || "",
        name: record.entry && record.entry.name || "",
        observedOnly: Boolean(record.observedOnly),
        path: record.entry && record.entry.path || "",
        source: record.entry && record.entry.source || null
      }));
  }

  function diagnosticsSnapshot() {
    const activeDomRecords = state.listenerRecords.filter((record) => record.active);
    const activeLibraryRecords = state.libraryListenerRecords.filter((record) => record.active);
    const observedOnlyDomRecords = activeDomRecords.filter((record) => record.observedOnly);
    const frameworkEventHandlers = Array.from(state.functions.values())
      .filter((entry) => entry && entry.kind === "framework-event-handler").length;

    return {
      captureDomEventListeners: CAPTURE_EVENT_LISTENERS,
      capturedDomEventTypes: Array.from(CAPTURED_DOM_EVENT_TYPES),
      domCaptureMode: state.safeMode
        ? "safe mode: observe DOM input listeners without wrapping so clicks remain native"
        : state.wrapDomEventListeners
          ? "aggressive mode: wrap DOM input listeners to trace event-handler call trees"
          : "observe DOM input listeners without wrapping so clicks remain native",
      domEventProbeCount: state.nativeEventProbeRecords.length,
      frame: ownFrameInfo(),
      libraryEventHooks: state.libraryEventHooks.map((hook) => hook.name),
      listenerCounts: {
        activeDom: activeDomRecords.length,
        activeLibrary: activeLibraryRecords.length,
        frameworkEventHandlers,
        observedOnlyDom: observedOnlyDomRecords.length,
        wrappedDom: activeDomRecords.length - observedOnlyDomRecords.length
      },
      listenerSample: listenerDiagnostics(activeDomRecords),
      noisyDomEventTypes: Array.from(NOISY_DOM_EVENT_TYPES),
      options: {
        captureMinifiedFunctions: state.captureMinifiedFunctions,
        continueTrackingAfterLimit: state.continueTrackingAfterLimit,
        pauseNetworkRequests: state.pauseNetworkRequests,
        pauseNetworkResponses: state.pauseNetworkResponses,
        safeMode: state.safeMode,
        wrapDomEventListeners: state.wrapDomEventListeners
      },
      sourceFileCount: state.sourceFiles.length,
      sourceIndexStatus: state.sourceIndexStatus,
      suppressedNotices: state.suppressedEntries.size,
      variableFrameSkipped: shouldSkipVariableFrame(),
      version: VERSION
    };
  }

  function snapshot(options = true) {
    const normalized = typeof options === "object" && options !== null ? options : {
      includeFunctions: options !== false
    };
    const includeFunctions = normalized.includeFunctions !== false;
    const includeNetwork = normalized.includeNetwork !== false;
    const includeVariables = normalized.includeVariables !== false;
    const current = {
      diagnostics: diagnosticsSnapshot(),
      disabledIds: Array.from(state.disabled),
      frameId: state.frameId,
      frameInfo: ownFrameInfo(),
      functionCount: state.functions.size,
      listenerCount: state.listenerRecords.filter((record) => record.active).length +
        state.libraryListenerRecords.filter((record) => record.active).length,
      running: state.running,
      sourceIndexStatus: state.sourceIndexStatus,
      startedAt: state.startedAt,
      network: includeNetwork ? Array.from(state.networkRecords.values()).map(networkRecordSnapshot) : [],
      totalCalls: state.totalCalls,
      variableCount: 0,
      version: VERSION
    };

    current.variableWatchEnabled = state.variableWatchEnabled;
    if (includeVariables) {
      current.variables = variableSnapshot(false, false);
      current.variableCount = current.variables.length;
    } else {
      current.variables = [];
      current.variableCount = state.variableRecords.size;
    }

    if (includeFunctions) {
      current.functions = Array.from(state.functions.values()).map(entrySnapshot);
    } else {
      current.functions = [];
    }

    return current;
  }

  function drain(options = {}) {
    const drainOptions = typeof options === "object" && options !== null ? options : {};
    const calls = state.buffer.splice(0, state.buffer.length);
    const snapshotOptions = {
      includeFunctions: drainOptions.includeFunctions === "changed" ? false : drainOptions.includeFunctions !== false,
      includeNetwork: drainOptions.includeNetwork === "changed" ? false : drainOptions.includeNetwork !== false,
      includeVariables: drainOptions.includeVariables !== false
    };
    const current = snapshot(snapshotOptions);

    if (drainOptions.includeFunctions === "changed") {
      const functionIds = new Set();
      for (const call of calls) {
        if (call && call.functionId) {
          functionIds.add(call.functionId);
        }
      }
      current.functions = Array.from(functionIds)
        .map((id) => state.functions.get(id))
        .filter(Boolean)
        .map(entrySnapshot);
    }

    if (drainOptions.includeNetwork === "changed") {
      const networkIds = new Set();
      for (const call of calls) {
        if (call && call.network && call.network.id) {
          networkIds.add(call.network.id);
        }
      }
      current.network = Array.from(networkIds)
        .map((id) => state.networkRecords.get(id))
        .filter(Boolean)
        .map(networkRecordSnapshot);
    }

    return {
      calls,
      snapshot: current
    };
  }

  function setOptions(options = {}) {
    const previousCaptureMinified = state.captureMinifiedFunctions;
    const previousWrapDomListeners = state.wrapDomEventListeners;
    const previousSafeMode = state.safeMode;
    state.captureMinifiedFunctions = Boolean(options.captureMinifiedFunctions);
    state.continueTrackingAfterLimit = Boolean(options.continueTrackingAfterLimit);
    state.pauseNetworkRequests = Boolean(options.pauseNetworkRequests);
    state.pauseNetworkResponses = Boolean(options.pauseNetworkResponses);
    state.safeMode = Boolean(options.safeMode);
    state.wrapDomEventListeners = Boolean(options.wrapDomEventListeners);

    if ((state.captureMinifiedFunctions && !previousCaptureMinified) || (!state.safeMode && previousSafeMode)) {
      state.suppressedEntries.delete("suppressed:minified-single-letter-functions");
      state.functions.delete("suppressed:minified-single-letter-functions");
    }

    if (state.running && (state.wrapDomEventListeners !== previousWrapDomListeners || state.safeMode !== previousSafeMode)) {
      syncDomListenerWrapping();
    }

    if (state.running) {
      scan();
    }

    return snapshot(true);
  }

  function setDisabled(id, disabled) {
    if (disabled) {
      state.disabled.add(id);
    } else {
      state.disabled.delete(id);
    }

    const entry = state.functions.get(id);
    if (entry) {
      entry.disabled = state.disabled.has(id);
    }

    return snapshot();
  }

  function replay(id, args = [], options = {}) {
    const entry = state.functions.get(String(id || ""));
    if (!entry) {
      throw new Error("Entry is not available for replay.");
    }

    const directHandlerReplay = Boolean(options && options.directHandler);
    if (!directHandlerReplay && (entry.kind === "observed-dom-event" ||
        ((entry.kind === "event-listener" || entry.kind === "framework-event-handler") &&
          options && options.forceDescriptors && args && args[0] && args[0].type === "dom-event"))) {
      return replayObservedDomEvent(args);
    }

    if (entry.kind !== "function" && entry.kind !== "event-listener" && entry.kind !== "framework-event-handler") {
      throw new Error("Entry is not available for replay.");
    }

    if (typeof entry.original !== "function") {
      throw new Error("Function is not available for replay.");
    }

    const resolvedArgs = directHandlerReplay
      ? resolveDirectHandlerReplayArguments(args, options)
      : resolveReplayArguments(args, options);
    const constructTarget = options && options.constructed ? entry.wrapper || entry.original : null;
    const forcedThis = !constructTarget ? resolveReplayThis(options) : { matched: false, value: null };
    const thisValue = forcedThis.matched
      ? forcedThis.value
      : (entry.lastReplayThisValue && !constructTarget
        ? entry.lastReplayThisValue
        : (entry.kind === "event-listener"
          ? entry.listenerObject || entry.target || window
          : entry.owner || window));
    return callEntry(entry, entry.original, thisValue, resolvedArgs, `${entry.path} replay`, constructTarget);
  }

  function callVariableRefreshFunction(fn, thisValue) {
    if (typeof fn !== "function") {
      return;
    }

    const entry = wrapperEntries && wrapperEntries.get(fn);
    try {
      if (entry && typeof entry.original === "function") {
        invokeOriginalFunction(entry, entry.original, thisValue, [], null);
      } else {
        Reflect.apply(fn, thisValue, []);
      }
    } catch (error) {
      // Variable edits should not fail just because a display refresh hook did.
    }
  }

  function resolveVariablePathOwner(path) {
    const parts = String(path || "").split(".").filter(Boolean);
    if (!parts.length) {
      return null;
    }

    let owner = window;
    for (let index = 0; index < parts.length - 1; index += 1) {
      try {
        owner = owner && owner[parts[index]];
      } catch (error) {
        return null;
      }

      if (!owner || (typeof owner !== "object" && typeof owner !== "function")) {
        return null;
      }
    }

    return {
      key: parts[parts.length - 1],
      owner,
      path: String(path || "")
    };
  }

  function refreshTextDisplayObject(textObject) {
    if (!textObject || (typeof textObject !== "object" && typeof textObject !== "function")) {
      return;
    }

    callVariableRefreshFunction(textObject._updateText, textObject);
    callVariableRefreshFunction(textObject.updateCache, textObject);
  }

  function assignIfWritable(owner, key, value) {
    if (!owner || (typeof owner !== "object" && typeof owner !== "function")) {
      return false;
    }

    try {
      const descriptor = safeGetOwnPropertyDescriptor(owner, key);
      if (descriptor && !descriptor.writable && typeof descriptor.set !== "function") {
        return false;
      }

      owner[key] = value;
      return true;
    } catch (error) {
      return false;
    }
  }

  function splitNameTokens(value) {
    return String(value || "")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .split(/[^A-Za-z0-9_$]+/)
      .map((token) => token.trim().toLowerCase())
      .filter(Boolean);
  }

  function variablePathLeaf(path) {
    const text = String(path || "");
    const parts = text.split(/[.[\]]+/).filter(Boolean);
    return parts[parts.length - 1] || text;
  }

  function relatedNameTokensForEdit(key, path) {
    const leaf = String(key || variablePathLeaf(path));
    const tokens = splitNameTokens(leaf);
    const ignored = new Set([
      "$",
      "_",
      "app",
      "application",
      "current",
      "data",
      "default",
      "global",
      "last",
      "new",
      "next",
      "old",
      "page",
      "prev",
      "previous",
      "root",
      "state",
      "temp",
      "tmp",
      "value",
      "window"
    ]);
    const related = tokens
      .filter((token, index) => token.length >= 3 &&
        !ignored.has(token) &&
        !/^\d+$/.test(token) &&
        (tokens.length === 1 || index === tokens.length - 1 || token.length >= 6));

    if (related.length) {
      return Array.from(new Set(related));
    }

    const normalized = leaf.toLowerCase();
    return normalized.length >= 3 && !ignored.has(normalized) ? [normalized] : [];
  }

  function nameMatchesRelatedToken(name, tokens) {
    const text = String(name || "").toLowerCase();
    return tokens.some((token) => text.includes(token));
  }

  function isProtectedRelatedName(name) {
    return /(?:best|high|max|min|goal|target|required|record)/i.test(String(name || ""));
  }

  function shouldMirrorPrimitiveRelatedValue(owner, key, tokens) {
    if (!nameMatchesRelatedToken(key, tokens) || isProtectedRelatedName(key)) {
      return false;
    }

    try {
      const value = owner && owner[key];
      return value === null ||
        typeof value === "number" ||
        typeof value === "string" ||
        typeof value === "boolean";
    } catch (error) {
      return false;
    }
  }

  function assignSiblingRelatedValues(owner, editedKey, tokens, nextValue) {
    for (const name of prioritizedVariableNames(owner, MAX_VARIABLE_PROPERTIES_PER_OBJECT)) {
      if (name === editedKey || !shouldMirrorPrimitiveRelatedValue(owner, name, tokens)) {
        continue;
      }

      assignIfWritable(owner, name, nextValue);
    }
  }

  function assignNestedRelatedValues(owner, tokens, nextValue) {
    for (const name of prioritizedVariableNames(owner, MAX_VARIABLE_PROPERTIES_PER_OBJECT)) {
      if (!nameMatchesRelatedToken(name, tokens) || isProtectedRelatedName(name)) {
        continue;
      }

      let value;
      try {
        value = owner[name];
      } catch (error) {
        continue;
      }

      if (!value || (typeof value !== "object" && typeof value !== "function")) {
        continue;
      }

      for (const childName of prioritizedVariableNames(value, 60)) {
        if (nameMatchesRelatedToken(childName, tokens) || childName === "value") {
          assignIfWritable(value, childName, nextValue);
        }
      }
    }
  }

  function assignTextRelatedValues(container, tokens, nextValue, depth = 0, seen = null) {
    if (!container || (typeof container !== "object" && typeof container !== "function")) {
      return;
    }

    const visited = seen || (typeof WeakSet === "function" ? new WeakSet() : null);
    if (visited) {
      if (visited.has(container)) {
        return;
      }
      visited.add(container);
    }

    for (const name of prioritizedVariableNames(container, MAX_VARIABLE_PROPERTIES_PER_OBJECT)) {
      if (isProtectedRelatedName(name)) {
        continue;
      }

      let value;
      try {
        value = container[name];
      } catch (error) {
        continue;
      }

      if (value && (typeof value === "object" || typeof value === "function") && nameMatchesRelatedToken(name, tokens) && "text" in value) {
        assignIfWritable(value, "text", String(nextValue));
        refreshTextDisplayObject(value);
      } else if (depth < 1 && value && (typeof value === "object" || typeof value === "function") && canInspectVariableContainer(value)) {
        assignTextRelatedValues(value, tokens, nextValue, depth + 1, visited);
      }
    }
  }

  function relatedValueOwner(owner, tokens) {
    return owner && (typeof owner === "object" || typeof owner === "function") &&
      prioritizedVariableNames(owner, MAX_VARIABLE_PROPERTIES_PER_OBJECT).some((name) => nameMatchesRelatedToken(name, tokens));
  }

  function applyVariableDisplayValueToOwner(owner, key, path, assignedValue) {
    if (!owner || (typeof owner !== "object" && typeof owner !== "function")) {
      return;
    }

    const nextValue = arguments.length >= 4 ? assignedValue : owner[key];
    if (nextValue === undefined) {
      return;
    }

    const tokens = relatedNameTokensForEdit(key, path);
    if (tokens.length) {
      if (relatedValueOwner(owner, tokens)) {
        assignIfWritable(owner, key, nextValue);
        assignSiblingRelatedValues(owner, key, tokens, nextValue);
        assignNestedRelatedValues(owner, tokens, nextValue);
      }
      assignTextRelatedValues(owner, tokens, nextValue);
    }
  }

  function applyVariableDisplayValue(ref, assignedValue) {
    const path = String(ref && ref.path || "");
    const owner = ref && ref.owner;
    try {
      applyVariableDisplayValueToOwner(owner, ref && ref.key, path, assignedValue);
      const resolved = resolveVariablePathOwner(path);
      if (resolved && (resolved.owner !== owner || resolved.key !== (ref && ref.key))) {
        applyVariableDisplayValueToOwner(resolved.owner, resolved.key, path, assignedValue);
      }
    } catch (error) {
      // Some canvas text objects have custom setters; fall back to normal refresh hooks.
    }
  }

  function scheduleVariableDisplayRefresh(ref, assignedValue) {
    const startedAt = Date.now();
    const duration = 2000;
    const refreshKey = String(ref && ref.path || "");
    const refreshToken = state.variableDisplayRefreshSeq + 1;
    state.variableDisplayRefreshSeq = refreshToken;
    if (refreshKey) {
      state.variableDisplayRefreshTokens.set(refreshKey, refreshToken);
    }

    function step() {
      if (refreshKey && state.variableDisplayRefreshTokens.get(refreshKey) !== refreshToken) {
        return;
      }

      applyVariableDisplayValue(ref, assignedValue);
      if (Date.now() - startedAt >= duration) {
        if (refreshKey && state.variableDisplayRefreshTokens.get(refreshKey) === refreshToken) {
          state.variableDisplayRefreshTokens.delete(refreshKey);
        }
        return;
      }

      try {
        if (typeof window.requestAnimationFrame === "function") {
          window.requestAnimationFrame(step);
        } else {
          window.setTimeout(step, 16);
        }
      } catch (error) {
        // Timed display refresh is best effort.
      }
    }

    step();
  }

  function refreshAfterVariableAssignment(ref, assignedValue) {
    const path = String(ref && ref.path || "");
    const tokens = relatedNameTokensForEdit(ref && ref.key, path);
    if (!tokens.length && !/(?:display|label|text|view|ui)/i.test(path)) {
      return;
    }

    const owner = ref && ref.owner;
    if (!owner || (typeof owner !== "object" && typeof owner !== "function")) {
      return;
    }

    applyVariableDisplayValue(ref, assignedValue);

    for (const name of prioritizedVariableNames(owner, MAX_VARIABLE_PROPERTIES_PER_OBJECT)) {
      let value;
      try {
        value = owner[name];
      } catch (error) {
        continue;
      }
      if (value && (typeof value === "object" || typeof value === "function")) {
        callVariableRefreshFunction(value.update, value);
        callVariableRefreshFunction(value.refresh, value);
        callVariableRefreshFunction(value.render, value);
      }
    }

    if (/(?:display|label|text|view|ui)/i.test(path)) {
      callVariableRefreshFunction(owner.update, owner);
      callVariableRefreshFunction(owner.refresh, owner);
      callVariableRefreshFunction(owner.render, owner);
    }

    applyVariableDisplayValue(ref, assignedValue);
    scheduleVariableDisplayRefresh(ref, assignedValue);
  }

  function setVariable(id, value) {
    const ref = state.variableRefs.get(String(id || ""));
    if (!ref) {
      throw new Error("Variable is not available or has not been scanned yet.");
    }

    let descriptor = safeGetOwnPropertyDescriptor(ref.owner, ref.key);
    if (typeof ref.assign === "function") {
      try {
        ref.assign(value);
      } catch (error) {
        throw new Error(`Variable assignment failed: ${error && error.message ? error.message : error}`);
      }
    } else {
      if (!descriptor || (!descriptor.writable && typeof descriptor.set !== "function")) {
        throw new Error("Variable is not writable.");
      }

      try {
        ref.owner[ref.key] = value;
      } catch (error) {
        throw new Error(`Variable assignment failed: ${error && error.message ? error.message : error}`);
      }
    }
    refreshAfterVariableAssignment(ref, value);

    if (typeof ref.read === "function") {
      descriptor = safeGetOwnPropertyDescriptor(ref.owner, ref.key) || {
        configurable: true,
        enumerable: true,
        value,
        writable: true
      };
      rememberVariable(ref.owner, ref.key, ref.path, ref.read(), descriptor, ref.source || "scan", {
        assign: ref.assign,
        canEdit: Boolean(ref.assign) || canEditVariableValue(ref.read(), descriptor),
        read: ref.read
      });
      scanVariables(true);
      return snapshot();
    }

    const updatedDescriptor = safeGetOwnPropertyDescriptor(ref.owner, ref.key);
    if (updatedDescriptor && Object.prototype.hasOwnProperty.call(updatedDescriptor, "value")) {
      rememberVariable(ref.owner, ref.key, ref.path, updatedDescriptor.value, updatedDescriptor, ref.source || "scan");
    }
    scanVariables(true);
    return snapshot();
  }

  function setVariableWatch(enabled, options = {}) {
    state.variableWatchEnabled = Boolean(enabled) && !shouldSkipVariableFrame();

    if (state.variableWatchEnabled) {
      if (options && options.forceScan) {
        scanVariables(true);
      }
    } else {
      state.variableRecords.clear();
      state.variableDisplayRefreshTokens.clear();
      state.variableRefs.clear();
      state.variableObjectIds = typeof WeakMap === "function" ? new WeakMap() : null;
      state.variableObjectSeq = 0;
      state.variableObserveCount = 0;
      state.variableObserveWindowAt = 0;
      state.variableScanAt = 0;
    }

    return snapshot();
  }

  function clear() {
    finishObservedDomEventSequence(state.activeDomEventSequence);
    state.activeDomEventSequence = null;
    state.activeDomEventFrames = [];
    state.buffer = [];
    state.callStack = [];
    state.replayRefs.clear();
    state.replayRefSeq = 0;
    state.networkRecords.clear();
    state.networkSeq = 0;
    state.suppressedEntries.clear();
    state.totalCalls = 0;
    state.frameworkHandlerSeq = 0;
    state.variableRecords.clear();
    state.variableDisplayRefreshTokens.clear();
    state.variableRefs.clear();
    state.variableObjectIds = typeof WeakMap === "function" ? new WeakMap() : null;
    state.variableObjectSeq = 0;
    state.variableObserveCount = 0;
    state.variableObserveWindowAt = 0;
    state.variableScanAt = 0;
    state.variableScanSeq = 0;
    state.seq = 0;
    for (const [id, entry] of Array.from(state.functions)) {
      if (entry.suppressed) {
        state.functions.delete(id);
        continue;
      }

      entry.blockedCount = 0;
      entry.callCount = 0;
      entry.lastCalledAt = "";
    }

    return snapshot();
  }

  function start() {
    if (state.running) {
      refreshSourceIndex();
      scan();
      postFrameSnapshot(true);
      return snapshot();
    }

    state.running = true;
    state.startedAt = nowIso();
    installFrameFeed();
    installFrameCommandListener();
    installEventHooks();
    installNetworkHooks();
    installLibraryEventHooks();
    startLibraryHookPolling();
    refreshSourceIndex();
    window.setTimeout(refreshSourceIndex, 800);
    window.setTimeout(refreshSourceIndex, 2500);
    scan();
    state.scanTimer = window.setInterval(scan, SCAN_INTERVAL_MS);
    postFrameSnapshot(true);
    return snapshot();
  }

  function rescan() {
    refreshSourceIndex();
    const wrapped = scan();
    const current = snapshot();
    current.lastScanWrapped = wrapped;
    return current;
  }

  function stop() {
    state.running = false;
    finishObservedDomEventSequence(state.activeDomEventSequence);
    state.activeDomEventSequence = null;
    state.activeDomEventFrames = [];
    if (state.scanTimer) {
      window.clearInterval(state.scanTimer);
      state.scanTimer = 0;
    }

    for (const entry of state.functions.values()) {
      restoreEntry(entry);
    }

    restoreEventHooks();
    restoreNetworkHooks();
    restoreLibraryEventHooks();

    if (state.nativeFrameCommandListener) {
      window.removeEventListener("message", state.nativeFrameCommandListener, true);
      state.nativeFrameCommandListener = null;
    }

    if (state.nativeFrameFeed && typeof state.nativeFrameFeed.stop === "function") {
      state.nativeFrameFeed.stop();
      state.nativeFrameFeed = null;
    }

    return snapshot();
  }

  window[KEY] = {
    clear,
    drain,
    networkContinue,
    networkReplay,
    refreshSourceIndex,
    replay,
    rescan,
    setDisabled,
    setOptions,
    setVariable,
    setVariableWatch,
    snapshot,
    start,
    stop,
    version: VERSION
  };

  return window[KEY].start();
})();
