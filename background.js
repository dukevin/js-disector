"use strict";

const activeTabs = new Set();
const captureStatusByTab = new Map();
const MAX_STATUS_REPORTS = 80;
const CONTENT_ACTIVATION_KEY = "__JAVASCREEN_CONTENT_ALLOWED__";

function safeError(error) {
  return String(error && error.message ? error.message : error || "");
}

function ensureTabStatus(tabId) {
  if (!captureStatusByTab.has(tabId)) {
    captureStatusByTab.set(tabId, {
      enabledAt: "",
      reports: []
    });
  }

  return captureStatusByTab.get(tabId);
}

function rememberStatus(tabId, report) {
  if (!Number.isFinite(tabId)) {
    return;
  }

  const status = ensureTabStatus(tabId);
  status.reports.push(Object.assign({
    time: new Date().toISOString()
  }, report));

  if (status.reports.length > MAX_STATUS_REPORTS) {
    status.reports.splice(0, status.reports.length - MAX_STATUS_REPORTS);
  }
}

function tabIdFromMessage(message) {
  const id = Number(message && message.tabId);
  return Number.isFinite(id) ? id : null;
}

function senderTabId(sender) {
  const id = sender && sender.tab && Number(sender.tab.id);
  return Number.isFinite(id) ? id : null;
}

async function executeCaptureScript(tabId, details = {}) {
  const baseDetails = {
    matchAboutBlank: true,
    runAt: "document_start"
  };

  if (Number.isFinite(details.frameId)) {
    baseDetails.frameId = details.frameId;
  } else {
    baseDetails.allFrames = true;
  }

  try {
    await browser.tabs.executeScript(tabId, Object.assign({}, baseDetails, {
      code: `window[${JSON.stringify(CONTENT_ACTIVATION_KEY)}] = true;`
    }));
    await browser.tabs.executeScript(tabId, Object.assign({}, baseDetails, {
      file: "/content/javascreen-content.js"
    }));
    return { injected: true };
  } catch (error) {
    // Some inspected pages or frames do not allow extension scripts.
    return {
      error: safeError(error),
      injected: false
    };
  }
}

async function injectExistingFrames(tabId) {
  return executeCaptureScript(tabId);
}

async function injectCommittedFrame(details) {
  const tabId = Number(details && details.tabId);
  if (!Number.isFinite(tabId) || !activeTabs.has(tabId)) {
    return;
  }

  const frameId = Number(details.frameId);
  const result = await executeCaptureScript(tabId, Number.isFinite(frameId) ? { frameId } : {});
  rememberStatus(tabId, {
    frameId: Number.isFinite(frameId) ? frameId : undefined,
    href: details.url || "",
    injection: result,
    status: "background-frame-inject"
  });
}

function tabStatus(tabId) {
  const status = captureStatusByTab.get(tabId);
  if (!status) {
    return {
      enabled: activeTabs.has(tabId),
      reports: []
    };
  }

  return {
    enabled: activeTabs.has(tabId),
    enabledAt: status.enabledAt,
    reports: status.reports.slice()
  };
}

browser.runtime.onMessage.addListener((message, sender) => {
  const type = message && message.type;

  if (type === "javascreen-enable-tab") {
    const tabId = tabIdFromMessage(message);
    if (tabId === null) {
      return Promise.resolve({ enabled: false });
    }

    activeTabs.add(tabId);
    captureStatusByTab.set(tabId, {
      enabledAt: new Date().toISOString(),
      reports: []
    });
    return injectExistingFrames(tabId)
      .then((existingFrames) => {
        const registration = {
          registered: true,
          scopedToTab: true
        };
        rememberStatus(tabId, {
          existingFrames,
          registration,
          status: "background-enable"
        });
        return {
          enabled: true,
          existingFrames,
          registration
        };
      });
  }

  if (type === "javascreen-disable-tab") {
    const tabId = tabIdFromMessage(message);
    if (tabId !== null) {
      activeTabs.delete(tabId);
    }

    return Promise.resolve({ enabled: false });
  }

  if (type === "javascreen-capture-status") {
    const tabId = tabIdFromMessage(message);
    return Promise.resolve(tabId === null ? { enabled: false, reports: [] } : tabStatus(tabId));
  }

  if (type === "javascreen-should-activate") {
    const tabId = senderTabId(sender);
    return Promise.resolve({
      active: tabId !== null && activeTabs.has(tabId),
      tabId
    });
  }

  if (type === "javascreen-content-status") {
    const tabId = senderTabId(sender);
    if (Number.isFinite(tabId) && activeTabs.has(tabId)) {
      rememberStatus(tabId, {
        error: message.error || "",
        frameId: sender.frameId,
        functionCount: message.functionCount || 0,
        href: message.href || "",
        listenerCount: message.listenerCount || 0,
        recovered: Boolean(message.recovered),
        running: Boolean(message.running),
        status: message.status || "content-status",
        top: Boolean(message.top)
      });
    }

    return Promise.resolve({});
  }

  return Promise.resolve({});
});

browser.tabs.onRemoved.addListener((tabId) => {
  activeTabs.delete(tabId);
  captureStatusByTab.delete(tabId);
});

if (browser.webNavigation && browser.webNavigation.onCommitted) {
  browser.webNavigation.onCommitted.addListener((details) => {
    injectCommittedFrame(details);
  });
} else if (browser.tabs && browser.tabs.onUpdated) {
  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (activeTabs.has(tabId) && changeInfo && changeInfo.status === "loading") {
      injectExistingFrames(tabId).then((injection) => {
        rememberStatus(tabId, {
          injection,
          status: "background-loading-inject"
        });
      });
    }
  });
}
