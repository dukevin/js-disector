"use strict";

(() => {
  const ACTIVATION_KEY = "__JAVASCREEN_CONTENT_ALLOWED__";
  const BOOTSTRAP_KEY = "__JAVASCREEN_CONTENT_BOOTSTRAPPED__";
  const MONITOR_KEY = "__JAVASCREEN__";
  const STATUS_TYPE = "javascreen-content-status";

  function pageWindow() {
    return window.wrappedJSObject || window;
  }

  function serializeError(error) {
    if (!error) {
      return "";
    }

    return String(error && error.message ? error.message : error);
  }

  function isTopFrame() {
    try {
      return window.top === window;
    } catch (error) {
      return false;
    }
  }

  function sendStatus(status, details = {}) {
    try {
      browser.runtime.sendMessage(Object.assign({
        href: String(location.href || ""),
        status,
        time: new Date().toISOString(),
        top: isTopFrame(),
        type: STATUS_TYPE
      }, details));
    } catch (error) {
      // Diagnostics are best effort; capture should not depend on them.
    }
  }

  function pageEval(expression) {
    return window.eval(expression);
  }

  function isBootstrapped() {
    try {
      return Boolean(pageEval(`window[${JSON.stringify(BOOTSTRAP_KEY)}]`));
    } catch (error) {
      try {
        return Boolean(pageWindow()[BOOTSTRAP_KEY]);
      } catch (innerError) {
        return true;
      }
    }
  }

  function markBootstrapped() {
    try {
      pageEval(`window[${JSON.stringify(BOOTSTRAP_KEY)}] = true;`);
    } catch (error) {
      try {
        pageWindow()[BOOTSTRAP_KEY] = true;
      } catch (innerError) {
        // If we cannot mark the page context, do not keep trying in this frame.
      }
    }
  }

  function monitorSource() {
    const request = new XMLHttpRequest();
    request.open("GET", browser.runtime.getURL("devtools/injected-monitor.js"), false);
    request.overrideMimeType("text/plain");
    request.send(null);

    if (request.status && (request.status < 200 || request.status >= 300)) {
      throw new Error(`Monitor source load failed: ${request.status}`);
    }

    return `${request.responseText}\n//# sourceURL=javascreen-injected-monitor.js`;
  }

  function injectMonitor() {
    if (isBootstrapped()) {
      sendStatus("already-present");
      return;
    }

    markBootstrapped();
    sendStatus("injecting");

    try {
      const snapshot = pageEval(monitorSource());
      sendStatus("monitor-started", {
        functionCount: snapshot && snapshot.functionCount || 0,
        listenerCount: snapshot && snapshot.listenerCount || 0,
        running: Boolean(snapshot && snapshot.running)
      });
    } catch (error) {
      try {
        const monitor = pageWindow()[MONITOR_KEY];
        if (monitor && typeof monitor.start === "function") {
          const snapshot = monitor.start();
          sendStatus("monitor-started", {
            functionCount: snapshot && snapshot.functionCount || 0,
            listenerCount: snapshot && snapshot.listenerCount || 0,
            recovered: true,
            running: Boolean(snapshot && snapshot.running)
          });
          return;
        }
      } catch (innerError) {
        // Keep the original error; it points at the failed page-context eval.
      }

      sendStatus("monitor-failed", {
        error: serializeError(error)
      });
    }
  }

  if (window[ACTIVATION_KEY]) {
    injectMonitor();
  }
})();
