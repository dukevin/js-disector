# JS Disector

JS Disector is a Firefox DevTools extension that adds a `JS Disector` tab. The panel logs discoverable JavaScript function calls from the inspected page in real time as nested call trees, including call time, rendered parameters, a best-effort source location, and a per-function disable toggle.

## Load it in Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Click `Load Temporary Add-on...`.
3. Select this repository's `manifest.json`.
4. Open DevTools on a normal web page and select the `JS Disector` tab.

For a quick smoke test, open `examples/test-page.html` in Firefox after loading the extension.

Opening the `JS Disector` DevTools tab does not inject anything into normal browsing pages. Capture is scoped to the inspected tab only after you click `Start` or `Reload + Capture`, and it is turned off for that tab when you click `Stop` or close the panel.

If you are testing click handlers or framework code, click `Reload + Capture` in the JS Disector panel before interacting with the page. Many apps register button behavior as anonymous event listeners during page load. JS Disector can wrap those listeners when it is injected early, but Firefox does not expose a standard way for a WebExtension to enumerate listeners that were already registered before the panel opened.

`Reload + Capture` enables an all-frame capture script, reloads the inspected tab, and injects the monitor at document start in frames Firefox allows. This is required for pages that put the real app in a cross-origin iframe, because Firefox's DevTools eval API cannot target individual frames. The panel still sweeps reachable frames during polling so late-created same-origin iframes are not missed. Calls are prefixed with a frame label such as `top`, `frame 0`, `frame 0/0`, or a remote frame label. If a page puts the real application inside iframes, check the frame label on each tree.

## How it works

The panel uses Firefox's DevTools extension APIs to evaluate a monitor inside the inspected page. The monitor wraps discoverable global functions, methods on plain global objects, and event listeners registered after the monitor starts. When a wrapped function runs, JS Disector records the time, parameters, function path, parent call, and the best source location it can find.

Calls are grouped into root trees. If `a()` calls `b()` and `b()` calls `c()`, JS Disector renders `b()` under `a()` and `c()` under `b()`. Separate top-level callbacks create separate trees. Whenever any call inside a tree runs, that entire tree moves to the bottom because it is now the most recently active tree.

The `Return` column shows the serialized synchronous return value from each captured function. Promise-returning functions are shown as `[Promise]`; JS Disector does not await them.

Click `Download` to export the currently visible trees as JSON. The export respects the text filter and `Hide noisy` setting, and includes tree structure, frame labels, parameters, return values, source locations, and function metadata.

`Hide all instances` adds the function name to the blacklist filter so matching rows disappear retroactively and stay hidden until you edit or clear the blacklist. `Disable calls to this function` keeps the wrapper in place and returns `undefined` instead of calling the original function. Disabled calls are suppressed from the tree after the function is disabled. If a noisy function has already filled the panel, hide or disable it and then click `Clear`.

`Show minified functions` and `Trace event handlers` are enabled by default so JS Disector favors discovery over compatibility. Short/minified function names such as `a()`, `e()`, or `z()` are displayed, event listeners are wrapped when possible, and reachable functions are rescanned as options change.

If a page or game stops accepting input while capture is active, enable `Safe mode`. Safe mode observes input/event listeners without replacing them, so clicks stay native. It captures less of the handler-local tree, but still records observed browser input, discoverable functions, variables, and compatibility-friendly call hints.

## Local Regression Test

The repository includes a small iframe test page at `examples/javascreen-test-site/index.html` and a Playwright regression script at `tests/run-frame-monitor-test.mjs`. The test covers the failure mode where reload injection only reaches the top page and verifies that polling recovers reachable child-frame functions. It also exercises all-frame early capture and a two-origin wrapper/content iframe case. It clicks `Submit Answer` inside the frame and verifies that iframe calls such as `handleSubmitClick`, `submitAnswer`, and `calculateResult` are captured without logging internal JS Disector calls like `drain`.

Run it with the bundled Codex Node runtime by setting `JAVASCREEN_NODE_MODULES` to a Node modules folder containing Playwright. You can optionally set `JAVASCREEN_BROWSER_EXECUTABLE`; otherwise the script tries common Chrome/Edge install paths.

## HAR Structure Reports

For password-gated pages, use `tools/har-structure-summary.mjs` to create a redacted structure report from a browser HAR. The report is intended for JS Disector debugging and omits cookies, authorization headers, request bodies, response bodies, query values, and hash fragments.

Example:

```powershell
node tools\har-structure-summary.mjs "C:\path\to\capture.har" har-reports\site-structure.json
```

The output summarizes loaded frames/documents, scripts, likely framework clues, XHR/fetch-like endpoints, blocked requests, and JS Disector capture hints without replaying the session.

## Current limits

This version uses JavaScript wrapping, not a browser-engine debugger hook. It can see functions that are reachable from `window`, plain objects attached to `window`, and event listeners registered after JS Disector starts. It cannot guarantee every closure, module-local function, minified helper, private class method, or event listener that was already registered before JS Disector loaded will appear.

Source links are best effort. Same-origin and CORS-readable scripts can be searched for function definitions. When a definition cannot be found, JS Disector falls back to the call-site stack frame when Firefox exposes one.
