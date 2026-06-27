"use strict";

const callTree = document.querySelector("#callTree");
const emptyState = document.querySelector("#emptyState");
const eventsPanel = document.querySelector("#eventsPanel");
const eventsTab = document.querySelector("#eventsTab");
const functionsPanel = document.querySelector("#functionsPanel");
const functionsTab = document.querySelector("#functionsTab");
const functionTable = document.querySelector("#functionTable");
const functionsEmptyState = document.querySelector("#functionsEmptyState");
const favoritesPanel = document.querySelector("#favoritesPanel");
const favoritesTab = document.querySelector("#favoritesTab");
const favoriteTable = document.querySelector("#favoriteTable");
const favoritesEmptyState = document.querySelector("#favoritesEmptyState");
const variablesPanel = document.querySelector("#variablesPanel");
const variablesTab = document.querySelector("#variablesTab");
const variableRefreshButton = document.querySelector("#variableRefreshButton");
const variableSearchInput = document.querySelector("#variableSearchInput");
const variableTable = document.querySelector("#variableTable");
const variablesEmptyState = document.querySelector("#variablesEmptyState");
const statusNode = document.querySelector("#status");
const startButton = document.querySelector("#startButton");
const reloadButton = document.querySelector("#reloadButton");
const stopButton = document.querySelector("#stopButton");
const rescanButton = document.querySelector("#rescanButton");
const downloadButton = document.querySelector("#downloadButton");
const clearButton = document.querySelector("#clearButton");
const filterInput = document.querySelector("#filterInput");
const blacklistInput = document.querySelector("#blacklistInput");
const autoscrollControl = document.querySelector("#autoscrollControl");
const autoscrollInput = document.querySelector("#autoscrollInput");
const hideNoisyControl = document.querySelector("#hideNoisyControl");
const hideNoisyInput = document.querySelector("#hideNoisyInput");
const showMinifiedControl = document.querySelector("#showMinifiedControl");
const showMinifiedInput = document.querySelector("#showMinifiedInput");
const traceHandlersControl = document.querySelector("#traceHandlersControl");
const traceHandlersInput = document.querySelector("#traceHandlersInput");
const safeModeControl = document.querySelector("#safeModeControl");
const safeModeInput = document.querySelector("#safeModeInput");
const continueAfterLimitControl = document.querySelector("#continueAfterLimitControl");
const continueAfterLimitInput = document.querySelector("#continueAfterLimitInput");
const pauseRequestsControl = document.querySelector("#pauseRequestsControl");
const pauseRequestsInput = document.querySelector("#pauseRequestsInput");
const pauseResponsesControl = document.querySelector("#pauseResponsesControl");
const pauseResponsesInput = document.querySelector("#pauseResponsesInput");
const liveVariablesControl = document.querySelector("#liveVariablesControl");
const liveVariablesInput = document.querySelector("#liveVariablesInput");
const callCountNode = document.querySelector("#callCount");
const functionCountNode = document.querySelector("#functionCount");
const variableCountNode = document.querySelector("#variableCount");
const disabledCountNode = document.querySelector("#disabledCount");
const logShell = document.querySelector(".log-shell");
const hintNode = document.querySelector("#hint");
const FRAME_SEPARATOR = "::";
const VARIABLE_FLASH_MS = 1600;
const FUNCTION_FLASH_MS = 1600;
const CALL_GROUP_DISPLAY_LIMIT = 99;
const EVENT_VIRTUAL_THRESHOLD = 900;
const EVENT_VIRTUAL_OVERSCAN_ROWS = 90;
const DEFAULT_EVENT_ROW_HEIGHT = 38;
const TABLE_VIRTUAL_THRESHOLD = 900;
const TABLE_VIRTUAL_OVERSCAN_ROWS = 80;
const DEFAULT_TABLE_ROW_HEIGHT = 38;
const FAVORITES_STORAGE_KEY = "js-disector:favorites:v1";
const FAVORITES_STORAGE_DEBOUNCE_MS = 250;

const state = {
  activeTab: "events",
  blacklistFilter: "",
  callOrder: [],
  captureStatus: null,
  captureStatusAt: 0,
  callsById: new Map(),
  collapsedCallIds: new Set(),
  diagnostics: [],
  disabledIds: new Set(),
  expandedCallIds: new Set(),
  filter: "",
  functionFilter: "",
  functionFlashTimer: 0,
  functionFlashUntil: new Map(),
  callGroupSignatureCache: new Map(),
  callMatchCache: new Map(),
  callRenderRevision: 0,
  favoriteEvents: new Map(),
  favoriteFilter: "",
  favoriteVariables: new Map(),
  frames: new Map(),
  functions: new Map(),
  hiddenFunctionIds: new Set(),
  hideNoisy: true,
  installed: false,
  liveVariables: false,
  monitorSource: "",
  networkRecords: new Map(),
  pauseNetworkRequests: false,
  pauseNetworkResponses: false,
  lastDrainPayloadSize: 0,
  lastRenderDurationMs: 0,
  lastRenderedRowCount: 0,
  lastTotalRenderableRows: 0,
  eventRowHeight: DEFAULT_EVENT_ROW_HEIGHT,
  tableRowHeight: DEFAULT_TABLE_ROW_HEIGHT,
  panelSeq: 0,
  pollTimer: 0,
  pendingChildren: new Map(),
  renderLimit: 5000,
  running: false,
  starredEventIds: new Set(),
  starredVariableIds: new Set(),
  showMinifiedFunctions: true,
  traceEventHandlers: true,
  safeMode: false,
  continueTrackingAfterLimit: false,
  totalCalls: 0,
  collapsedVariableGroups: new Set(),
  variableFilter: "",
  variableFlashTimer: 0,
  variableFlashUntil: new Map(),
  variableValueSearch: "",
  variables: new Map(),
  trees: new Map()
};

let favoritesPersistTimer = 0;
let virtualScrollRenderQueued = false;

function scheduleVirtualScrollRender(view) {
  if (virtualScrollRenderQueued) {
    return;
  }

  virtualScrollRenderQueued = true;
  window.requestAnimationFrame(() => {
    virtualScrollRenderQueued = false;
    if (view === "events" && state.activeTab === "events" && state.lastTotalRenderableRows > EVENT_VIRTUAL_THRESHOLD) {
      render();
    } else if (view === "functions" && state.activeTab === "functions" && state.lastTotalRenderableRows > TABLE_VIRTUAL_THRESHOLD) {
      renderFunctions();
    } else if (view === "variables" && state.activeTab === "variables" && state.lastTotalRenderableRows > TABLE_VIRTUAL_THRESHOLD) {
      renderVariables();
    }
  });
}

function setStatus(text, mode = "idle") {
  statusNode.textContent = text;
  statusNode.classList.toggle("status-live", mode === "live");
  statusNode.classList.toggle("status-error", mode === "error");
}

function formatEvalError(error) {
  if (!error) {
    return "Unknown DevTools error";
  }

  if (error.isError) {
    return `DevTools error: ${error.code}`;
  }

  if (error.isException) {
    return `JavaScript error: ${error.value}`;
  }

  return String(error);
}

async function evalInPage(expression) {
  const [value, error] = await browser.devtools.inspectedWindow.eval(expression);
  if (error) {
    throw new Error(formatEvalError(error));
  }

  return value;
}

function javascreenFrameBridge(action, args) {
  "use strict";

  const KEY = "__JAVASCREEN__";
  const FRAME_SEPARATOR = "::";
  const FRAME_CHANNEL = "__JAVASCREEN_FRAME_CHANNEL__";
  const FRAME_FEED_KEY = "__JAVASCREEN_FRAME_FEED__";
  const MAX_BRIDGE_VARIABLES = 1500;
  const calls = [];
  const disabledIds = [];
  const frames = [];
  const functions = [];
  const network = [];
  const variables = [];
  const target = splitPrefixedId(args && args[0]);
  const canInstallMissingMonitor = action === "install" || action === "drain" || action === "rescan";
  const source = args && typeof args[0] === "string" && canInstallMissingMonitor ? args[0] : "";
  const drainOptions = action === "drain" && args && args[1] && typeof args[1] === "object" ? args[1] : {};
  const aggregate = {
    diagnostics: [],
    frameCount: 0,
    functionCount: 0,
    inaccessibleFrameCount: 0,
    listenerCount: 0,
    running: false,
    sourceIndexStatus: "pending",
    startedAt: "",
    totalCalls: 0,
    variableCount: 0,
    version: ""
  };

  function splitPrefixedId(value) {
    const text = String(value || "");
    const index = text.indexOf(FRAME_SEPARATOR);
    if (index === -1) {
      return {
        framePath: "top",
        rawId: text
      };
    }

    return {
      framePath: text.slice(0, index),
      rawId: text.slice(index + FRAME_SEPARATOR.length)
    };
  }

  function prefixedId(framePath, id) {
    return `${framePath}${FRAME_SEPARATOR}${id}`;
  }

  function frameInfo(win, path) {
    let title = "";
    let url = "";

    try {
      title = win.document && win.document.title ? win.document.title : "";
    } catch (error) {
      title = "";
    }

    try {
      url = String(win.location.href);
    } catch (error) {
      url = "";
    }

    return {
      label: path === "top" ? "top" : `frame ${path.replace(/^top\//, "")}`,
      path,
      title,
      url
    };
  }

  function remoteFrameInfo(message) {
    const info = message && message.frameInfo || {};
    const id = String(message && message.frameId || info.frameId || "unknown");
    return {
      label: info.label || `frame ${id.slice(0, 8)}`,
      path: `remote:${id}`,
      title: info.title || "",
      url: info.url || ""
    };
  }

  function prefixedFunction(fn, frame) {
    return Object.assign({}, fn, {
      frameLabel: frame.label,
      framePath: frame.path,
      frameTitle: frame.title,
      frameUrl: frame.url,
      id: prefixedId(frame.path, fn.id),
      rawId: fn.id
    });
  }

  function prefixedCall(call, frame) {
    const copy = Object.assign({}, call, {
      frameLabel: frame.label,
      framePath: frame.path,
      frameTitle: frame.title,
      frameUrl: frame.url,
      functionId: prefixedId(frame.path, call.functionId),
      id: prefixedId(frame.path, call.id),
      parentCallId: call.parentCallId ? prefixedId(frame.path, call.parentCallId) : null,
      rawFunctionId: call.functionId,
      rawId: call.id,
      rawParentCallId: call.parentCallId,
      rawTreeId: call.treeId,
      treeId: prefixedId(frame.path, call.treeId)
    });
    if (call.network && call.network.id) {
      copy.network = Object.assign({}, call.network, {
        id: prefixedId(frame.path, call.network.id),
        rawId: call.network.id
      });
    }
    return copy;
  }

  function prefixedVariable(variable, frame) {
    return Object.assign({}, variable, {
      frameLabel: frame.label,
      framePath: frame.path,
      frameTitle: frame.title,
      frameUrl: frame.url,
      id: prefixedId(frame.path, variable.id),
      rawId: variable.id
    });
  }

  function prefixedNetwork(record, frame) {
    return Object.assign({}, record, {
      frameLabel: frame.label,
      framePath: frame.path,
      frameTitle: frame.title,
      frameUrl: frame.url,
      id: prefixedId(frame.path, record.id),
      rawId: record.id,
      requestCallId: record.requestCallId ? prefixedId(frame.path, record.requestCallId) : null,
      responseCallId: record.responseCallId ? prefixedId(frame.path, record.responseCallId) : null
    });
  }

  function mergeSnapshot(snapshot, frame) {
    if (!snapshot) {
      return;
    }

    aggregate.frameCount += 1;
    aggregate.functionCount += Number(snapshot.functionCount || 0);
    aggregate.listenerCount += Number(snapshot.listenerCount || 0);
    aggregate.running = aggregate.running || Boolean(snapshot.running);
    aggregate.totalCalls += Number(snapshot.totalCalls || 0);
    aggregate.variableCount += Number(snapshot.variableCount || 0);
    aggregate.version = snapshot.version || aggregate.version;

    if (snapshot.diagnostics) {
      aggregate.diagnostics.push(Object.assign({}, snapshot.diagnostics, {
        frameLabel: frame.label,
        framePath: frame.path,
        frameTitle: frame.title,
        frameUrl: frame.url
      }));
    }

    if (snapshot.startedAt && (!aggregate.startedAt || snapshot.startedAt < aggregate.startedAt)) {
      aggregate.startedAt = snapshot.startedAt;
    }

    if (snapshot.sourceIndexStatus === "ready") {
      aggregate.sourceIndexStatus = "ready";
    } else if (aggregate.sourceIndexStatus !== "ready" && snapshot.sourceIndexStatus) {
      aggregate.sourceIndexStatus = snapshot.sourceIndexStatus;
    }

    for (const id of snapshot.disabledIds || []) {
      disabledIds.push(prefixedId(frame.path, id));
    }

    for (const fn of snapshot.functions || []) {
      functions.push(prefixedFunction(fn, frame));
    }

    for (const variable of snapshot.variables || []) {
      variables.push(prefixedVariable(variable, frame));
    }

    for (const record of snapshot.network || []) {
      network.push(prefixedNetwork(record, frame));
    }
  }

  function mergeFrameMessage(message) {
    if (!message || message.channel !== FRAME_CHANNEL) {
      return;
    }

    const frame = remoteFrameInfo(message);
    frames.push(frame);

    for (const fn of message.functions || []) {
      functions.push(prefixedFunction(fn, frame));
    }

    for (const call of message.calls || []) {
      calls.push(prefixedCall(call, frame));
    }

    mergeSnapshot(message.snapshot, frame);
  }

  function drainFrameFeed(win) {
    let feed = null;
    try {
      feed = win[FRAME_FEED_KEY];
    } catch (error) {
      return false;
    }

    if (!feed || typeof feed.drain !== "function") {
      return false;
    }

    const messages = feed.drain() || [];
    for (const message of messages) {
      mergeFrameMessage(message);
    }

    return true;
  }

  function postCommandToChildren(win, actionName, commandArgs, targetFrameId) {
    const message = {
      action: actionName,
      args: commandArgs || [],
      channel: FRAME_CHANNEL,
      targetFrameId: targetFrameId || "",
      type: "command"
    };

    let length = 0;
    try {
      length = win.frames.length;
    } catch (error) {
      return;
    }

    for (let index = 0; index < length; index += 1) {
      try {
        win.frames[index].postMessage(message, "*");
      } catch (error) {
        // The frame may be gone or not messageable.
      }
    }
  }

  function monitorSnapshot(win, frame) {
    try {
      const monitor = win[KEY];
      return monitor && typeof monitor.snapshot === "function" ? monitor.snapshot() : null;
    } catch (error) {
      return null;
    }
  }

  function shouldApplyMonitorOptions(monitor, options) {
    if (!monitor || !options || typeof monitor.snapshot !== "function") {
      return false;
    }

    try {
      const current = monitor.snapshot({
        includeFunctions: false,
        includeNetwork: false,
        includeVariables: false
      });
      const currentOptions = current && current.diagnostics && current.diagnostics.options || {};
      return Boolean(currentOptions.captureMinifiedFunctions) !== Boolean(options.captureMinifiedFunctions) ||
        Boolean(currentOptions.continueTrackingAfterLimit) !== Boolean(options.continueTrackingAfterLimit) ||
        Boolean(currentOptions.pauseNetworkRequests) !== Boolean(options.pauseNetworkRequests) ||
        Boolean(currentOptions.pauseNetworkResponses) !== Boolean(options.pauseNetworkResponses) ||
        Boolean(currentOptions.safeMode) !== Boolean(options.safeMode) ||
        Boolean(currentOptions.wrapDomEventListeners) !== Boolean(options.wrapDomEventListeners);
    } catch (error) {
      return true;
    }
  }

  function syncMonitorOptionsForDrain(monitor) {
    const options = drainOptions && drainOptions.monitorOptions || null;
    if (options && typeof monitor.setOptions === "function" && shouldApplyMonitorOptions(monitor, options)) {
      monitor.setOptions(options);
    }
  }

  function runAction(win, frame) {
    let monitor = null;

    try {
      monitor = win[KEY];
    } catch (error) {
      return;
    }

    if (canInstallMissingMonitor && source && (action === "install" || !monitor)) {
      try {
        win.eval(source);
        monitor = win[KEY];
      } catch (error) {
        monitor = win[KEY];
      }
    }

    if (!monitor) {
      return;
    }

    if (action === "drain" && typeof monitor.drain === "function") {
      syncMonitorOptionsForDrain(monitor);
      const payload = monitor.drain(drainOptions);
      for (const call of payload.calls || []) {
        calls.push(prefixedCall(call, frame));
      }
      mergeSnapshot(payload.snapshot, frame);
      return;
    }

    if (action === "setDisabled" && target.framePath.startsWith("remote:") && frame.path === "top") {
      postCommandToChildren(win, "setDisabled", [target.rawId, Boolean(args[1])], target.framePath.slice("remote:".length));
      mergeSnapshot(monitorSnapshot(win, frame), frame);
      return;
    }

    if (action === "setDisabled" && frame.path === target.framePath && typeof monitor.setDisabled === "function") {
      monitor.setDisabled(target.rawId, Boolean(args[1]));
      mergeSnapshot(monitorSnapshot(win, frame), frame);
      return;
    }

    if (action === "replay" && target.framePath.startsWith("remote:") && frame.path === "top") {
      postCommandToChildren(win, "replay", [target.rawId, Array.isArray(args[1]) ? args[1] : [], args[2] || {}], target.framePath.slice("remote:".length));
      mergeSnapshot(monitorSnapshot(win, frame), frame);
      return;
    }

    if (action === "replay" && frame.path === target.framePath && typeof monitor.replay === "function") {
      monitor.replay(target.rawId, Array.isArray(args[1]) ? args[1] : [], args[2] || {});
      mergeSnapshot(monitorSnapshot(win, frame), frame);
      return;
    }

    if (action === "setVariable" && target.framePath.startsWith("remote:") && frame.path === "top") {
      postCommandToChildren(win, "setVariable", [target.rawId, args[1]], target.framePath.slice("remote:".length));
      mergeSnapshot(monitorSnapshot(win, frame), frame);
      return;
    }

    if (action === "setVariable" && frame.path === target.framePath && typeof monitor.setVariable === "function") {
      monitor.setVariable(target.rawId, args[1]);
      mergeSnapshot(monitorSnapshot(win, frame), frame);
      return;
    }

    if (action === "networkContinue" && target.framePath.startsWith("remote:") && frame.path === "top") {
      postCommandToChildren(win, "networkContinue", [target.rawId, args[1], args[2] || {}], target.framePath.slice("remote:".length));
      mergeSnapshot(monitorSnapshot(win, frame), frame);
      return;
    }

    if (action === "networkContinue" && frame.path === target.framePath && typeof monitor.networkContinue === "function") {
      monitor.networkContinue(target.rawId, args[1], args[2] || {});
      mergeSnapshot(monitorSnapshot(win, frame), frame);
      return;
    }

    if (action === "networkReplay" && target.framePath.startsWith("remote:") && frame.path === "top") {
      postCommandToChildren(win, "networkReplay", [target.rawId, args[1] || {}], target.framePath.slice("remote:".length));
      mergeSnapshot(monitorSnapshot(win, frame), frame);
      return;
    }

    if (action === "networkReplay" && frame.path === target.framePath && typeof monitor.networkReplay === "function") {
      monitor.networkReplay(target.rawId, args[1] || {});
      mergeSnapshot(monitorSnapshot(win, frame), frame);
      return;
    }

    if (action === "setVariableWatch" && typeof monitor.setVariableWatch === "function") {
      if (frame.path === "top") {
        postCommandToChildren(win, "setVariableWatch", [Boolean(args[0]), args[1] || {}]);
      }
      monitor.setVariableWatch(Boolean(args[0]), args[1] || {});
      mergeSnapshot(monitorSnapshot(win, frame), frame);
      return;
    }

    if (action === "setOptions" && typeof monitor.setOptions === "function") {
      if (frame.path === "top") {
        postCommandToChildren(win, "setOptions", [args[0] || {}]);
      }
      monitor.setOptions(args[0] || {});
      mergeSnapshot(monitorSnapshot(win, frame), frame);
      return;
    }

    if (action === "clear" && typeof monitor.clear === "function") {
      if (frame.path === "top") {
        postCommandToChildren(win, "clear", []);
      }
      monitor.clear();
      mergeSnapshot(monitorSnapshot(win, frame), frame);
      return;
    }

    if (action === "stop" && typeof monitor.stop === "function") {
      if (frame.path === "top") {
        postCommandToChildren(win, "stop", []);
      }
      monitor.stop();
      mergeSnapshot(monitorSnapshot(win, frame), frame);
      return;
    }

    if (action === "rescan" && typeof monitor.rescan === "function") {
      if (frame.path === "top") {
        postCommandToChildren(win, "rescan", []);
      }
      monitor.rescan();
      mergeSnapshot(monitorSnapshot(win, frame), frame);
      return;
    }

    mergeSnapshot(monitorSnapshot(win, frame), frame);
  }

  function visit(win, path, includeChildren) {
    const frame = frameInfo(win, path);
    frames.push(frame);
    runAction(win, frame);

    if (!includeChildren) {
      return;
    }

    let length = 0;
    try {
      length = win.frames.length;
    } catch (error) {
      aggregate.inaccessibleFrameCount += 1;
      return;
    }

    for (let index = 0; index < length; index += 1) {
      try {
        visit(win.frames[index], `${path}/${index}`, includeChildren);
      } catch (error) {
        aggregate.inaccessibleFrameCount += 1;
      }
    }
  }

  visit(window, "top", true);

  if (action === "drain") {
    drainFrameFeed(window);
  }

  const variableById = new Map();
  for (const variable of variables) {
    variableById.set(variable.id, variable);
  }
  const cappedVariables = Array.from(variableById.values())
    .sort((first, second) => {
      const importance = Number(second.importance || 0) - Number(first.importance || 0);
      if (importance) {
        return importance;
      }
      const changed = String(second.lastChangedAt || "").localeCompare(String(first.lastChangedAt || ""));
      if (changed) {
        return changed;
      }
      return String(first.path || "").localeCompare(String(second.path || ""));
    })
    .slice(0, MAX_BRIDGE_VARIABLES);
  if (variables.length) {
    aggregate.variableCount = cappedVariables.length;
  }

  return {
    calls,
    snapshot: Object.assign({}, aggregate, {
      disabledIds,
      frames,
      functions,
      network,
      variables: cappedVariables
    })
  };
}

function bridgeExpression(action, args = []) {
  return `(${javascreenFrameBridge.toString()})(${JSON.stringify(action)},${JSON.stringify(args)})`;
}

async function loadMonitorSource() {
  if (!state.monitorSource) {
    const response = await fetch("injected-monitor.js");
    state.monitorSource = `${await response.text()}\n//# sourceURL=javascreen-injected-monitor.js`;
  }

  return state.monitorSource;
}

async function installMonitor() {
  await setTabCaptureEnabled(true);
  const source = await loadMonitorSource();
  const payload = await evalInPage(bridgeExpression("install", [source]));
  let snapshot = payload && payload.snapshot;
  state.installed = true;
  if (state.showMinifiedFunctions || state.traceEventHandlers || state.safeMode || state.continueTrackingAfterLimit) {
    const optionsPayload = await evalInPage(bridgeExpression("setOptions", [monitorOptions()]));
    snapshot = optionsPayload && optionsPayload.snapshot || snapshot;
  }
  applySnapshot(snapshot);
  setStatus(snapshot && snapshot.running ? "Live" : "Idle", snapshot && snapshot.running ? "live" : "idle");
  return snapshot;
}

function monitorOptions() {
  return {
    captureMinifiedFunctions: Boolean(state.showMinifiedFunctions),
    wrapDomEventListeners: Boolean(state.traceEventHandlers),
    safeMode: Boolean(state.safeMode),
    continueTrackingAfterLimit: Boolean(state.continueTrackingAfterLimit),
    pauseNetworkRequests: Boolean(state.pauseNetworkRequests),
    pauseNetworkResponses: Boolean(state.pauseNetworkResponses)
  };
}

async function callMonitor(method, args = []) {
  if (!state.installed) {
    throw new Error("JS Disector capture is not started.");
  }

  const drainOptions = Object.assign({}, args && args[0] || {}, {
    monitorOptions: monitorOptions()
  });
  const bridgeArgs = method === "drain"
    ? [await loadMonitorSource(), drainOptions]
    : method === "rescan"
      ? [await loadMonitorSource()]
      : args;
  const payload = await evalInPage(bridgeExpression(method, bridgeArgs));
  return method === "drain" ? payload : payload && payload.snapshot;
}

async function setTabCaptureEnabled(enabled) {
  try {
    const response = await browser.runtime.sendMessage({
      tabId: browser.devtools.inspectedWindow.tabId,
      type: enabled ? "javascreen-enable-tab" : "javascreen-disable-tab"
    });
    state.captureStatusAt = 0;
    await refreshCaptureStatus(true);
    return response;
  } catch (error) {
    // The DevTools eval bridge still works for same-origin pages and frames.
    return null;
  }
}

async function refreshCaptureStatus(force = false) {
  const now = Date.now();
  if (!force && now - state.captureStatusAt < 2000) {
    return state.captureStatus;
  }

  state.captureStatusAt = now;

  try {
    state.captureStatus = await browser.runtime.sendMessage({
      tabId: browser.devtools.inspectedWindow.tabId,
      type: "javascreen-capture-status"
    });
  } catch (error) {
    state.captureStatus = null;
  }

  return state.captureStatus;
}

function variableValueSignature(variable) {
  return [
    variable && variable.kind || "",
    variable && variable.displayValue || "",
    Object.prototype.hasOwnProperty.call(variable || {}, "value") ? JSON.stringify(variable.value) : ""
  ].join("\u0000");
}

function didVariableChange(previous, next) {
  if (!previous || !next) {
    return false;
  }

  return variableValueSignature(previous) !== variableValueSignature(next);
}

function trimExpiredVariableFlashes() {
  const now = Date.now();
  let active = 0;

  for (const [id, until] of Array.from(state.variableFlashUntil)) {
    if (until <= now) {
      state.variableFlashUntil.delete(id);
    } else {
      active += 1;
    }
  }

  return active;
}

function scheduleVariableFlashRender() {
  if (state.variableFlashTimer) {
    return;
  }

  state.variableFlashTimer = window.setTimeout(() => {
    state.variableFlashTimer = 0;
    const active = trimExpiredVariableFlashes();
    if (state.activeTab === "variables") {
      renderVariables();
    } else if (state.activeTab === "favorites") {
      renderFavorites();
    }
    if (active) {
      scheduleVariableFlashRender();
    }
  }, VARIABLE_FLASH_MS + 40);
}

function markVariableUpdated(id) {
  if (!id) {
    return;
  }

  state.variableFlashUntil.set(id, Date.now() + VARIABLE_FLASH_MS);
  scheduleVariableFlashRender();
}

function isVariableUpdated(id) {
  const until = state.variableFlashUntil.get(id);
  if (!until) {
    return false;
  }

  if (until <= Date.now()) {
    state.variableFlashUntil.delete(id);
    return false;
  }

  return true;
}

function trimExpiredFunctionFlashes() {
  const now = Date.now();
  let active = 0;

  for (const [id, until] of Array.from(state.functionFlashUntil)) {
    if (until <= now) {
      state.functionFlashUntil.delete(id);
    } else {
      active += 1;
    }
  }

  return active;
}

function scheduleFunctionFlashRender() {
  if (state.functionFlashTimer) {
    return;
  }

  state.functionFlashTimer = window.setTimeout(() => {
    state.functionFlashTimer = 0;
    const active = trimExpiredFunctionFlashes();
    if (state.activeTab === "functions") {
      renderFunctions();
    } else if (state.activeTab === "favorites") {
      renderFavorites();
    }
    if (active) {
      scheduleFunctionFlashRender();
    }
  }, FUNCTION_FLASH_MS + 40);
}

function markFunctionUpdated(id) {
  if (!id) {
    return;
  }

  state.functionFlashUntil.set(id, Date.now() + FUNCTION_FLASH_MS);
  scheduleFunctionFlashRender();
}

function isFunctionUpdated(id) {
  const until = state.functionFlashUntil.get(id);
  if (!until) {
    return false;
  }

  if (until <= Date.now()) {
    state.functionFlashUntil.delete(id);
    return false;
  }

  return true;
}

function renderActiveView() {
  if (state.activeTab === "variables") {
    renderVariables();
  } else if (state.activeTab === "functions") {
    renderFunctions();
  } else if (state.activeTab === "favorites") {
    renderFavorites();
  } else {
    render();
  }
}

function invalidateCallRenderCache() {
  state.callRenderRevision += 1;
  state.callGroupSignatureCache.clear();
  state.callMatchCache.clear();
}

function approximatePayloadSize(payload) {
  try {
    return JSON.stringify(payload || {}).length;
  } catch (error) {
    return 0;
  }
}

function steadyDrainOptions(options = {}) {
  const wantsVariables = Boolean(options.updateVariables || state.liveVariables || state.activeTab === "variables");
  return {
    includeFunctions: "changed",
    includeNetwork: "changed",
    includeVariables: wantsVariables
  };
}

function applySnapshot(snapshot, options = {}) {
  if (!snapshot) {
    return {
      functionsChanged: false,
      networkChanged: false,
      variablesChanged: false
    };
  }

  const preserveEmptyVariables = Boolean(options.preserveEmptyVariables);
  const deferRender = Boolean(options.deferRender);
  const updateVariables = options.updateVariables !== false;
  let functionsChanged = false;
  let networkChanged = false;
  let replacedVariables = false;
  state.running = Boolean(snapshot.running);
  state.diagnostics = Array.isArray(snapshot.diagnostics) ? snapshot.diagnostics : [];
  state.totalCalls = Number(snapshot.totalCalls || state.totalCalls || 0);
  state.disabledIds = new Set(snapshot.disabledIds || []);
  for (const frame of snapshot.frames || []) {
    state.frames.set(frame.path || frame.framePath || frame.label || state.frames.size, frame);
  }
  for (const fn of snapshot.functions || []) {
    state.functions.set(fn.id, fn);
    functionsChanged = true;
  }
  const snapshotOptions = snapshot.diagnostics && snapshot.diagnostics.options || {};
  if (Object.prototype.hasOwnProperty.call(snapshotOptions, "continueTrackingAfterLimit")) {
    state.continueTrackingAfterLimit = Boolean(snapshotOptions.continueTrackingAfterLimit);
  }
  if (Object.prototype.hasOwnProperty.call(snapshotOptions, "captureMinifiedFunctions")) {
    state.showMinifiedFunctions = Boolean(snapshotOptions.captureMinifiedFunctions);
  }
  if (Object.prototype.hasOwnProperty.call(snapshotOptions, "wrapDomEventListeners")) {
    state.traceEventHandlers = Boolean(snapshotOptions.wrapDomEventListeners);
  }
  if (Object.prototype.hasOwnProperty.call(snapshotOptions, "safeMode")) {
    state.safeMode = Boolean(snapshotOptions.safeMode);
  }
  if (Object.prototype.hasOwnProperty.call(snapshotOptions, "pauseNetworkRequests")) {
    state.pauseNetworkRequests = Boolean(snapshotOptions.pauseNetworkRequests);
  }
  if (Object.prototype.hasOwnProperty.call(snapshotOptions, "pauseNetworkResponses")) {
    state.pauseNetworkResponses = Boolean(snapshotOptions.pauseNetworkResponses);
  }
  if (Array.isArray(snapshot.network)) {
    for (const record of snapshot.network) {
      if (record && record.id) {
        state.networkRecords.set(record.id, record);
        networkChanged = true;
      }
    }
  }
  if (updateVariables && Array.isArray(snapshot.variables) && (!preserveEmptyVariables || snapshot.variables.length > 0 || state.variables.size === 0)) {
    const nextVariables = new Map();
    let favoriteVariablesChanged = false;
    for (const variable of snapshot.variables) {
      const previous = state.variables.get(variable.id);
      if (didVariableChange(previous, variable)) {
        markVariableUpdated(variable.id);
      }
      nextVariables.set(variable.id, variable);
      if (state.starredVariableIds.has(variable.id)) {
        const previousFavorite = state.favoriteVariables.get(variable.id);
        if (!previousFavorite || didVariableChange(previousFavorite, variable)) {
          favoriteVariablesChanged = true;
        }
        state.favoriteVariables.set(variable.id, cloneFavoriteVariable(variable));
      }
    }
    if (favoriteVariablesChanged) {
      schedulePersistFavorites();
    }
    state.variables = nextVariables;
    replacedVariables = true;
  }

  functionCountNode.textContent = String(snapshot.functionCount || state.functions.size);
  const variableCount = Number(snapshot.variableCount);
  variableCountNode.textContent = String(replacedVariables && Number.isFinite(variableCount) ? variableCount : state.variables.size);
  disabledCountNode.textContent = String(state.disabledIds.size);
  callCountNode.textContent = String(state.totalCalls);
  startButton.disabled = state.running;
  reloadButton.disabled = false;
  stopButton.disabled = !state.running;
  if (deferRender) {
    return {
      functionsChanged,
      networkChanged,
      variablesChanged: replacedVariables
    };
  }

  if (state.activeTab === "variables") {
    renderVariables();
  } else if (state.activeTab === "functions") {
    renderFunctions();
  } else if (state.activeTab === "favorites") {
    renderFavorites();
  }
  return {
    functionsChanged,
    networkChanged,
    variablesChanged: replacedVariables
  };
}

function applyDrain(payload, options = {}) {
  if (!payload) {
    return;
  }

  state.lastDrainPayloadSize = approximatePayloadSize(payload);
  let snapshotResult = {
    functionsChanged: false,
    networkChanged: false,
    variablesChanged: false
  };
  if (payload.snapshot) {
    snapshotResult = applySnapshot(payload.snapshot, {
      deferRender: true,
      preserveEmptyVariables: true,
      updateVariables: Boolean(options.updateVariables || state.liveVariables)
    });
  }

  const calls = payload.calls || [];
  if (!calls.length) {
    if (snapshotResult.variablesChanged && (state.activeTab === "variables" || state.activeTab === "favorites")) {
      renderActiveView();
    } else if ((snapshotResult.functionsChanged || snapshotResult.networkChanged) && state.activeTab === "functions") {
      renderFunctions();
    }
    return;
  }

  for (const call of calls) {
    if (!isInternalCall(call)) {
      insertCall(call);
    }
  }

  pruneOldCalls();
  if (state.activeTab === "functions") {
    renderFunctions();
  } else {
    render();
  }
}

function insertCall(call) {
  if (state.callsById.has(call.id)) {
    return;
  }

  invalidateCallRenderCache();
  if (call.network && call.network.id && !state.networkRecords.has(call.network.id)) {
    state.networkRecords.set(call.network.id, {
      id: call.network.id,
      paused: Boolean(call.network.paused),
      pausedPhase: call.network.paused ? call.network.phase : "",
      protocol: call.network.protocol || "",
      request: {
        method: call.network.method || "",
        url: call.network.url || ""
      },
      response: call.network.phase === "response" ? {
        status: call.network.status || 0
      } : null
    });
  }

  state.panelSeq += 1;
  const node = {
    ...call,
    children: [],
    panelSeq: state.panelSeq
  };
  const parent = call.parentCallId ? state.callsById.get(call.parentCallId) : null;
  let tree = state.trees.get(call.treeId);

  if (!tree) {
    tree = {
      callCount: 0,
      id: call.treeId,
      lastSeq: node.panelSeq,
      lastTime: call.time,
      rootCallIds: []
    };
    state.trees.set(call.treeId, tree);
  }

  state.callsById.set(node.id, node);
  markFunctionUpdated(node.functionId);

  if (parent) {
    appendChild(parent, node);
  } else {
    tree.rootCallIds.push(node.id);
    if (node.parentCallId) {
      addPendingChild(node.parentCallId, node.id);
    }
  }

  tree.callCount += 1;
  tree.lastSeq = node.panelSeq;
  tree.lastTime = call.time;
  state.callOrder.push(node.id);
  attachPendingChildren(node);
}

function appendChild(parent, child) {
  if (!parent.children.some((node) => node.id === child.id)) {
    parent.children.push(child);
    parent.children.sort((first, second) => first.panelSeq - second.panelSeq);
  }
}

function addPendingChild(parentId, childId) {
  const children = state.pendingChildren.get(parentId) || [];
  if (!children.includes(childId)) {
    children.push(childId);
    state.pendingChildren.set(parentId, children);
  }
}

function removePendingChild(parentId, childId) {
  const children = state.pendingChildren.get(parentId);
  if (!children) {
    return;
  }

  const remaining = children.filter((id) => id !== childId);
  if (remaining.length) {
    state.pendingChildren.set(parentId, remaining);
  } else {
    state.pendingChildren.delete(parentId);
  }
}

function attachPendingChildren(parent) {
  const children = state.pendingChildren.get(parent.id);
  if (!children || !children.length) {
    return;
  }

  const tree = state.trees.get(parent.treeId);
  for (const childId of children) {
    const child = state.callsById.get(childId);
    if (!child || child.parentCallId !== parent.id) {
      continue;
    }

    if (tree) {
      tree.rootCallIds = tree.rootCallIds.filter((id) => id !== child.id);
    }
    appendChild(parent, child);
  }

  state.pendingChildren.delete(parent.id);
}

function removeFromParentOrTree(node) {
  const tree = state.trees.get(node.treeId);
  const parent = node.parentCallId ? state.callsById.get(node.parentCallId) : null;

  if (parent) {
    parent.children = parent.children.filter((child) => child.id !== node.id);
  } else if (tree) {
    tree.rootCallIds = tree.rootCallIds.filter((id) => id !== node.id);
  }

  if (node.parentCallId) {
    removePendingChild(node.parentCallId, node.id);
  }
  state.pendingChildren.delete(node.id);
}

function removeNodeAndChildren(id) {
  const node = state.callsById.get(id);
  if (!node) {
    return 0;
  }

  let removed = 1;
  for (const child of [...node.children]) {
    removed += removeNodeAndChildren(child.id);
  }

  removeFromParentOrTree(node);
  state.callsById.delete(id);
  state.expandedCallIds.delete(id);

  const tree = state.trees.get(node.treeId);
  if (tree) {
    tree.callCount = Math.max(0, tree.callCount - 1);
    tree.rootCallIds = tree.rootCallIds.filter((rootId) => state.callsById.has(rootId));
    if (!tree.rootCallIds.length) {
      state.trees.delete(tree.id);
    }
  }

  return removed;
}

function collectNodeIds(node, ids = new Set()) {
  if (!node || ids.has(node.id)) {
    return ids;
  }

  ids.add(node.id);
  for (const child of node.children || []) {
    collectNodeIds(child, ids);
  }
  return ids;
}

function removeTreeAndChildren(treeId) {
  const tree = state.trees.get(treeId);
  if (!tree) {
    return new Set();
  }

  const ids = new Set();
  for (const rootId of [...tree.rootCallIds]) {
    const root = state.callsById.get(rootId);
    if (root) {
      collectNodeIds(root, ids);
      removeNodeAndChildren(rootId);
    }
  }

  state.trees.delete(treeId);
  return ids;
}

function pruneOldCalls() {
  while (state.callOrder.length > state.renderLimit && state.trees.size > 1) {
    const oldestId = state.callOrder.find((id) => state.callsById.has(id));
    const oldest = oldestId ? state.callsById.get(oldestId) : null;
    if (!oldest) {
      state.callOrder = state.callOrder.filter((id) => state.callsById.has(id));
      break;
    }

    const removedIds = removeTreeAndChildren(oldest.treeId);
    state.callOrder = state.callOrder.filter((id) => !removedIds.has(id) && state.callsById.has(id));
  }
}

async function poll(options = {}) {
  try {
    const payload = await callMonitor("drain", [steadyDrainOptions(options)]);
    await refreshCaptureStatus();
    if (!payload) {
      return;
    }

    applyDrain(payload, options);
    updateHint(payload.snapshot);
    setStatus(state.running ? "Live" : "Idle", state.running ? "live" : "idle");
  } catch (error) {
    await refreshCaptureStatus(true);
    updateHint(null);
    setStatus("Page unavailable", "error");
  }
}

function startPolling() {
  if (state.pollTimer) {
    return;
  }

  state.pollTimer = window.setInterval(poll, 1000);
}

function stopPolling() {
  if (!state.pollTimer) {
    return;
  }

  window.clearInterval(state.pollTimer);
  state.pollTimer = 0;
}

function resetLocalLog() {
  state.callOrder = [];
  state.callsById.clear();
  state.collapsedCallIds.clear();
  state.disabledIds = new Set();
  state.expandedCallIds.clear();
  state.frames.clear();
  state.functions.clear();
  state.functionFlashUntil.clear();
  invalidateCallRenderCache();
  state.networkRecords.clear();
  state.panelSeq = 0;
  state.pendingChildren.clear();
  state.totalCalls = 0;
  state.collapsedVariableGroups.clear();
  state.trees.clear();
  state.variables.clear();
  callCountNode.textContent = "0";
  functionCountNode.textContent = "0";
  variableCountNode.textContent = "0";
  disabledCountNode.textContent = "0";
  render();
  renderFunctions();
  renderVariables();
}

function latestBackgroundReport(reports) {
  for (let index = reports.length - 1; index >= 0; index -= 1) {
    if (reports[index] && reports[index].status === "background-enable") {
      return reports[index];
    }
  }

  return null;
}

function captureStatusHint(snapshot) {
  const status = state.captureStatus;
  const reports = status && Array.isArray(status.reports) ? status.reports : [];
  const background = latestBackgroundReport(reports);
  const registration = background && background.registration;
  const existingFrames = background && background.existingFrames;

  if (registration && registration.registered === false) {
    return registration.error || "Frame capture could not register future-frame injection in this Firefox context.";
  }

  if (existingFrames && existingFrames.injected === false && !reports.some((report) => report.status === "monitor-started")) {
    return `Could not inject into existing frames: ${existingFrames.error || "Firefox blocked this page or frame"}. Try Reload + Capture after reloading the add-on.`;
  }

  const frameKeys = new Set();
  let failed = 0;
  let started = 0;

  for (const report of reports) {
    if (!report || report.status === "background-enable") {
      continue;
    }

    frameKeys.add(`${report.frameId || ""}|${report.href || ""}|${report.top ? "top" : "child"}`);

    if (report.status === "monitor-started") {
      started += 1;
    } else if (report.status === "monitor-failed") {
      failed += 1;
    }
  }

  if (failed && !started) {
    return `Frame capture failed in ${failed} frame${failed === 1 ? "" : "s"}. Reload the temporary add-on, then use Reload + Capture before testing clicks.`;
  }

  if (snapshot && Number(snapshot.totalCalls || 0) === 0 && started > 0) {
    const frameCount = frameKeys.size || started;
    return `Frame capture is active in ${frameCount} frame${frameCount === 1 ? "" : "s"}. Use Reload + Capture and wait for the page content to reload before pressing buttons.`;
  }

  if (snapshot && Number(snapshot.totalCalls || 0) === 0 && status && status.enabled && reports.length === 0) {
    return "Frame capture is enabled, but no content-script reports have arrived yet. Reload the temporary add-on after this update, then use Reload + Capture.";
  }

  return "";
}

function updateHint(snapshot) {
  const captureHint = captureStatusHint(snapshot);
  if (captureHint) {
    hintNode.hidden = false;
    hintNode.textContent = captureHint;
    return;
  }

  if (!snapshot) {
    hintNode.hidden = true;
    hintNode.textContent = "";
    return;
  }

  if (snapshot.listenerCount === 0 && state.totalCalls > 0) {
    hintNode.hidden = false;
    hintNode.textContent = state.safeMode
      ? "Safe mode is active: input/event listeners are observed without wrapping, so pages keep receiving clicks normally. Turn Safe mode off, then use Reload + Capture, to expose more handler-local call trees."
      : state.traceEventHandlers
        ? "Trace event handlers is active. If this page registered handlers before capture started, use Reload + Capture so JS Disector can wrap them during page load."
        : "Trace event handlers is off. Turn it on, then use Reload + Capture, to expose handler-local call trees on pages where clicks only show observed events.";
    return;
  }

  hintNode.hidden = true;
  hintNode.textContent = "";
}

function formatTime(iso) {
  if (!iso) {
    return "";
  }

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }

  return date.toLocaleTimeString([], {
    fractionalSecondDigits: 3,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
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

function sourceLabel(source) {
  if (!source || !source.url) {
    return "Unknown";
  }

  const line = source.line ? `:${source.line}` : "";
  const column = source.column ? `:${source.column}` : "";
  return `${fileLabel(source.url)}${line}${column}`;
}

function sourceHref(source) {
  if (!source || !source.url) {
    return "";
  }

  if (source.line) {
    return `${source.url}#L${source.line}`;
  }

  return source.url;
}

function callSearchText(call) {
  const fn = state.functions.get(call.functionId) || {};
  return [
    displayFunctionName(call, fn),
    call.name,
    call.path,
    call.note,
    call.error,
    fn.name,
    fn.path,
    sourceLabel(call.source || call.callSite || fn.source),
    ...(call.args || [])
  ].join(" ").toLowerCase();
}

function isInternalCall(call) {
  const text = [
    call.functionId,
    call.name,
    call.path,
    call.rawFunctionId,
    call.rawId
  ].join(" ").toLowerCase();
  return text.includes("__javascreen");
}

function callNameText(call) {
  const fn = state.functions.get(call.functionId) || {};
  return [
    displayFunctionName(call, fn),
    call.name,
    call.path,
    fn.name,
    fn.path
  ].join(" ").toLowerCase();
}

function blacklistTerms() {
  const terms = [];
  const pattern = /"((?:\\.|[^"\\])*)"|[^\s,]+/g;
  let match = pattern.exec(state.blacklistFilter);

  while (match) {
    const raw = match[1] === undefined ? match[0] : match[1];
    const term = raw.replace(/\\(["\\])/g, "$1").trim().toLowerCase();
    if (term) {
      terms.push(term);
    }
    match = pattern.exec(state.blacklistFilter);
  }

  return terms;
}

function callMatchesFilter(call) {
  return !state.filter || callSearchText(call).includes(state.filter);
}

function callMatchesFunctionFilter(call) {
  return !state.functionFilter || callSearchText(call).includes(state.functionFilter);
}

function isBlacklistedCall(call) {
  const terms = blacklistTerms();
  if (!terms.length) {
    return false;
  }

  const haystack = callNameText(call);
  return terms.some((term) => haystack.includes(term));
}

function callSuppressionMergeKey(call) {
  const fn = state.functions.get(call && call.functionId) || {};
  return [
    call && call.framePath || fn.framePath || "",
    call && call.path || fn.path || "",
    call && call.name || fn.name || ""
  ].join("\u0000");
}

function functionSuppressionMergeKey(fn) {
  return [
    fn && fn.framePath || "",
    fn && fn.path || "",
    fn && fn.name || ""
  ].join("\u0000");
}

function isAutoLimitSuppressionNotice(call) {
  return Boolean(call && call.suppressed) &&
    /already been logged\s+99\+\s+times/i.test(String(call.note || call.args && call.args[0] || ""));
}

function isAutoLimitSuppressionFunction(fn) {
  return Boolean(fn && fn.suppressed) &&
    /already been logged\s+99\+\s+times/i.test(String(fn.note || ""));
}

function hasMatchingUnsuppressedCall(call) {
  const key = callSuppressionMergeKey(call);
  if (!key.replace(/\u0000/g, "")) {
    return false;
  }

  for (const candidate of state.callsById.values()) {
    if (!candidate || candidate === call || candidate.suppressed) {
      continue;
    }

    if (callSuppressionMergeKey(candidate) === key) {
      return true;
    }
  }

  return false;
}

function hasMergedLimitSuppression(call) {
  if (!call || call.suppressed) {
    return false;
  }

  const key = callSuppressionMergeKey(call);
  if (!key.replace(/\u0000/g, "")) {
    return false;
  }

  for (const candidate of state.callsById.values()) {
    if (candidate !== call &&
        isAutoLimitSuppressionNotice(candidate) &&
        callSuppressionMergeKey(candidate) === key) {
      return true;
    }
  }

  for (const fn of state.functions.values()) {
    if (isAutoLimitSuppressionFunction(fn) && functionSuppressionMergeKey(fn) === key) {
      return true;
    }
  }

  return false;
}

function isMergedLimitSuppressionNotice(call) {
  return isAutoLimitSuppressionNotice(call) && hasMatchingUnsuppressedCall(call);
}

function limitSuppressionRepeatCount(call) {
  if (!hasMergedLimitSuppression(call)) {
    return 1;
  }

  const fn = state.functions.get(call.functionId) || {};
  return Math.max(CALL_GROUP_DISPLAY_LIMIT, Number(fn.callCount || 0) || 0);
}

function isHiddenCall(call) {
  return state.hiddenFunctionIds.has(call.functionId) ||
    isMergedLimitSuppressionNotice(call) ||
    (!state.showMinifiedFunctions && isMinifiedCall(call)) ||
    (state.hideNoisy && isNoisyCall(call)) ||
    isBlacklistedCall(call);
}

function isMinifiedCall(call) {
  const fn = state.functions.get(call.functionId) || {};
  const name = String(call.name || fn.name || "").trim();
  const path = String(call.path || fn.path || "");
  const lastPathPart = path.split(/[.#]/).pop() || "";
  return /^[A-Za-z_$][\w$]?$/.test(name) ||
    /^[A-Za-z_$][\w$]?$/.test(lastPathPart);
}

function isNoisyCall(call) {
  if (call.suppressed) {
    return false;
  }

  const fn = state.functions.get(call.functionId);
  const kind = fn && fn.kind || "";
  const name = String(call.name || "").trim().toLowerCase();
  const lowValueName = !name || name === "anonymous" || name === "bound" || /^[a-z_$][\w$]?$/.test(name);
  const text = [
    call.name,
    call.path,
    call.frameUrl,
    ...(call.args || [])
  ].join(" ").toLowerCase();
  const loadOrErrorListener =
    (text.includes(".addeventlistener(\"load\")") ||
      text.includes(".addeventlistener(\"error\")")) &&
    (text.includes("{type: \"load\"") ||
      text.includes("{type: \"error\"") ||
      text.includes("polyfills."));
  const noisyLoadTarget = text.includes("<script>") ||
    text.includes("[object xmlhttprequest]") ||
    text.includes("<iframe") ||
    text.includes("<img") ||
    text.includes("<link") ||
    text.includes("polyfills.");
  const lowValueAssetEvent = loadOrErrorListener && (lowValueName || noisyLoadTarget);
  const rawInputPhase = /(?:^|[."\s])(pointerdown|pointerup|mousedown|mouseup|click|dblclick|contextmenu|touchstart|touchend)(?:["\s)]|$)/.test(text);
  const observedBrowserDetail = (kind === "observed-dom-event" || kind === "observed-dom-listener") && rawInputPhase;
  const lowValueEmptyProbe = /(?:^|[.\s])isempty(?:[.\s("{]|$)/.test(text);

  return lowValueEmptyProbe ||
    observedBrowserDetail ||
    lowValueAssetEvent ||
    text.includes("addeventlistener(\"pointermove\")") ||
    text.includes("addeventlistener(\"mousemove\")") ||
    text.includes("addeventlistener(\"mouseover\")") ||
    text.includes("addeventlistener(\"mouseout\")") ||
    text.includes("{type: \"pointermove\"") ||
    text.includes("{type: \"mousemove\"") ||
    text.includes("{type: \"mouseover\"") ||
    text.includes("{type: \"mouseout\"") ||
    text.includes("{type: \"readystatechange\"");
}

function nodeMatchesDeep(node) {
  if (!node) {
    return false;
  }

  const key = `${state.callRenderRevision}:${node.id}`;
  if (state.callMatchCache.has(key)) {
    return state.callMatchCache.get(key);
  }

  const matches = (!isHiddenCall(node) && callMatchesFilter(node)) ||
    node.children.some((child) => nodeMatchesDeep(child));
  state.callMatchCache.set(key, matches);
  return matches;
}

function visibleChildNodes(call) {
  return call.children.filter(nodeMatchesDeep);
}

function visibleRootNodes(tree) {
  return tree.rootCallIds
    .map((id) => state.callsById.get(id))
    .filter((node) => node && nodeMatchesDeep(node));
}

function renderableCallNodes(calls) {
  const nodes = [];
  for (const call of calls) {
    if (!nodeMatchesDeep(call)) {
      continue;
    }

    if (isHiddenCall(call)) {
      nodes.push(...renderableCallNodes(visibleChildNodes(call)));
    } else {
      nodes.push(call);
    }
  }

  return nodes;
}

function hasStarredCallDeep(call) {
  return state.starredEventIds.has(call.id) ||
    call.children.some((child) => nodeMatchesDeep(child) && hasStarredCallDeep(child));
}

function callGroupSignature(call) {
  const cacheKey = `${state.callRenderRevision}:${call.id}`;
  if (state.callGroupSignatureCache.has(cacheKey)) {
    return state.callGroupSignatureCache.get(cacheKey);
  }

  const fn = state.functions.get(call.functionId) || {};
  const signature = JSON.stringify({
    args: call.args || [],
    blocked: Boolean(call.blocked),
    error: call.error || "",
    frame: call.framePath || call.frameLabel || "",
    functionId: call.functionId || "",
    name: displayFunctionName(call, fn),
    path: call.path || fn.path || "",
    returnValue: Object.prototype.hasOwnProperty.call(call, "returnValue") ? call.returnValue : "",
    suppressed: Boolean(call.suppressed),
    threw: Boolean(call.threw),
    children: renderableCallNodes(visibleChildNodes(call)).map((child) => callGroupSignature(child))
  });
  state.callGroupSignatureCache.set(cacheKey, signature);
  return signature;
}

function canGroupCall(call) {
  return Boolean(call) &&
    !isHiddenCall(call) &&
    !hasStarredCallDeep(call);
}

function groupedCallItems(calls) {
  const items = [];
  let group = null;

  for (const call of calls) {
    const signature = canGroupCall(call) ? callGroupSignature(call) : "";
    if (group && signature && group.signature === signature) {
      group.calls.push(call);
      continue;
    }

    if (group) {
      items.push(group);
      group = null;
    }

    if (signature) {
      group = {
        calls: [call],
        signature,
        type: "group"
      };
    } else {
      items.push({
        call,
        type: "single"
      });
    }
  }

  if (group) {
    items.push(group);
  }

  return items;
}

function cell(className = "") {
  const node = document.createElement("div");
  node.className = className ? `call-cell ${className}` : "call-cell";
  return node;
}

function sleep(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function iconSvg(name, filled = false) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const ns = "http://www.w3.org/2000/svg";
  const paths = {
    ban: [
      ["circle", { cx: "12", cy: "12", r: "10" }],
      ["path", { d: "m4.93 4.93 14.14 14.14" }]
    ],
    edit: [
      ["path", { d: "M12 20h9" }],
      ["path", { d: "M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" }]
    ],
    eyeOff: [
      ["path", { d: "m2 2 20 20" }],
      ["path", { d: "M10.58 10.58A2 2 0 0 0 12 14a2 2 0 0 0 1.42-.58" }],
      ["path", { d: "M9.88 5.1A10.8 10.8 0 0 1 12 5c5 0 9 5 10 7a17.3 17.3 0 0 1-3.1 4.27" }],
      ["path", { d: "M6.61 6.61A17.1 17.1 0 0 0 2 12c1 2 5 7 10 7a10.8 10.8 0 0 0 5.39-1.39" }]
    ],
    networkIn: [
      ["path", { d: "M5 12.55a11 11 0 0 1 14.08 0" }],
      ["path", { d: "M8.53 16.11a6 6 0 0 1 6.95 0" }],
      ["path", { d: "M12 20h.01" }],
      ["path", { d: "M12 3v8" }],
      ["path", { d: "m8 7 4 4 4-4" }]
    ],
    networkOut: [
      ["path", { d: "M5 12.55a11 11 0 0 1 14.08 0" }],
      ["path", { d: "M8.53 16.11a6 6 0 0 1 6.95 0" }],
      ["path", { d: "M12 20h.01" }],
      ["path", { d: "M12 11V3" }],
      ["path", { d: "m8 7 4-4 4 4" }]
    ],
    refresh: [
      ["path", { d: "M21 12a9 9 0 0 1-15.36 6.36L3 15" }],
      ["path", { d: "M3 20v-5h5" }],
      ["path", { d: "M3 12A9 9 0 0 1 18.36 5.64L21 9" }],
      ["path", { d: "M21 4v5h-5" }]
    ],
    send: [
      ["path", { d: "m22 2-7 20-4-9-9-4Z" }],
      ["path", { d: "M22 2 11 13" }]
    ],
    star: [
      ["polygon", { points: "12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" }]
    ]
  };

  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.classList.add("icon");

  for (const [tag, attrs] of paths[name] || paths.star) {
    const node = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attrs)) {
      node.setAttribute(key, value);
    }
    node.setAttribute("fill", filled && tag === "polygon" ? "currentColor" : "none");
    node.setAttribute("stroke", "currentColor");
    node.setAttribute("stroke-linecap", "round");
    node.setAttribute("stroke-linejoin", "round");
    node.setAttribute("stroke-width", "2");
    svg.append(node);
  }

  return svg;
}

function iconButton(icon, label, options = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = ["icon-button", options.className || "", options.active ? "active-icon" : ""]
    .filter(Boolean)
    .join(" ");
  button.title = options.title || label;
  button.setAttribute("aria-label", label);
  button.append(iconSvg(icon, Boolean(options.filled)));
  return button;
}

if (variableRefreshButton) {
  variableRefreshButton.append(iconSvg("refresh"));
}

function searchTerms(value) {
  return Array.from(new Set(
    String(value || "")
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
  ));
}

function appendHighlightedText(node, value, terms) {
  const text = String(value || "");
  const activeTerms = (terms || [])
    .map((term) => String(term || "").toLowerCase())
    .filter(Boolean);

  if (!text || !activeTerms.length) {
    node.textContent = text;
    return;
  }

  const lower = text.toLowerCase();
  let index = 0;
  while (index < text.length) {
    let nextIndex = -1;
    let nextTerm = "";

    for (const term of activeTerms) {
      const found = lower.indexOf(term, index);
      if (found >= 0 && (nextIndex < 0 || found < nextIndex || (found === nextIndex && term.length > nextTerm.length))) {
        nextIndex = found;
        nextTerm = term;
      }
    }

    if (nextIndex < 0) {
      node.append(document.createTextNode(text.slice(index)));
      break;
    }

    if (nextIndex > index) {
      node.append(document.createTextNode(text.slice(index, nextIndex)));
    }

    const mark = document.createElement("mark");
    mark.className = "search-match";
    mark.textContent = text.slice(nextIndex, nextIndex + nextTerm.length);
    node.append(mark);
    index = nextIndex + nextTerm.length;
  }
}

function editableReplayValue(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  switch (value.type) {
    case "json":
      return editableReplayValue(value.value);
    case "undefined":
      return {
        $javascreenUndefined: true
      };
    case "number":
      return {
        $javascreenNumber: value.value
      };
    case "bigint":
      return {
        $javascreenBigInt: value.value
      };
    case "ref":
      return {
        $javascreenRef: value.refId,
        preview: value.preview || ""
      };
    default: {
      const copy = {};
      for (const key of Object.keys(value)) {
        copy[key] = editableReplayValue(value[key]);
      }
      return copy;
    }
  }
}

function editableReplayArgs(call) {
  if (Array.isArray(call.forceReplayArgs)) {
    return call.forceReplayArgs.map(editableReplayValue);
  }

  if (Array.isArray(call.replayArgs)) {
    return call.replayArgs;
  }

  return [];
}

function forceReplayArgs(call) {
  if (Array.isArray(call.forceReplayArgs)) {
    return {
      args: call.forceReplayArgs,
      forceDescriptors: true,
      forceThis: call.forceReplayThis || null,
      forceThisDescriptor: Boolean(call.forceReplayThis)
    };
  }

  return {
    args: call.replayArgs || [],
    forceDescriptors: false,
    forceThis: call.forceReplayThis || null,
    forceThisDescriptor: Boolean(call.forceReplayThis)
  };
}

function callHasReplayValues(call) {
  return Boolean(call) && (
    (call.forceReplayable && Array.isArray(call.forceReplayArgs)) ||
    (call.replayable && Array.isArray(call.replayArgs))
  );
}

function sourceHintReplayTarget(call) {
  if (!call || !call.sourceHint) {
    return null;
  }

  const parent = state.callsById.get(call.parentCallId);
  if (callHasReplayValues(parent)) {
    return parent;
  }

  const replay = call.enclosingReplay;
  if (replay && replay.functionId) {
    return {
      constructed: Boolean(replay.constructed),
      directHandlerReplay: true,
      forceReplayArgs: Array.isArray(replay.forceReplayArgs) ? replay.forceReplayArgs : null,
      forceReplayError: replay.forceReplayError || "",
      forceReplayThis: replay.forceReplayThis || null,
      forceReplayable: Boolean(replay.forceReplayable),
      functionId: replay.functionId,
      name: replay.name || call.name,
      replayArgs: Array.isArray(replay.replayArgs) ? replay.replayArgs : null,
      replayError: replay.replayError || "",
      replayable: Boolean(replay.replayable)
    };
  }

  return null;
}

async function replayCall(call, replayArgs = null, options = {}) {
  try {
    setStatus("Replaying", "live");
    const prepared = replayArgs
      ? {
        args: replayArgs,
        forceDescriptors: Boolean(options.forceDescriptors)
      }
      : forceReplayArgs(call);
    const snapshot = await callMonitor("replay", [
      call.functionId,
      prepared.args,
      {
        constructed: Boolean(call.constructed),
        directHandler: Boolean(options.directHandler || call.directHandlerReplay),
        forceDescriptors: Boolean(prepared.forceDescriptors),
        forceThis: prepared.forceThis || call.forceReplayThis || null,
        forceThisDescriptor: Boolean(prepared.forceThisDescriptor || call.forceReplayThis)
      }
    ]);
    applySnapshot(snapshot);
    await sleep(120);
    await poll();
    setStatus(state.running ? "Live" : "Idle", state.running ? "live" : "idle");
  } catch (error) {
    const message = error && error.message ? error.message : String(error || "Replay failed");
    setStatus(`Replay failed: ${message.slice(0, 120)}`, "error");
  }
}

function openReplayEditor(initialText) {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    const dialog = document.createElement("div");
    const heading = document.createElement("div");
    const textarea = document.createElement("textarea");
    const error = document.createElement("div");
    const actions = document.createElement("div");
    const cancelButton = document.createElement("button");
    const resendButton = iconButton("send", "Force Resend", {
      title: "Force Resend edited parameters."
    });

    backdrop.className = "replay-editor-backdrop";
    dialog.className = "replay-editor";
    heading.className = "replay-editor-heading";
    textarea.className = "replay-editor-text";
    error.className = "replay-editor-error";
    actions.className = "replay-editor-actions";

    heading.textContent = "Force Edit and Resend Parameters";
    textarea.value = initialText;
    textarea.spellcheck = false;
    error.hidden = true;

    cancelButton.type = "button";
    cancelButton.textContent = "Cancel";

    function close(value) {
      backdrop.remove();
      resolve(value);
    }

    cancelButton.addEventListener("click", () => close(null));
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) {
        close(null);
      }
    });
    resendButton.addEventListener("click", () => {
      let parsed;
      try {
        parsed = JSON.parse(textarea.value);
      } catch (parseError) {
        error.hidden = false;
        error.textContent = "Parameters must be valid JSON.";
        return;
      }

      if (!Array.isArray(parsed)) {
        error.hidden = false;
        error.textContent = "Parameters must be a JSON array.";
        return;
      }

      close(parsed);
    });
    textarea.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(null);
      }
    });
    textarea.addEventListener("input", () => {
      error.hidden = true;
      error.textContent = "";
    });

    actions.append(cancelButton, resendButton);
    dialog.append(heading, textarea, error, actions);
    backdrop.append(dialog);
    document.body.append(backdrop);
    textarea.focus();
    textarea.select();
  });
}

async function editReplayArgs(call) {
  const current = JSON.stringify(editableReplayArgs(call), null, 2);
  return openReplayEditor(current);
}

function openJsonEditor(title, initialValue, options = {}) {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    const dialog = document.createElement("div");
    const heading = document.createElement("div");
    const textarea = document.createElement("textarea");
    const error = document.createElement("div");
    const actions = document.createElement("div");
    const cancelButton = document.createElement("button");
    const saveButton = iconButton(options.icon || "send", options.actionLabel || "Send", {
      title: options.actionTitle || options.actionLabel || "Send edited JSON."
    });

    backdrop.className = "replay-editor-backdrop";
    dialog.className = "replay-editor";
    heading.className = "replay-editor-heading";
    textarea.className = "replay-editor-text";
    error.className = "replay-editor-error";
    actions.className = "replay-editor-actions";

    heading.textContent = title;
    textarea.value = JSON.stringify(initialValue, null, 2);
    textarea.spellcheck = false;
    error.hidden = true;
    cancelButton.type = "button";
    cancelButton.textContent = "Cancel";

    function close(value) {
      backdrop.remove();
      resolve(value);
    }

    cancelButton.addEventListener("click", () => close(null));
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) {
        close(null);
      }
    });
    saveButton.addEventListener("click", () => {
      try {
        close(JSON.parse(textarea.value));
      } catch (parseError) {
        error.hidden = false;
        error.textContent = "Value must be valid JSON.";
      }
    });
    textarea.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(null);
      }
    });
    textarea.addEventListener("input", () => {
      error.hidden = true;
      error.textContent = "";
    });

    actions.append(cancelButton, saveButton);
    dialog.append(heading, textarea, error, actions);
    backdrop.append(dialog);
    document.body.append(backdrop);
    textarea.focus();
    textarea.select();
  });
}

function networkRecordForCall(call) {
  return call && call.network && call.network.id ? state.networkRecords.get(call.network.id) || null : null;
}

async function editNetworkRequest(call) {
  const record = networkRecordForCall(call);
  const paused = Boolean(record
    ? record.paused && record.pausedPhase === "request"
    : call.network && call.network.paused);
  const initial = record && record.request || {
    body: null,
    headers: {},
    method: call.network && call.network.method || "GET",
    url: call.network && call.network.url || ""
  };
  const edited = await openJsonEditor(paused ? "Edit Paused Request" : "Edit and Resend Request", initial, {
    actionLabel: paused ? "Send Request" : "Resend Request",
    actionTitle: "Send the edited request.",
    icon: "networkOut"
  });
  if (!edited) {
    return;
  }

  try {
    setStatus(paused ? "Sending request" : "Resending request", "live");
    const snapshot = await callMonitor(paused ? "networkContinue" : "networkReplay", [
      call.network.id,
      paused ? "request" : { request: edited },
      paused ? { request: edited } : undefined
    ].filter((value) => typeof value !== "undefined"));
    applySnapshot(snapshot, { preserveEmptyVariables: true });
    await sleep(120);
    await poll();
    setStatus(state.running ? "Live" : "Idle", state.running ? "live" : "idle");
  } catch (error) {
    setStatus(`Network edit failed: ${String(error && error.message || error).slice(0, 100)}`, "error");
  }
}

async function editNetworkResponse(call) {
  const record = networkRecordForCall(call);
  const initial = record && record.response || {
    body: "",
    headers: {},
    status: call.network && call.network.status || 200,
    statusText: "OK"
  };
  const paused = Boolean(record
    ? record.paused && record.pausedPhase === "response"
    : call.network && call.network.paused);
  const edited = await openJsonEditor(paused ? "Edit Paused Response" : "View Response", initial, {
    actionLabel: paused ? "Send Response" : "Close",
    actionTitle: paused ? "Send the edited response to page code." : "Responses can only affect page code while paused.",
    icon: "networkIn"
  });
  if (!edited || !paused) {
    return;
  }

  try {
    setStatus("Sending response", "live");
    const snapshot = await callMonitor("networkContinue", [
      call.network.id,
      "response",
      { response: edited }
    ]);
    applySnapshot(snapshot, { preserveEmptyVariables: true });
    await sleep(120);
    await poll();
    setStatus(state.running ? "Live" : "Idle", state.running ? "live" : "idle");
  } catch (error) {
    setStatus(`Response edit failed: ${String(error && error.message || error).slice(0, 100)}`, "error");
  }
}

function openVariableEditor(variable) {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    const dialog = document.createElement("div");
    const heading = document.createElement("div");
    const textarea = document.createElement("textarea");
    const error = document.createElement("div");
    const actions = document.createElement("div");
    const cancelButton = document.createElement("button");
    const saveButton = document.createElement("button");

    backdrop.className = "replay-editor-backdrop";
    dialog.className = "replay-editor";
    heading.className = "replay-editor-heading";
    textarea.className = "replay-editor-text";
    error.className = "replay-editor-error";
    actions.className = "replay-editor-actions";

    heading.textContent = `Edit ${variable.path}`;
    textarea.value = Object.prototype.hasOwnProperty.call(variable, "value")
      ? JSON.stringify(variable.value, null, 2)
      : String(variable.displayValue || "");
    textarea.spellcheck = false;
    error.hidden = true;

    cancelButton.type = "button";
    cancelButton.textContent = "Cancel";
    saveButton.type = "button";
    saveButton.textContent = "Save Variable";

    function close(value) {
      backdrop.remove();
      resolve(value);
    }

    cancelButton.addEventListener("click", () => close(null));
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) {
        close(null);
      }
    });
    saveButton.addEventListener("click", () => {
      let parsed;
      try {
        parsed = JSON.parse(textarea.value);
      } catch (parseError) {
        error.hidden = false;
        error.textContent = "Value must be valid JSON. Use quotes for strings.";
        return;
      }

      close(parsed);
    });
    textarea.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(null);
      }
    });
    textarea.addEventListener("input", () => {
      error.hidden = true;
      error.textContent = "";
    });

    actions.append(cancelButton, saveButton);
    dialog.append(heading, textarea, error, actions);
    backdrop.append(dialog);
    document.body.append(backdrop);
    textarea.focus();
    textarea.select();
  });
}

async function editVariable(variable) {
  if (!variable.canEdit) {
    return;
  }

  const value = await openVariableEditor(variable);
  if (value === null) {
    return;
  }

  try {
    setStatus("Editing variable", "live");
    const snapshot = await callMonitor("setVariable", [variable.id, value]);
    if ((snapshot && snapshot.variables || []).some((item) => item.id === variable.id)) {
      applySnapshot(snapshot);
    }
    await sleep(300);
    await poll({ updateVariables: true });
    setStatus(state.running ? "Live" : "Idle", state.running ? "live" : "idle");
  } catch (error) {
    setStatus("Variable edit failed", "error");
  }
}

async function refreshVariable(variable = null) {
  try {
    setStatus("Refreshing variable", "live");
    const snapshot = await callMonitor("setVariableWatch", [true, { forceScan: true }]);
    applySnapshot(snapshot);
    await sleep(150);
    await poll({ updateVariables: true });
    if (variable && !state.variables.has(variable.id)) {
      setStatus("Variable not found", "error");
      return;
    }
    setStatus(state.running ? "Live" : "Idle", state.running ? "live" : "idle");
  } catch (error) {
    setStatus("Variable refresh failed", "error");
  }
}

async function refreshVariables() {
  if (variableRefreshButton) {
    variableRefreshButton.disabled = true;
  }

  try {
    await refreshVariable(null);
    renderVariables();
  } finally {
    if (variableRefreshButton) {
      variableRefreshButton.disabled = false;
    }
  }
}

async function setVariableWatchEnabled(enabled, forceScan = false) {
  try {
    const snapshot = await callMonitor("setVariableWatch", [Boolean(enabled), { forceScan: Boolean(forceScan) }]);
    applySnapshot(snapshot, {
      preserveEmptyVariables: state.variables.size > 0,
      updateVariables: Boolean(enabled)
    });
    if (enabled) {
      await sleep(150);
      await poll({ updateVariables: Boolean(forceScan || state.liveVariables) });
      if (forceScan && !state.liveVariables) {
        await callMonitor("setVariableWatch", [false, {}]);
      }
    }
  } catch (error) {
    if (enabled) {
      setStatus("Variable scan failed", "error");
    }
  }
}

function canShowReplayControls(call) {
  const fn = state.functions.get(call.functionId);
  if (call.suppressed || call.blocked) {
    return false;
  }

  if (sourceHintReplayTarget(call)) {
    return true;
  }

  if (call.forceReplayable || call.replayable) {
    return true;
  }

  return fn && (
    fn.kind === "function" ||
    fn.kind === "event-listener" ||
    fn.kind === "observed-dom-event"
  );
}

function renderReplayControls(call) {
  if (!canShowReplayControls(call)) {
    return null;
  }

  const sourceHintTarget = sourceHintReplayTarget(call);
  if (sourceHintTarget) {
    const controls = document.createElement("span");
    const canReplayHint = callHasReplayValues(sourceHintTarget);
    const replayName = sourceHintTarget.name || "enclosing handler";
    const disabledReason = sourceHintTarget.forceReplayError ||
      sourceHintTarget.replayError ||
      "The enclosing handler was not captured with replayable parameters.";
    const resendButton = iconButton("send", "Replay enclosing handler", {
      className: "source-hint-replay",
      title: canReplayHint
        ? `Replay enclosing handler: runs ${replayName} again with its original closed-over values. Inferred inner-call parameters cannot be edited without source instrumentation.`
        : disabledReason
    });

    controls.className = "arg-actions source-hint-actions";
    resendButton.disabled = !canReplayHint;
    resendButton.addEventListener("click", async (event) => {
      event.stopPropagation();
      resendButton.disabled = true;
      await replayCall(sourceHintTarget, null, { directHandler: true });
      resendButton.disabled = false;
    });

    controls.append(resendButton);
    return controls;
  }

  const controls = document.createElement("span");
  const canReplay = callHasReplayValues(call);
  const disabledReason = call.forceReplayError || call.replayError || "This call was not captured with replayable parameters.";
  const resendButton = iconButton("send", "Force Resend", {
    title: canReplay ? "Force Resend: best effort replay with captured values or live references if they still exist." : disabledReason
  });
  const editButton = iconButton("edit", "Force Edit and Resend", {
    title: canReplay ? "Force Edit and Resend: edit JSON values, or leave $javascreenRef placeholders to reuse live references." : disabledReason
  });

  controls.className = "arg-actions";

  resendButton.disabled = !canReplay;
  resendButton.addEventListener("click", async (event) => {
    event.stopPropagation();
    resendButton.disabled = true;
    editButton.disabled = true;
    await replayCall(call);
    resendButton.disabled = false;
    editButton.disabled = false;
  });

  editButton.disabled = !canReplay;
  editButton.addEventListener("click", async (event) => {
    event.stopPropagation();
    const editedArgs = await editReplayArgs(call);
    if (!editedArgs) {
      return;
    }

    resendButton.disabled = true;
    editButton.disabled = true;
    await replayCall(call, editedArgs, {
      forceDescriptors: false
    });
    resendButton.disabled = false;
    editButton.disabled = false;
  });

  controls.append(resendButton, editButton);
  return controls;
}

function renderArgs(call) {
  const args = call.args || [];
  const node = cell();
  const wrap = document.createElement("div");
  const terms = searchTerms(state.activeTab === "functions" ? state.functionFilter : state.filter);
  wrap.className = "args";

  if (!args.length) {
    const empty = document.createElement("span");
    empty.className = "muted";
    empty.textContent = "none";
    wrap.append(empty);
  } else {
    for (const arg of args) {
      const chip = document.createElement("span");
      chip.className = "arg";
      appendHighlightedText(chip, arg, terms);
      wrap.append(chip);
    }
  }

  const replayControls = renderReplayControls(call);
  if (replayControls) {
    wrap.append(replayControls);
  }

  node.append(wrap);
  return node;
}

function renderReturn(call) {
  const node = cell();
  const value = document.createElement("span");
  const terms = searchTerms(state.activeTab === "functions" ? state.functionFilter : state.filter);

  if (call.threw) {
    value.className = "muted";
    value.textContent = "threw";
  } else if (Object.prototype.hasOwnProperty.call(call, "returnValue")) {
    value.className = "return-value";
    appendHighlightedText(value, call.returnValue, terms);
  } else {
    value.className = "muted";
    value.textContent = "pending";
  }

  node.append(value);
  return node;
}

function toggleCall(callId) {
  if (state.collapsedCallIds.has(callId)) {
    state.collapsedCallIds.delete(callId);
  } else {
    state.collapsedCallIds.add(callId);
  }
  render();
}

function toggleHiddenFunction(functionId) {
  if (state.hiddenFunctionIds.has(functionId)) {
    state.hiddenFunctionIds.delete(functionId);
  } else {
    state.hiddenFunctionIds.add(functionId);
  }
  invalidateCallRenderCache();
  renderActiveView();
}

function blacklistToken(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }

  if (/[\s,"]/.test(text)) {
    return `"${text.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
  }

  return text;
}

function addBlacklistTerm(value) {
  const term = String(value || "").trim();
  if (!term) {
    return;
  }

  if (blacklistTerms().includes(term.toLowerCase())) {
    return;
  }

  const current = state.blacklistFilter.trim();
  state.blacklistFilter = current ? `${current} ${blacklistToken(term)}` : blacklistToken(term);
  blacklistInput.value = state.blacklistFilter;
}

function hideAllInstances(call) {
  const fn = state.functions.get(call.functionId) || {};
  const name = displayFunctionName(call, fn) || call.name || fn.name || call.path || fn.path;
  addBlacklistTerm(name);
  invalidateCallRenderCache();
  renderActiveView();
}

function cloneJson(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    return value;
  }
}

function cloneFavoriteCall(call) {
  const copy = Object.assign({}, call, {
    args: Array.isArray(call.args) ? call.args.slice() : [],
    children: [],
    enclosingReplay: cloneJson(call.enclosingReplay || null),
    forceReplayArgs: cloneJson(call.forceReplayArgs || null),
    forceReplayThis: cloneJson(call.forceReplayThis || null),
    replayArgs: cloneJson(call.replayArgs || null),
    source: cloneJson(call.source || call.callSite || null)
  });
  delete copy.panelSeq;
  return copy;
}

function cloneFavoriteVariable(variable) {
  return Object.assign({}, variable, {
    frame: cloneJson(variable.frame || null)
  });
}

function favoritesPayload() {
  return {
    events: Array.from(state.favoriteEvents.values()).map(cloneFavoriteCall),
    savedAt: new Date().toISOString(),
    variables: Array.from(state.favoriteVariables.values()).map(cloneFavoriteVariable),
    version: 1
  };
}

function extensionStorageLocal() {
  try {
    return typeof browser !== "undefined" &&
      browser.storage &&
      browser.storage.local &&
      typeof browser.storage.local.get === "function" &&
      typeof browser.storage.local.set === "function"
      ? browser.storage.local
      : null;
  } catch (error) {
    return null;
  }
}

function localStorageGetFavorites() {
  try {
    const raw = window.localStorage && window.localStorage.getItem(FAVORITES_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    return null;
  }
}

function localStorageSetFavorites(payload) {
  try {
    if (window.localStorage) {
      window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(payload));
    }
  } catch (error) {
    // Persistence is best-effort; the panel should keep working without it.
  }
}

async function browserStorageGetFavorites() {
  const storage = extensionStorageLocal();
  if (!storage) {
    return null;
  }

  try {
    const result = await storage.get(FAVORITES_STORAGE_KEY);
    return result && result[FAVORITES_STORAGE_KEY] ? result[FAVORITES_STORAGE_KEY] : null;
  } catch (error) {
    return null;
  }
}

async function browserStorageSetFavorites(payload) {
  const storage = extensionStorageLocal();
  if (!storage) {
    return;
  }

  try {
    await storage.set({
      [FAVORITES_STORAGE_KEY]: payload
    });
  } catch (error) {
    // Keep localStorage fallback as the durable copy when extension storage is unavailable.
  }
}

function restoreFavorites(payload) {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const events = Array.isArray(payload.events) ? payload.events : [];
  const variables = Array.isArray(payload.variables) ? payload.variables : [];
  state.favoriteEvents.clear();
  state.favoriteVariables.clear();
  state.starredEventIds.clear();
  state.starredVariableIds.clear();

  for (const call of events) {
    if (!call || !call.id) {
      continue;
    }
    const copy = cloneFavoriteCall(call);
    state.favoriteEvents.set(copy.id, copy);
    state.starredEventIds.add(copy.id);
  }

  for (const variable of variables) {
    if (!variable || !variable.id) {
      continue;
    }
    const copy = cloneFavoriteVariable(variable);
    state.favoriteVariables.set(copy.id, copy);
    state.starredVariableIds.add(copy.id);
  }

  return Boolean(state.favoriteEvents.size || state.favoriteVariables.size);
}

async function loadPersistedFavorites() {
  const payload = await browserStorageGetFavorites() || localStorageGetFavorites();
  const restored = restoreFavorites(payload);
  if (restored) {
    renderFavorites();
  }
  return restored;
}

function persistFavoritesNow() {
  const payload = favoritesPayload();
  localStorageSetFavorites(payload);
  browserStorageSetFavorites(payload);
}

function schedulePersistFavorites() {
  if (favoritesPersistTimer) {
    window.clearTimeout(favoritesPersistTimer);
  }

  favoritesPersistTimer = window.setTimeout(() => {
    favoritesPersistTimer = 0;
    persistFavoritesNow();
  }, FAVORITES_STORAGE_DEBOUNCE_MS);
}

function favoriteCall(call) {
  state.starredEventIds.add(call.id);
  state.favoriteEvents.set(call.id, cloneFavoriteCall(call));
  persistFavoritesNow();
}

function unfavoriteCall(callId) {
  state.starredEventIds.delete(callId);
  state.favoriteEvents.delete(callId);
  persistFavoritesNow();
}

function toggleFavoriteCall(call) {
  if (state.starredEventIds.has(call.id)) {
    unfavoriteCall(call.id);
  } else {
    favoriteCall(call);
  }

  renderActiveView();
  renderFavorites();
}

function favoriteVariable(variable) {
  state.starredVariableIds.add(variable.id);
  state.favoriteVariables.set(variable.id, cloneFavoriteVariable(variable));
  persistFavoritesNow();
}

function unfavoriteVariable(variableId) {
  state.starredVariableIds.delete(variableId);
  state.favoriteVariables.delete(variableId);
  persistFavoritesNow();
}

function toggleFavoriteVariable(variable) {
  if (state.starredVariableIds.has(variable.id)) {
    unfavoriteVariable(variable.id);
  } else {
    favoriteVariable(variable);
  }

  renderVariables();
  renderFavorites();
}

function favoriteSearchText(item) {
  if (item.type === "event") {
    const call = item.value;
    const fn = state.functions.get(call.functionId) || {};
    return [
      "event",
      displayFunctionName(call, fn),
      call.name,
      call.path,
      call.frameLabel,
      call.frameTitle,
      call.frameUrl,
      call.args && call.args.join(" "),
      call.returnValue
    ].join(" ").toLowerCase();
  }

  const variable = item.value;
  return [
    "variable",
    variable.path,
    variable.displayValue,
    variable.kind,
    variable.frameLabel,
    variable.frameTitle,
    variable.frameUrl
  ].join(" ").toLowerCase();
}

function isLowValueDisplayName(name) {
  const normalized = String(name || "").trim();
  return !normalized ||
    normalized === "anonymous" ||
    normalized === "bound" ||
    /^[A-Za-z_$][\w$]?$/.test(normalized);
}

function readableEventTarget(path) {
  const text = String(path || "");
  const match = /^(.+)\.addEventListener\("([^"]+)"\)$/.exec(text);
  if (!match) {
    return null;
  }

  const objectMatch = /^\[object\s+(.+)\]$/.exec(match[1]);
  const target = (objectMatch ? objectMatch[1] : match[1])
    .replace(/^<|>$/g, "")
    .replace(/[#.]/g, " ")
    .trim() || "target";
  return `${target} ${match[2]} listener`;
}

function displayFunctionName(call, fn = {}) {
  const name = call.name || fn.name || "";
  const eventName = readableEventTarget(call.path || fn.path);
  if (eventName && isLowValueDisplayName(name)) {
    return eventName;
  }

  return name || "anonymous";
}

function treeStyleOptions(options = {}) {
  return {
    ancestorGuides: Array.isArray(options.ancestorGuides) ? options.ancestorGuides : [],
    isLastSibling: options.isLastSibling !== false
  };
}

function appendTreeGuides(line, displayDepth, options = {}) {
  const { ancestorGuides, isLastSibling } = treeStyleOptions(options);
  for (let index = 0; index < ancestorGuides.length; index += 1) {
    if (!ancestorGuides[index]) {
      continue;
    }

    const guide = document.createElement("span");
    guide.className = "tree-guide";
    guide.style.setProperty("--guide-depth", String(index + 1));
    line.append(guide);
  }

  if (displayDepth > 0) {
    const branch = document.createElement("span");
    branch.className = `tree-branch ${isLastSibling ? "last" : "continues"}`;
    branch.style.setProperty("--guide-depth", String(displayDepth));
    line.append(branch);
  }
}

function renderFunction(call, options) {
  const { collapsed, displayDepth, hasChildren, repeatCount = 1 } = options;
  const fn = state.functions.get(call.functionId) || {};
  const node = cell("call-cell-function");
  const line = document.createElement("span");
  const body = document.createElement("span");
  const name = document.createElement("span");
  const details = `${call.frameLabel || fn.frameLabel || "top"} / ${call.path || fn.path || call.functionId}`;

  line.className = "tree-line";
  line.style.setProperty("--tree-depth", String(displayDepth));
  body.className = "tree-node-body";
  name.className = "fn-name";
  appendHighlightedText(name, displayFunctionName(call, fn), searchTerms(state.activeTab === "functions" ? state.functionFilter : state.filter));
  name.title = details;
  node.title = details;
  appendTreeGuides(line, displayDepth, options);

  if (hasChildren) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "call-toggle";
    toggle.setAttribute("aria-label", collapsed ? "Expand call tree" : "Collapse call tree");
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleCall(call.id);
    });
    body.append(toggle);
  } else {
    const spacer = document.createElement("span");
    spacer.className = "call-toggle-spacer";
    body.append(spacer);
  }

  body.append(name);
  if (call.network && call.network.phase) {
    const record = networkRecordForCall(call);
    const networkPaused = Boolean(record
      ? record.paused && record.pausedPhase === call.network.phase
      : call.network.paused);
    const networkButton = iconButton(call.network.phase === "response" ? "networkIn" : "networkOut", call.network.phase === "response" ? "Edit response" : "Edit or resend request", {
      active: networkPaused,
      className: `network-icon-button ${call.network.phase === "response" ? "network-response-button" : "network-request-button"}`,
      title: call.network.phase === "response"
        ? (networkPaused ? "Paused response: edit before the page receives it." : "View captured response. Enable Pause responses to edit before page code receives it.")
        : (networkPaused ? "Paused request: edit before sending." : "Edit and resend this request.")
    });
    networkButton.addEventListener("click", (event) => {
      event.stopPropagation();
      if (call.network.phase === "response") {
        editNetworkResponse(call);
      } else {
        editNetworkRequest(call);
      }
    });
    body.append(networkButton);
  }
  if (repeatCount > 1) {
    const badge = document.createElement("span");
    badge.className = "repeat-count";
    badge.textContent = repeatCount >= CALL_GROUP_DISPLAY_LIMIT ? `${CALL_GROUP_DISPLAY_LIMIT}+` : String(repeatCount);
    badge.title = repeatCount >= CALL_GROUP_DISPLAY_LIMIT
      ? `${CALL_GROUP_DISPLAY_LIMIT}+ identical calls grouped here; tracking may be disabled unless Continue after 99+ is enabled.`
      : `${repeatCount} identical calls grouped here.`;
    body.append(badge);
  } else if (call.suppressed && /99\+/.test(String(call.note || ""))) {
    const badge = document.createElement("span");
    badge.className = "repeat-count suppressed-count";
    badge.textContent = `${CALL_GROUP_DISPLAY_LIMIT}+`;
    badge.title = call.note || "Tracking disabled after repeated calls.";
    body.append(badge);
  }
  if (hasMergedLimitSuppression(call)) {
    const disabledLabel = document.createElement("span");
    disabledLabel.className = "tracking-disabled-inline";
    disabledLabel.textContent = "tracking disabled";
    disabledLabel.title = "Tracking disabled after 99+ calls. Enable Continue after 99+ to keep capturing this function.";
    body.append(disabledLabel);
  }
  line.append(body);
  node.append(line);
  return node;
}

function renderSource(call) {
  const fn = state.functions.get(call.functionId);
  const source = (fn && fn.source) || call.source || call.callSite;
  const node = cell();

  if (!source || !source.url) {
    const unknown = document.createElement("span");
    unknown.className = "muted";
    unknown.textContent = "Unknown";
    node.append(unknown);
    return node;
  }

  const link = document.createElement("a");
  link.className = "source-link";
  link.href = sourceHref(source);
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = sourceLabel(source);
  link.title = source.url;
  link.addEventListener("click", (event) => openSource(event, source));

  const kind = document.createElement("span");
  kind.className = "source-kind";
  kind.textContent = source.kind || "source";

  node.append(link, kind);
  return node;
}

function renderAction(call) {
  const node = cell();
  const fn = state.functions.get(call.functionId);
  const suppressed = Boolean(call.suppressed || (fn && fn.suppressed));
  const disabled = state.disabledIds.has(call.functionId);
  const actions = document.createElement("div");

  if (suppressed) {
    const label = document.createElement("span");
    label.className = "muted action-note";
    label.textContent = "Tracking disabled";
    node.append(label);
    return node;
  }

  const starred = state.starredEventIds.has(call.id);
  const hideButton = iconButton("eyeOff", "Hide all instances", {
    title: "Hide all instances of this function."
  });
  const disableButton = iconButton("ban", disabled ? "Enable calls to this function" : "Disable calls to this function", {
    className: disabled ? "" : "danger-button",
    title: disabled ? "Enable calls to this function." : "Disable calls to this function."
  });
  const starButton = iconButton("star", starred ? "Unstar event" : "Star event", {
    className: "star-button",
    filled: starred,
    active: starred,
    title: starred ? "Remove this event from Favorites." : "Save this event to Favorites."
  });

  actions.className = "action-stack icon-actions";
  starButton.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleFavoriteCall(call);
  });

  hideButton.disabled = !fn;
  hideButton.addEventListener("click", (event) => {
    event.stopPropagation();
    hideAllInstances(call);
  });

  disableButton.disabled = !fn;
  disableButton.addEventListener("click", async (event) => {
    event.stopPropagation();
    disableButton.disabled = true;
    try {
      const snapshot = await callMonitor("setDisabled", [call.functionId, !disabled]);
      applySnapshot(snapshot, { preserveEmptyVariables: true });
      renderActiveView();
    } catch (error) {
      setStatus("Toggle failed", "error");
    } finally {
      disableButton.disabled = false;
    }
  });

  actions.append(starButton, hideButton, disableButton);
  node.append(actions);
  return node;
}

function renderError(call) {
  if (!call.threw) {
    return null;
  }

  const error = document.createElement("span");
  error.className = "error-pill";
  error.textContent = call.error ? `threw ${call.error}` : "threw";
  return error;
}

function openSource(event, source) {
  if (!source || !source.url) {
    return;
  }

  if (browser.devtools.panels.openResource) {
    event.preventDefault();
    browser.devtools.panels.openResource(source.url, source.line || 1).catch(() => {
      window.open(sourceHref(source), "_blank", "noopener,noreferrer");
    });
  }
}

function createVirtualSpacer(height) {
  const spacer = document.createElement("div");
  spacer.className = "virtual-spacer";
  spacer.style.height = `${Math.max(0, Math.round(height))}px`;
  return spacer;
}

function virtualRange(shell, total, rowHeight, overscanRows, stickToEnd = false) {
  if (total <= 0) {
    return {
      end: 0,
      start: 0
    };
  }

  const height = Math.max(24, Number(rowHeight || DEFAULT_TABLE_ROW_HEIGHT));
  const viewport = Math.max(height, shell && shell.clientHeight || 720);
  const visibleCount = Math.min(total, Math.ceil(viewport / height) + overscanRows);
  let start = stickToEnd
    ? Math.max(0, total - visibleCount)
    : Math.max(0, Math.floor((shell && shell.scrollTop || 0) / height) - Math.floor(overscanRows / 2));
  start = Math.min(start, Math.max(0, total - visibleCount));

  return {
    end: Math.min(total, start + visibleCount),
    start
  };
}

function updateMeasuredRowHeight(kind, container, fallback) {
  const row = container.querySelector(".call-row, .function-row, .variable-row");
  if (!row) {
    return;
  }

  const height = row.getBoundingClientRect().height;
  if (!Number.isFinite(height) || height < 20) {
    return;
  }

  if (kind === "events") {
    state.eventRowHeight = Math.round((state.eventRowHeight * 3 + height) / 4) || fallback;
  } else {
    state.tableRowHeight = Math.round((state.tableRowHeight * 3 + height) / 4) || fallback;
  }
}

function decorateCallRow(row, call, displayDepth, repeatCount, treeOptions = {}) {
  const { ancestorGuides, isLastSibling } = treeStyleOptions(treeOptions);
  row.className = "call-row";
  row.classList.add(displayDepth > 0 ? "child-call-row" : "root-call-row");
  row.classList.toggle("expanded-row", state.expandedCallIds.has(call.id));
  row.classList.toggle("starred-row", state.starredEventIds.has(call.id));
  row.classList.toggle("suppressed-row", Boolean(call.suppressed));
  row.classList.toggle("grouped-call-row", repeatCount > 1);
  row.classList.toggle("tree-group-start", displayDepth === 0);
  row.dataset.treeDepth = String(displayDepth);
  if (ancestorGuides.some(Boolean)) {
    row.dataset.treeGuides = ancestorGuides
      .map((enabled, index) => enabled ? String(index + 1) : "")
      .filter(Boolean)
      .join(",");
  }
  if (displayDepth > 0) {
    row.dataset.treeLastSibling = String(isLastSibling);
  }
}

function createCallRow(call, displayDepth = 0, repeatCount = 1, treeOptions = {}) {
  const row = document.createElement("div");
  const time = cell();
  const args = renderArgs(call);
  const error = renderError(call);
  const visibleChildren = visibleChildNodes(call);
  const hasChildren = visibleChildren.length > 0;
  const collapsed = state.collapsedCallIds.has(call.id);
  decorateCallRow(row, call, displayDepth, repeatCount, treeOptions);
  if (repeatCount > 1) {
    row.dataset.repeatCount = String(repeatCount);
    row.title = `${repeatCount} identical calls grouped into this row.`;
  }
  row.setAttribute("role", "treeitem");
  row.setAttribute("aria-level", String(displayDepth + 1));
  row.addEventListener("click", (event) => {
    if (event.target.closest("a, button, input, label, select, textarea")) {
      return;
    }

    if (state.expandedCallIds.has(call.id)) {
      state.expandedCallIds.delete(call.id);
    } else {
      state.expandedCallIds.add(call.id);
    }
    render();
  });
  if (hasChildren) {
    row.setAttribute("aria-expanded", String(!collapsed));
  }

  if (call.blocked) {
    row.classList.add("blocked-row");
  }

  if (call.threw) {
    row.classList.add("threw-row");
  }

  if (state.filter && !callMatchesFilter(call)) {
    row.classList.add("context-row");
  }

  time.textContent = formatTime(call.time);
  if (error) {
    args.append(error);
  }

  row.append(
    time,
    renderFunction(call, {
      collapsed,
      ancestorGuides: treeOptions.ancestorGuides,
      displayDepth,
      hasChildren,
      isLastSibling: treeOptions.isLastSibling,
      repeatCount
    }),
    args,
    renderReturn(call),
    renderSource(call),
    renderAction(call)
  );
  return row;
}

function renderedChildItems(call) {
  return groupedCallItems(renderableCallNodes(visibleChildNodes(call)));
}

function collectCallRowModels(call, displayDepth, repeatCount, rows, options = {}, treeOptions = {}) {
  if (!nodeMatchesDeep(call)) {
    return;
  }

  if (isHiddenCall(call)) {
    const hiddenItems = renderedChildItems(call);
    hiddenItems.forEach((item, index) => {
      const childTreeOptions = Object.assign({}, treeOptions, {
        isLastSibling: index === hiddenItems.length - 1 && treeStyleOptions(treeOptions).isLastSibling
      });
      if (item.type === "group") {
        collectCallRowModels(item.calls[0], displayDepth, item.calls.length, rows, options, childTreeOptions);
      } else {
        collectCallRowModels(item.call, displayDepth, 1, rows, options, childTreeOptions);
      }
    });
    return;
  }

  if (hasMergedLimitSuppression(call)) {
    const key = callSuppressionMergeKey(call);
    const seen = options.limitSuppressionKeys || null;
    if (seen && seen.has(key)) {
      return;
    }
    if (seen) {
      seen.add(key);
    }
    repeatCount = Math.max(repeatCount, limitSuppressionRepeatCount(call));
  }

  rows.push({
    ancestorGuides: treeStyleOptions(treeOptions).ancestorGuides.slice(),
    call,
    displayDepth,
    isLastSibling: treeStyleOptions(treeOptions).isLastSibling,
    repeatCount
  });

  if (state.collapsedCallIds.has(call.id)) {
    return;
  }

  const childItems = renderedChildItems(call);
  const childAncestorGuides = treeStyleOptions(treeOptions).ancestorGuides.slice();
  if (displayDepth > 0) {
    childAncestorGuides.push(!treeStyleOptions(treeOptions).isLastSibling);
  }
  childItems.forEach((item, index) => {
    const childTreeOptions = {
      ancestorGuides: childAncestorGuides,
      isLastSibling: index === childItems.length - 1
    };
    if (item.type === "group") {
      collectCallRowModels(item.calls[0], displayDepth + 1, item.calls.length, rows, options, childTreeOptions);
    } else {
      collectCallRowModels(item.call, displayDepth + 1, 1, rows, options, childTreeOptions);
    }
  });
}

function eventRowModels(trees) {
  const rows = [];
  const rootNodes = [];
  const options = {
    limitSuppressionKeys: new Set()
  };

  for (const tree of trees) {
    rootNodes.push(...visibleRootNodes(tree));
  }

  const rootItems = groupedCallItems(renderableCallNodes(rootNodes));
  rootItems.forEach((item, index) => {
    const rootTreeOptions = {
      ancestorGuides: [],
      isLastSibling: index === rootItems.length - 1
    };
    if (item.type === "group") {
      collectCallRowModels(item.calls[0], 0, item.calls.length, rows, options, rootTreeOptions);
    } else {
      collectCallRowModels(item.call, 0, 1, rows, options, rootTreeOptions);
    }
  });

  return rows;
}

function renderCallNode(call, container, displayDepth = 0, repeatCount = 1, options = {}, treeOptions = {}) {
  if (!nodeMatchesDeep(call)) {
    return false;
  }

  if (isHiddenCall(call)) {
    let rendered = false;
    const hiddenItems = renderedChildItems(call);
    hiddenItems.forEach((item, index) => {
      const childTreeOptions = Object.assign({}, treeOptions, {
        isLastSibling: index === hiddenItems.length - 1 && treeStyleOptions(treeOptions).isLastSibling
      });
      if (item.type === "group") {
        rendered = renderCallNode(item.calls[0], container, displayDepth, item.calls.length, options, childTreeOptions) || rendered;
      } else {
        rendered = renderCallNode(item.call, container, displayDepth, 1, options, childTreeOptions) || rendered;
      }
    });
    return rendered;
  }

  if (hasMergedLimitSuppression(call)) {
    const key = callSuppressionMergeKey(call);
    const seen = options.limitSuppressionKeys || null;
    if (seen && seen.has(key)) {
      return false;
    }
    if (seen) {
      seen.add(key);
    }
    repeatCount = Math.max(repeatCount, limitSuppressionRepeatCount(call));
  }

  const row = document.createElement("div");
  const time = cell();
  const args = renderArgs(call);
  const error = renderError(call);
  const visibleChildren = visibleChildNodes(call);
  const hasChildren = visibleChildren.length > 0;
  const collapsed = state.collapsedCallIds.has(call.id);
  decorateCallRow(row, call, displayDepth, repeatCount, treeOptions);
  if (repeatCount > 1) {
    row.dataset.repeatCount = String(repeatCount);
    row.title = `${repeatCount} identical calls grouped into this row.`;
  }
  row.setAttribute("role", "treeitem");
  row.setAttribute("aria-level", String(displayDepth + 1));
  row.addEventListener("click", (event) => {
    if (event.target.closest("a, button, input, label, select, textarea")) {
      return;
    }

    if (state.expandedCallIds.has(call.id)) {
      state.expandedCallIds.delete(call.id);
    } else {
      state.expandedCallIds.add(call.id);
    }
    render();
  });
  if (hasChildren) {
    row.setAttribute("aria-expanded", String(!collapsed));
  }

  if (call.blocked) {
    row.classList.add("blocked-row");
  }

  if (call.threw) {
    row.classList.add("threw-row");
  }

  if (state.filter && !callMatchesFilter(call)) {
    row.classList.add("context-row");
  }

  time.textContent = formatTime(call.time);
  if (error) {
    args.append(error);
  }

  row.append(
    time,
    renderFunction(call, {
      collapsed,
      ancestorGuides: treeOptions.ancestorGuides,
      displayDepth,
      hasChildren,
      isLastSibling: treeOptions.isLastSibling,
      repeatCount
    }),
    args,
    renderReturn(call),
    renderSource(call),
    renderAction(call)
  );
  container.append(row);

  if (!collapsed) {
    const childItems = groupedCallItems(renderableCallNodes(visibleChildren));
    const childAncestorGuides = treeStyleOptions(treeOptions).ancestorGuides.slice();
    if (displayDepth > 0) {
      childAncestorGuides.push(!treeStyleOptions(treeOptions).isLastSibling);
    }
    childItems.forEach((item, index) => {
      const childTreeOptions = {
        ancestorGuides: childAncestorGuides,
        isLastSibling: index === childItems.length - 1
      };
      if (item.type === "group") {
        renderCallNode(item.calls[0], container, displayDepth + 1, item.calls.length, options, childTreeOptions);
      } else {
        renderCallNode(item.call, container, displayDepth + 1, 1, options, childTreeOptions);
      }
    });
  }

  return true;
}

function visibleTrees() {
  return Array.from(state.trees.values())
    .filter((tree) => tree.rootCallIds.some((id) => {
      const root = state.callsById.get(id);
      return root && nodeMatchesDeep(root);
    }))
    .sort((first, second) => first.lastSeq - second.lastSeq);
}

function render() {
  const startedAt = performance.now();
  const trees = visibleTrees();
  const shouldAutoscroll = Boolean(autoscrollInput.checked);
  const previousScrollTop = logShell.scrollTop;
  const rows = eventRowModels(trees);
  const useVirtual = rows.length > EVENT_VIRTUAL_THRESHOLD;
  const range = useVirtual
    ? virtualRange(logShell, rows.length, state.eventRowHeight, EVENT_VIRTUAL_OVERSCAN_ROWS, shouldAutoscroll)
    : {
      end: rows.length,
      start: 0
    };
  const fragment = document.createDocumentFragment();

  callTree.textContent = "";

  if (useVirtual && range.start > 0) {
    fragment.append(createVirtualSpacer(range.start * state.eventRowHeight));
  }

  for (let index = range.start; index < range.end; index += 1) {
    const model = rows[index];
    fragment.append(createCallRow(model.call, model.displayDepth, model.repeatCount, {
      ancestorGuides: model.ancestorGuides,
      isLastSibling: model.isLastSibling
    }));
  }

  if (useVirtual && range.end < rows.length) {
    fragment.append(createVirtualSpacer((rows.length - range.end) * state.eventRowHeight));
  }

  callTree.append(fragment);
  updateMeasuredRowHeight("events", callTree, DEFAULT_EVENT_ROW_HEIGHT);
  state.lastTotalRenderableRows = rows.length;
  state.lastRenderedRowCount = range.end - range.start;
  state.lastRenderDurationMs = Math.round((performance.now() - startedAt) * 10) / 10;

  emptyState.hidden = rows.length > 0;
  if (!rows.length) {
    if (state.callOrder.length > 0 || state.totalCalls > 0) {
      emptyState.textContent = "Calls are being captured, but all rows are hidden by the current filters.";
    } else {
      emptyState.textContent = state.running ? "Listening for calls..." : "No calls captured.";
    }
  }

  if (shouldAutoscroll && rows.length > 0) {
    logShell.scrollTop = logShell.scrollHeight;
  } else {
    logShell.scrollTop = previousScrollTop;
  }
}

function latestFunctionCalls() {
  const latest = new Map();

  for (const callId of state.callOrder) {
    const call = state.callsById.get(callId);
    if (!call || !call.functionId || isInternalCall(call)) {
      continue;
    }

    latest.set(call.functionId, call);
  }

  return Array.from(latest.values())
    .filter((call) => !isHiddenCall(call))
    .filter((call) => callMatchesFunctionFilter(call))
    .sort((first, second) => Number(second.panelSeq || 0) - Number(first.panelSeq || 0));
}

function renderFunctionListRow(call) {
  const row = document.createElement("div");
  const time = cell();
  const args = renderArgs(call);
  const error = renderError(call);

  row.className = "function-row call-row";
  row.classList.toggle("updated-function-row", isFunctionUpdated(call.functionId));
  row.classList.toggle("starred-row", state.starredEventIds.has(call.id));
  row.classList.toggle("suppressed-row", Boolean(call.suppressed));
  row.addEventListener("click", (event) => {
    if (event.target.closest("a, button, input, label, select, textarea")) {
      return;
    }

    if (state.expandedCallIds.has(call.id)) {
      state.expandedCallIds.delete(call.id);
    } else {
      state.expandedCallIds.add(call.id);
    }
    renderFunctions();
  });

  if (state.expandedCallIds.has(call.id)) {
    row.classList.add("expanded-row");
  }

  if (call.blocked) {
    row.classList.add("blocked-row");
  }

  if (call.threw) {
    row.classList.add("threw-row");
  }

  time.textContent = formatTime(call.time);
  if (error) {
    args.append(error);
  }

  row.append(
    time,
    renderFunction(call, {
      collapsed: true,
      displayDepth: 0,
      hasChildren: false,
      repeatCount: Math.max(1, Number(state.functions.get(call.functionId) && state.functions.get(call.functionId).callCount || 1))
    }),
    args,
    renderReturn(call),
    renderSource(call),
    renderAction(call)
  );
  return row;
}

function renderVirtualTable(container, shell, items, renderItem, options = {}) {
  const threshold = options.threshold || TABLE_VIRTUAL_THRESHOLD;
  const rowHeight = options.rowHeight || state.tableRowHeight || DEFAULT_TABLE_ROW_HEIGHT;
  const overscan = options.overscan || TABLE_VIRTUAL_OVERSCAN_ROWS;
  const useVirtual = items.length > threshold;
  const range = useVirtual
    ? virtualRange(shell, items.length, rowHeight, overscan, false)
    : {
      end: items.length,
      start: 0
    };
  const fragment = document.createDocumentFragment();

  container.textContent = "";
  if (useVirtual && range.start > 0) {
    fragment.append(createVirtualSpacer(range.start * rowHeight));
  }
  for (let index = range.start; index < range.end; index += 1) {
    fragment.append(renderItem(items[index]));
  }
  if (useVirtual && range.end < items.length) {
    fragment.append(createVirtualSpacer((items.length - range.end) * rowHeight));
  }
  container.append(fragment);
  updateMeasuredRowHeight("table", container, DEFAULT_TABLE_ROW_HEIGHT);
  state.lastTotalRenderableRows = items.length;
  state.lastRenderedRowCount = range.end - range.start;
  return range.end - range.start;
}

function renderFunctions() {
  const startedAt = performance.now();
  const calls = latestFunctionCalls();
  renderVirtualTable(functionTable, functionsPanel, calls, renderFunctionListRow);
  state.lastRenderDurationMs = Math.round((performance.now() - startedAt) * 10) / 10;

  functionsEmptyState.hidden = calls.length > 0;
  if (!calls.length) {
    if (state.callOrder.length > 0 || state.totalCalls > 0) {
      functionsEmptyState.textContent = "Functions have been called, but all rows are hidden by the current filters.";
    } else {
      functionsEmptyState.textContent = state.running ? "Listening for called functions..." : "No functions called.";
    }
  }
}

function variableFilterText(variable) {
  return [
    variable.path,
    variable.kind,
    variable.frameLabel,
    variable.frameTitle,
    variable.frameUrl
  ].join(" ").toLowerCase();
}

function variableValueText(variable) {
  return [
    variable.displayValue,
    variable.value
  ].join(" ").toLowerCase();
}

function isImportantVariable(variable) {
  const text = String(variable && variable.path || "").toLowerCase();
  return Number(variable && variable.importance || 0) >= 4 ||
    /(?:^|[.\]_\s])(?:value|text|label|title|name|id|index|size|length|count|total|current|selected|active|visible|enabled|disabled|complete|status|mode|type|kind|progress|percent|remaining)(?:$|[.\]_\s])/i.test(text);
}

function isNoisyVariable(variable) {
  if (!variable) {
    return true;
  }

  if (isImportantVariable(variable)) {
    return false;
  }

  const path = String(variable.path || variable.id || "");
  const text = `${path} ${variable.kind || ""}`.toLowerCase();
  const importance = Number(variable.importance || 0);

  if (!path || variable.kind === "undefined" || importance <= 1) {
    return true;
  }

  if (/(?:webpack|jquery|react|angular|vue|svelte|analytics|tracking|advert|ads?|googletag|criteo|tcfapi|gpp)/i.test(text) && importance < 6) {
    return true;
  }

  if (/(?:^|\.)(?:alpha|cacheID|currentAnimationFrame|currentFrame|framerate|mouseEnabled|regX|regY|rotation|scaleX|scaleY|skewX|skewY|snapToPixel|tickEnabled|visible|x|y|zOrder)$/.test(path) && importance < 6) {
    return true;
  }

  return false;
}

function visibleVariables() {
  const filter = state.variableFilter;
  const valueSearch = state.variableValueSearch;
  const searching = Boolean(filter || valueSearch);
  return Array.from(state.variables.values())
    .filter((variable) => searching || !state.hideNoisy || !isNoisyVariable(variable))
    .filter((variable) => !filter || variableFilterText(variable).includes(filter))
    .filter((variable) => !valueSearch || variableValueText(variable).includes(valueSearch))
    .sort((first, second) => {
      const changed = String(second.lastChangedAt || "").localeCompare(String(first.lastChangedAt || ""));
      if (changed) {
        return changed;
      }
      return Number(second.importance || 0) - Number(first.importance || 0) || String(first.path || "").localeCompare(String(second.path || ""));
    });
}

function setVariableFilter(value) {
  state.variableFilter = String(value || "").trim().toLowerCase();
  filterInput.value = state.activeTab === "variables" ? state.variableFilter : filterInput.value;
  renderVariables();
}

function setVariableValueSearch(value) {
  state.variableValueSearch = String(value || "").trim().toLowerCase();
  variableSearchInput.value = state.variableValueSearch;
  renderVariables();
}

function parseVariableSegments(path) {
  const text = String(path || "").trim();
  if (!text) {
    return ["unknown"];
  }

  const suffixIndex = text.indexOf(" @ ");
  const base = suffixIndex >= 0 ? text.slice(0, suffixIndex) : text;
  const suffix = suffixIndex >= 0 ? text.slice(suffixIndex) : "";
  const segments = [];
  let current = "";
  let bracketDepth = 0;
  let quote = "";
  let escaped = false;

  for (const char of base) {
    if (quote) {
      current += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = "";
      }
      continue;
    }

    if (char === "\"" || char === "'") {
      quote = char;
      current += char;
      continue;
    }

    if (char === "[") {
      bracketDepth += 1;
      current += char;
      continue;
    }

    if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      current += char;
      continue;
    }

    if (char === "." && bracketDepth === 0) {
      if (current) {
        segments.push(current);
      }
      current = "";
      continue;
    }

    current += char;
  }

  if (current) {
    segments.push(current);
  }

  if (!segments.length) {
    segments.push(text);
  } else if (suffix) {
    segments[segments.length - 1] += suffix;
  }

  return segments;
}

function makeVariableGroup(path, label, depth) {
  return {
    children: [],
    depth,
    groupMap: new Map(),
    importance: 0,
    label,
    latest: "",
    path,
    type: "group",
    variableCount: 0
  };
}

function variableSortValue(item) {
  if (item.type === "group") {
    return item.latest || "";
  }
  return item.variable.lastChangedAt || item.variable.lastSeenAt || "";
}

function variableImportanceValue(item) {
  if (item.type === "group") {
    return Number(item.importance || 0);
  }
  return Number(item.variable.importance || 0);
}

function variableLabelValue(item) {
  if (item.type === "group") {
    return item.label || "";
  }
  return item.label || item.variable.path || item.variable.id || "";
}

function compareVariableTreeItems(first, second) {
  const changed = String(variableSortValue(second)).localeCompare(String(variableSortValue(first)));
  if (changed) {
    return changed;
  }

  const importance = variableImportanceValue(second) - variableImportanceValue(first);
  if (importance) {
    return importance;
  }

  if (first.type !== second.type) {
    return first.type === "group" ? -1 : 1;
  }

  return String(variableLabelValue(first)).localeCompare(String(variableLabelValue(second)));
}

function buildVariableTree(variables) {
  const root = makeVariableGroup("", "", -1);

  for (const variable of variables) {
    const segments = parseVariableSegments(variable.path || variable.id);
    let group = root;

    for (let index = 0; index < Math.max(0, segments.length - 1); index += 1) {
      const label = segments[index];
      const groupPath = group.path ? `${group.path}.${label}` : label;
      let child = group.groupMap.get(label);
      if (!child) {
        child = makeVariableGroup(groupPath, label, index);
        group.groupMap.set(label, child);
        group.children.push(child);
      }
      group = child;
    }

    const label = segments[segments.length - 1] || variable.path || variable.id;
    group.children.push({
      depth: Math.max(0, segments.length - 1),
      label,
      type: "variable",
      variable
    });
  }

  function finalize(group) {
    let count = 0;
    let latest = "";
    let importance = 0;

    for (const child of group.children) {
      if (child.type === "group") {
        finalize(child);
        count += child.variableCount;
        latest = String(child.latest || "").localeCompare(latest) > 0 ? child.latest : latest;
        importance = Math.max(importance, Number(child.importance || 0));
      } else {
        count += 1;
        const changed = child.variable.lastChangedAt || child.variable.lastSeenAt || "";
        latest = String(changed).localeCompare(latest) > 0 ? changed : latest;
        importance = Math.max(importance, Number(child.variable.importance || 0));
      }
    }

    group.variableCount = count;
    group.latest = latest;
    group.importance = importance;
    group.children.sort(compareVariableTreeItems);
  }

  finalize(root);
  return root;
}

function variableCell(className = "") {
  const node = document.createElement("div");
  node.className = className ? `variable-cell ${className}` : "variable-cell";
  return node;
}

function renderVariableNameCell(label, fullPath, depth, options = {}) {
  const pathCell = variableCell("variable-name-cell");
  const line = document.createElement("div");
  const body = document.createElement("span");
  const text = document.createElement("span");

  line.className = "variable-tree-line";
  line.style.setProperty("--tree-depth", String(depth));
  body.className = "tree-node-body";
  text.className = options.group ? "variable-group-name" : "variable-path";
  appendHighlightedText(text, label || fullPath, searchTerms(state.variableFilter));
  text.title = fullPath || label || "";
  appendTreeGuides(line, depth, options);

  if (options.group) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "call-toggle";
    toggle.setAttribute("aria-label", options.collapsed ? "Expand variable group" : "Collapse variable group");
    toggle.setAttribute("aria-expanded", String(!options.collapsed));
    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      if (state.collapsedVariableGroups.has(options.groupPath)) {
        state.collapsedVariableGroups.delete(options.groupPath);
      } else {
        state.collapsedVariableGroups.add(options.groupPath);
      }
      renderVariables();
    });
    body.append(toggle);
  } else {
    const spacer = document.createElement("span");
    spacer.className = "call-toggle-spacer";
    body.append(spacer);
  }

  body.append(text);
  line.append(body);
  pathCell.append(line);
  return pathCell;
}

function decorateVariableRow(row, item, options = {}) {
  const { ancestorGuides, isLastSibling } = treeStyleOptions(options);
  row.dataset.treeDepth = String(item.depth || 0);
  if (ancestorGuides.some(Boolean)) {
    row.dataset.treeGuides = ancestorGuides
      .map((enabled, index) => enabled ? String(index + 1) : "")
      .filter(Boolean)
      .join(",");
  }
  if (Number(item.depth || 0) > 0) {
    row.dataset.treeLastSibling = String(isLastSibling);
  }
}

function renderVariableGroupRow(group, treeOptions = {}) {
  const row = document.createElement("div");
  const collapsed = state.collapsedVariableGroups.has(group.path);
  row.className = "variable-row variable-group-row";
  decorateVariableRow(row, group, treeOptions);
  row.setAttribute("role", "treeitem");
  row.setAttribute("aria-expanded", String(!collapsed));

  const changed = variableCell();
  changed.textContent = formatTime(group.latest);

  const value = variableCell();
  value.textContent = `${group.variableCount} ${group.variableCount === 1 ? "variable" : "variables"}`;

  const kind = variableCell("variable-kind");
  kind.textContent = "group";

  const frame = variableCell();
  frame.textContent = "";

  const action = variableCell();
  row.append(
    changed,
    renderVariableNameCell(group.label, group.path, group.depth, {
      collapsed,
      ancestorGuides: treeOptions.ancestorGuides,
      group: true,
      groupPath: group.path,
      isLastSibling: treeOptions.isLastSibling
    }),
    value,
    kind,
    frame,
    action
  );

  row.addEventListener("click", () => {
    if (state.collapsedVariableGroups.has(group.path)) {
      state.collapsedVariableGroups.delete(group.path);
    } else {
      state.collapsedVariableGroups.add(group.path);
    }
    renderVariables();
  });

  return row;
}

function renderVariableRow(variable, depth = 0, label = "", treeOptions = {}) {
  const row = document.createElement("div");
  row.className = "variable-row";
  decorateVariableRow(row, { depth }, treeOptions);
  row.classList.toggle("starred-row", state.starredVariableIds.has(variable.id));
  row.classList.toggle("updated-variable-row", isVariableUpdated(variable.id));

  const changed = variableCell();
  changed.textContent = formatTime(variable.lastChangedAt || variable.lastSeenAt);

  const valueCell = variableCell();
  const value = document.createElement("span");
  value.className = "variable-value";
  appendHighlightedText(value, variable.displayValue || "", searchTerms(state.variableValueSearch));
  value.title = variable.displayValue || "";
  valueCell.append(value);

  const kind = variableCell("variable-kind");
  kind.textContent = variable.kind || "";

  const frame = variableCell();
  frame.textContent = variable.frameLabel || variable.framePath || "";
  frame.title = [variable.frameTitle, variable.frameUrl].filter(Boolean).join("\n");

  const action = variableCell();
  const starred = state.starredVariableIds.has(variable.id);
  const starButton = iconButton("star", starred ? "Unstar variable" : "Star variable", {
    className: "star-button",
    filled: starred,
    active: starred,
    title: starred ? "Remove this variable from Favorites." : "Save this variable to Favorites."
  });
  const editButton = iconButton("edit", "Edit variable", {
    title: variable.canEdit ? "Edit this variable as JSON." : "This variable is read-only or not JSON-editable."
  });
  const refreshButton = iconButton("refresh", "Refresh variable", {
    title: "Refresh this variable from the current page state."
  });
  const actionStack = document.createElement("div");
  actionStack.className = "action-stack icon-actions";
  starButton.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleFavoriteVariable(variable);
  });

  refreshButton.addEventListener("click", async (event) => {
    event.stopPropagation();
    refreshButton.disabled = true;
    await refreshVariable(variable);
    refreshButton.disabled = false;
  });

  editButton.disabled = !variable.canEdit;
  editButton.addEventListener("click", (event) => {
    event.stopPropagation();
    editVariable(variable);
  });
  actionStack.append(starButton, refreshButton, editButton);
  action.append(actionStack);

  row.append(changed, renderVariableNameCell(label || variable.path || variable.id, variable.path || variable.id, depth, {
    ancestorGuides: treeOptions.ancestorGuides,
    isLastSibling: treeOptions.isLastSibling
  }), valueCell, kind, frame, action);
  return row;
}

function renderVariableTreeItem(item, container, treeOptions = {}) {
  if (item.type === "group") {
    container.append(renderVariableGroupRow(item, treeOptions));
    if (!state.collapsedVariableGroups.has(item.path)) {
      const childAncestorGuides = treeStyleOptions(treeOptions).ancestorGuides.slice();
      if (item.depth > 0) {
        childAncestorGuides.push(!treeStyleOptions(treeOptions).isLastSibling);
      }
      item.children.forEach((child, index) => {
        renderVariableTreeItem(child, container, {
          ancestorGuides: childAncestorGuides,
          isLastSibling: index === item.children.length - 1
        });
      });
    }
    return;
  }

  container.append(renderVariableRow(item.variable, item.depth, item.label, treeOptions));
}

function flattenVariableTreeItem(item, rows, treeOptions = {}) {
  rows.push(Object.assign({}, item, {
    ancestorGuides: treeStyleOptions(treeOptions).ancestorGuides.slice(),
    isLastSibling: treeStyleOptions(treeOptions).isLastSibling
  }));
  if (item.type === "group" && !state.collapsedVariableGroups.has(item.path)) {
    const childAncestorGuides = treeStyleOptions(treeOptions).ancestorGuides.slice();
    if (item.depth > 0) {
      childAncestorGuides.push(!treeStyleOptions(treeOptions).isLastSibling);
    }
    item.children.forEach((child, index) => {
      flattenVariableTreeItem(child, rows, {
        ancestorGuides: childAncestorGuides,
        isLastSibling: index === item.children.length - 1
      });
    });
  }
}

function renderVariableTreeRow(item) {
  return item.type === "group"
    ? renderVariableGroupRow(item, item)
    : renderVariableRow(item.variable, item.depth, item.label, item);
}

function renderVariables() {
  const startedAt = performance.now();
  const variables = visibleVariables();
  const tree = buildVariableTree(variables);
  const rows = [];
  tree.children.forEach((item, index) => {
    flattenVariableTreeItem(item, rows, {
      ancestorGuides: [],
      isLastSibling: index === tree.children.length - 1
    });
  });
  renderVirtualTable(variableTable, variablesPanel, rows, renderVariableTreeRow);
  state.lastRenderDurationMs = Math.round((performance.now() - startedAt) * 10) / 10;

  variablesEmptyState.hidden = variables.length > 0;
  if (!variables.length) {
    if (state.variables.size > 0) {
      variablesEmptyState.textContent = "Variables are being tracked, but all rows are hidden by the filter or Hide noisy.";
    } else {
      variablesEmptyState.textContent = state.running
        ? "Scanning reachable page variables..."
        : "No variables found.";
    }
  }
}

function favoriteItems() {
  const items = [];
  for (const call of state.favoriteEvents.values()) {
    items.push({
      id: call.id,
      time: call.time || "",
      type: "event",
      value: call
    });
  }
  for (const variable of state.favoriteVariables.values()) {
    items.push({
      id: variable.id,
      time: variable.lastChangedAt || variable.lastSeenAt || "",
      type: "variable",
      value: variable
    });
  }

  const filter = state.favoriteFilter;
  return items
    .filter((item) => !filter || favoriteSearchText(item).includes(filter))
    .sort((first, second) => String(second.time || "").localeCompare(String(first.time || "")));
}

function favoriteCell(className = "") {
  const node = document.createElement("div");
  node.className = className ? `favorite-cell ${className}` : "favorite-cell";
  return node;
}

function renderFavoriteEvent(call) {
  const row = document.createElement("div");
  const fn = state.functions.get(call.functionId) || {};
  const type = favoriteCell("favorite-type");
  const name = favoriteCell();
  const detail = favoriteCell();
  const value = favoriteCell();
  const frame = favoriteCell();
  const action = favoriteCell();
  const actionStack = document.createElement("div");
  const unstarButton = iconButton("star", "Unstar event", {
    className: "star-button",
    filled: true,
    active: true,
    title: "Remove this event from Favorites."
  });
  const replayControls = renderReplayControls(call);
  const detailText = call.path || fn.path || call.functionId;
  const valueText = [
    call.args && call.args.length ? `args: ${call.args.join(", ")}` : "args: none",
    Object.prototype.hasOwnProperty.call(call, "returnValue") ? `return: ${call.returnValue}` : ""
  ].filter(Boolean).join(" | ");

  row.className = "favorite-row starred-row";
  type.textContent = "Event";

  const nameText = document.createElement("span");
  nameText.className = "favorite-name";
  nameText.textContent = displayFunctionName(call, fn);
  nameText.title = detailText;
  name.append(nameText);

  const detailNode = document.createElement("span");
  detailNode.className = "favorite-detail";
  detailNode.textContent = detailText;
  detailNode.title = detailText;
  detail.append(detailNode);

  const valueNode = document.createElement("span");
  valueNode.className = "favorite-value";
  valueNode.textContent = valueText || "none";
  valueNode.title = valueText || "none";
  value.append(valueNode);

  frame.textContent = call.frameLabel || call.framePath || "";
  frame.title = [call.frameTitle, call.frameUrl].filter(Boolean).join("\n");

  actionStack.className = "action-stack";
  unstarButton.addEventListener("click", (event) => {
    event.stopPropagation();
    unfavoriteCall(call.id);
    renderActiveView();
    renderFavorites();
  });
  actionStack.append(unstarButton);

  if (replayControls) {
    actionStack.append(replayControls);
  } else {
    const unavailable = document.createElement("span");
    unavailable.className = "muted";
    unavailable.textContent = "Replay unavailable";
    actionStack.append(unavailable);
  }

  action.append(actionStack);
  row.append(type, name, detail, value, frame, action);
  return row;
}

function renderFavoriteVariable(variable) {
  const row = document.createElement("div");
  const type = favoriteCell("favorite-type");
  const name = favoriteCell();
  const detail = favoriteCell();
  const value = favoriteCell();
  const frame = favoriteCell();
  const action = favoriteCell();
  const actionStack = document.createElement("div");
  const current = state.variables.get(variable.id) || variable;
  const unstarButton = iconButton("star", "Unstar variable", {
    className: "star-button",
    filled: true,
    active: true,
    title: "Remove this variable from Favorites."
  });
  const editButton = iconButton("edit", "Edit variable", {
    title: current.canEdit ? "Edit this variable as JSON." : "This variable is read-only or no longer available."
  });

  row.className = "favorite-row starred-row";
  row.classList.toggle("updated-variable-row", isVariableUpdated(current.id));
  type.textContent = "Variable";

  const nameNode = document.createElement("span");
  nameNode.className = "favorite-name";
  nameNode.textContent = current.path || current.id;
  nameNode.title = current.path || current.id;
  name.append(nameNode);

  const detailNode = document.createElement("span");
  detailNode.className = "favorite-detail";
  detailNode.textContent = current.kind || "";
  detailNode.title = current.kind || "";
  detail.append(detailNode);

  const valueNode = document.createElement("span");
  valueNode.className = "favorite-value";
  valueNode.textContent = current.displayValue || "";
  valueNode.title = current.displayValue || "";
  value.append(valueNode);

  frame.textContent = current.frameLabel || current.framePath || "";
  frame.title = [current.frameTitle, current.frameUrl].filter(Boolean).join("\n");

  actionStack.className = "action-stack icon-actions";
  unstarButton.addEventListener("click", (event) => {
    event.stopPropagation();
    unfavoriteVariable(current.id);
    renderVariables();
    renderFavorites();
  });

  editButton.disabled = !current.canEdit;
  editButton.addEventListener("click", (event) => {
    event.stopPropagation();
    editVariable(current);
  });

  actionStack.append(unstarButton, editButton);
  action.append(actionStack);
  row.append(type, name, detail, value, frame, action);
  return row;
}

function renderFavorites() {
  const items = favoriteItems();
  favoriteTable.textContent = "";
  for (const item of items) {
    favoriteTable.append(item.type === "event"
      ? renderFavoriteEvent(item.value)
      : renderFavoriteVariable(item.value));
  }

  favoritesEmptyState.hidden = items.length > 0;
  if (!items.length) {
    if (state.favoriteEvents.size || state.favoriteVariables.size) {
      favoritesEmptyState.textContent = "Favorites are hidden by the current filter.";
    } else {
      favoritesEmptyState.textContent = "No favorites starred.";
    }
  }
}

function setActiveTab(tab) {
  state.activeTab = tab === "functions" || tab === "variables" || tab === "favorites" ? tab : "events";
  const showFunctions = state.activeTab === "functions";
  const showVariables = state.activeTab === "variables";
  const showFavorites = state.activeTab === "favorites";
  const showEvents = state.activeTab === "events";

  eventsTab.classList.toggle("active", showEvents);
  eventsTab.setAttribute("aria-selected", String(showEvents));
  functionsTab.classList.toggle("active", showFunctions);
  functionsTab.setAttribute("aria-selected", String(showFunctions));
  variablesTab.classList.toggle("active", showVariables);
  variablesTab.setAttribute("aria-selected", String(showVariables));
  favoritesTab.classList.toggle("active", showFavorites);
  favoritesTab.setAttribute("aria-selected", String(showFavorites));
  eventsPanel.hidden = !showEvents;
  functionsPanel.hidden = !showFunctions;
  variablesPanel.hidden = !showVariables;
  favoritesPanel.hidden = !showFavorites;
  variableSearchInput.hidden = !showVariables;
  variableRefreshButton.hidden = !showVariables;
  blacklistInput.hidden = !(showEvents || showFunctions);
  autoscrollControl.hidden = !showEvents;
  hideNoisyControl.hidden = !(showEvents || showFunctions || showVariables);
  showMinifiedControl.hidden = !(showEvents || showFunctions);
  showMinifiedInput.checked = state.showMinifiedFunctions;
  traceHandlersControl.hidden = !(showEvents || showFunctions);
  traceHandlersInput.checked = state.traceEventHandlers;
  safeModeControl.hidden = !(showEvents || showFunctions);
  safeModeInput.checked = state.safeMode;
  continueAfterLimitControl.hidden = !(showEvents || showFunctions);
  continueAfterLimitInput.checked = state.continueTrackingAfterLimit;
  pauseRequestsControl.hidden = !(showEvents || showFunctions);
  pauseRequestsInput.checked = state.pauseNetworkRequests;
  pauseResponsesControl.hidden = !(showEvents || showFunctions);
  pauseResponsesInput.checked = state.pauseNetworkResponses;
  liveVariablesControl.hidden = false;
  liveVariablesInput.checked = state.liveVariables;

  filterInput.placeholder = showVariables ? "Filter variable names" : showFavorites ? "Filter favorites" : showFunctions ? "Filter called functions" : "Filter functions";
  filterInput.value = showVariables ? state.variableFilter : showFavorites ? state.favoriteFilter : showFunctions ? state.functionFilter : state.filter;
  variableSearchInput.value = state.variableValueSearch;

  if (showVariables) {
    renderVariables();
    setVariableWatchEnabled(true, true);
  } else if (showFunctions) {
    renderFunctions();
    setVariableWatchEnabled(state.liveVariables || state.starredVariableIds.size > 0, false);
  } else if (showFavorites) {
    renderFavorites();
    if (state.liveVariables || state.starredVariableIds.size > 0) {
      setVariableWatchEnabled(true, false);
    }
  } else {
    render();
    setVariableWatchEnabled(state.liveVariables || state.starredVariableIds.size > 0, false);
  }
}

function groupedSourceList(calls) {
  const seen = new Set();
  const sources = [];
  for (const call of calls) {
    const source = call.source || call.callSite || null;
    if (!source || !source.url) {
      continue;
    }

    const key = `${source.url}:${source.line || ""}:${source.column || ""}:${source.kind || ""}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    sources.push(source);
  }
  return sources;
}

function shouldSkipLimitSuppressionDuplicate(call, options = {}) {
  if (!hasMergedLimitSuppression(call)) {
    return false;
  }

  const key = callSuppressionMergeKey(call);
  const seen = options.limitSuppressionKeys || null;
  if (!seen) {
    return false;
  }

  if (seen.has(key)) {
    return true;
  }

  seen.add(key);
  return false;
}

function exportCallGroupItem(item, options = {}) {
  const call = item.type === "group" ? item.calls[0] : item.call;
  if (shouldSkipLimitSuppressionDuplicate(call, options)) {
    return null;
  }

  if (item.type === "group") {
    return exportCall(item.calls[0], item.calls, options);
  }

  return exportCall(item.call, null, options);
}

function exportCall(call, groupedCalls = null, options = {}) {
  const repeats = Array.isArray(groupedCalls) && groupedCalls.length > 1 ? groupedCalls : null;
  const repeatCount = Math.max(repeats ? repeats.length : 1, limitSuppressionRepeatCount(call));
  const children = [];
  for (const item of groupedCallItems(renderableCallNodes(visibleChildNodes(call)))) {
    const exportedChild = exportCallGroupItem(item, options);
    if (exportedChild) {
      children.push(exportedChild);
    }
  }

  const exported = {
    args: call.args || [],
    children,
    error: call.error || null,
    frameLabel: call.frameLabel || "",
    framePath: call.framePath || "",
    frameTitle: call.frameTitle || "",
    frameUrl: call.frameUrl || "",
    functionId: call.functionId,
    enclosingReplay: call.enclosingReplay || null,
    forceReplayArgs: Array.isArray(call.forceReplayArgs) ? call.forceReplayArgs : null,
    forceReplayError: call.forceReplayError || "",
    forceReplayThis: call.forceReplayThis || null,
    forceReplayable: Boolean(call.forceReplayable),
    id: call.id,
    name: call.name,
    note: call.note || "",
    parentCallId: call.parentCallId,
    path: call.path,
    returnValue: Object.prototype.hasOwnProperty.call(call, "returnValue") ? call.returnValue : null,
    replayArgs: Array.isArray(call.replayArgs) ? call.replayArgs : null,
    replayError: call.replayError || "",
    replayable: Boolean(call.replayable),
    repeatCount,
    source: call.source || call.callSite || null,
    sourceHint: Boolean(call.sourceHint),
    suppressed: Boolean(call.suppressed),
    trackingDisabledAfterLimit: hasMergedLimitSuppression(call),
    threw: Boolean(call.threw),
    time: call.time,
    treeId: call.treeId
  };

  if (repeats) {
    exported.groupedCallIds = repeats.map((item) => item.id);
    exported.groupedFirstTime = repeats[0].time || "";
    exported.groupedLastTime = repeats[repeats.length - 1].time || "";
    exported.groupedSources = groupedSourceList(repeats);
  }

  return exported;
}

function exportTree(tree, options = {}) {
  const roots = tree.rootCallIds
    .map((id) => state.callsById.get(id))
    .filter(Boolean);
  const exportedRoots = [];
  for (const item of groupedCallItems(renderableCallNodes(roots))) {
    const exportedRoot = exportCallGroupItem(item, options);
    if (exportedRoot) {
      exportedRoots.push(exportedRoot);
    }
  }

  return {
    callCount: tree.callCount,
    id: tree.id,
    lastTime: tree.lastTime,
    roots: exportedRoots
  };
}

function redactedDiagnosticUrl(value) {
  const text = String(value || "");
  if (!text) {
    return "";
  }

  try {
    const parsed = new URL(text);
    if (parsed.search) {
      parsed.search = "?...";
    }
    if (parsed.hash) {
      parsed.hash = "#...";
    }
    return parsed.href;
  } catch (error) {
    return text.replace(/[?#].*$/, (suffix) => suffix.charAt(0) === "?" ? "?..." : "#...");
  }
}

function summarizeFrameDiagnostics() {
  return state.diagnostics.map((diagnostic) => {
    const listenerCounts = diagnostic.listenerCounts || {};
    const options = diagnostic.options || {};
    return {
      domCaptureMode: diagnostic.domCaptureMode || "",
      frameLabel: diagnostic.frameLabel || "",
      framePath: diagnostic.framePath || "",
      frameTitle: diagnostic.frameTitle || "",
      frameUrl: redactedDiagnosticUrl(diagnostic.frameUrl || diagnostic.frame && diagnostic.frame.url || ""),
      libraryEventHooks: diagnostic.libraryEventHooks || [],
      listenerCounts: {
        activeDom: Number(listenerCounts.activeDom || 0),
        activeLibrary: Number(listenerCounts.activeLibrary || 0),
        frameworkEventHandlers: Number(listenerCounts.frameworkEventHandlers || 0),
        observedOnlyDom: Number(listenerCounts.observedOnlyDom || 0),
        wrappedDom: Number(listenerCounts.wrappedDom || 0)
      },
      options: {
        captureMinifiedFunctions: Boolean(options.captureMinifiedFunctions),
        continueTrackingAfterLimit: Boolean(options.continueTrackingAfterLimit),
        pauseNetworkRequests: Boolean(options.pauseNetworkRequests),
        pauseNetworkResponses: Boolean(options.pauseNetworkResponses),
        safeMode: Boolean(options.safeMode),
        wrapDomEventListeners: Boolean(options.wrapDomEventListeners)
      },
      sourceFileCount: Number(diagnostic.sourceFileCount || 0),
      sourceIndexStatus: diagnostic.sourceIndexStatus || "",
      suppressedNotices: Number(diagnostic.suppressedNotices || 0),
      variableFrameSkipped: Boolean(diagnostic.variableFrameSkipped),
      version: diagnostic.version || ""
    };
  });
}

function summarizeCaptureStatus() {
  const status = state.captureStatus || {};
  const reports = Array.isArray(status.reports) ? status.reports : [];
  let monitorFailed = 0;
  let monitorStarted = 0;
  let backgroundInjected = 0;
  const recentReports = reports.slice(-12).map((report) => ({
    error: report.error || "",
    frameId: Object.prototype.hasOwnProperty.call(report, "frameId") ? report.frameId : null,
    href: redactedDiagnosticUrl(report.href || ""),
    functionCount: Number(report.functionCount || 0),
    listenerCount: Number(report.listenerCount || 0),
    running: Boolean(report.running),
    status: report.status || "",
    time: report.time || "",
    top: Boolean(report.top)
  }));

  for (const report of reports) {
    if (!report) {
      continue;
    }
    if (report.status === "monitor-started") {
      monitorStarted += 1;
    } else if (report.status === "monitor-failed") {
      monitorFailed += 1;
    } else if (report.status === "background-frame-inject" || report.status === "background-enable") {
      backgroundInjected += 1;
    }
  }

  return {
    backgroundInjected,
    enabled: Boolean(status.enabled),
    enabledAt: status.enabledAt || "",
    monitorFailed,
    monitorStarted,
    recentReports,
    reportCount: reports.length
  };
}

function summarizeCallsForDiagnostics() {
  const calls = Array.from(state.callsById.values());
  let browserSequenceCalls = 0;
  let inferredCalls = 0;
  let listenerCalls = 0;
  let networkCalls = 0;
  let replayableCalls = 0;
  let suppressedCalls = 0;
  const names = new Set();

  for (const call of calls) {
    const name = String(call.name || call.path || "");
    if (name) {
      names.add(name);
    }
    if (/browser .* sequence/i.test(name)) {
      browserSequenceCalls += 1;
    }
    if (/\blistener\b/i.test(name)) {
      listenerCalls += 1;
    }
    if (/\binferred\b/i.test(name) || call.sourceHint) {
      inferredCalls += 1;
    }
    if (call.network) {
      networkCalls += 1;
    }
    if (call.replayable || call.forceReplayable) {
      replayableCalls += 1;
    }
    if (call.suppressed || hasMergedLimitSuppression(call)) {
      suppressedCalls += 1;
    }
  }

  return {
    browserOrListenerCalls: browserSequenceCalls + listenerCalls,
    browserSequenceCalls,
    inferredCalls,
    listenerCalls,
    networkCalls,
    replayableCalls,
    suppressedCalls,
    totalCalls: calls.length,
    uniqueFunctionNames: names.size
  };
}

function summarizeNetworkForDiagnostics() {
  const methods = {};
  const statuses = {};
  let pausedRequests = 0;
  let pausedResponses = 0;
  let requests = 0;
  let responses = 0;

  for (const record of state.networkRecords.values()) {
    const method = String(record.request && record.request.method || "GET").toUpperCase();
    methods[method] = (methods[method] || 0) + 1;
    if (record.request) {
      requests += 1;
    }
    if (record.response) {
      responses += 1;
      const status = String(record.response.status || 0);
      statuses[status] = (statuses[status] || 0) + 1;
    }
    if (record.paused && record.pausedPhase === "request") {
      pausedRequests += 1;
    }
    if (record.paused && record.pausedPhase === "response") {
      pausedResponses += 1;
    }
  }

  return {
    methods,
    pausedRequests,
    pausedResponses,
    records: state.networkRecords.size,
    requests,
    responses,
    statuses
  };
}

function diagnosticHints(frameSummary, callSummary, networkSummary, captureStatus) {
  const hints = [];
  const wrappedDom = frameSummary.reduce((total, frame) => total + Number(frame.listenerCounts && frame.listenerCounts.wrappedDom || 0), 0);
  const observedOnlyDom = frameSummary.reduce((total, frame) => total + Number(frame.listenerCounts && frame.listenerCounts.observedOnlyDom || 0), 0);
  const activeLibrary = frameSummary.reduce((total, frame) => total + Number(frame.listenerCounts && frame.listenerCounts.activeLibrary || 0), 0);

  if (!state.running) {
    hints.push("Capture is currently idle. Click Start or Reload + Capture before reproducing the behavior.");
  }
  if (!state.showMinifiedFunctions) {
    hints.push("Show minified functions is off, so short/minified functions may be omitted.");
  }
  if (!state.traceEventHandlers) {
    hints.push("Trace event handlers is off, so click rows may not include handler-local call trees.");
  }
  if (state.safeMode) {
    hints.push("Safe mode is on, so DOM input listeners are observed without wrapper tracing to preserve page input behavior.");
  }
  if (captureStatus.enabled && captureStatus.monitorStarted === 0) {
    hints.push("Background capture is enabled, but no frame has reported a started monitor yet.");
  }
  if (frameSummary.length === 0 && state.running) {
    hints.push("No frame diagnostics were reported. Reload + Capture may be needed for pages that create frames during load.");
  }
  if (observedOnlyDom > 0 && wrappedDom === 0 && activeLibrary === 0) {
    hints.push("Input listeners are being observed only; turn off Safe mode and use Reload + Capture when deeper handler trees are needed.");
  }
  if (callSummary.totalCalls > 0 && callSummary.browserOrListenerCalls === callSummary.totalCalls && networkSummary.records === 0) {
    hints.push("Captured rows are only browser sequences/listeners. This usually means the handler was registered before capture, hidden in a closure, or running in an inaccessible frame.");
  }
  if (networkSummary.records > 0 && networkSummary.responses === 0) {
    hints.push("Network requests were captured without matching responses yet. Pause/continue state or blocked requests may be involved.");
  }

  return hints;
}

function buildCaptureSummary() {
  const frameSummary = summarizeFrameDiagnostics();
  const callSummary = summarizeCallsForDiagnostics();
  const networkSummary = summarizeNetworkForDiagnostics();
  const statusSummary = summarizeCaptureStatus();
  return {
    calls: callSummary,
    captureStatus: statusSummary,
    frames: frameSummary,
    hints: diagnosticHints(frameSummary, callSummary, networkSummary, statusSummary),
    network: networkSummary,
    totals: {
      disabledFunctions: state.disabledIds.size,
      frames: state.frames.size || frameSummary.length,
      functions: state.functions.size,
      variables: state.variables.size
    }
  };
}

function buildExportPayload() {
  const trees = visibleTrees();
  const exportOptions = {
    limitSuppressionKeys: new Set()
  };

  return {
    captureStatus: state.captureStatus,
    diagnostics: {
      captureSummary: buildCaptureSummary(),
      exportedFromPanelAt: new Date().toISOString(),
      frames: state.diagnostics,
      panel: {
        autoscroll: autoscrollInput.checked,
        callOrderLength: state.callOrder.length,
        lastDrainPayloadSize: state.lastDrainPayloadSize,
        lastRenderDurationMs: state.lastRenderDurationMs,
        lastRenderedRowCount: state.lastRenderedRowCount,
        lastTotalRenderableRows: state.lastTotalRenderableRows,
        liveVariables: state.liveVariables,
        pauseNetworkRequests: state.pauseNetworkRequests,
        pauseNetworkResponses: state.pauseNetworkResponses,
        pollTimerActive: Boolean(state.pollTimer),
        renderLimit: state.renderLimit,
        running: state.running,
        showMinifiedFunctions: state.showMinifiedFunctions,
        safeMode: state.safeMode,
        traceEventHandlers: state.traceEventHandlers,
        continueTrackingAfterLimit: state.continueTrackingAfterLimit
      }
    },
    exportedAt: new Date().toISOString(),
    filters: {
      blacklist: state.blacklistFilter,
      favoriteText: state.favoriteFilter,
      functionText: state.functionFilter,
      hiddenFunctionIds: Array.from(state.hiddenFunctionIds),
      hideNoisy: state.hideNoisy,
      liveVariables: state.liveVariables,
      pauseNetworkRequests: state.pauseNetworkRequests,
      pauseNetworkResponses: state.pauseNetworkResponses,
      showMinifiedFunctions: state.showMinifiedFunctions,
      safeMode: state.safeMode,
      traceEventHandlers: state.traceEventHandlers,
      text: state.filter,
      variableNameText: state.variableFilter,
      variableValueText: state.variableValueSearch
    },
    favorites: {
      events: Array.from(state.favoriteEvents.values()),
      variables: Array.from(state.favoriteVariables.values())
    },
    functions: Array.from(state.functions.values()),
    frames: Array.from(state.frames.values()),
    network: Array.from(state.networkRecords.values()),
    metrics: {
      callsCaptured: state.totalCalls,
      callsInPanel: state.callOrder.length,
      disabledFunctions: state.disabledIds.size,
      favoriteEvents: state.favoriteEvents.size,
      favoriteVariables: state.favoriteVariables.size,
      functions: state.functions.size,
      variables: state.variables.size,
      visibleTrees: trees.length
    },
    trees: trees.map((tree) => exportTree(tree, exportOptions)).filter((tree) => tree.roots.length > 0),
    variables: visibleVariables(),
    version: 1
  };
}

async function downloadExport() {
  try {
    const latest = await callMonitor("drain", [{
      includeFunctions: true,
      includeNetwork: true,
      includeVariables: true
    }]);
    applyDrain(latest, { updateVariables: true });
  } catch (error) {
    // Export the panel's current state if the inspected page is unavailable.
  }

  const payload = buildExportPayload();
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  link.href = url;
  link.download = `js-disector-${timestamp}.json`;
  document.body.append(link);
  link.click();
  link.remove();

  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

startButton.addEventListener("click", async () => {
  startButton.disabled = true;
  try {
    const snapshot = await installMonitor();
    applySnapshot(snapshot);
    startPolling();
    renderActiveView();
  } catch (error) {
    setStatus("Start failed", "error");
  }
});

reloadButton.addEventListener("click", async () => {
  reloadButton.disabled = true;
  try {
    const source = `${await loadMonitorSource()}
try {
  if (window.__JAVASCREEN__ && typeof window.__JAVASCREEN__.setOptions === "function") {
    window.__JAVASCREEN__.setOptions(${JSON.stringify(monitorOptions())});
  }
} catch (error) {
}`;
    await setTabCaptureEnabled(true);
    resetLocalLog();
    state.installed = true;
    browser.devtools.inspectedWindow.reload({
      injectedScript: source
    });
    setStatus("Reloading", "live");
    startPolling();
  } catch (error) {
    state.installed = false;
    setStatus("Reload failed", "error");
  } finally {
    window.setTimeout(() => {
      reloadButton.disabled = false;
    }, 1200);
  }
});

stopButton.addEventListener("click", async () => {
  stopButton.disabled = true;
  try {
    const snapshot = await callMonitor("stop");
    await setTabCaptureEnabled(false);
    applySnapshot(snapshot);
    setStatus("Idle");
  } catch (error) {
    setStatus("Stop failed", "error");
  }
});

rescanButton.addEventListener("click", async () => {
  rescanButton.disabled = true;
  try {
    const snapshot = await callMonitor("rescan");
    applySnapshot(snapshot);
    if (state.activeTab === "variables") {
      await setVariableWatchEnabled(true, true);
    } else {
      renderActiveView();
    }
  } catch (error) {
    setStatus("Rescan failed", "error");
  } finally {
    rescanButton.disabled = false;
  }
});

variableRefreshButton.addEventListener("click", async () => {
  await refreshVariables();
});

clearButton.addEventListener("click", async () => {
  resetLocalLog();
  try {
    const snapshot = await callMonitor("clear");
    applySnapshot(snapshot);
  } catch (error) {
    state.totalCalls = 0;
    callCountNode.textContent = "0";
  }
  renderActiveView();
});

downloadButton.addEventListener("click", downloadExport);

filterInput.addEventListener("input", () => {
  if (state.activeTab === "variables") {
    setVariableFilter(filterInput.value);
  } else if (state.activeTab === "favorites") {
    state.favoriteFilter = filterInput.value.trim().toLowerCase();
    renderFavorites();
  } else if (state.activeTab === "functions") {
    state.functionFilter = filterInput.value.trim().toLowerCase();
    renderFunctions();
  } else {
    state.filter = filterInput.value.trim().toLowerCase();
    invalidateCallRenderCache();
    render();
  }
});

variableSearchInput.addEventListener("input", () => {
  setVariableValueSearch(variableSearchInput.value);
});

blacklistInput.addEventListener("input", () => {
  state.blacklistFilter = blacklistInput.value.trim().toLowerCase();
  invalidateCallRenderCache();
  if (state.activeTab === "functions") {
    renderFunctions();
  } else {
    render();
  }
});

hideNoisyInput.addEventListener("change", () => {
  state.hideNoisy = hideNoisyInput.checked;
  invalidateCallRenderCache();
  if (state.activeTab === "variables") {
    renderVariables();
  } else if (state.activeTab === "functions") {
    renderFunctions();
  } else if (state.activeTab === "favorites") {
    renderFavorites();
  } else {
    render();
  }
});

async function setShowMinifiedFunctions(enabled) {
  state.showMinifiedFunctions = Boolean(enabled);
  showMinifiedInput.checked = state.showMinifiedFunctions;
  invalidateCallRenderCache();
  renderActiveView();

  try {
    setStatus("Updating capture", "live");
    const snapshot = await callMonitor("setOptions", [monitorOptions()]);
    applySnapshot(snapshot);
    renderActiveView();
    setStatus(state.running ? "Live" : "Idle", state.running ? "live" : "idle");
  } catch (error) {
    setStatus("Capture update failed", "error");
  }
}

showMinifiedInput.addEventListener("change", () => {
  setShowMinifiedFunctions(showMinifiedInput.checked);
});

async function setTraceEventHandlers(enabled) {
  state.traceEventHandlers = Boolean(enabled);
  traceHandlersInput.checked = state.traceEventHandlers;
  renderActiveView();

  try {
    setStatus("Updating capture", "live");
    const snapshot = await callMonitor("setOptions", [monitorOptions()]);
    applySnapshot(snapshot);
    renderActiveView();
    setStatus(state.running ? "Live" : "Idle", state.running ? "live" : "idle");
  } catch (error) {
    setStatus("Capture update failed", "error");
  }
}

traceHandlersInput.addEventListener("change", () => {
  setTraceEventHandlers(traceHandlersInput.checked);
});

async function setSafeMode(enabled) {
  state.safeMode = Boolean(enabled);
  safeModeInput.checked = state.safeMode;
  renderActiveView();

  try {
    setStatus("Updating capture", "live");
    const snapshot = await callMonitor("setOptions", [monitorOptions()]);
    applySnapshot(snapshot);
    renderActiveView();
    setStatus(state.running ? "Live" : "Idle", state.running ? "live" : "idle");
  } catch (error) {
    setStatus("Capture update failed", "error");
  }
}

safeModeInput.addEventListener("change", () => {
  setSafeMode(safeModeInput.checked);
});

async function setContinueTrackingAfterLimit(enabled) {
  state.continueTrackingAfterLimit = Boolean(enabled);
  continueAfterLimitInput.checked = state.continueTrackingAfterLimit;

  try {
    setStatus("Updating capture", "live");
    const snapshot = await callMonitor("setOptions", [monitorOptions()]);
    applySnapshot(snapshot);
    renderActiveView();
    setStatus(state.running ? "Live" : "Idle", state.running ? "live" : "idle");
  } catch (error) {
    setStatus("Capture update failed", "error");
  }
}

continueAfterLimitInput.addEventListener("change", () => {
  setContinueTrackingAfterLimit(continueAfterLimitInput.checked);
});

async function setNetworkPauseOptions(options = {}) {
  if (Object.prototype.hasOwnProperty.call(options, "requests")) {
    state.pauseNetworkRequests = Boolean(options.requests);
  }
  if (Object.prototype.hasOwnProperty.call(options, "responses")) {
    state.pauseNetworkResponses = Boolean(options.responses);
  }
  pauseRequestsInput.checked = state.pauseNetworkRequests;
  pauseResponsesInput.checked = state.pauseNetworkResponses;

  try {
    setStatus("Updating capture", "live");
    const snapshot = await callMonitor("setOptions", [monitorOptions()]);
    applySnapshot(snapshot, { preserveEmptyVariables: true });
    renderActiveView();
    setStatus(state.running ? "Live" : "Idle", state.running ? "live" : "idle");
  } catch (error) {
    setStatus("Capture update failed", "error");
  }
}

pauseRequestsInput.addEventListener("change", () => {
  setNetworkPauseOptions({ requests: pauseRequestsInput.checked });
});

pauseResponsesInput.addEventListener("change", () => {
  setNetworkPauseOptions({ responses: pauseResponsesInput.checked });
});

liveVariablesInput.addEventListener("change", () => {
  state.liveVariables = liveVariablesInput.checked;
  if (state.liveVariables) {
    setVariableWatchEnabled(true, true);
  } else {
    setVariableWatchEnabled(false, false);
    if (state.activeTab === "variables") {
      renderVariables();
    } else if (state.activeTab === "favorites") {
      renderFavorites();
    }
  }
});

eventsTab.addEventListener("click", () => {
  setActiveTab("events");
});

functionsTab.addEventListener("click", () => {
  setActiveTab("functions");
});

variablesTab.addEventListener("click", () => {
  setActiveTab("variables");
});

favoritesTab.addEventListener("click", () => {
  setActiveTab("favorites");
});

logShell.addEventListener("scroll", () => {
  scheduleVirtualScrollRender("events");
});

functionsPanel.addEventListener("scroll", () => {
  scheduleVirtualScrollRender("functions");
});

variablesPanel.addEventListener("scroll", () => {
  scheduleVirtualScrollRender("variables");
});

window.addEventListener("beforeunload", () => {
  if (favoritesPersistTimer) {
    window.clearTimeout(favoritesPersistTimer);
    favoritesPersistTimer = 0;
    persistFavoritesNow();
  }
  stopPolling();
  setTabCaptureEnabled(false);
});

loadPersistedFavorites()
  .catch(() => false)
  .then(async () => {
    await refreshCaptureStatus(true);
    setStatus("Idle");
    renderActiveView();
  })
  .catch(() => {
    setStatus("Idle");
  });
