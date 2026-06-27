import { createServer } from "node:http";
import { createRequire } from "node:module";
import { existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const siteDir = path.join(rootDir, "examples", "javascreen-test-site");
const backgroundPath = path.join(rootDir, "background.js");
const contentScriptPath = path.join(rootDir, "content", "javascreen-content.js");
const manifestPath = path.join(rootDir, "manifest.json");
const monitorPath = path.join(rootDir, "devtools", "injected-monitor.js");
const panelPath = path.join(rootDir, "devtools", "panel.js");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function runExtensionActivationStaticTest() {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const backgroundSource = await readFile(backgroundPath, "utf8");
  const contentScriptSource = await readFile(contentScriptPath, "utf8");
  const panelSource = await readFile(panelPath, "utf8");

  assert(!manifest.content_scripts, "Manifest should not register JS Disector content scripts globally.");
  assert(Array.isArray(manifest.permissions) && manifest.permissions.includes("webNavigation"), "Manifest should include webNavigation for active-tab reinjection only.");
  assert(!backgroundSource.includes("contentScripts.register"), "Background should not globally register the injector for normal browsing.");
  assert(backgroundSource.includes("CONTENT_ACTIVATION_KEY"), "Background should mark explicitly enabled tab frames before injecting the content script.");
  assert(backgroundSource.includes("browser.tabs.executeScript"), "Background should inject scripts only through explicit tab execution.");
  assert(backgroundSource.includes("scopedToTab: true"), "Background should report capture as scoped to the inspected tab.");
  assert(backgroundSource.includes("webNavigation.onCommitted"), "Background should reinject only active inspected tabs on navigation.");
  assert(contentScriptSource.includes("ACTIVATION_KEY"), "Content script should require an activation flag.");
  assert(/if\s*\(\s*window\[ACTIVATION_KEY\]\s*\)\s*{\s*injectMonitor\(\);\s*}/.test(contentScriptSource), "Content script should inject only after explicit tab activation.");
  assert(!contentScriptSource.includes("javascreen-should-activate"), "Content script should not wake background pages during normal browsing.");
  assert(panelSource.includes("JS Disector capture is not started."), "Panel monitor calls should fail closed before Start or Reload + Capture.");
  assert(!panelSource.includes(".then(() => installMonitor())"), "Panel startup should not automatically install the monitor.");

  console.log("PASS extension injector stays inactive until Start or Reload + Capture.");
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) {
    return "text/html; charset=utf-8";
  }
  if (filePath.endsWith(".js")) {
    return "text/javascript; charset=utf-8";
  }
  return "text/plain; charset=utf-8";
}

function findNodeModules() {
  const candidates = [
    process.env.JAVASCREEN_NODE_MODULES,
    ...(process.env.NODE_PATH || "").split(path.delimiter)
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      let packageRoot = candidate;
      const pnpmRoot = path.join(candidate, ".pnpm");
      if (!existsSync(path.join(packageRoot, "playwright-core", "package.json")) && existsSync(pnpmRoot)) {
        const playwrightDir = readdirSync(pnpmRoot)
          .find((name) => name.startsWith("playwright@"));
        if (playwrightDir) {
          packageRoot = path.join(pnpmRoot, playwrightDir, "node_modules");
        }
      }

      const requireFromCandidate = createRequire(path.join(packageRoot, "playwright", "package.json"));
      requireFromCandidate.resolve("playwright");
      requireFromCandidate.resolve("playwright-core");
      return packageRoot;
    } catch (error) {
      // Keep looking.
    }
  }

  throw new Error("Set JAVASCREEN_NODE_MODULES to a node_modules folder that contains Playwright.");
}

function findBrowserExecutable() {
  const candidates = [
    process.env.JAVASCREEN_BROWSER_EXECUTABLE,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
  ].filter(Boolean);

  return candidates.find((candidate) => existsSync(candidate)) || "";
}

async function startServer() {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (url.pathname === "/api/answer") {
      let rawBody = "";
      request.setEncoding("utf8");
      for await (const chunk of request) {
        rawBody += chunk;
      }

      let parsed = null;
      try {
        parsed = rawBody ? JSON.parse(rawBody) : null;
      } catch (error) {
        parsed = { parseError: String(error && error.message || error), rawBody };
      }

      response.writeHead(200, {
        "access-control-allow-origin": "*",
        "content-type": "application/json; charset=utf-8"
      });
      response.end(JSON.stringify({
        answer: false,
        echoed: parsed
      }));
      return;
    }

    if (url.pathname === "/api/status") {
      response.writeHead(200, {
        "access-control-allow-origin": "*",
        "content-type": "application/json; charset=utf-8"
      });
      response.end(JSON.stringify({
        count: Number(url.searchParams.get("seq") || 0),
        message: "server original",
        source: "server"
      }));
      return;
    }

    const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
    const requested = path.resolve(siteDir, `.${decodeURIComponent(pathname)}`);

    if (!requested.startsWith(siteDir)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }

    try {
      const body = await readFile(requested);
      response.writeHead(200, { "content-type": contentType(requested) });
      response.end(body);
    } catch (error) {
      response.writeHead(404);
      response.end("Not found");
    }
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    close: () => new Promise((resolve) => server.close(resolve)),
    url: `http://127.0.0.1:${address.port}/index.html`
  };
}

async function startCrossOriginServers() {
  const childServer = createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    const pathname = url.pathname === "/" ? "/quiz.html" : url.pathname;
    const requested = path.resolve(siteDir, `.${decodeURIComponent(pathname)}`);

    if (!requested.startsWith(siteDir)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }

    try {
      const body = await readFile(requested);
      response.writeHead(200, { "content-type": contentType(requested) });
      response.end(body);
    } catch (error) {
      response.writeHead(404);
      response.end("Not found");
    }
  });

  await new Promise((resolve) => childServer.listen(0, "127.0.0.1", resolve));
  const childAddress = childServer.address();
  const childUrl = `http://127.0.0.1:${childAddress.port}/quiz.html`;

  const topServer = createServer((request, response) => {
    const html = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>JS Disector Cross-Origin Frame Test</title></head>
  <body>
    <h1>JS Disector Cross-Origin Frame Test</h1>
    <iframe id="quiz-frame" name="quiz-frame" src="${childUrl}" title="Quiz Frame"></iframe>
  </body>
</html>`;
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(html);
  });

  await new Promise((resolve) => topServer.listen(0, "127.0.0.1", resolve));
  const topAddress = topServer.address();

  return {
    close: async () => {
      await new Promise((resolve) => topServer.close(resolve));
      await new Promise((resolve) => childServer.close(resolve));
    },
    url: `http://127.0.0.1:${topAddress.port}/index.html`
  };
}

function callNames(calls) {
  return calls.map((call) => call.name).sort();
}

function hasAncestorCall(calls, call, ancestor) {
  if (!call || !ancestor) {
    return false;
  }

  const byId = new Map(calls.map((item) => [item.id, item]));
  let cursor = call;
  const seen = new Set();
  while (cursor && cursor.parentCallId && !seen.has(cursor.parentCallId)) {
    if (cursor.parentCallId === ancestor.id) {
      return true;
    }
    seen.add(cursor.parentCallId);
    cursor = byId.get(cursor.parentCallId);
  }
  return false;
}

function assertNoThrownCalls(calls, context) {
  const thrown = calls.filter((call) => call.threw || call.error);
  assert(!thrown.length, `${context} should not throw inside captured calls: ${thrown.map((call) => `${call.name}: ${call.error}`).join(", ")}`);
}

function diagnosticForFrame(payload, framePath = "top") {
  const diagnostics = payload && payload.snapshot && payload.snapshot.diagnostics || [];
  return diagnostics.find((diagnostic) => diagnostic.framePath === framePath);
}

function extractFrameBridge(panelSource) {
  const start = panelSource.indexOf("function javascreenFrameBridge");
  const end = panelSource.indexOf("\nfunction bridgeExpression", start);
  assert(start >= 0 && end > start, "Could not extract javascreenFrameBridge from panel.js.");
  return panelSource.slice(start, end).trim();
}

function topOnlyInitScript(source) {
  return `
(() => {
  let isTop = false;
  try {
    isTop = window.top === window;
  } catch (error) {
    isTop = false;
  }

  if (isTop) {
${source}
  }
})();
`;
}

async function callBridge(page, bridgeSource, action, args = []) {
  return page.evaluate(({ bridgeSource: source, action: bridgeAction, args: bridgeArgs }) => {
    const bridge = (0, eval)(`(${source})`);
    return bridge(bridgeAction, bridgeArgs || []);
  }, { bridgeSource, action, args });
}

async function quizFrame(page) {
  await page.waitForSelector("#quiz-frame");
  const frame = page.frame({ name: "quiz-frame" });
  assert(frame, "Expected quiz iframe to exist.");
  await frame.waitForSelector("#submit-answer");
  return frame;
}

function assertNoInternalCalls(calls) {
  assert(!calls.some((call) => String(call.path || "").includes("__JAVASCREEN_FRAME_FEED__")), "Internal frame-feed drain call leaked into capture.");
  assert(!calls.some((call) => String(call.path || "").includes("__JAVASCREEN__")), "Internal JS Disector call leaked into capture.");
}

function assertBrowserClickSequence(calls, targetPrefix) {
  const eventCalls = calls.filter((call) =>
    String(call.name || "").startsWith(targetPrefix) &&
    /(?:pointerdown|mousedown|pointerup|mouseup|click) event$/.test(String(call.name || "")));
  const clickEvent = eventCalls.find((call) => /click event$/.test(String(call.name || "")));
  const sequence = clickEvent && calls.find((call) => call.id === clickEvent.parentCallId);
  const requiredEvents = ["mousedown event", "mouseup event", "click event"];

  assert(clickEvent, `Expected ${targetPrefix} click event in browser sequence, got: ${callNames(calls).join(", ")}`);
  assert(sequence && String(sequence.name || "").includes("browser click sequence"), `Expected ${clickEvent.name} to be under a browser click sequence, got parent ${JSON.stringify(sequence)}.`);

  for (const eventName of requiredEvents) {
    const eventCall = eventCalls.find((call) => String(call.name || "").endsWith(eventName));
    assert(eventCall, `Expected ${targetPrefix} ${eventName} in browser sequence, got: ${eventCalls.map((call) => call.name).join(", ")}`);
    assert(eventCall.parentCallId === sequence.id, `Expected ${eventCall.name} to be a child of ${sequence.name}.`);
  }
}

function assertSnapshotHasChildFrameFunctions(payload) {
  const functions = payload && payload.snapshot && payload.snapshot.functions || [];
  assert(functions.some((fn) => fn.framePath === "top/0" && fn.name === "submitAnswer"), "Expected bridge snapshot to include child-frame submitAnswer.");
  assert(functions.some((fn) => fn.framePath === "top/0" && fn.name === "calculateResult"), "Expected bridge snapshot to include child-frame calculateResult.");
}

function assertLateInstalledQuizCalls(calls, payload) {
  const names = callNames(calls);
  const submitAnswer = calls.find((call) => call.name === "submitAnswer");
  const calculateResult = calls.find((call) => call.name === "calculateResult");

  assertNoInternalCalls(calls);
  assertSnapshotHasChildFrameFunctions(payload);
  assert(submitAnswer, `Expected late-installed child-frame submitAnswer call, got: ${names.join(", ")}`);
  assert(calculateResult, `Expected late-installed child-frame calculateResult call, got: ${names.join(", ")}`);
  assert(submitAnswer.framePath === "top/0", `Expected submitAnswer from top/0, got ${submitAnswer.framePath}.`);
  assert(calculateResult.parentCallId === submitAnswer.id, "Expected calculateResult to be a child of submitAnswer.");
}

function assertEarlyQuizCallTree(calls) {
  const names = callNames(calls);
  const handleSubmitClick = calls.find((call) => call.name === "handleSubmitClick");
  const submitAnswer = calls.find((call) => call.name === "submitAnswer");
  const calculateResult = calls.find((call) => call.name === "calculateResult");
  const handleParent = handleSubmitClick && calls.find((call) => call.id === handleSubmitClick.parentCallId);

  assertNoInternalCalls(calls);
  assertBrowserClickSequence(calls, "button submit-answer");
  assert(handleSubmitClick, `Expected iframe observed click listener handleSubmitClick call, got: ${names.join(", ")}`);
  assert(handleParent && handleParent.name.includes("click event"), "Expected handleSubmitClick to be listed under the observed click event.");
  assert(submitAnswer, `Expected iframe submitAnswer call, got: ${names.join(", ")}`);
  assert(calculateResult, `Expected iframe calculateResult call, got: ${names.join(", ")}`);
  assert(submitAnswer.framePath === "top/0", `Expected submitAnswer from top/0, got ${submitAnswer.framePath}.`);
  assert(calculateResult.parentCallId === submitAnswer.id, "Expected calculateResult to be a child of submitAnswer.");
}

function assertCrossOriginQuizCallTree(calls) {
  const names = callNames(calls);
  const handleSubmitClick = calls.find((call) => call.name === "handleSubmitClick");
  const submitAnswer = calls.find((call) => call.name === "submitAnswer");
  const calculateResult = calls.find((call) => call.name === "calculateResult");
  const handleParent = handleSubmitClick && calls.find((call) => call.id === handleSubmitClick.parentCallId);

  assertNoInternalCalls(calls);
  assertBrowserClickSequence(calls, "button submit-answer");
  assert(handleSubmitClick, `Expected cross-origin observed click listener handleSubmitClick call, got: ${names.join(", ")}`);
  assert(handleParent && handleParent.name.includes("click event"), "Expected cross-origin handleSubmitClick to be listed under the observed click event.");
  assert(submitAnswer, `Expected cross-origin iframe submitAnswer call, got: ${names.join(", ")}`);
  assert(calculateResult, `Expected cross-origin iframe calculateResult call, got: ${names.join(", ")}`);
  assert(String(submitAnswer.framePath || "").startsWith("remote:"), `Expected remote frame path, got ${submitAnswer.framePath}.`);
  assert(calculateResult.parentCallId === submitAnswer.id, "Expected cross-origin calculateResult to be a child of submitAnswer.");
}

async function runTopOnlyReloadBridgeTest(browser, serverUrl, bridgeSource, source) {
  const context = await browser.newContext();
  await context.addInitScript({ content: topOnlyInitScript(source) });
  const page = await context.newPage();

  try {
    await page.goto(serverUrl);
    const frame = await quizFrame(page);
    await page.waitForTimeout(1800);

    await callBridge(page, bridgeSource, "drain", [source]);
    await page.waitForTimeout(100);
    await frame.click("#submit-answer");
    await page.waitForTimeout(200);

    const payload = await callBridge(page, bridgeSource, "drain", [source]);
    const calls = payload.calls || [];
    assertLateInstalledQuizCalls(calls, payload);

    console.log(`PASS bridge recovered child frame after top-only reload injection: ${callNames(calls).join(", ")}`);
  } finally {
    await context.close();
  }
}

async function runAllFrameEarlyCaptureTest(browser, serverUrl, bridgeSource, source) {
  const context = await browser.newContext();
  await context.addInitScript({ content: source });
  const page = await context.newPage();

  try {
    await page.goto(serverUrl);
    const frame = await quizFrame(page);
    await page.waitForTimeout(1800);

    await callBridge(page, bridgeSource, "drain", [source]);
    await frame.click("#submit-answer");
    await page.waitForTimeout(200);

    const payload = await callBridge(page, bridgeSource, "drain", [source]);
    const calls = payload.calls || [];
    assertEarlyQuizCallTree(calls);

    const clickEvent = calls.find((call) => call.name === "button submit-answer click event");
    const clickListener = calls.find((call) => call.name === "handleSubmitClick");
    assert(clickEvent && clickEvent.forceReplayable, `Expected observed click event to be force replayable, got: ${JSON.stringify(clickEvent)}`);
    assert(clickEvent.forceReplayArgs && clickEvent.forceReplayArgs[0].type === "dom-event", `Expected observed click event force args to describe a DOM event, got: ${JSON.stringify(clickEvent.forceReplayArgs)}`);
    assert(clickListener && clickListener.forceReplayable, `Expected observed click listener to be force replayable, got: ${JSON.stringify(clickListener)}`);

    await callBridge(page, bridgeSource, "replay", [
      clickEvent.functionId,
      clickEvent.forceReplayArgs,
      { forceDescriptors: true }
    ]);
    await page.waitForTimeout(200);

    const replayPayload = await callBridge(page, bridgeSource, "drain", [source]);
    const replayCalls = replayPayload.calls || [];
    assertBrowserClickSequence(replayCalls, "button submit-answer");
    assert(replayCalls.some((call) => call.name === "submitAnswer"), `Expected force replayed click event to run submitAnswer, got: ${callNames(replayCalls).join(", ")}`);
    assert(replayCalls.some((call) => call.name === "calculateResult"), `Expected force replayed click event to run calculateResult, got: ${callNames(replayCalls).join(", ")}`);

    console.log(`PASS all-frame early capture preserved tree: ${callNames(calls).join(", ")}`);
  } finally {
    await context.close();
  }
}

async function runCrossOriginFrameFeedTest(browser, serverUrl, bridgeSource, source) {
  const context = await browser.newContext();
  await context.addInitScript({ content: source });
  const page = await context.newPage();

  try {
    await page.goto(serverUrl);
    const frame = await quizFrame(page);
    await page.waitForTimeout(1800);

    await callBridge(page, bridgeSource, "drain", [source]);
    await frame.click("#submit-answer");
    await page.waitForTimeout(300);

    const payload = await callBridge(page, bridgeSource, "drain", [source]);
    const calls = payload.calls || [];
    assertCrossOriginQuizCallTree(calls);

    console.log(`PASS cross-origin frame feed preserved tree: ${callNames(calls).join(", ")}`);
  } finally {
    await context.close();
  }
}

async function runGameSafeInputTest(browser, serverUrl, bridgeSource, source) {
  const context = await browser.newContext();
  await context.addInitScript({ content: source });
  const page = await context.newPage();
  const gameUrl = new URL("game.html", serverUrl).href;

  try {
    await page.goto(gameUrl);
    await page.waitForSelector("#play-button");
    await page.waitForTimeout(1800);

    await callBridge(page, bridgeSource, "drain", [source]);
    await page.click("#play-button");
    await page.waitForFunction(() => window.fragileGame && window.fragileGame.scene === "game");
    await page.locator("#game-canvas").click({
      position: {
        x: 80,
        y: 90
      }
    });
    await page.waitForTimeout(100);

    const gameState = await page.evaluate(() => ({
      cardClicks: window.fragileGame.cardClicks,
      progress: window.fragileGame.progress,
      score: window.fragileGame.scoreBoard.score,
      scene: window.fragileGame.scene,
      trace: window.fragileGame.trace.slice()
    }));
    const payload = await callBridge(page, bridgeSource, "drain", [source]);
    const calls = payload.calls || [];
    const names = callNames(calls);
    const playClickEvent = calls.find((call) => call.name === "div play-button btn-play click event");
    const playClickListener = calls.find((call) => call.name === "startGameClick");
    const canvasMouseDownEvent = calls.find((call) => call.name === "canvas game-canvas mousedown event");
    const canvasMouseDownListener = calls.find((call) => call.name === "canvasCardMouseDown");
    const beginLoading = calls.find((call) => call.name === "beginLoading");
    const cardDown = calls.find((call) => call.name === "cardDown");
    const addScore = calls.find((call) => call.name === "addScore");
    const finishLoading = calls.find((call) => call.name === "finishLoading");
    const diagnostic = diagnosticForFrame(payload, "top");

    assert(gameState.scene === "game", `Expected fragile game to reach game scene, got ${gameState.scene}. Trace: ${gameState.trace.join(", ")}`);
    assert(gameState.progress === 100, `Expected loading progress to reach 100, got ${gameState.progress}.`);
    assert(gameState.cardClicks === 1, `Expected canvas click to reach game listener, got cardClicks=${gameState.cardClicks}.`);
    assert(gameState.score === 1, `Expected prototype addScore to update score to 1, got ${gameState.score}.`);
    assertNoThrownCalls(calls, "Fragile game input test");
    assertBrowserClickSequence(calls, "div play-button btn-play");
    assertBrowserClickSequence(calls, "canvas game-canvas");
    assert(playClickEvent, `Expected observed play click event, got: ${names.join(", ")}`);
    assert(playClickListener, `Expected observed play click listener, got: ${names.join(", ")}`);
    assert(playClickListener.parentCallId === playClickEvent.id, "Expected play click listener to appear under the observed play click event.");
    assert(playClickListener.returnValue === "observed", `Expected play listener to be observed-only, got ${playClickListener.returnValue}.`);
    assert(String(playClickListener.note || "").includes("not wrapped"), "Expected play listener note to say it was not wrapped.");
    assert(canvasMouseDownEvent, `Expected observed canvas mousedown event, got: ${names.join(", ")}`);
    assert(canvasMouseDownListener, `Expected observed canvas mousedown listener, got: ${names.join(", ")}`);
    assert(canvasMouseDownListener.returnValue === "observed", `Expected canvas listener to be observed-only, got ${canvasMouseDownListener.returnValue}.`);
    assert(beginLoading, `Expected beginLoading method call to be logged, got: ${names.join(", ")}`);
    assert(beginLoading.parentCallId === playClickEvent.id, `Expected beginLoading to appear under the play click event, got parent ${beginLoading.parentCallId}.`);
    assert(cardDown, `Expected cardDown method call to be logged, got: ${names.join(", ")}`);
    assert(cardDown.parentCallId === canvasMouseDownEvent.id, `Expected cardDown to appear under the canvas mousedown event, got parent ${cardDown.parentCallId}.`);
    assert(addScore, `Expected prototype addScore method call to be logged, got: ${names.join(", ")}`);
    assert(addScore.parentCallId === cardDown.id, `Expected addScore to appear under cardDown in the click tree, got parent ${addScore.parentCallId}.`);
    assert(finishLoading, `Expected finishLoading method call to be logged, got: ${names.join(", ")}`);
    assert(diagnostic, "Expected diagnostics for the top frame.");
    assert(diagnostic.domCaptureMode === "observe DOM input listeners without wrapping so clicks remain native", `Unexpected DOM capture mode: ${diagnostic.domCaptureMode}`);
    assert(diagnostic.listenerCounts.wrappedDom === 0, `Expected zero wrapped DOM listeners, got ${diagnostic.listenerCounts.wrappedDom}.`);
    assert(diagnostic.listenerCounts.observedOnlyDom >= 6, `Expected observed DOM listener diagnostics, got ${JSON.stringify(diagnostic.listenerCounts)}.`);

    console.log(`PASS game-safe input fixture advanced scenes without blocking clicks: ${names.join(", ")}`);
  } finally {
    await context.close();
  }
}

async function runEventHandlerTracingTest(browser, serverUrl, bridgeSource, source) {
  const context = await browser.newContext();
  await context.addInitScript({
    content: `${source}
try {
  window.__JAVASCREEN__.setOptions({
    captureMinifiedFunctions: true,
    wrapDomEventListeners: true
  });
} catch (error) {
}`
  });
  const page = await context.newPage();
  const gameUrl = new URL("game.html", serverUrl).href;

  try {
    await page.goto(gameUrl);
    await page.waitForSelector("#play-button");
    await page.waitForTimeout(1800);

    await callBridge(page, bridgeSource, "drain", [source]);
    await page.click("#play-button");
    await page.waitForFunction(() => window.fragileGame && window.fragileGame.scene === "game");
    await page.locator("#game-canvas").click({
      position: {
        x: 80,
        y: 90
      }
    });
    await page.waitForTimeout(100);

    const gameState = await page.evaluate(() => ({
      cardClicks: window.fragileGame.cardClicks,
      progress: window.fragileGame.progress,
      score: window.fragileGame.scoreBoard.score,
      scene: window.fragileGame.scene
    }));
    const payload = await callBridge(page, bridgeSource, "drain", [source]);
    const calls = payload.calls || [];
    const names = callNames(calls);
    const playClickEvent = calls.find((call) => call.name === "div play-button btn-play click event");
    const playClickListener = calls.find((call) => call.name === "startGameClick");
    const canvasMouseDownEvent = calls.find((call) => call.name === "canvas game-canvas mousedown event");
    const canvasMouseDownListener = calls.find((call) => call.name === "canvasCardMouseDown");
    const beginLoading = calls.find((call) => call.name === "beginLoading");
    const cardDown = calls.find((call) => call.name === "cardDown");
    const addScore = calls.find((call) => call.name === "addScore");
    const diagnostic = diagnosticForFrame(payload, "top");

    assert(gameState.scene === "game", `Expected traced game to reach game scene, got ${gameState.scene}.`);
    assert(gameState.progress === 100, `Expected loading progress to reach 100, got ${gameState.progress}.`);
    assert(gameState.cardClicks === 1, `Expected canvas click to reach game listener, got cardClicks=${gameState.cardClicks}.`);
    assert(gameState.score === 1, `Expected addScore to update score to 1, got ${gameState.score}.`);
    assertNoThrownCalls(calls, "Event handler tracing test");
    assert(playClickEvent, `Expected observed play click event, got: ${names.join(", ")}`);
    assert(playClickListener, `Expected wrapped play click listener, got: ${names.join(", ")}`);
    assert(playClickListener.parentCallId === playClickEvent.id, "Expected wrapped play listener under the observed click event.");
    assert(playClickListener.returnValue !== "observed", "Expected play listener to be wrapped, not observed-only.");
    assert(!String(playClickListener.note || "").includes("not wrapped"), "Expected wrapped play listener not to use the observed-only note.");
    assert(beginLoading, `Expected beginLoading method call under traced listener, got: ${names.join(", ")}`);
    assert(beginLoading.parentCallId === playClickListener.id, `Expected beginLoading under startGameClick, got parent ${beginLoading.parentCallId}.`);
    assert(canvasMouseDownEvent, `Expected observed canvas mousedown event, got: ${names.join(", ")}`);
    assert(canvasMouseDownListener, `Expected wrapped canvas listener, got: ${names.join(", ")}`);
    assert(canvasMouseDownListener.parentCallId === canvasMouseDownEvent.id, "Expected canvas listener under the observed mousedown event.");
    assert(canvasMouseDownListener.returnValue !== "observed", "Expected canvas listener to be wrapped, not observed-only.");
    assert(cardDown, `Expected cardDown method call under traced listener, got: ${names.join(", ")}`);
    assert(cardDown.parentCallId === canvasMouseDownListener.id, `Expected cardDown under canvasCardMouseDown, got parent ${cardDown.parentCallId}.`);
    assert(addScore, `Expected addScore method call under cardDown, got: ${names.join(", ")}`);
    assert(addScore.parentCallId === cardDown.id, `Expected addScore to appear under cardDown, got parent ${addScore.parentCallId}.`);
    assert(diagnostic, "Expected diagnostics for the top frame.");
    assert(diagnostic.domCaptureMode === "aggressive mode: wrap DOM input listeners to trace event-handler call trees", `Unexpected DOM capture mode: ${diagnostic.domCaptureMode}`);
    assert(diagnostic.listenerCounts.wrappedDom >= 2, `Expected wrapped DOM listener diagnostics, got ${JSON.stringify(diagnostic.listenerCounts)}.`);

    console.log(`PASS event-handler trace mode nests handler calls without blocking clicks: ${names.join(", ")}`);
  } finally {
    await context.close();
  }
}

async function runFrameworkEventHandlerDiscoveryTest(browser, serverUrl, bridgeSource, source) {
  const context = await browser.newContext();
  await context.addInitScript({
    content: `${source}
try {
  window.__JAVASCREEN__.setOptions({
    captureMinifiedFunctions: true,
    wrapDomEventListeners: true
  });
} catch (error) {
}`
  });
  const page = await context.newPage();
  const appUrl = new URL("framework-handlers.html", serverUrl).href;

  try {
    await page.goto(appUrl);
    await page.waitForSelector("#answer-a");
    await callBridge(page, bridgeSource, "rescan", [source]);
    await callBridge(page, bridgeSource, "drain", [source]);
    await page.click("#answer-a");
    await page.waitForFunction(() => window.frameworkQuiz && window.frameworkQuiz.loaded === 1);

    const payload = await callBridge(page, bridgeSource, "drain", [source]);
    const calls = payload.calls || [];
    const names = callNames(calls);
    const clickEvent = calls.find((call) => call.name === "button answer-a browser click sequence" || call.name === "button answer-a \"Answer A\" browser click sequence")
      || calls.find((call) => /button answer-a.*click event/.test(call.name));
    const frameworkInvoker = calls.find((call) => call.name === "frameworkInvoker");
    const frameworkHandler = calls.find((call) => /onClick\.value handler$/.test(call.name));
    const submitAnswer = calls.find((call) => call.name === "submitAnswer");
    const checkAnswer = calls.find((call) => call.name === "checkAnswer");
    const loadNextQuestion = calls.find((call) => call.name === "loadNextQuestion");
    const diagnostic = diagnosticForFrame(payload, "top");

    assertNoThrownCalls(calls, "Framework event handler discovery test");
    assert(clickEvent, `Expected framework fixture click event, got: ${names.join(", ")}`);
    assert(frameworkInvoker, `Expected low-level framework invoker listener, got: ${names.join(", ")}`);
    assert(frameworkHandler, `Expected DOM-stored framework onClick callback, got: ${names.join(", ")}`);
    assert(frameworkHandler.parentCallId === frameworkInvoker.id, `Expected framework handler under invoker, got parent ${frameworkHandler.parentCallId}.`);
    assert(submitAnswer, `Expected submitAnswer call from framework handler, got: ${names.join(", ")}`);
    assert(submitAnswer.parentCallId === frameworkHandler.id, `Expected submitAnswer under framework handler, got parent ${submitAnswer.parentCallId}.`);
    assert(checkAnswer && checkAnswer.parentCallId === submitAnswer.id, `Expected checkAnswer under submitAnswer, got ${JSON.stringify(checkAnswer)}.`);
    assert(loadNextQuestion && loadNextQuestion.parentCallId === submitAnswer.id, `Expected loadNextQuestion under submitAnswer, got ${JSON.stringify(loadNextQuestion)}.`);
    assert(diagnostic && diagnostic.listenerCounts.frameworkEventHandlers >= 1, `Expected framework handler diagnostics, got ${JSON.stringify(diagnostic && diagnostic.listenerCounts)}.`);

    await callBridge(page, bridgeSource, "drain", [source]);
    await page.click("#closure-answer");
    await page.waitForFunction(() => document.querySelector("#result").textContent === "closure:B");
    const closurePayload = await callBridge(page, bridgeSource, "drain", [source]);
    const closureCalls = closurePayload.calls || [];
    const closureNames = callNames(closureCalls);
    const closureHandler = closureCalls.find((call) => /Closure Answer.*onClick\.value handler$/.test(call.name));
    const sendAnswerHint = closureCalls.find((call) => call.name === "sendAnswer() inferred");
    const answerClassHint = closureCalls.find((call) => call.name === "answerClass() inferred");
    const nextHint = closureCalls.find((call) => call.name === "next() inferred");

    assert(closureHandler, `Expected closure framework handler, got: ${closureNames.join(", ")}`);
    assert(sendAnswerHint, `Expected inferred sendAnswer source-call hint, got: ${closureNames.join(", ")}`);
    assert(sendAnswerHint.parentCallId === closureHandler.id, `Expected sendAnswer hint under closure framework handler, got parent ${sendAnswerHint.parentCallId}.`);
    assert(answerClassHint && answerClassHint.parentCallId === sendAnswerHint.id, `Expected inferred answerClass render-related hint under sendAnswer, got: ${closureNames.join(", ")}`);
    assert(nextHint && nextHint.parentCallId === sendAnswerHint.id, `Expected inferred next render-related hint under sendAnswer, got: ${closureNames.join(", ")}`);
    assert(sendAnswerHint.returnValue === "source hint", `Expected source hint return marker, got ${sendAnswerHint.returnValue}.`);
    assert(sendAnswerHint.enclosingReplay && sendAnswerHint.enclosingReplay.functionId, `Expected sendAnswer hint to preserve enclosing handler replay metadata, got ${JSON.stringify(sendAnswerHint)}.`);

    await callBridge(page, bridgeSource, "replay", [
      sendAnswerHint.enclosingReplay.functionId,
      sendAnswerHint.enclosingReplay.forceReplayArgs || sendAnswerHint.enclosingReplay.replayArgs,
      {
        forceDescriptors: Boolean(sendAnswerHint.enclosingReplay.forceReplayArgs)
      }
    ]);
    await page.waitForFunction(() => window.frameworkClosureState && window.frameworkClosureState.sent === 2);
    const closureReplayPayload = await callBridge(page, bridgeSource, "drain", [source]);
    const replayedClosureCalls = closureReplayPayload.calls || [];
    assert(replayedClosureCalls.some((call) => /Closure Answer.*onClick\.value handler$/.test(call.name)), `Expected replay enclosing handler to run closure handler, got ${callNames(replayedClosureCalls).join(", ")}`);
    assert(replayedClosureCalls.some((call) => call.name === "sendAnswer() inferred"), `Expected replay enclosing handler to emit sendAnswer source hint, got ${callNames(replayedClosureCalls).join(", ")}`);

    await callBridge(page, bridgeSource, "drain", [source]);
    await page.click("#replay-correct-answer");
    await page.waitForFunction(() => window.frameworkReplayQuizState && window.frameworkReplayQuizState.question === 1);
    const correctSequencePayload = await callBridge(page, bridgeSource, "drain", [source]);
    const correctSequenceCalls = correctSequencePayload.calls || [];
    const correctSequenceNames = callNames(correctSequenceCalls);
    const correctSequenceHint = correctSequenceCalls.find((call) =>
      call.name === "sendAnswer() inferred" &&
      /Replay Correct Answer/.test(String(call.path || "")));

    assert(correctSequenceHint, `Expected captured correct-answer source hint, got ${correctSequenceNames.join(", ")}`);
    assert(correctSequenceHint.enclosingReplay && correctSequenceHint.enclosingReplay.functionId, `Expected correct-answer source hint to preserve enclosing handler replay metadata, got ${JSON.stringify(correctSequenceHint)}.`);

    await callBridge(page, bridgeSource, "replay", [
      correctSequenceHint.enclosingReplay.functionId,
      correctSequenceHint.enclosingReplay.forceReplayArgs || correctSequenceHint.enclosingReplay.replayArgs,
      {
        directHandler: true,
        forceDescriptors: Boolean(correctSequenceHint.enclosingReplay.forceReplayArgs)
      }
    ]);
    await page.waitForFunction(() => window.frameworkReplayQuizState && window.frameworkReplayQuizState.question === 2);
    const directReplayState = await page.evaluate(() => Object.assign({}, window.frameworkReplayQuizState, {
      currentTargetMarker: document.querySelector("#replay-correct-answer").dataset.directReplayCurrentTarget,
      result: document.querySelector("#result").textContent
    }));
    const directReplayPayload = await callBridge(page, bridgeSource, "drain", [source]);
    const directReplayCalls = directReplayPayload.calls || [];
    const directReplayNames = callNames(directReplayCalls);

    assert(directReplayState.correct === 2 && directReplayState.wrong === 0, `Expected direct handler replay to count as a second correct answer, got ${JSON.stringify(directReplayState)}.`);
    assert(directReplayState.domClicks === 1, `Expected direct handler replay not to dispatch a second DOM click, got ${JSON.stringify(directReplayState)}.`);
    assert(directReplayState.handlerRuns === 2, `Expected captured handler to run twice, got ${JSON.stringify(directReplayState)}.`);
    assert(directReplayState.currentTargetMarker === "captured", `Expected direct replay event to preserve currentTarget for the captured handler, got ${JSON.stringify(directReplayState)}.`);
    assert(directReplayState.result === "replay-correct:first-correct", `Expected direct replay to keep the correct-answer result, got ${JSON.stringify(directReplayState)}.`);
    assert(directReplayCalls.some((call) => /Replay Correct Answer.*onClick\.value handler/.test(call.name)), `Expected direct replay to log the captured framework handler, got ${directReplayNames.join(", ")}`);
    assert(directReplayCalls.some((call) => call.name === "sendAnswer() inferred" && /Replay Correct Answer/.test(String(call.path || ""))), `Expected direct replay to emit sendAnswer source hint, got ${directReplayNames.join(", ")}`);
    assert(!directReplayCalls.some((call) => /Replay Correct Answer.*browser click sequence/.test(call.name)), `Expected direct handler replay not to create a browser click sequence, got ${directReplayNames.join(", ")}`);

    await callBridge(page, bridgeSource, "drain", [source]);
    await page.click("#vue-answer");
    await page.waitForFunction(() => window.frameworkVueState && window.frameworkVueState.next === 1);
    const vuePayload = await callBridge(page, bridgeSource, "drain", [source]);
    const vueCalls = vuePayload.calls || [];
    const vueNames = callNames(vueCalls);
    const vueHandler = vueCalls.find((call) => /Vue Answer.*onClick\.value handler$/.test(call.name));
    const vueSendAnswer = vueCalls.find((call) => call.name === "sendAnswer" && /__vueParentComponent/.test(call.path || ""));
    const vueAnswerClass = vueCalls.find((call) => call.name === "answerClass" && /__vueParentComponent/.test(call.path || ""));
    const vueNext = vueCalls.find((call) => call.name === "next" && /__vueParentComponent/.test(call.path || ""));

    assert(vueHandler, `Expected Vue-style framework handler, got: ${vueNames.join(", ")}`);
    assert(vueSendAnswer, `Expected Vue component sendAnswer method to be wrapped, got: ${vueNames.join(", ")}`);
    assert(vueSendAnswer.parentCallId === vueHandler.id, `Expected Vue sendAnswer under framework handler, got parent ${vueSendAnswer.parentCallId}.`);
    assert(vueAnswerClass && vueAnswerClass.parentCallId === vueSendAnswer.id, `Expected answerClass under Vue sendAnswer, got ${JSON.stringify(vueAnswerClass)}.`);
    assert(vueNext && vueNext.parentCallId === vueSendAnswer.id, `Expected next under Vue sendAnswer, got ${JSON.stringify(vueNext)}.`);

    await callBridge(page, bridgeSource, "drain", [source]);
    await page.click("#react-counter");
    await page.waitForFunction(() => document.querySelector("#react-result").textContent === "react:1");
    const reactPayload = await callBridge(page, bridgeSource, "drain", [source]);
    const reactCalls = reactPayload.calls || [];
    const reactNames = callNames(reactCalls);
    const reactIncrement = reactCalls.find((call) => call.name === "increment" && /__reactFiber/.test(call.path || ""));
    const reactCalculateNext = reactCalls.find((call) => call.name === "calculateNext" && /__reactFiber/.test(call.path || ""));

    assert(reactIncrement, `Expected React class component increment method to be wrapped, got: ${reactNames.join(", ")}`);
    assert(reactCalculateNext && reactCalculateNext.parentCallId === reactIncrement.id, `Expected calculateNext under React increment, got ${JSON.stringify(reactCalculateNext)}.`);

    await callBridge(page, bridgeSource, "drain", [source]);
    await page.click("#angular-answer");
    await page.waitForFunction(() => document.querySelector("#angular-result").textContent === "angular:correct:5");
    const angularPayload = await callBridge(page, bridgeSource, "drain", [source]);
    const angularCalls = angularPayload.calls || [];
    const angularNames = callNames(angularCalls);
    const angularSendAnswer = angularCalls.find((call) => call.name === "sendAnswer" && /__ngContext/.test(call.path || ""));
    const angularApplyScore = angularCalls.find((call) => call.name === "applyScore" && /__ngContext/.test(call.path || ""));

    assert(angularSendAnswer, `Expected Angular component sendAnswer method to be wrapped, got: ${angularNames.join(", ")}`);
    assert(angularApplyScore && angularApplyScore.parentCallId === angularSendAnswer.id, `Expected Angular applyScore under sendAnswer, got ${JSON.stringify(angularApplyScore)}.`);

    await callBridge(page, bridgeSource, "setVariableWatch", [true, { forceScan: true }]);
    const variablePayload = await callBridge(page, bridgeSource, "drain", [source]);
    const variables = variablePayload.snapshot && variablePayload.snapshot.variables || [];
    const reactHookState = variables.find((variable) => /^react\.fiber\.ReactHookCounter\[\d+\]\.hooks\[0\]\.state$/.test(variable.path || ""));
    const reactClassCount = variables.find((variable) => /^react\.fiber\.ReactCounterComponent\[\d+\]\.state\.count$/.test(variable.path || ""));
    const angularAnswered = variables.find((variable) => /^angular\.component\.AngularQuestionComponent\[\d+\]\.localQuestion\.answered$/.test(variable.path || ""));
    const angularScore = variables.find((variable) => /^angular\.component\.AngularQuestionComponent\[\d+\]\.score$/.test(variable.path || ""));

    assert(reactHookState && reactHookState.canEdit, `Expected editable React hook state variable, got ${JSON.stringify(reactHookState)} from ${variables.slice(0, 30).map((variable) => variable.path).join(", ")}`);
    assert(reactClassCount && reactClassCount.value === 1, `Expected React class state count variable to be 1, got ${JSON.stringify(reactClassCount)}.`);
    assert(angularAnswered && angularAnswered.value === "angular-correct", `Expected Angular localQuestion.answered variable, got ${JSON.stringify(angularAnswered)}.`);
    assert(angularScore && angularScore.value === 5, `Expected Angular score variable, got ${JSON.stringify(angularScore)}.`);

    await callBridge(page, bridgeSource, "setVariable", [reactHookState.id, 7]);
    await page.waitForFunction(() => document.querySelector("#react-hook-result").textContent === "hook:7");
    await callBridge(page, bridgeSource, "setVariable", [angularAnswered.id, "manual-answer"]);
    const editedFrameworkState = await page.evaluate(() => ({
      angularAnswered: window.ng.getComponent(document.querySelector("#angular-answer")).localQuestion.answered,
      reactHookText: document.querySelector("#react-hook-result").textContent
    }));

    assert(editedFrameworkState.reactHookText === "hook:7", `Expected React hook state edit to update fixture output, got ${JSON.stringify(editedFrameworkState)}.`);
    assert(editedFrameworkState.angularAnswered === "manual-answer", `Expected Angular component variable edit to update component state, got ${JSON.stringify(editedFrameworkState)}.`);

    console.log(`PASS framework DOM handler discovery exposes app call tree: ${names.concat(closureNames, vueNames, reactNames, angularNames).join(", ")}`);
  } finally {
    await context.close();
  }
}

async function runClientJsAppPatternsTest(browser, serverUrl, bridgeSource, source) {
  const context = await browser.newContext();
  await context.addInitScript({ content: source });
  const page = await context.newPage();
  const appUrl = new URL("client-apps.html", serverUrl).href;

  function findVariable(variables, pathText) {
    return variables.find((variable) => variable.path === pathText);
  }

  try {
    await page.goto(appUrl);
    await page.waitForSelector("#add-notebook");
    await page.waitForTimeout(500);

    await callBridge(page, bridgeSource, "rescan", [source]);
    await callBridge(page, bridgeSource, "setVariableWatch", [true, { forceScan: true }]);
    await callBridge(page, bridgeSource, "drain", [source]);

    await page.click("#add-notebook");
    await page.waitForTimeout(200);

    const checkoutPayload = await callBridge(page, bridgeSource, "drain", [source]);
    const checkoutCalls = checkoutPayload.calls || [];
    const checkoutNames = callNames(checkoutCalls);
    const addClickEvent = checkoutCalls.find((call) => call.name === "button add-notebook click event");
    const addItemCall = checkoutCalls.find((call) => call.name === "addItem");
    const lookupPriceCall = checkoutCalls.find((call) => call.name === "lookupPrice");
    const lineTotalCall = checkoutCalls.find((call) => call.name === "calculateLineTotal");
    const updateTotalsCall = checkoutCalls.find((call) => call.name === "updateTotals");
    const renderCartCall = checkoutCalls.find((call) => call.name === "renderCart");

    assertBrowserClickSequence(checkoutCalls, "button add-notebook");
    assert(addClickEvent && addClickEvent.forceReplayable, `Expected Add button click event to be force replayable, got ${JSON.stringify(addClickEvent)}.`);
    assert(addItemCall && addItemCall.replayable, `Expected checkout addItem call to be replayable, got: ${checkoutNames.join(", ")}`);
    assert(JSON.stringify(addItemCall.replayArgs) === JSON.stringify(["notebook", 2]), `Expected addItem replay args to preserve sku/quantity, got ${JSON.stringify(addItemCall.replayArgs)}.`);
    assert(lookupPriceCall && lookupPriceCall.parentCallId === addItemCall.id, "Expected lookupPrice to be a child of addItem.");
    assert(lineTotalCall && lineTotalCall.parentCallId === addItemCall.id, "Expected calculateLineTotal to be a child of addItem.");
    assert(updateTotalsCall && updateTotalsCall.parentCallId === addItemCall.id, "Expected updateTotals to be a child of addItem.");
    assert(renderCartCall && renderCartCall.parentCallId === addItemCall.id, "Expected renderCart to be a child of addItem.");

    let checkoutState = await page.evaluate(() => ({
      cartCount: window.checkoutApp.state.cartCount,
      total: window.checkoutApp.state.total,
      totalText: document.querySelector("#cart-total").textContent
    }));
    assert(checkoutState.cartCount === 2 && checkoutState.total === 10 && checkoutState.totalText === "10", `Expected checkout click to add two notebooks, got ${JSON.stringify(checkoutState)}.`);

    await callBridge(page, bridgeSource, "replay", [
      addClickEvent.functionId,
      addClickEvent.forceReplayArgs,
      { forceDescriptors: true }
    ]);
    await page.waitForTimeout(200);
    checkoutState = await page.evaluate(() => ({
      cartCount: window.checkoutApp.state.cartCount,
      total: window.checkoutApp.state.total
    }));
    assert(checkoutState.cartCount === 4 && checkoutState.total === 20, `Expected Force Resend of Add click to add another two notebooks, got ${JSON.stringify(checkoutState)}.`);

    await callBridge(page, bridgeSource, "replay", [addItemCall.functionId, addItemCall.replayArgs]);
    await callBridge(page, bridgeSource, "replay", [addItemCall.functionId, ["pencil", 3]]);
    await page.waitForTimeout(200);

    const replayPayload = await callBridge(page, bridgeSource, "drain", [source]);
    const replayCalls = replayPayload.calls || [];
    const addItemReplayCalls = replayCalls.filter((call) => call.name === "addItem");
    checkoutState = await page.evaluate(() => ({
      cartCount: window.checkoutApp.state.cartCount,
      total: window.checkoutApp.state.total,
      totalText: document.querySelector("#cart-total").textContent
    }));
    assert(checkoutState.cartCount === 9 && checkoutState.total === 36 && checkoutState.totalText === "36", `Expected original and edited addItem replays to mutate checkout state, got ${JSON.stringify(checkoutState)}.`);
    assert(addItemReplayCalls.some((call) => call.returnValue === "30"), `Expected original addItem replay return 30, got ${addItemReplayCalls.map((call) => call.returnValue).join(", ")}`);
    assert(addItemReplayCalls.some((call) => call.returnValue === "36"), `Expected edited addItem replay return 36, got ${addItemReplayCalls.map((call) => call.returnValue).join(", ")}`);

    await page.fill("#search-box", "pen");
    await page.click("#run-search");
    await page.waitForTimeout(200);
    const searchPayload = await callBridge(page, bridgeSource, "drain", [source]);
    const searchCalls = searchPayload.calls || [];
    const searchNames = callNames(searchCalls);
    const runSearchCall = searchCalls.find((call) => call.name === "runSearch");
    const normalizeQueryCall = searchCalls.find((call) => call.name === "normalizeQuery");
    const filterProductsCall = searchCalls.find((call) => call.name === "filterProducts");
    const renderResultsCall = searchCalls.find((call) => call.name === "renderResults");

    assertBrowserClickSequence(searchCalls, "button run-search");
    assert(runSearchCall && runSearchCall.replayable, `Expected runSearch to be replayable, got: ${searchNames.join(", ")}`);
    assert(JSON.stringify(runSearchCall.replayArgs) === JSON.stringify(["pen"]), `Expected runSearch replay args to preserve query, got ${JSON.stringify(runSearchCall.replayArgs)}.`);
    assert(normalizeQueryCall && normalizeQueryCall.parentCallId === runSearchCall.id, "Expected normalizeQuery to be a child of runSearch.");
    assert(filterProductsCall && filterProductsCall.parentCallId === runSearchCall.id, "Expected filterProducts to be a child of runSearch.");
    assert(renderResultsCall && renderResultsCall.parentCallId === runSearchCall.id, "Expected renderResults to be a child of runSearch.");

    await callBridge(page, bridgeSource, "replay", [runSearchCall.functionId, ["note"]]);
    await page.waitForTimeout(150);
    const searchState = await page.evaluate(() => ({
      countText: document.querySelector("#search-count").textContent,
      lastQuery: window.searchApp.state.lastQuery,
      resultCount: window.searchApp.state.resultCount,
      results: window.searchApp.state.results.slice()
    }));
    assert(searchState.lastQuery === "note" && searchState.resultCount === 1 && searchState.results[0] === "notebook" && searchState.countText === "1 results", `Expected edited runSearch replay to use the new query, got ${JSON.stringify(searchState)}.`);

    await page.click("#complete-task");
    await page.waitForTimeout(200);
    const dashboardPayload = await callBridge(page, bridgeSource, "drain", [source]);
    const dashboardCalls = dashboardPayload.calls || [];
    const dashboardNames = callNames(dashboardCalls);
    const completeTaskCall = dashboardCalls.find((call) => call.name === "completeTask");
    const setTaskCall = dashboardCalls.find((call) => call.name === "setTaskComplete");
    const progressCall = dashboardCalls.find((call) => call.name === "recalculateProgress");
    const statsCall = dashboardCalls.find((call) => call.name === "renderStats");

    assertBrowserClickSequence(dashboardCalls, "button complete-task");
    assert(completeTaskCall && completeTaskCall.replayable, `Expected completeTask to be replayable, got: ${dashboardNames.join(", ")}`);
    assert(setTaskCall && setTaskCall.parentCallId === completeTaskCall.id, "Expected setTaskComplete to be a child of completeTask.");
    assert(progressCall && progressCall.parentCallId === completeTaskCall.id, "Expected recalculateProgress to be a child of completeTask.");
    assert(statsCall && statsCall.parentCallId === completeTaskCall.id, "Expected renderStats to be a child of completeTask.");

    const variablePayload = await callBridge(page, bridgeSource, "setVariableWatch", [true, { forceScan: true }]);
    const variables = variablePayload.snapshot && variablePayload.snapshot.variables || [];
    const checkoutTotalVariable = findVariable(variables, "checkoutApp.state.total");
    const searchResultCountVariable = findVariable(variables, "searchApp.state.resultCount");
    const dashboardCompletedVariable = findVariable(variables, "dashboardApp.state.completedCount");
    const dashboardProgressVariable = findVariable(variables, "dashboardApp.state.progressPercent");

    assert(checkoutTotalVariable && checkoutTotalVariable.canEdit && checkoutTotalVariable.value === 36, `Expected editable checkout total variable, got ${JSON.stringify(checkoutTotalVariable)}.`);
    assert(searchResultCountVariable && searchResultCountVariable.canEdit && searchResultCountVariable.value === 1, `Expected editable search result count variable, got ${JSON.stringify(searchResultCountVariable)}.`);
    assert(dashboardCompletedVariable && dashboardCompletedVariable.canEdit && dashboardCompletedVariable.value === 1, `Expected editable dashboard completed count variable, got ${JSON.stringify(dashboardCompletedVariable)}.`);
    assert(dashboardProgressVariable && dashboardProgressVariable.canEdit && dashboardProgressVariable.value === 33, `Expected editable dashboard progress variable, got ${JSON.stringify(dashboardProgressVariable)}.`);

    await callBridge(page, bridgeSource, "setVariable", [checkoutTotalVariable.id, 123.45]);
    await callBridge(page, bridgeSource, "setVariable", [dashboardCompletedVariable.id, 2]);
    await callBridge(page, bridgeSource, "setVariable", [dashboardProgressVariable.id, 88]);
    await page.waitForTimeout(250);

    const editedVariables = await page.evaluate(() => ({
      completedCount: window.dashboardApp.state.completedCount,
      completedText: document.querySelector("#completed-count").textContent,
      progressPercent: window.dashboardApp.state.progressPercent,
      progressText: document.querySelector("#progress-percent").textContent,
      total: window.checkoutApp.state.total,
      totalText: document.querySelector("#cart-total").textContent
    }));
    assert(editedVariables.total === 123.45 && editedVariables.totalText === "123.45", `Expected checkout total variable edit to update state and display, got ${JSON.stringify(editedVariables)}.`);
    assert(editedVariables.completedCount === 2 && editedVariables.completedText === "2", `Expected dashboard completed variable edit to update state and display, got ${JSON.stringify(editedVariables)}.`);
    assert(editedVariables.progressPercent === 88 && editedVariables.progressText === "88", `Expected dashboard progress variable edit to update state and display, got ${JSON.stringify(editedVariables)}.`);

    console.log("PASS client JS app patterns capture nested calls, replay edited parameters, and edit variables.");
  } finally {
    await context.close();
  }
}

async function runNetworkPauseEditTest(browser, serverUrl, bridgeSource, source) {
  const context = await browser.newContext();
  await context.addInitScript({
    content: `${source}
try {
  window.__JAVASCREEN__.setOptions({
    captureMinifiedFunctions: true,
    pauseNetworkResponses: true,
    safeMode: false,
    wrapDomEventListeners: true
  });
} catch (error) {
  console.error("JS Disector network test init failed", error);
}`
  });
  const page = await context.newPage();
  const appUrl = new URL("network.html", serverUrl).href;

  try {
    await page.goto(appUrl);
    await page.waitForSelector("#check-answer");
    await callBridge(page, bridgeSource, "setOptions", [{
      captureMinifiedFunctions: true,
      pauseNetworkResponses: true,
      safeMode: false,
      wrapDomEventListeners: true
    }]);
    await callBridge(page, bridgeSource, "drain", [source]);

    await page.click("#check-answer");
    await page.waitForFunction(() => {
      const monitor = window.__JAVASCREEN__;
      return Boolean(monitor && monitor.snapshot().network.some((record) =>
        record.paused && record.pausedPhase === "response" && /\/api\/answer$/.test(String(record.request && record.request.url || ""))));
    });

    const pausedText = await page.locator("#network-result").textContent();
    assert(pausedText === "waiting", `Expected page to wait while the response is paused, got ${pausedText}.`);

    const pausedPayload = await callBridge(page, bridgeSource, "drain", [source]);
    const pausedCalls = pausedPayload.calls || [];
    const requestCall = pausedCalls.find((call) =>
      call.network && call.network.phase === "request" && /\/api\/answer$/.test(String(call.network.url || "")));
    const responseCall = pausedCalls.find((call) =>
      call.network && call.network.phase === "response" && call.network.paused && /\/api\/answer$/.test(String(call.network.url || "")));
    const handleClickCall = pausedCalls.find((call) => call.name === "handleNetworkAnswerClick");
    const submitAnswerCall = pausedCalls.find((call) => call.name === "submitAnswer");

    assertBrowserClickSequence(pausedCalls, "button check-answer");
    assert(handleClickCall, `Expected network fixture click handler to be captured, got ${callNames(pausedCalls).join(", ")}`);
    assert(submitAnswerCall, `Expected submitAnswer fetch caller to be captured, got ${callNames(pausedCalls).join(", ")}`);
    assert(requestCall, `Expected outgoing fetch request row, got ${callNames(pausedCalls).join(", ")}`);
    assert(responseCall, `Expected paused incoming fetch response row, got ${callNames(pausedCalls).join(", ")}`);
    assert(hasAncestorCall(pausedCalls, requestCall, submitAnswerCall), "Expected network request row to be nested under submitAnswer.");
    assert(responseCall.parentCallId === requestCall.id, "Expected network response row to be a child of its request row.");

    const record = pausedPayload.snapshot.network.find((item) => item.id === responseCall.network.id);
    assert(record && record.response && record.response.body.includes("\"answer\":false"), `Expected captured server response body, got ${JSON.stringify(record && record.response)}.`);

    await callBridge(page, bridgeSource, "networkContinue", [
      responseCall.network.id,
      "response",
      {
        response: {
          body: JSON.stringify({ answer: true, editedBy: "js-disector-test" }),
          headers: {
            "content-type": "application/json; charset=utf-8"
          },
          status: 200,
          statusText: "OK"
        }
      }
    ]);

    await page.waitForFunction(() => document.querySelector("#network-result").textContent === "correct");
    const editedResult = await page.evaluate(() => window.networkFixture.lastResult);
    assert(editedResult && editedResult.answer === true && editedResult.editedBy === "js-disector-test", `Expected page code to receive edited response JSON, got ${JSON.stringify(editedResult)}.`);

    await callBridge(page, bridgeSource, "networkReplay", [
      requestCall.network.id,
      {
        request: {
          body: JSON.stringify({ answer: "B" }),
          headers: {
            "content-type": "application/json"
          },
          method: "POST",
          url: new URL("/api/answer", serverUrl).href
        }
      }
    ]);
    await page.waitForFunction(() => {
      const monitor = window.__JAVASCREEN__;
      return Boolean(monitor && monitor.snapshot().network.some((record) =>
        record.protocol === "fetch-replay" && record.response && /"answer":false/.test(String(record.response.body || ""))));
    });

    const replayPayload = await callBridge(page, bridgeSource, "drain", [source]);
    const replayResponse = replayPayload.calls.find((call) =>
      call.network && call.network.phase === "response" && /fetch-replay/.test(String(call.path || "")));
    assert(replayResponse, `Expected edited request replay to log a response, got ${callNames(replayPayload.calls || []).join(", ")}`);

    console.log("PASS network fetch requests/responses are logged, response pause editing changes page code, and edited requests can be resent.");
  } finally {
    await context.close();
  }
}

async function runAsyncResponseEditUpdatesPageTest(browser, serverUrl, bridgeSource, source) {
  const context = await browser.newContext();
  await context.addInitScript({
    content: `${source}
try {
  window.__JAVASCREEN__.setOptions({
    captureMinifiedFunctions: true,
    pauseNetworkResponses: true,
    safeMode: false,
    wrapDomEventListeners: true
  });
} catch (error) {
  console.error("JS Disector async update test init failed", error);
}`
  });
  const page = await context.newPage();
  const appUrl = new URL("async-update.html", serverUrl).href;

  try {
    await page.goto(appUrl);
    await page.waitForSelector("#load-status");
    await callBridge(page, bridgeSource, "setOptions", [{
      captureMinifiedFunctions: true,
      pauseNetworkResponses: true,
      safeMode: false,
      wrapDomEventListeners: true
    }]);
    await callBridge(page, bridgeSource, "drain", [source]);

    await page.click("#load-status");
    await page.waitForFunction(() => {
      const monitor = window.__JAVASCREEN__;
      return Boolean(monitor && monitor.snapshot().network.some((record) =>
        record.paused && record.pausedPhase === "response" && /\/api\/status\?seq=1$/.test(String(record.request && record.request.url || ""))));
    });

    const waitingText = await page.locator("#async-status").textContent();
    assert(waitingText === "idle", `Expected async fixture to wait while the incoming response is paused, got ${waitingText}.`);

    const pausedPayload = await callBridge(page, bridgeSource, "drain", [source]);
    const pausedCalls = pausedPayload.calls || [];
    const requestCall = pausedCalls.find((call) =>
      call.network && call.network.phase === "request" && /\/api\/status\?seq=1$/.test(String(call.network.url || "")));
    const responseCall = pausedCalls.find((call) =>
      call.network && call.network.phase === "response" && call.network.paused && /\/api\/status\?seq=1$/.test(String(call.network.url || "")));
    const handleClickCall = pausedCalls.find((call) => call.name === "handleAsyncStatusClick");
    const loadStatusCall = pausedCalls.find((call) => call.name === "loadStatus");

    assertBrowserClickSequence(pausedCalls, "button load-status");
    assert(handleClickCall, `Expected async fixture click handler to be captured, got ${callNames(pausedCalls).join(", ")}`);
    assert(loadStatusCall, `Expected loadStatus fetch caller to be captured, got ${callNames(pausedCalls).join(", ")}`);
    assert(requestCall, `Expected outgoing async status request row, got ${callNames(pausedCalls).join(", ")}`);
    assert(responseCall, `Expected paused incoming async status response row, got ${callNames(pausedCalls).join(", ")}`);
    assert(hasAncestorCall(pausedCalls, requestCall, loadStatusCall), "Expected async status request row to be nested under loadStatus.");
    assert(responseCall.parentCallId === requestCall.id, "Expected async status response row to be a child of its request row.");

    const record = pausedPayload.snapshot.network.find((item) => item.id === responseCall.network.id);
    assert(record && record.response && record.response.body.includes("server original"), `Expected captured original status response body, got ${JSON.stringify(record && record.response)}.`);

    await callBridge(page, bridgeSource, "networkContinue", [
      responseCall.network.id,
      "response",
      {
        response: {
          body: JSON.stringify({
            count: 9001,
            message: "edited by js disector",
            source: "edited-response"
          }),
          headers: {
            "content-type": "application/json; charset=utf-8"
          },
          status: 200,
          statusText: "OK"
        }
      }
    ]);

    await page.waitForFunction(() => document.querySelector("#async-status").textContent === "edited by js disector:9001");
    const editedState = await page.evaluate(() => ({
      datasetSource: document.querySelector("#async-status").dataset.source,
      lastResult: window.asyncUpdateFixture.lastResult,
      text: document.querySelector("#async-status").textContent
    }));
    assert(editedState.datasetSource === "edited-response", `Expected page DOM to use edited response source, got ${JSON.stringify(editedState)}.`);
    assert(editedState.lastResult && editedState.lastResult.message === "edited by js disector" && editedState.lastResult.count === 9001, `Expected page state to receive edited async response, got ${JSON.stringify(editedState)}.`);

    const resumedPayload = await callBridge(page, bridgeSource, "drain", [source]);
    const renderCall = (resumedPayload.calls || []).find((call) => call.name === "renderStatus");
    assert(renderCall, `Expected page renderStatus function to run after edited response was released, got ${callNames(resumedPayload.calls || []).join(", ")}`);

    console.log("PASS async GET response editing updates page state and DOM with the edited payload.");
  } finally {
    await context.close();
  }
}

async function runTransparentWrapperTest(browser, bridgeSource, source) {
  const context = await browser.newContext();
  await context.addInitScript({ content: source });
  const page = await context.newPage();

  try {
    await page.setContent(`<!doctype html>
      <script>
        window.order = [];
        window.domReplayLog = [];
        window.javascreenGameState = {
          score: 0,
          timer: 0,
          nested: {
            moves: 0
          }
        };
        window.game = {
          menuManager: {
            cardFaceMenu: {
              level: {
                score: 0,
                scoreMirror: {
                  score: 0
                },
                renderedScore: null,
                hud: {
                  scoreText: {
                    text: "0",
                    refreshCount: 0,
                    _updateText() {
                      this.refreshCount += 1;
                    },
                    updateCache() {
                      this.cacheCount = (this.cacheCount || 0) + 1;
                    }
                  },
                  movesText: {
                    text: "0"
                  }
                }
              }
            }
          }
        };
        window.gameScoreRefresh = setInterval(() => {
          const level = window.game.menuManager.cardFaceMenu.level;
          level.hud.scoreText.text = String(level.renderedScore || 0);
        }, 30);
        window.replayLog = [];
        window.replaySum = function replaySum(left, right, options) {
          const value = left + right + options.bonus;
          window.replayLog.push(value);
          return value;
        };
        window.useDomReplay = function useDomReplay(element, value) {
          element.replayTotal = (element.replayTotal || 0) + value;
          window.domReplayLog.push(element.replayTotal);
          return element.replayTotal;
        };
        window.replayMethodLog = [];
        window.ReplayStage = function ReplayStage() {
          this.canvas = {
            offsetTop: 100
          };
          this.pointerData = {};
        };
        window.ReplayStage.prototype.handleMouseDown = function handleMouseDown(event, amount) {
          if (!this || !this.canvas || !this.pointerData) {
            throw new Error("replay used the wrong this value");
          }
          const value = this.canvas.offsetTop + event.offsetTop + amount;
          this.pointerData.last = value;
          window.replayMethodLog.push(value);
          return value;
        };
        window.replayStage = new window.ReplayStage();
        window.useProbe = function useProbe(value) {
          window.order.push("original");
          return value.label;
        };
        window.Widget = function Widget(name) {
          this.name = name;
          this.runtimeSuffix = Widget.runtime.suffix;
        };
        window.Widget.config = {
          prefix: "widget"
        };
        window.Widget.prototype.kind = function kind() {
          return window.Widget.config.prefix + ":" + this.name + this.runtimeSuffix;
        };
        window.limit = function limit(value) {
          return value;
        };
        window.lerp = function lerp(value) {
          return value;
        };
        window.lookupAsset = function lookupAsset(value) {
          return value;
        };
        window.getAtlas = function getAtlas(value) {
          return value;
        };
        window.spamHelper = function spamHelper(value) {
          return value;
        };
        window.getOrientation = function getOrientation() {
          return "landscape";
        };
        window.e = function e(value) {
          return value;
        };
        window.M = function M() {
          this.total = 0;
        };
        window.M.prototype.a = function a(value) {
          this.total += value;
          return this.total;
        };
        window.g = new window.M();
        window.q = {
          r: {
            s(value) {
              return value * 3;
            }
          }
        };
        window.bumpHiddenState = function bumpHiddenState(amount) {
          this.score += amount;
          this.time += 1;
          return this.score;
        };
        window.createHiddenState = function createHiddenState() {
          const hiddenState = {
            score: 12,
            time: 1
          };
          const hiddenScore = window.bumpHiddenState.call(hiddenState, 8);
          window.readHiddenScore = function readHiddenScore() {
            return hiddenState.score;
          };
          return hiddenScore;
        };
        window.createjs = {};
        window.createjs.EventDispatcher = function EventDispatcher() {
          this._listeners = {};
        };
        window.createjs.EventDispatcher.prototype.addEventListener = function addEventListener(type, listener) {
          (this._listeners[type] || (this._listeners[type] = [])).push(listener);
          return listener;
        };
        window.createjs.EventDispatcher.prototype.removeEventListener = function removeEventListener(type, listener) {
          const listeners = this._listeners[type] || [];
          const index = listeners.indexOf(listener);
          if (index >= 0) {
            listeners.splice(index, 1);
          }
        };
        window.createjs.EventDispatcher.prototype.on = function on(type, listener, scope, once, data, useCapture) {
          const wrapped = function onWrapped(event) {
            listener.call(scope || this, event, data);
            if (once) {
              this.removeEventListener(type, wrapped, useCapture);
            }
          };
          this.addEventListener(type, wrapped, useCapture);
          return wrapped;
        };
        window.createjs.EventDispatcher.prototype.off = function off(type, listener, useCapture) {
          return this.removeEventListener(type, listener, useCapture);
        };
        window.createjs.EventDispatcher.prototype._dispatchEvent = function _dispatchEvent(event) {
          for (const listener of (this._listeners[event.type] || []).slice()) {
            listener.call(this, event);
          }
        };
        window.createjs.EventDispatcher.prototype.dispatchEvent = function dispatchEvent(event) {
          return this._dispatchEvent(event);
        };
        window.preRegisteredScore = 0;
        window.addScore = function addScore(amount) {
          window.preRegisteredScore += amount;
          return window.preRegisteredScore;
        };
        window.preRegisteredCard = new window.createjs.EventDispatcher();
        window.preRegisteredCard.addEventListener("change", function preRegisteredChange(event) {
          return window.addScore(event.cardValue);
        });
      </script>`);

    await callBridge(page, bridgeSource, "rescan", [source]);
    await callBridge(page, bridgeSource, "setVariableWatch", [true]);

    const result = await page.evaluate(() => {
      const probe = {};
      Object.defineProperty(probe, "label", {
        enumerable: true,
        get() {
          window.order.push("getter");
          return "ok";
        }
      });

      const value = window.useProbe(probe);
      const hiddenScore = window.createHiddenState();
      const replayValue = window.replaySum(2, 5, { bonus: 4 });
      window.javascreenGameState.score = 25;
      window.javascreenGameState.timer = 7;
      window.javascreenGameState.nested.moves = 3;
      const replayElement = document.createElement("button");
      replayElement.id = "force-replay-target";
      document.body.append(replayElement);
      const domReplayValue = window.useDomReplay(replayElement, 3);
      const stageMethodValue = window.replayStage.handleMouseDown({ offsetTop: 10 }, 5);
      window.Widget.runtime = {
        suffix: "!"
      };
      const widget = new window.Widget("alpha");
      const card = new window.createjs.EventDispatcher();
      let cardClicks = 0;
      let ticks = 0;
      function cardClick(event) {
        cardClicks += event.cardValue;
        return cardClicks;
      }
      function onTick(event) {
        ticks += event.cardValue;
        return ticks;
      }
      function cardOnClick(event, data) {
        cardClicks += event.cardValue + data.bonus;
        return cardClicks;
      }
      const returnedListener = card.addEventListener("click", cardClick);
      card.addEventListener("tick", onTick);
      const onReturnedListener = card.on("click", cardOnClick, null, false, { bonus: 3 });
      window.limit(1);
      window.lerp(3);
      window.lookupAsset(4);
      window.getAtlas("cards");
      for (let index = 0; index < 105; index += 1) {
        window.spamHelper(index);
      }
      for (let index = 0; index < 105; index += 1) {
        window.getOrientation();
      }
      window.e(2);
      card.dispatchEvent({ type: "click", cardValue: 7 });
      card.dispatchEvent({ type: "tick", cardValue: 13 });
      window.preRegisteredCard.dispatchEvent({ type: "change", cardValue: 4 });
      card.removeEventListener("click", cardClick);
      card.off("click", onReturnedListener);
      card.dispatchEvent({ type: "click", cardValue: 11 });
      return {
        cardClicks,
        hiddenScore,
        instanceOfWrapper: widget instanceof window.Widget,
        kind: widget.kind(),
        name: widget.name,
        domReplayValue,
        order: window.order.slice(),
        onReturnedFunction: typeof onReturnedListener === "function",
        preRegisteredScore: window.preRegisteredScore,
        replayValue,
        returnedOriginalListener: returnedListener === cardClick,
        stageMethodValue,
        ticks,
        value
      };
    });

    await callBridge(page, bridgeSource, "setVariableWatch", [true, { forceScan: true }]);
    const payload = await callBridge(page, bridgeSource, "drain", [source]);
    const calls = payload.calls || [];
    const variables = payload.snapshot && payload.snapshot.variables || [];

    assert(result.value === "ok", `Expected original return value, got ${result.value}.`);
    assert(result.order[0] === "original", `Expected original function to run before argument serialization, got ${result.order.join(", ")}.`);
    assert(result.instanceOfWrapper, "Expected constructor wrapper to preserve instanceof.");
    assert(result.name === "alpha", `Expected constructed instance name, got ${result.name}.`);
    assert(result.kind === "widget:alpha!", `Expected constructed instance prototype method to preserve static function state, got ${result.kind}.`);
    assert(result.replayValue === 11, `Expected original replaySum value 11, got ${result.replayValue}.`);
    assert(result.domReplayValue === 3, `Expected original useDomReplay value 3, got ${result.domReplayValue}.`);
    assert(result.stageMethodValue === 115, `Expected original stageMouseDown value 115, got ${result.stageMethodValue}.`);
    assert(result.returnedOriginalListener, "Expected library addEventListener to return the original listener.");
    assert(result.onReturnedFunction, "Expected library on() to return its native listener token.");
    assert(result.cardClicks === 17, `Expected original listener removal to work, got cardClicks=${result.cardClicks}.`);
    assert(result.ticks === 13, `Expected skipped tick listener to still run, got ticks=${result.ticks}.`);
    assert(result.preRegisteredScore === 4, `Expected pre-registered CreateJS listener to call addScore, got ${result.preRegisteredScore}.`);
    assert(calls.some((call) => call.name === "useProbe"), `Expected useProbe call to be logged, got: ${callNames(calls).join(", ")}`);
    assert(calls.some((call) => call.name === "Widget"), `Expected Widget constructor call to be logged, got: ${callNames(calls).join(", ")}`);
    const cardClickCall = calls.find((call) => call.name === "cardClick");
    const cardOnClickCall = calls.find((call) => call.name === "cardOnClick");
    const clickDispatch = calls.find((call) => call.name === "createjs.EventDispatcher click dispatch");
    const changeDispatch = calls.find((call) => call.name === "createjs.EventDispatcher change dispatch");
    const preRegisteredChangeCall = calls.find((call) => call.name === "preRegisteredChange");
    const addScoreCall = calls.find((call) => call.name === "addScore" && call.returnValue === "4");
    const domReplayCall = calls.find((call) => call.name === "useDomReplay");
    const replaySumCall = calls.find((call) => call.name === "replaySum");
    const stageMethodCall = calls.find((call) => call.name === "handleMouseDown");
    const scoreVariable = variables.find((variable) => variable.path === "javascreenGameState.score");
    const timerVariable = variables.find((variable) => variable.path === "javascreenGameState.timer");
    const hiddenScoreVariable = variables.find((variable) => String(variable.path || "").includes(".score @ bumpHiddenState"));
    const canvasScoreVariable = variables.find((variable) => variable.path === "game.menuManager.cardFaceMenu.level.score");
    const junkVariable = variables.find((variable) =>
      variable.value === undefined ||
      variable.kind === "undefined" ||
      String(variable.path || "") === "undefined" ||
      /^\d+(?:\.|\[|$)/.test(String(variable.path || "")));
    assert(replaySumCall && replaySumCall.replayable, `Expected replaySum call to be replayable, got: ${JSON.stringify(replaySumCall)}`);
    assert(JSON.stringify(replaySumCall.replayArgs) === JSON.stringify([2, 5, { bonus: 4 }]), `Expected replaySum replay args to preserve JSON parameters, got ${JSON.stringify(replaySumCall.replayArgs)}.`);
    assert(result.hiddenScore === 20, `Expected hidden state score to be 20, got ${result.hiddenScore}.`);
    assert(scoreVariable && scoreVariable.value === 25 && scoreVariable.canEdit, `Expected editable score variable with value 25, got: ${JSON.stringify(scoreVariable)}.`);
    assert(timerVariable && timerVariable.value === 7 && timerVariable.canEdit, `Expected editable timer variable with value 7, got: ${JSON.stringify(timerVariable)}.`);
    assert(hiddenScoreVariable && hiddenScoreVariable.value === 20 && hiddenScoreVariable.canEdit, `Expected editable observed hidden score variable with value 20, got: ${JSON.stringify(hiddenScoreVariable)}.`);
    assert(canvasScoreVariable && canvasScoreVariable.value === 0 && canvasScoreVariable.canEdit, `Expected editable canvas-style game score variable, got: ${JSON.stringify(canvasScoreVariable)}.`);
    assert(!junkVariable, `Expected variable scan to skip undefined and numeric frame roots, got: ${JSON.stringify(junkVariable)}.`);

    await page.evaluate(() => {
      window.javascreenGameState.score = 31;
    });
    await page.waitForTimeout(3200);
    const liveVariablePayload = await callBridge(page, bridgeSource, "drain", [source]);
    const liveScoreVariable = (liveVariablePayload.snapshot && liveVariablePayload.snapshot.variables || [])
      .find((variable) => variable.path === "javascreenGameState.score");
    assert(liveScoreVariable && liveScoreVariable.value === 31, `Expected live variable snapshot polling to update score to 31, got: ${JSON.stringify(liveScoreVariable)}.`);

    assert(domReplayCall, `Expected useDomReplay call to be logged, got: ${callNames(calls).join(", ")}`);
    assert(!domReplayCall.replayable, `Expected DOM argument to be unsafe for JSON replay, got: ${JSON.stringify(domReplayCall)}`);
    assert(domReplayCall.forceReplayable, `Expected DOM argument to be force replayable, got: ${JSON.stringify(domReplayCall)}`);
    assert(domReplayCall.forceReplayArgs && domReplayCall.forceReplayArgs[0].type === "ref", `Expected first force replay arg to be a live ref, got ${JSON.stringify(domReplayCall.forceReplayArgs)}.`);
    assert(stageMethodCall && stageMethodCall.replayable, `Expected prototype instance method call to be replayable, got: ${JSON.stringify(stageMethodCall)}`);
    assert(stageMethodCall.forceReplayThis && stageMethodCall.forceReplayThis.type === "ref", `Expected prototype instance method call to keep its live this reference, got: ${JSON.stringify(stageMethodCall)}`);
    assert(cardClickCall, `Expected CreateJS-style cardClick call to be logged, got: ${callNames(calls).join(", ")}`);
    assert(cardOnClickCall, `Expected CreateJS-style on() cardOnClick call to be logged, got: ${callNames(calls).join(", ")}`);
    assert(preRegisteredChangeCall, `Expected pre-existing CreateJS change listener to be synced and logged, got: ${callNames(calls).join(", ")}`);
    assert(addScoreCall, `Expected addScore called by pre-existing CreateJS listener to be logged, got: ${callNames(calls).join(", ")}`);
    assert(clickDispatch && String(clickDispatch.note || "").includes("Observed library dispatch"), "Expected CreateJS dispatch to be observed while native dispatch runs.");
    assert(changeDispatch && String(changeDispatch.note || "").includes("Observed library dispatch"), "Expected pre-existing CreateJS change dispatch to be observed while native dispatch runs.");
    assert(cardClickCall.parentCallId === clickDispatch.id, `Expected CreateJS cardClick listener under dispatchEvent, got parent ${cardClickCall.parentCallId}.`);
    assert(cardOnClickCall.parentCallId === clickDispatch.id, `Expected CreateJS cardOnClick listener under dispatchEvent, got parent ${cardOnClickCall.parentCallId}.`);
    assert(preRegisteredChangeCall.parentCallId === changeDispatch.id, `Expected pre-existing CreateJS listener under change dispatch, got parent ${preRegisteredChangeCall.parentCallId}.`);
    assert(hasAncestorCall(calls, addScoreCall, changeDispatch), `Expected addScore to be inside the CreateJS change dispatch tree, got ${JSON.stringify({
      addScoreCall,
      changeDispatch,
      preRegisteredChangeCall
    })}.`);
    assert(cardClickCall.returnValue === "observed", `Expected CreateJS cardClick listener to be observed-only, got ${cardClickCall.returnValue}.`);
    assert(String(cardClickCall.note || "").includes("not wrapped"), "Expected CreateJS cardClick listener note to say it was not wrapped.");
    assert(cardOnClickCall.returnValue === "observed", `Expected CreateJS cardOnClick listener to be observed-only, got ${cardOnClickCall.returnValue}.`);
    assert(preRegisteredChangeCall.returnValue === "observed", `Expected pre-existing CreateJS listener to be observed-only, got ${preRegisteredChangeCall.returnValue}.`);
    assert(addScoreCall.returnValue === "4", `Expected addScore to return 4, got ${addScoreCall.returnValue}.`);
    const spamCalls = calls.filter((call) => call.name === "spamHelper" && !call.suppressed);
    const suppressedSpam = calls.find((call) => call.name === "spamHelper" && call.suppressed);
    const orientationCalls = calls.filter((call) => call.name === "getOrientation" && !call.suppressed);
    const suppressedOrientation = calls.find((call) => call.name === "getOrientation" && call.suppressed);
    assert(spamCalls.length === 99, `Expected spamHelper to stop after 99 logged calls, got ${spamCalls.length}.`);
    assert(suppressedSpam && String(suppressedSpam.note || "").includes("already been logged 99+ times"), `Expected spamHelper to show an automatic flood notice, got: ${callNames(calls).join(", ")}`);
    assert(orientationCalls.length === 99, `Expected getOrientation to stop after 99 logged calls, got ${orientationCalls.length}.`);
    assert(suppressedOrientation && String(suppressedOrientation.note || "").includes("already been logged 99+ times"), `Expected getOrientation to show an automatic flood notice, got: ${callNames(calls).join(", ")}`);
    assert(!calls.some((call) => call.name === "onTick" && !call.suppressed), `Expected noisy CreateJS tick listener to be skipped, got: ${callNames(calls).join(", ")}`);

    await callBridge(page, bridgeSource, "setOptions", [{ captureMinifiedFunctions: true }]);
    await page.evaluate(() => {
      window.e(9);
      window.g.a(5);
      window.q.r.s(7);
    });
    const minifiedPayload = await callBridge(page, bridgeSource, "drain", [source]);
    const minifiedCalls = minifiedPayload.calls || [];
    assert(minifiedCalls.some((call) => call.name === "e" && !call.suppressed), `Expected Show minified functions to capture e(), got: ${callNames(minifiedCalls).join(", ")}`);
    assert(minifiedCalls.some((call) => call.name === "a" && call.path === "g#prototype.a" && call.returnValue === "5" && !call.suppressed), `Expected Show minified functions to capture prototype a(), got: ${callNames(minifiedCalls).join(", ")}`);
    assert(minifiedCalls.some((call) => call.name === "s" && call.path === "q.r.s" && call.returnValue === "21" && !call.suppressed), `Expected Show minified functions to capture nested object s(), got: ${callNames(minifiedCalls).join(", ")}`);

    await callBridge(page, bridgeSource, "replay", [replaySumCall.functionId, replaySumCall.replayArgs]);
    await callBridge(page, bridgeSource, "replay", [replaySumCall.functionId, [10, 1, { bonus: 2 }]]);
    await callBridge(page, bridgeSource, "replay", [stageMethodCall.functionId, stageMethodCall.replayArgs]);
    await callBridge(page, bridgeSource, "replay", [
      stageMethodCall.functionId,
      [{ offsetTop: 20 }, 5],
      {
        forceThis: stageMethodCall.forceReplayThis,
        forceThisDescriptor: true
      }
    ]);
    await callBridge(page, bridgeSource, "replay", [
      domReplayCall.functionId,
      domReplayCall.forceReplayArgs,
      { forceDescriptors: true }
    ]);
    await callBridge(page, bridgeSource, "replay", [
      domReplayCall.functionId,
      [
        { $javascreenRef: domReplayCall.forceReplayArgs[0].refId },
        4
      ]
    ]);
    await callBridge(page, bridgeSource, "setVariable", [scoreVariable.id, 100]);
    await callBridge(page, bridgeSource, "setVariable", [hiddenScoreVariable.id, 77]);
    await callBridge(page, bridgeSource, "setVariable", [canvasScoreVariable.id, 222]);
    await page.waitForTimeout(450);
    const replayPayload = await callBridge(page, bridgeSource, "drain", [source]);
    const replayState = await page.evaluate(() => window.replayLog.slice());
    const domReplayState = await page.evaluate(() => window.domReplayLog.slice());
    const methodReplayState = await page.evaluate(() => window.replayMethodLog.slice());
    const editedScore = await page.evaluate(() => window.javascreenGameState.score);
    const editedHiddenScore = await page.evaluate(() => window.readHiddenScore());
    const editedCanvasScore = await page.evaluate(() => {
      const level = window.game.menuManager.cardFaceMenu.level;
      return {
        renderedScore: level.renderedScore,
        score: level.score,
        scoreMirror: level.scoreMirror.score,
        text: level.hud.scoreText.text,
        textRefreshed: level.hud.scoreText.refreshCount > 0
      };
    });
    const replayCalls = (replayPayload.calls || []).filter((call) => call.name === "replaySum");
    const domReplayCalls = (replayPayload.calls || []).filter((call) => call.name === "useDomReplay");
    const methodReplayCalls = (replayPayload.calls || []).filter((call) => call.name === "handleMouseDown");
    const updatedScoreVariable = (replayPayload.snapshot && replayPayload.snapshot.variables || []).find((variable) => variable.path === "javascreenGameState.score");
    assert(JSON.stringify(replayState) === JSON.stringify([11, 11, 13]), `Expected replay calls to run in the page, got ${JSON.stringify(replayState)}.`);
    assert(JSON.stringify(domReplayState) === JSON.stringify([3, 6, 10]), `Expected force replay calls to reuse the DOM element, got ${JSON.stringify(domReplayState)}.`);
    assert(JSON.stringify(methodReplayState) === JSON.stringify([115, 115, 125]), `Expected method replay calls to reuse the original this object, got ${JSON.stringify(methodReplayState)}.`);
    assert(editedScore === 100, `Expected setVariable to edit page state to 100, got ${editedScore}.`);
    assert(editedHiddenScore === 77, `Expected setVariable to edit observed hidden state to 77, got ${editedHiddenScore}.`);
    assert(editedCanvasScore.score === 222 && editedCanvasScore.scoreMirror === 222 && editedCanvasScore.renderedScore === 222 && editedCanvasScore.text === "222" && editedCanvasScore.textRefreshed, `Expected setVariable to keep generic canvas-style score mirrors/HUD at 222, got ${JSON.stringify(editedCanvasScore)}.`);
    await callBridge(page, bridgeSource, "setVariable", [canvasScoreVariable.id, 0]);
    await page.waitForTimeout(450);
    const editedCanvasScoreZero = await page.evaluate(() => {
      const level = window.game.menuManager.cardFaceMenu.level;
      return {
        renderedScore: level.renderedScore,
        score: level.score,
        scoreMirror: level.scoreMirror.score,
        text: level.hud.scoreText.text
      };
    });
    assert(editedCanvasScoreZero.score === 0 && editedCanvasScoreZero.scoreMirror === 0 && editedCanvasScoreZero.renderedScore === 0 && editedCanvasScoreZero.text === "0", `Expected latest setVariable display refresh to let zero win after a previous edit, got ${JSON.stringify(editedCanvasScoreZero)}.`);
    assert(updatedScoreVariable && updatedScoreVariable.value === 100, `Expected variable snapshot to show edited score 100, got ${JSON.stringify(updatedScoreVariable)}.`);
    assert(replayCalls.length === 2, `Expected two logged replaySum replay calls, got ${replayCalls.length}.`);
    assert(domReplayCalls.length === 2, `Expected two logged useDomReplay replay calls, got ${domReplayCalls.length}.`);
    assert(methodReplayCalls.length === 2, `Expected two logged handleMouseDown replay calls, got ${methodReplayCalls.length}.`);
    assert(replayCalls.some((call) => call.returnValue === "11"), `Expected captured-arg replay return 11, got ${replayCalls.map((call) => call.returnValue).join(", ")}`);
    assert(replayCalls.some((call) => call.returnValue === "13"), `Expected edited replay return 13, got ${replayCalls.map((call) => call.returnValue).join(", ")}`);
    assert(domReplayCalls.some((call) => call.returnValue === "6"), `Expected force replay return 6, got ${domReplayCalls.map((call) => call.returnValue).join(", ")}`);
    assert(domReplayCalls.some((call) => call.returnValue === "10"), `Expected edited force replay return 10, got ${domReplayCalls.map((call) => call.returnValue).join(", ")}`);
    assert(methodReplayCalls.every((call) => !call.threw), `Expected method replay not to throw, got ${JSON.stringify(methodReplayCalls)}`);
    assert(methodReplayCalls.some((call) => call.returnValue === "115"), `Expected captured method replay return 115, got ${methodReplayCalls.map((call) => call.returnValue).join(", ")}`);
    assert(methodReplayCalls.some((call) => call.returnValue === "125"), `Expected edited method replay return 125, got ${methodReplayCalls.map((call) => call.returnValue).join(", ")}`);

    console.log(`PASS wrappers are transparent for getters and constructors: ${callNames(calls).join(", ")}`);
  } finally {
    await context.close();
  }
}

async function runPanelVariableTreeTest(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(pathToFileURL(path.join(rootDir, "devtools", "panel.html")).href);
    await page.waitForFunction(() => typeof renderVariables === "function" && document.querySelector("#variableTable"));

    const variables = [
      {
        canEdit: true,
        displayValue: "0",
        frameLabel: "top",
        id: "top::game.menuManager.loadingMenu.angularSpeed",
        importance: 5,
        kind: "number",
        lastChangedAt: "2026-01-01T00:00:03.000Z",
        lastSeenAt: "2026-01-01T00:00:03.000Z",
        path: "game.menuManager.loadingMenu.angularSpeed",
        value: 0
      },
      {
        canEdit: true,
        displayValue: "1",
        frameLabel: "top",
        id: "top::game.menuManager.mainMenu.lastClickCount",
        importance: 5,
        kind: "number",
        lastChangedAt: "2026-01-01T00:00:02.000Z",
        lastSeenAt: "2026-01-01T00:00:02.000Z",
        path: "game.menuManager.mainMenu.lastClickCount",
        value: 1
      },
      {
        canEdit: true,
        displayValue: "12.5",
        frameLabel: "top",
        id: "top::game.gameTime",
        importance: 5,
        kind: "number",
        lastChangedAt: "2026-01-01T00:00:01.000Z",
        lastSeenAt: "2026-01-01T00:00:01.000Z",
        path: "game.gameTime",
        value: 12.5
      },
      {
        canEdit: true,
        displayValue: "5",
        frameLabel: "top",
        id: "top::game.menuManager.loadingMenu.sprite.x",
        importance: 0,
        kind: "number",
        lastChangedAt: "2026-01-01T00:00:00.000Z",
        lastSeenAt: "2026-01-01T00:00:00.000Z",
        path: "game.menuManager.loadingMenu.sprite.x",
        value: 5
      }
    ];

    await page.evaluate((items) => {
      const currentState = eval("state");
      currentState.activeTab = "variables";
      currentState.variables.clear();
      currentState.collapsedVariableGroups.clear();
      currentState.hideNoisy = true;
      currentState.liveVariables = false;
      currentState.variableFilter = "";
      currentState.variableValueSearch = "";
      document.querySelector("#eventsPanel").hidden = true;
      document.querySelector("#variablesPanel").hidden = false;
      document.querySelector("#hideNoisyInput").checked = true;
      document.querySelector("#hideNoisyControl").hidden = false;
      document.querySelector("#liveVariablesControl").hidden = false;
      document.querySelector("#liveVariablesInput").checked = false;
      document.querySelector("#variableSearchInput").hidden = false;
      document.querySelector("#variableRefreshButton").hidden = false;
      for (const variable of items) {
        currentState.variables.set(variable.id, variable);
      }
      renderVariables();
    }, variables);

    const groupNames = await page.locator(".variable-group-row .variable-group-name").evaluateAll((nodes) =>
      nodes.map((node) => node.textContent));
    assert(groupNames.includes("game"), `Expected game variable group, got ${groupNames.join(", ")}`);
    assert(groupNames.includes("menuManager"), `Expected menuManager variable group, got ${groupNames.join(", ")}`);
    assert(groupNames.includes("loadingMenu"), `Expected loadingMenu variable group, got ${groupNames.join(", ")}`);
    assert(await page.locator(".variable-path", { hasText: "angularSpeed" }).count() === 1, "Expected angularSpeed leaf variable before collapse.");
    assert(await page.evaluate(() => !Array.from(document.querySelectorAll(".variable-path")).some((node) => String(node.title || "").includes("sprite.x"))), "Expected Hide noisy to suppress low-importance sprite geometry.");
    assert(await page.locator("#liveVariablesInput").isChecked() === false, "Expected live variable updates to be off by default.");
    assert(await page.locator(".variable-group-row", { hasText: "menuManager" }).locator(".tree-branch").count() === 1, "Expected nested variable groups to render directory-style branch connectors.");
    assert(await page.locator(".variable-path", { hasText: "angularSpeed" }).locator("xpath=ancestor::*[contains(@class, 'variable-row')]").locator(".tree-guide").count() >= 1, "Expected nested variable leaves to keep ancestor guide lines visible.");
    assert(await page.locator(".variable-row", { hasText: "gameTime" }).locator(".tree-branch.last").count() === 1, "Expected final variable sibling branch guide to terminate.");
    assert(await page.evaluate(() => {
      const leafRow = Array.from(document.querySelectorAll("#variableTable .variable-row:not(.variable-group-row)"))
        .find((row) => row.textContent.includes("angularSpeed"));
      const groupRow = Array.from(document.querySelectorAll("#variableTable .variable-group-row"))
        .find((row) => row.textContent.includes("menuManager"));
      return leafRow &&
        groupRow &&
        getComputedStyle(leafRow).borderBottomStyle === "none" &&
        getComputedStyle(groupRow).borderTopStyle === "solid";
    }), "Expected Variables tree to remove per-row horizontal dividers while keeping group separators.");

    await page.locator("#variableSearchInput").fill("12.5");
    assert(await page.locator(".variable-path", { hasText: "gameTime" }).count() === 1, "Expected value search for 12.5 to find gameTime.");
    assert(await page.locator(".variable-path", { hasText: "angularSpeed" }).count() === 0, "Expected value search for 12.5 to hide angularSpeed.");
    assert(await page.locator(".variable-value .search-match", { hasText: "12.5" }).count() === 1, "Expected value search match to be highlighted.");
    assert(await page.locator("#filterInput").inputValue() === "", "Expected value search not to prefill the variable name filter.");
    await page.locator("#variableSearchInput").fill("");

    await page.locator("#filterInput").fill("sprite.x");
    assert(await page.evaluate(() => Array.from(document.querySelectorAll(".variable-path")).some((node) => String(node.title || "").includes("sprite.x"))), "Expected searching to reveal a noisy variable.");
    await page.locator("#filterInput").fill("");

    await page.locator("#filterInput").fill("angular");
    assert(await page.locator(".variable-path", { hasText: "angularSpeed" }).count() === 1, "Expected variable name filter to find angularSpeed.");
    assert(await page.locator(".variable-path .search-match", { hasText: "angular" }).count() === 1, "Expected variable name filter match to be highlighted.");
    assert(await page.locator("#variableSearchInput").inputValue() === "", "Expected variable name filter not to prefill value search.");
    await page.locator("#filterInput").fill("");
    assert(await page.locator("button[aria-label='Refresh variable']").count() >= 3, "Expected each variable row to expose a refresh action.");
    assert(await page.locator("#variableRefreshButton").isVisible(), "Expected the Variables tab to expose a refresh button.");

    const refreshedVariables = variables.concat({
      canEdit: true,
      displayValue: "99",
      frameLabel: "top",
      id: "top::game.menuManager.runtime.newCounter",
      importance: 5,
      kind: "number",
      lastChangedAt: "2026-01-01T00:00:05.000Z",
      lastSeenAt: "2026-01-01T00:00:05.000Z",
      path: "game.menuManager.runtime.newCounter",
      value: 99
    });

    await page.evaluate((items) => {
      eval(`callMonitor = async function panelVariableRefreshStub(method) {
        window.__variableRefreshCalls = (window.__variableRefreshCalls || 0) + 1;
        if (method === "setVariableWatch") {
          return {
            running: true,
            totalCalls: 0,
            variableCount: ${items.length},
            variables: ${JSON.stringify(items)}
          };
        }
        if (method === "drain") {
          return {
            snapshot: {
              running: true,
              totalCalls: 0,
              variableCount: ${items.length},
              variables: ${JSON.stringify(items)}
            }
          };
        }
        return {};
      }`);
      eval("refreshCaptureStatus = async function refreshCaptureStatusStub() { return null; }");
    }, refreshedVariables);
    await page.locator("#variableRefreshButton").click();
    await page.waitForFunction(() => eval("state").variables.has("top::game.menuManager.runtime.newCounter"));
    await page.waitForFunction(() => window.__variableRefreshCalls >= 2);
    assert(await page.locator(".variable-group-row .variable-group-name", { hasText: "runtime" }).count() === 1, "Expected variable refresh to rebuild newly discovered variable groups.");
    assert(await page.locator(".variable-path", { hasText: "newCounter" }).count() === 1, "Expected variable refresh to show newly discovered variables.");
    assert(await page.evaluate(() => window.__variableRefreshCalls >= 2), "Expected tab-level variable refresh to force a scan and then poll.");

    const updatedVariables = variables.map((variable) => variable.id === "top::game.gameTime"
      ? {
        ...variable,
        displayValue: "20.5",
        lastChangedAt: "2026-01-01T00:00:04.000Z",
        lastSeenAt: "2026-01-01T00:00:04.000Z",
        value: 20.5
      }
      : variable);

    await page.evaluate((items) => {
      applyDrain({
        snapshot: {
          running: true,
          totalCalls: 0,
          variableCount: items.length,
          variables: items
        }
      });
    }, updatedVariables);
    assert(await page.evaluate(() => eval("state").variables.get("top::game.gameTime").displayValue) === "12.5", "Expected normal polling to leave variables frozen when live updates are off.");

    await page.evaluate((items) => {
      const currentState = eval("state");
      currentState.liveVariables = true;
      document.querySelector("#liveVariablesInput").checked = true;
      applyDrain({
        snapshot: {
          running: true,
          totalCalls: 0,
          variableCount: items.length,
          variables: items
        }
      });
    }, updatedVariables);
    assert(await page.evaluate(() => eval("state").variables.get("top::game.gameTime").displayValue) === "20.5", "Expected live variable updates to merge changed snapshot values.");
    assert(await page.locator(".updated-variable-row", { hasText: "gameTime" }).count() === 1, "Expected changed variable row to be highlighted.");

    await page.locator(".variable-group-row", { hasText: "menuManager" }).first().click();
    assert(await page.locator(".variable-path", { hasText: "angularSpeed" }).count() === 0, "Expected menuManager collapse to hide angularSpeed.");
    assert(await page.locator(".variable-path", { hasText: "gameTime" }).count() === 1, "Expected sibling gameTime leaf to remain visible after menuManager collapse.");

    console.log("PASS panel Variables tab groups and collapses dotted paths.");
  } finally {
    await context.close();
  }
}

async function runPanelEventNoiseTest(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(pathToFileURL(path.join(rootDir, "devtools", "panel.html")).href);
    await page.waitForFunction(() => typeof render === "function" && typeof insertCall === "function" && document.querySelector("#callTree"));

    await page.evaluate(() => {
      const currentState = eval("state");
      currentState.activeTab = "events";
      currentState.callsById.clear();
      currentState.callOrder = [];
      currentState.pendingChildren.clear();
      currentState.trees.clear();
      currentState.functions.clear();
      currentState.networkRecords.clear();
      currentState.hiddenFunctionIds.clear();
      currentState.filter = "";
      currentState.blacklistFilter = "";
      currentState.hideNoisy = true;
      currentState.showMinifiedFunctions = false;
      document.querySelector("#hideNoisyInput").checked = true;
      document.querySelector("#showMinifiedInput").checked = false;
      document.querySelector("#eventsPanel").hidden = false;
      document.querySelector("#variablesPanel").hidden = true;
      document.querySelector("#showMinifiedControl").hidden = false;

      currentState.functions.set("sequence", {
        id: "sequence",
        kind: "observed-dom-sequence",
        name: "canvas canvas browser click sequence",
        path: "<canvas#canvas>.browser-click-sequence"
      });
      currentState.functions.set("dom-event", {
        id: "dom-event",
        kind: "observed-dom-event",
        name: "canvas canvas mousedown event",
        path: "<canvas#canvas>.mousedown"
      });
      currentState.functions.set("dispatch", {
        id: "dispatch",
        kind: "library-event-dispatch",
        name: "createjs.EventDispatcher mousedown dispatch",
        path: "createjs.EventDispatcher.dispatchEvent(\"mousedown\")"
      });
      currentState.functions.set("change-dispatch", {
        id: "change-dispatch",
        kind: "library-event-dispatch",
        name: "createjs.EventDispatcher change dispatch",
        path: "createjs.EventDispatcher.dispatchEvent(\"change\")"
      });
      currentState.functions.set("z", {
        id: "z",
        kind: "function",
        name: "z",
        path: "game.z"
      });
      currentState.functions.set("orientation-parent", {
        id: "orientation-parent",
        kind: "function",
        name: "orientationParent",
        path: "game.orientationParent"
      });
      currentState.functions.set("getOrientation", {
        id: "getOrientation",
        callCount: 6,
        kind: "function",
        name: "getOrientation",
        path: "famobi#prototype.getOrientation"
      });
      currentState.functions.set("submitAnswer", {
        id: "submitAnswer",
        callCount: 2,
        kind: "function",
        name: "submitAnswer",
        path: "quiz.submitAnswer"
      });
      currentState.functions.set("network:request", {
        id: "network:request",
        callCount: 1,
        kind: "network-request",
        name: "network request",
        path: "network.request"
      });
      currentState.functions.set("network:response", {
        id: "network:response",
        callCount: 1,
        kind: "network-response",
        name: "network response",
        path: "network.response"
      });
      currentState.functions.set("answer-handler", {
        id: "answer-handler",
        callCount: 1,
        kind: "framework-event-handler",
        name: "button answer onClick.value handler",
        path: "<button.answer>._vei.onClick.value"
      });
      currentState.functions.set("source-hint-sendAnswer", {
        id: "source-hint-sendAnswer",
        callCount: 1,
        kind: "source-call-hint",
        name: "sendAnswer() inferred",
        path: "<button.answer>._vei.onClick.value -> c.sendAnswer(v)"
      });
      currentState.functions.set("setReg", {
        id: "setReg",
        callCount: 99,
        kind: "function",
        name: "setReg",
        path: "game.setReg"
      });
      currentState.functions.set("suppressedSetReg", {
        id: "suppressedSetReg",
        callCount: 1,
        kind: "suppressed-function",
        name: "setReg",
        note: "Tracking disabled: setReg has already been logged 99+ times and would flood the log.",
        path: "game.setReg",
        suppressed: true
      });
      currentState.functions.set("otherRenderStep", {
        id: "otherRenderStep",
        callCount: 99,
        kind: "function",
        name: "otherRenderStep",
        path: "game.otherRenderStep"
      });
      currentState.functions.set("tree-root", {
        id: "tree-root",
        callCount: 1,
        kind: "function",
        name: "treeRoot",
        path: "tree.root"
      });
      currentState.functions.set("tree-parent", {
        id: "tree-parent",
        callCount: 1,
        kind: "function",
        name: "branchParent",
        path: "tree.root.branchParent"
      });
      currentState.functions.set("tree-leaf", {
        id: "tree-leaf",
        callCount: 1,
        kind: "function",
        name: "branchLeaf",
        path: "tree.root.branchParent.branchLeaf"
      });
      currentState.functions.set("tree-sibling", {
        id: "tree-sibling",
        callCount: 1,
        kind: "function",
        name: "branchSibling",
        path: "tree.root.branchSibling"
      });
      currentState.networkRecords.set("top::network:1", {
        frameLabel: "top",
        framePath: "top",
        id: "top::network:1",
        paused: true,
        pausedPhase: "response",
        protocol: "fetch",
        request: {
          body: "{\"answer\":\"A\"}",
          headers: {
            "content-type": "application/json"
          },
          method: "POST",
          url: "/api/answer"
        },
        response: {
          body: "{\"answer\":false}",
          headers: {
            "content-type": "application/json; charset=utf-8"
          },
          status: 200,
          statusText: "OK"
        },
        time: "2026-01-01T00:00:04.001Z"
      });

      insertCall({
        args: ["pointerdown on <canvas#canvas>"],
        functionId: "sequence",
        id: 1,
        name: "canvas canvas browser click sequence",
        parentCallId: null,
        path: "<canvas#canvas>.browser-click-sequence",
        returnValue: "observed",
        time: "2026-01-01T00:00:00.000Z",
        treeId: 1
      });
      insertCall({
        args: ["{type: \"mousedown\", target: \"<canvas#canvas>\"}"],
        functionId: "dom-event",
        id: 2,
        name: "canvas canvas mousedown event",
        parentCallId: 1,
        path: "<canvas#canvas>.mousedown",
        returnValue: "observed",
        time: "2026-01-01T00:00:00.001Z",
        treeId: 1
      });
      insertCall({
        args: ["{type: \"mousedown\", cardValue: 7}"],
        functionId: "dispatch",
        id: 3,
        name: "createjs.EventDispatcher mousedown dispatch",
        parentCallId: 2,
        path: "createjs.EventDispatcher.dispatchEvent(\"mousedown\")",
        returnValue: "true",
        time: "2026-01-01T00:00:00.002Z",
        treeId: 1
      });
      insertCall({
        args: ["{type: \"mousedown\", cardValue: 7}"],
        functionId: "dispatch",
        id: 4,
        name: "createjs.EventDispatcher mousedown dispatch",
        parentCallId: 2,
        path: "createjs.EventDispatcher.dispatchEvent(\"mousedown\")",
        returnValue: "true",
        time: "2026-01-01T00:00:00.003Z",
        treeId: 1
      });
      insertCall({
        args: ["{type: \"mousedown\", cardValue: 7}"],
        functionId: "dispatch",
        id: 5,
        name: "createjs.EventDispatcher mousedown dispatch",
        parentCallId: 2,
        path: "createjs.EventDispatcher.dispatchEvent(\"mousedown\")",
        returnValue: "true",
        time: "2026-01-01T00:00:00.004Z",
        treeId: 1
      });
      for (const id of [20, 21, 22]) {
        insertCall({
          args: ["change"],
          functionId: "change-dispatch",
          id,
          name: "createjs.EventDispatcher change dispatch",
          parentCallId: null,
          path: "createjs.EventDispatcher.dispatchEvent(\"change\")",
          returnValue: "true",
          time: `2026-01-01T00:00:01.0${id - 20}0Z`,
          treeId: id
        });
      }
      insertCall({
        args: ["1"],
        functionId: "z",
        id: 30,
        name: "z",
        parentCallId: null,
        path: "game.z",
        returnValue: "2",
        time: "2026-01-01T00:00:02.000Z",
        treeId: 30
      });
      insertCall({
        args: [],
        functionId: "orientation-parent",
        id: 40,
        name: "orientationParent",
        parentCallId: null,
        path: "game.orientationParent",
        returnValue: "ready",
        time: "2026-01-01T00:00:03.000Z",
        treeId: 40
      });
      for (let index = 0; index < 6; index += 1) {
        insertCall({
          args: [],
          functionId: "getOrientation",
          id: 41 + index,
          name: "getOrientation",
          parentCallId: 40,
          path: "famobi#prototype.getOrientation",
          returnValue: "\"landscape\"",
          source: {
            column: index % 2 ? 373500 : 373314,
            kind: "call-site",
            line: 1,
            url: "https://games.cdn.famobi.com/html5games/s/solitaire-klondike/3239a0d6/lib/easeljs-NEXT.min.js"
          },
          time: `2026-01-01T00:00:03.00${index + 1}Z`,
          treeId: 40
        });
      }
      for (let index = 0; index < 99; index += 1) {
        insertCall({
          args: ["ready"],
          functionId: "setReg",
          id: 100 + index,
          name: "setReg",
          parentCallId: null,
          path: "game.setReg",
          returnValue: "true",
          time: `2026-01-01T00:00:03.${String(100 + index).padStart(3, "0")}Z`,
          treeId: 100 + index
        });
        insertCall({
          args: [String(index)],
          functionId: "otherRenderStep",
          id: 300 + index,
          name: "otherRenderStep",
          parentCallId: null,
          path: "game.otherRenderStep",
          returnValue: "ok",
          time: `2026-01-01T00:00:03.${String(300 + index).padStart(3, "0")}Z`,
          treeId: 300 + index
        });
      }
      insertCall({
        args: ["Tracking disabled: setReg has already been logged 99+ times and would flood the log."],
        functionId: "suppressedSetReg",
        id: 199,
        name: "setReg",
        note: "Tracking disabled: setReg has already been logged 99+ times and would flood the log.",
        parentCallId: null,
        path: "game.setReg",
        returnValue: "tracking disabled",
        suppressed: true,
        time: "2026-01-01T00:00:03.999Z",
        treeId: 199
      });
      insertCall({
        args: ["1"],
        functionId: "submitAnswer",
        id: 60,
        name: "submitAnswer",
        parentCallId: null,
        path: "quiz.submitAnswer",
        replayable: true,
        replayArgs: [1],
        returnValue: "\"wrong\"",
        time: "2026-01-01T00:00:04.000Z",
        treeId: 60
      });
      insertCall({
        args: ["{\"body\":\"{\\\"answer\\\":\\\"A\\\"}\",\"headers\":{\"content-type\":\"application/json\"},\"method\":\"POST\",\"url\":\"/api/answer\"}"],
        functionId: "network:request",
        id: 62,
        name: "POST request",
        network: {
          id: "top::network:1",
          method: "POST",
          paused: false,
          phase: "request",
          protocol: "fetch",
          status: 0,
          url: "/api/answer"
        },
        parentCallId: 60,
        path: "fetch POST /api/answer request",
        returnValue: "request",
        time: "2026-01-01T00:00:04.001Z",
        treeId: 60
      });
      insertCall({
        args: ["{\"body\":\"{\\\"answer\\\":false}\",\"headers\":{\"content-type\":\"application/json; charset=utf-8\"},\"status\":200,\"statusText\":\"OK\"}"],
        functionId: "network:response",
        id: 63,
        name: "POST 200 response",
        network: {
          id: "top::network:1",
          method: "POST",
          paused: true,
          phase: "response",
          protocol: "fetch",
          status: 200,
          url: "/api/answer"
        },
        parentCallId: 62,
        path: "fetch POST /api/answer response",
        returnValue: "paused response",
        time: "2026-01-01T00:00:04.002Z",
        treeId: 60
      });
      insertCall({
        args: ["{type: \"click\"}"],
        forceReplayArgs: [{ type: "dom-event", eventType: "click", init: {}, target: { type: "ref", refId: "answer-button" } }],
        forceReplayable: true,
        functionId: "answer-handler",
        id: 70,
        name: "button answer onClick.value handler",
        parentCallId: null,
        path: "<button.answer>._vei.onClick.value",
        returnValue: "undefined",
        time: "2026-01-01T00:00:04.100Z",
        treeId: 70
      });
      insertCall({
        args: ["c.sendAnswer(v)"],
        enclosingReplay: {
          forceReplayArgs: [{ type: "dom-event", eventType: "click", init: {}, target: { type: "ref", refId: "answer-button" } }],
          forceReplayable: true,
          functionId: "answer-handler",
          name: "button answer onClick.value handler",
          replayArgs: null,
          replayable: false
        },
        functionId: "source-hint-sendAnswer",
        id: 71,
        name: "sendAnswer() inferred",
        parentCallId: 70,
        path: "<button.answer>._vei.onClick.value -> c.sendAnswer(v)",
        replayable: false,
        returnValue: "source hint",
        sourceHint: true,
        time: "2026-01-01T00:00:04.101Z",
        treeId: 70
      });
      insertCall({
        args: [],
        functionId: "tree-root",
        id: 80,
        name: "treeRoot",
        parentCallId: null,
        path: "tree.root",
        returnValue: "root",
        time: "2026-01-01T00:00:04.200Z",
        treeId: 80
      });
      insertCall({
        args: [],
        functionId: "tree-parent",
        id: 81,
        name: "branchParent",
        parentCallId: 80,
        path: "tree.root.branchParent",
        returnValue: "parent",
        time: "2026-01-01T00:00:04.201Z",
        treeId: 80
      });
      insertCall({
        args: [],
        functionId: "tree-leaf",
        id: 82,
        name: "branchLeaf",
        parentCallId: 81,
        path: "tree.root.branchParent.branchLeaf",
        returnValue: "leaf",
        time: "2026-01-01T00:00:04.202Z",
        treeId: 80
      });
      insertCall({
        args: [],
        functionId: "tree-sibling",
        id: 83,
        name: "branchSibling",
        parentCallId: 80,
        path: "tree.root.branchSibling",
        returnValue: "sibling",
        time: "2026-01-01T00:00:04.203Z",
        treeId: 80
      });
      insertCall({
        args: ["2"],
        functionId: "submitAnswer",
        id: 61,
        name: "submitAnswer",
        parentCallId: null,
        path: "quiz.submitAnswer",
        replayable: true,
        replayArgs: [2],
        returnValue: "\"correct\"",
        time: "2026-01-01T00:00:05.000Z",
        treeId: 61
      });
      render();
    });

    assert(await page.locator("#showMinifiedControl").isVisible(), "Expected Events tab to expose Show minified functions.");
    assert(await page.locator("#traceHandlersControl").isVisible(), "Expected Events tab to expose Trace event handlers.");
    assert(await page.locator(".call-row", { hasText: "canvas canvas browser click sequence" }).count() === 1, "Expected click sequence root to remain visible.");
    assert(await page.locator(".call-row", { hasText: "createjs.EventDispatcher mousedown dispatch" }).count() === 1, "Expected useful library dispatch to remain visible.");
    assert(await page.locator(".call-row", { hasText: "createjs.EventDispatcher mousedown dispatch" }).locator(".repeat-count", { hasText: "3" }).count() === 1, "Expected repeated useful dispatch rows to be grouped with a count.");
    assert(await page.locator(".call-row", { hasText: "createjs.EventDispatcher change dispatch" }).count() === 1, "Expected repeated root dispatch trees to be grouped into one visible row.");
    assert(await page.locator(".call-row", { hasText: "createjs.EventDispatcher change dispatch" }).locator(".repeat-count", { hasText: "3" }).count() === 1, "Expected repeated root dispatch trees to show a count.");
    assert(await page.locator(".call-row", { hasText: "getOrientation" }).count() === 1, "Expected repeated getOrientation calls with different call-site columns to be grouped.");
    assert(await page.locator(".call-row", { hasText: "getOrientation" }).locator(".repeat-count", { hasText: "6" }).count() === 1, "Expected grouped getOrientation row to show a count.");
    assert(await page.locator(".call-row", { hasText: "setReg" }).count() === 1, "Expected 99+ auto-suppression notice to merge into the setReg row.");
    assert(await page.locator(".call-row", { hasText: "setReg" }).locator(".repeat-count", { hasText: "99+" }).count() === 1, "Expected merged setReg row to show 99+.");
    assert(await page.locator(".call-row", { hasText: "setReg" }).locator(".tracking-disabled-inline", { hasText: "tracking disabled" }).count() === 1, "Expected merged setReg row to say tracking disabled.");
    assert(await page.locator(".call-row", { hasText: "sendAnswer() inferred" }).locator(".source-hint-replay").count() === 1, "Expected source-call hints to expose one replay-enclosing-handler button.");
    assert(await page.locator("#pauseRequestsControl").isVisible(), "Expected Events tab to expose Pause requests.");
    assert(await page.locator("#pauseResponsesControl").isVisible(), "Expected Events tab to expose Pause responses.");
    assert(await page.locator(".call-row", { hasText: "POST request" }).locator(".network-request-button").count() === 1, "Expected outgoing network rows to show a request edit/resend icon.");
    assert(await page.locator(".call-row", { hasText: "POST 200 response" }).locator(".network-response-button").count() === 1, "Expected incoming network rows to show a response icon.");
    assert(await page.locator(".call-row", { hasText: "POST 200 response" }).locator(".network-response-button.active-icon").count() === 1, "Expected paused incoming responses to use the active response icon style.");
    assert(await page.locator(".call-row", { hasText: "branchParent" }).locator(".tree-branch.continues").count() === 1, "Expected parent branch guide to continue through its sibling group.");
    assert(await page.locator(".call-row", { hasText: "branchLeaf" }).locator(".tree-guide").count() === 1, "Expected nested leaf row to keep the ancestor guide line visible.");
    assert(await page.locator(".call-row", { hasText: "branchSibling" }).locator(".tree-branch.last").count() === 1, "Expected final sibling branch guide to terminate.");
    assert(await page.locator(".root-call-row.tree-group-start").count() > 1, "Expected root rows to mark visual group separators.");
    assert(await page.evaluate(() => {
      const childRow = Array.from(document.querySelectorAll("#callTree .child-call-row"))
        .find((row) => row.textContent.includes("branchLeaf"));
      const rootRow = Array.from(document.querySelectorAll("#callTree .root-call-row.tree-group-start"))
        .find((row) => row.textContent.includes("treeRoot"));
      return childRow &&
        rootRow &&
        getComputedStyle(childRow).borderBottomStyle === "none" &&
        getComputedStyle(rootRow).borderTopStyle === "solid";
    }), "Expected Events tree to remove per-row horizontal dividers while keeping group separators.");
    assert(await page.locator(".call-row", { hasText: "canvas canvas mousedown event" }).count() === 0, "Expected raw DOM mousedown row to be hidden as noisy.");
    assert(await page.locator(".call-row", { hasText: "z" }).count() === 0, "Expected minified rows to be hidden until Show minified functions is enabled.");

    await page.evaluate(() => {
      eval(`callMonitor = async function panelSourceHintReplayStub(method, args) {
        window.__sourceHintReplayMethod = method;
        window.__sourceHintReplayArgs = args;
        return {
          running: true,
          totalCalls: 0,
          functions: []
        };
      }`);
    });
    await page.locator(".call-row", { hasText: "sendAnswer() inferred" }).locator(".source-hint-replay").click();
    assert(await page.evaluate(() =>
      window.__sourceHintReplayMethod === "replay" &&
      window.__sourceHintReplayArgs[0] === "answer-handler" &&
      window.__sourceHintReplayArgs[1][0].type === "dom-event" &&
      window.__sourceHintReplayArgs[2].forceDescriptors === true &&
      window.__sourceHintReplayArgs[2].directHandler === true), "Expected source-call hint replay button to replay the enclosing handler directly with force descriptors.");

    await page.locator("#functionsTab").click();
    assert(await page.locator("#functionsPanel").isVisible(), "Expected Functions tab panel to be visible.");
    assert(await page.locator("#functionTable .function-row", { hasText: "submitAnswer" }).count() === 1, "Expected Functions tab to de-duplicate repeated submitAnswer calls.");
    assert(await page.locator("#functionTable .function-row").first().locator(".fn-name", { hasText: "submitAnswer" }).count() === 1, "Expected most recently called function to appear first.");
    assert(await page.locator("#functionTable .function-row", { hasText: "submitAnswer" }).locator(".arg", { hasText: "2" }).count() === 1, "Expected Functions tab to show latest parameters.");
    assert(await page.locator("#functionTable .function-row", { hasText: "submitAnswer" }).locator(".return-value", { hasText: "\"correct\"" }).count() === 1, "Expected Functions tab to show latest return value.");
    assert(await page.locator("#functionTable .function-row", { hasText: "submitAnswer" }).locator(".arg-actions .icon-button").count() === 2, "Expected Functions tab to expose resend and edit-resend buttons.");
    assert(await page.locator("#functionTable .function-row", { hasText: "getOrientation" }).count() === 1, "Expected Functions tab to keep one row for repeated getOrientation calls.");
    assert(await page.locator("#functionTable .function-row", { hasText: "getOrientation" }).locator(".repeat-count", { hasText: "6" }).count() === 1, "Expected Functions tab repeat badge to show function call count.");
    assert(await page.locator("#functionTable .updated-function-row", { hasText: "submitAnswer" }).count() === 1, "Expected newly called function row to flash.");
    await page.locator("#eventsTab").click();

    const exported = await page.evaluate(() => buildExportPayload());
    const exportedCalls = [];
    function collectExportedCalls(call) {
      exportedCalls.push(call);
      for (const child of call.children || []) {
        collectExportedCalls(child);
      }
    }
    for (const tree of exported.trees || []) {
      for (const root of tree.roots || []) {
        collectExportedCalls(root);
      }
    }
    const exportedSetReg = exportedCalls.filter((call) => call.name === "setReg" && call.path === "game.setReg");
    assert(exportedSetReg.length === 1, `Expected export to contain one merged setReg row, got ${exportedSetReg.length}.`);
    assert(exportedSetReg[0].repeatCount === 99 && exportedSetReg[0].trackingDisabledAfterLimit, `Expected exported setReg row to be 99+ tracking disabled, got ${JSON.stringify(exportedSetReg[0])}.`);
    const orientationTree = exported.trees.find((tree) => tree.roots.some((root) => root.name === "orientationParent"));
    const orientationRoot = orientationTree && orientationTree.roots.find((root) => root.name === "orientationParent");
    const orientationChild = orientationRoot && orientationRoot.children.find((child) => child.name === "getOrientation");
    assert(orientationChild && orientationChild.repeatCount === 6, `Expected export to group repeated getOrientation rows, got ${JSON.stringify(orientationChild)}.`);
    assert(orientationChild.groupedSources && orientationChild.groupedSources.length === 2, `Expected export to preserve distinct grouped source columns, got ${JSON.stringify(orientationChild && orientationChild.groupedSources)}.`);

    await page.evaluate(() => {
      eval(`callMonitor = async function panelShowMinifiedStub(method, args) {
        window.__showMinifiedMethod = method;
        window.__showMinifiedArgs = args;
        return {
          running: true,
          totalCalls: 0,
          functions: []
        };
      }`);
    });
    await page.locator("#showMinifiedInput").check();
    assert(await page.locator(".call-row", { hasText: "z" }).count() === 1, "Expected minified rows to appear when Show minified functions is enabled.");
    assert(await page.evaluate(() => window.__showMinifiedMethod === "setOptions" && window.__showMinifiedArgs[0].captureMinifiedFunctions === true), "Expected Show minified functions to update monitor capture options.");
    await page.locator("#traceHandlersInput").check();
    assert(await page.evaluate(() => window.__showMinifiedMethod === "setOptions" && window.__showMinifiedArgs[0].wrapDomEventListeners === true), "Expected Trace event handlers to update monitor capture options.");

    await page.locator("#hideNoisyInput").uncheck();
    assert(await page.locator(".call-row", { hasText: "canvas canvas mousedown event" }).count() === 1, "Expected raw DOM mousedown row to return when Hide noisy is unchecked.");

    console.log("PASS panel Events tab hides raw browser phases while keeping useful dispatch rows.");
  } finally {
    await context.close();
  }
}

async function runPanelFavoritesPersistenceTest(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const panelUrl = pathToFileURL(path.join(rootDir, "devtools", "panel.html")).href;

  try {
    await page.goto(panelUrl);
    await page.waitForFunction(() => typeof favoriteCall === "function" && typeof favoriteVariable === "function");
    await page.evaluate(() => {
      window.localStorage.removeItem("js-disector:favorites:v1");
      const currentState = eval("state");
      currentState.favoriteEvents.clear();
      currentState.favoriteVariables.clear();
      currentState.starredEventIds.clear();
      currentState.starredVariableIds.clear();
      currentState.functions.set("top::function:addScore", {
        id: "top::function:addScore",
        name: "addScore",
        path: "game.score.addScore"
      });
      favoriteCall({
        args: ["5"],
        forceReplayArgs: [5],
        forceReplayable: true,
        functionId: "top::function:addScore",
        id: "top::call:addScore:1",
        name: "addScore",
        path: "game.score.addScore",
        replayArgs: [5],
        replayable: true,
        returnValue: "15",
        time: "2026-01-01T00:00:01.000Z",
        treeId: "top::tree:score"
      });
      favoriteVariable({
        canEdit: true,
        displayValue: "15",
        frameLabel: "top",
        id: "top::game.score",
        kind: "number",
        lastChangedAt: "2026-01-01T00:00:02.000Z",
        lastSeenAt: "2026-01-01T00:00:02.000Z",
        path: "game.score",
        value: 15
      });
    });

    assert(await page.evaluate(() => {
      const stored = JSON.parse(window.localStorage.getItem("js-disector:favorites:v1"));
      return stored && stored.events.length === 1 && stored.variables.length === 1;
    }), "Expected starred event and variable to be written to persistent storage.");

    await page.reload();
    await page.waitForFunction(() => typeof setActiveTab === "function" && eval("state").favoriteEvents.size === 1 && eval("state").favoriteVariables.size === 1);
    await page.evaluate(() => setActiveTab("favorites"));
    assert(await page.locator(".favorite-row", { hasText: "addScore" }).count() === 1, "Expected favorite event to persist across panel reload.");
    assert(await page.locator(".favorite-name", { hasText: "game.score" }).count() === 1, "Expected favorite variable to persist across panel reload.");

    await page.evaluate(() => {
      unfavoriteCall("top::call:addScore:1");
      unfavoriteVariable("top::game.score");
    });
    assert(await page.evaluate(() => {
      const stored = JSON.parse(window.localStorage.getItem("js-disector:favorites:v1"));
      return stored && stored.events.length === 0 && stored.variables.length === 0;
    }), "Expected unstarred favorites to be removed from persistent storage.");

    await page.reload();
    await page.waitForFunction(() => typeof setActiveTab === "function");
    await page.evaluate(() => setActiveTab("favorites"));
    assert(await page.locator(".favorite-row").count() === 0, "Expected removed favorites to stay removed after panel reload.");

    console.log("PASS panel Favorites persist across reloads and removals.");
  } finally {
    await context.close();
  }
}

async function runPanelShowMinifiedIntegrationTest(browser, source) {
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(pathToFileURL(path.join(rootDir, "devtools", "panel.html")).href);
    await page.waitForFunction(() => typeof installMonitor === "function" && typeof callMonitor === "function" && document.querySelector("#showMinifiedInput"));

    await page.evaluate((monitorSource) => new Promise((resolve) => {
      const frame = document.createElement("iframe");
      frame.id = "show-minified-target";
      frame.srcdoc = `<!doctype html>
        <html><body>
          <script>
            window.minifiedLog = [];
            window.e = function e(value) {
              window.minifiedLog.push(value);
              return value + 1;
            };
          <\/script>
        </body></html>`;
      frame.addEventListener("load", () => {
        window.__showMinifiedTarget = frame.contentWindow;
        window.browser = {
          devtools: {
            inspectedWindow: {
              tabId: 1,
              eval: async (expression) => {
                try {
                  return [window.__showMinifiedTarget.eval(expression), null];
                } catch (error) {
                  return [undefined, {
                    isException: true,
                    value: String(error && error.message || error)
                  }];
                }
              }
            },
            panels: {}
          },
          runtime: {
            sendMessage: async () => ({ enabled: true })
          }
        };
        eval("state").monitorSource = monitorSource;
        resolve();
      }, { once: true });
      document.body.append(frame);
    }), source);

    await page.locator("#startButton").click();
    await page.waitForFunction(() => eval("state").installed && eval("state").running);
    assert(await page.locator("#showMinifiedInput").isChecked(), "Expected Show minified functions to be enabled by default.");
    await page.evaluate(() => window.__showMinifiedTarget.e(1));
    await page.evaluate(async () => {
      const payload = await callMonitor("drain");
      applyDrain(payload);
    });
    assert(await page.evaluate(() =>
      Array.from(document.querySelectorAll(".fn-name")).some((node) => node.textContent.trim() === "e")
    ), "Expected minified e() to be visible by default.");

    await page.locator("#showMinifiedInput").uncheck();
    await page.waitForFunction(() =>
      window.__showMinifiedTarget.__JAVASCREEN__ &&
      window.__showMinifiedTarget.__JAVASCREEN__.snapshot().diagnostics.options.captureMinifiedFunctions === false);
    await page.evaluate(() => window.__showMinifiedTarget.e(2));
    await page.evaluate(async () => {
      const payload = await callMonitor("drain");
      applyDrain(payload);
    });
    assert(await page.evaluate(() =>
      !Array.from(document.querySelectorAll(".fn-name")).some((node) => node.textContent.trim() === "e")
    ), "Expected unchecked Show minified functions to hide e() rows.");

    await page.locator("#showMinifiedInput").check();
    await page.waitForFunction(() =>
      window.__showMinifiedTarget.__JAVASCREEN__ &&
      window.__showMinifiedTarget.__JAVASCREEN__.snapshot().diagnostics.options.captureMinifiedFunctions === true);
    await page.evaluate(() => window.__showMinifiedTarget.e(3));
    await page.evaluate(async () => {
      const payload = await callMonitor("drain");
      applyDrain(payload);
    });

    assert(await page.evaluate(() =>
      Array.from(document.querySelectorAll(".fn-name")).some((node) => node.textContent.trim() === "e")
    ), "Expected Show minified functions checkbox to make e() visible after capture options update.");
    assert(await page.evaluate(() => JSON.stringify(window.__showMinifiedTarget.minifiedLog) === JSON.stringify([1, 2, 3])), "Expected minified function calls to still execute normally.");

    console.log("PASS panel Show minified functions checkbox updates real monitor capture.");
  } finally {
    await context.close();
  }
}

async function runPanelLateFrameOptionsSyncTest(browser, source) {
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(pathToFileURL(path.join(rootDir, "devtools", "panel.html")).href);
    await page.waitForFunction(() => typeof installMonitor === "function" && typeof callMonitor === "function");

    await page.evaluate((monitorSource) => new Promise((resolve) => {
      const frame = document.createElement("iframe");
      frame.id = "late-frame-root";
      frame.srcdoc = "<!doctype html><html><body><div id=\"root\"></div></body></html>";
      frame.addEventListener("load", () => {
        window.__lateFrameRoot = frame.contentWindow;
        window.browser = {
          devtools: {
            inspectedWindow: {
              tabId: 1,
              eval: async (expression) => {
                try {
                  return [window.__lateFrameRoot.eval(expression), null];
                } catch (error) {
                  return [undefined, {
                    isException: true,
                    value: String(error && error.message || error)
                  }];
                }
              }
            },
            panels: {}
          },
          runtime: {
            sendMessage: async () => ({ enabled: true })
          }
        };
        eval("state").monitorSource = monitorSource;
        resolve();
      }, { once: true });
      document.body.append(frame);
    }), source);

    await page.locator("#startButton").click();
    await page.waitForFunction(() => eval("state").installed && eval("state").running);

    await page.evaluate(() => new Promise((resolve) => {
      const child = window.__lateFrameRoot.document.createElement("iframe");
      child.id = "late-child";
      child.srcdoc = `<!doctype html>
        <html><body>
          <script>
            window.lateLog = [];
            window.z = function z(value) {
              window.lateLog.push(value);
              return value + 7;
            };
          <\/script>
        </body></html>`;
      child.addEventListener("load", () => {
        window.__lateChild = child.contentWindow;
        resolve();
      }, { once: true });
      window.__lateFrameRoot.document.body.append(child);
    }));

    await page.evaluate(async () => {
      const payload = await callMonitor("drain");
      applyDrain(payload);
    });
    assert(await page.evaluate(() =>
      window.__lateChild.__JAVASCREEN__ &&
      window.__lateChild.__JAVASCREEN__.snapshot({
        includeFunctions: false,
        includeNetwork: false,
        includeVariables: false
      }).diagnostics.options.captureMinifiedFunctions === true
    ), "Expected late child frame to inherit Show minified functions during drain.");
    assert(await page.evaluate(() =>
      window.__lateChild.__JAVASCREEN__ &&
      window.__lateChild.__JAVASCREEN__.snapshot({
        includeFunctions: false,
        includeNetwork: false,
        includeVariables: false
      }).diagnostics.options.wrapDomEventListeners === true
    ), "Expected late child frame to inherit Trace event handlers during drain.");

    await page.evaluate(() => window.__lateChild.z(5));
    await page.evaluate(async () => {
      const payload = await callMonitor("drain");
      applyDrain(payload);
    });

    assert(await page.evaluate(() =>
      Array.from(document.querySelectorAll(".fn-name")).some((node) => node.textContent.trim() === "z")
    ), "Expected late child frame minified z() call to be visible after option sync.");
    assert(await page.evaluate(() => JSON.stringify(window.__lateChild.lateLog) === JSON.stringify([5])), "Expected late child function to execute normally.");

    console.log("PASS panel drain syncs capture options into late child frames.");
  } finally {
    await context.close();
  }
}

async function runPanelTreeRetentionTest(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(pathToFileURL(path.join(rootDir, "devtools", "panel.html")).href);
    await page.waitForFunction(() => typeof render === "function" && typeof insertCall === "function" && typeof pruneOldCalls === "function" && document.querySelector("#callTree"));

    await page.evaluate(() => {
      const currentState = eval("state");
      currentState.activeTab = "events";
      currentState.callsById.clear();
      currentState.callOrder = [];
      currentState.pendingChildren.clear();
      currentState.trees.clear();
      currentState.functions.clear();
      currentState.hiddenFunctionIds.clear();
      currentState.filter = "";
      currentState.blacklistFilter = "";
      currentState.hideNoisy = false;
      currentState.showMinifiedFunctions = true;
      currentState.renderLimit = 5;
      document.querySelector("#eventsPanel").hidden = false;
      document.querySelector("#variablesPanel").hidden = true;
      document.querySelector("#hideNoisyInput").checked = false;
      document.querySelector("#showMinifiedInput").checked = true;

      for (const fn of [
        ["old-root", "oldBackgroundPoll", "app.oldBackgroundPoll"],
        ["click-root", "canvas canvas browser click sequence", "<canvas#canvas>.browser-click-sequence"],
        ["mouse-down", "_handleMouseDown", "game.stage#prototype._handleMouseDown"],
        ["pointer-down", "_handlePointerDown", "game.stage#prototype._handlePointerDown"],
        ["mouse-up", "_handleMouseUp", "game.stage#prototype._handleMouseUp"],
        ["pointer-up", "_handlePointerUp", "game.stage#prototype._handlePointerUp"],
        ["deal-card", "dealCard", "game.dealCard"],
        ["set-score", "setScore", "game.setScore"]
      ]) {
        currentState.functions.set(fn[0], {
          id: fn[0],
          kind: "function",
          name: fn[1],
          path: fn[2]
        });
      }

      insertCall({
        args: [],
        functionId: "old-root",
        id: "old-1",
        name: "oldBackgroundPoll",
        parentCallId: null,
        path: "app.oldBackgroundPoll",
        returnValue: "ok",
        time: "2026-01-01T00:00:00.000Z",
        treeId: "old-tree"
      });

      insertCall({
        args: ["pointerdown on <canvas#canvas>"],
        functionId: "click-root",
        id: "click-1",
        name: "canvas canvas browser click sequence",
        parentCallId: null,
        path: "<canvas#canvas>.browser-click-sequence",
        returnValue: "observed",
        time: "2026-01-01T00:00:01.000Z",
        treeId: "click-tree"
      });

      const children = [
        ["mouse-down", "_handleMouseDown", "click-2", "click-1"],
        ["pointer-down", "_handlePointerDown", "click-3", "click-2"],
        ["mouse-up", "_handleMouseUp", "click-4", "click-1"],
        ["pointer-up", "_handlePointerUp", "click-5", "click-4"],
        ["deal-card", "dealCard", "click-6", "click-5"],
        ["set-score", "setScore", "click-7", "click-6"]
      ];

      for (let index = 0; index < children.length; index += 1) {
        const [functionId, name, id, parentCallId] = children[index];
        insertCall({
          args: [],
          functionId,
          id,
          name,
          parentCallId,
          path: currentState.functions.get(functionId).path,
          returnValue: String(index),
          time: `2026-01-01T00:00:01.00${index + 1}Z`,
          treeId: "click-tree"
        });
      }

      pruneOldCalls();
      render();
    });

    assert(await page.locator(".call-row", { hasText: "oldBackgroundPoll" }).count() === 0, "Expected oldest unrelated tree to be pruned first.");
    assert(await page.locator(".call-row", { hasText: "canvas canvas browser click sequence" }).count() === 1, "Expected click tree root to remain.");
    assert(await page.locator(".call-row", { hasText: "_handleMouseDown" }).count() === 1, "Expected click tree child to remain after pruning.");
    assert(await page.locator(".call-row", { hasText: "_handlePointerUp" }).count() === 1, "Expected deep click tree child to remain after pruning.");
    assert(await page.locator(".call-row", { hasText: "dealCard" }).count() === 1, "Expected app function called by click to remain after pruning.");
    assert(await page.locator(".call-row", { hasText: "setScore" }).count() === 1, "Expected deepest app function called by click to remain after pruning.");

    console.log("PASS panel pruning keeps complete click traces instead of orphaning event shells.");
  } finally {
    await context.close();
  }
}

async function runPanelPerformanceVirtualizationTest(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(pathToFileURL(path.join(rootDir, "devtools", "panel.html")).href);
    await page.waitForFunction(() =>
      typeof render === "function" &&
      typeof renderFunctions === "function" &&
      typeof renderVariables === "function" &&
      typeof insertCall === "function" &&
      document.querySelector("#callTree"));

    const eventMetrics = await page.evaluate(() => {
      const currentState = eval("state");
      currentState.activeTab = "events";
      currentState.callsById.clear();
      currentState.callOrder = [];
      currentState.pendingChildren.clear();
      currentState.trees.clear();
      currentState.functions.clear();
      currentState.networkRecords.clear();
      currentState.hiddenFunctionIds.clear();
      currentState.starredEventIds.clear();
      currentState.filter = "";
      currentState.blacklistFilter = "";
      currentState.hideNoisy = false;
      currentState.showMinifiedFunctions = true;
      currentState.renderLimit = 20000;
      document.querySelector("#eventsPanel").hidden = false;
      document.querySelector("#functionsPanel").hidden = true;
      document.querySelector("#variablesPanel").hidden = true;
      document.querySelector("#autoscrollInput").checked = true;

      for (let index = 0; index < 2400; index += 1) {
        const functionId = `perf-fn-${index}`;
        currentState.functions.set(functionId, {
          id: functionId,
          kind: "function",
          name: `perfFunction${index}`,
          path: `app.perfFunction${index}`
        });
        insertCall({
          args: [String(index)],
          functionId,
          id: `perf-call-${index}`,
          name: `perfFunction${index}`,
          parentCallId: null,
          path: `app.perfFunction${index}`,
          returnValue: String(index),
          time: `2026-01-01T00:00:${String(index % 60).padStart(2, "0")}.000Z`,
          treeId: `perf-tree-${index}`
        });
      }

      currentState.functions.set("network-parent", {
        id: "network-parent",
        kind: "function",
        name: "submitLargePerfRequest",
        path: "app.submitLargePerfRequest"
      });
      currentState.functions.set("network:request", {
        id: "network:request",
        kind: "network-request",
        name: "network request",
        path: "network.request"
      });
      currentState.functions.set("network:response", {
        id: "network:response",
        kind: "network-response",
        name: "network response",
        path: "network.response"
      });
      currentState.networkRecords.set("top::network:perf", {
        frameLabel: "top",
        framePath: "top",
        id: "top::network:perf",
        paused: false,
        pausedPhase: "",
        protocol: "fetch",
        request: {
          body: "{\"ok\":true}",
          headers: { "content-type": "application/json" },
          method: "POST",
          url: "/api/perf"
        },
        response: {
          body: "{\"ok\":true}",
          headers: { "content-type": "application/json" },
          status: 200,
          statusText: "OK"
        },
        time: "2026-01-01T00:01:00.000Z"
      });
      insertCall({
        args: [],
        functionId: "network-parent",
        id: "network-parent-call",
        name: "submitLargePerfRequest",
        parentCallId: null,
        path: "app.submitLargePerfRequest",
        returnValue: "pending",
        time: "2026-01-01T00:01:00.000Z",
        treeId: "network-tree"
      });
      insertCall({
        args: ["{\"method\":\"POST\",\"url\":\"/api/perf\"}"],
        functionId: "network:request",
        id: "network-request-call",
        name: "POST request",
        network: {
          id: "top::network:perf",
          method: "POST",
          paused: false,
          phase: "request",
          protocol: "fetch",
          status: 0,
          url: "/api/perf"
        },
        parentCallId: "network-parent-call",
        path: "fetch POST /api/perf request",
        returnValue: "request",
        time: "2026-01-01T00:01:00.001Z",
        treeId: "network-tree"
      });
      insertCall({
        args: ["{\"status\":200,\"body\":\"{\\\"ok\\\":true}\"}"],
        functionId: "network:response",
        id: "network-response-call",
        name: "POST 200 response",
        network: {
          id: "top::network:perf",
          method: "POST",
          paused: false,
          phase: "response",
          protocol: "fetch",
          status: 200,
          url: "/api/perf"
        },
        parentCallId: "network-request-call",
        path: "fetch POST /api/perf response",
        returnValue: "{\"ok\":true}",
        time: "2026-01-01T00:01:00.002Z",
        treeId: "network-tree"
      });
      currentState.starredEventIds.add("network-parent-call");
      render();
      return {
        callOrder: currentState.callOrder.length,
        domRows: document.querySelectorAll("#callTree .call-row").length,
        lastRendered: currentState.lastRenderedRowCount,
        lastTotal: currentState.lastTotalRenderableRows,
        renderMs: currentState.lastRenderDurationMs,
        text: document.querySelector("#callTree").textContent
      };
    });

    assert(eventMetrics.callOrder > 2400, `Expected large synthetic event log, got ${JSON.stringify(eventMetrics)}.`);
    assert(eventMetrics.lastTotal > 2400, `Expected virtual row model to include every event row, got ${JSON.stringify(eventMetrics)}.`);
    assert(eventMetrics.domRows < 220, `Expected Events DOM rows to stay bounded, got ${JSON.stringify(eventMetrics)}.`);
    assert(eventMetrics.lastRendered < 220, `Expected performance diagnostics to report bounded event rows, got ${JSON.stringify(eventMetrics)}.`);
    assert(eventMetrics.text.includes("submitLargePerfRequest"), "Expected virtualized tail to include latest starred/network tree.");
    assert(await page.locator(".network-request-button").count() === 1, "Expected virtualized network request icon to render.");
    assert(await page.locator(".network-response-button").count() === 1, "Expected virtualized network response icon to render.");

    await page.evaluate(() => {
      const currentState = eval("state");
      currentState.filter = "perfFunction10".toLowerCase();
      invalidateCallRenderCache();
      render();
    });
    assert(await page.locator(".call-row", { hasText: "perfFunction10" }).count() >= 1, "Expected filtering to find virtualized event rows.");
    assert(await page.locator("#callTree .call-row").count() < 220, "Expected filtered Events DOM rows to remain bounded.");

    await page.locator("#functionsTab").click();
    const functionMetrics = await page.evaluate(() => ({
      domRows: document.querySelectorAll("#functionTable .function-row").length,
      lastRendered: eval("state").lastRenderedRowCount,
      lastTotal: eval("state").lastTotalRenderableRows
    }));
    assert(functionMetrics.lastTotal > 2400, `Expected Functions row model to include called functions, got ${JSON.stringify(functionMetrics)}.`);
    assert(functionMetrics.domRows < 220, `Expected Functions DOM rows to stay bounded, got ${JSON.stringify(functionMetrics)}.`);

    const variableMetrics = await page.evaluate(() => {
      const currentState = eval("state");
      currentState.activeTab = "variables";
      currentState.variables.clear();
      currentState.variableFilter = "";
      currentState.variableValueSearch = "";
      currentState.hideNoisy = true;
      document.querySelector("#eventsPanel").hidden = true;
      document.querySelector("#functionsPanel").hidden = true;
      document.querySelector("#variablesPanel").hidden = false;
      for (let index = 0; index < 1500; index += 1) {
        currentState.variables.set(`top::app.group${index}.needle${index}.value`, {
          canEdit: true,
          displayValue: `value-${index}`,
          frameLabel: "top",
          id: `top::app.group${index}.needle${index}.value`,
          importance: 5,
          kind: "string",
          lastChangedAt: `2026-01-01T00:${String(index % 60).padStart(2, "0")}:00.000Z`,
          lastSeenAt: `2026-01-01T00:${String(index % 60).padStart(2, "0")}:00.000Z`,
          path: `app.group${index}.needle${index}.value`,
          value: `value-${index}`
        });
      }
      renderVariables();
      return {
        domRows: document.querySelectorAll("#variableTable .variable-row").length,
        lastRendered: currentState.lastRenderedRowCount,
        lastTotal: currentState.lastTotalRenderableRows
      };
    });
    assert(variableMetrics.lastTotal > 1500, `Expected Variables row model to include groups and variables, got ${JSON.stringify(variableMetrics)}.`);
    assert(variableMetrics.domRows < 220, `Expected Variables DOM rows to stay bounded, got ${JSON.stringify(variableMetrics)}.`);

    await page.evaluate(() => {
      const currentState = eval("state");
      currentState.variableValueSearch = "value-1499";
      renderVariables();
    });
    assert(await page.locator(".variable-value", { hasText: "value-1499" }).count() === 1, "Expected value search to find virtualized variable rows.");

    const exported = await page.evaluate(() => buildExportPayload());
    assert(exported.diagnostics.panel.lastRenderedRowCount < 220, `Expected export diagnostics to include bounded render count, got ${JSON.stringify(exported.diagnostics.panel)}.`);
    assert(exported.diagnostics.panel.lastTotalRenderableRows > 0, "Expected export diagnostics to include total renderable rows.");
    assert(exported.diagnostics.captureSummary.calls.totalCalls > 2400, `Expected capture summary to include call totals, got ${JSON.stringify(exported.diagnostics.captureSummary.calls)}.`);
    assert(exported.diagnostics.captureSummary.network.records === 1, `Expected capture summary to include network totals, got ${JSON.stringify(exported.diagnostics.captureSummary.network)}.`);
    assert(Array.isArray(exported.diagnostics.captureSummary.hints), "Expected capture summary to include diagnostic hints.");

    console.log("PASS panel virtualization keeps large Events, Functions, and Variables DOM row counts bounded.");
  } finally {
    await context.close();
  }
}

async function runPanelDeltaPollingTest(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(pathToFileURL(path.join(rootDir, "devtools", "panel.html")).href);
    await page.waitForFunction(() => typeof poll === "function" && typeof render === "function");

    const result = await page.evaluate(async () => {
      const currentState = eval("state");
      const originalRender = render;
      let renderCount = 0;
      render = function countedRender() {
        renderCount += 1;
        return originalRender();
      };
      currentState.installed = true;
      currentState.activeTab = "events";
      currentState.running = true;
      refreshCaptureStatus = async function refreshCaptureStatusStub() {
        return null;
      };
      callMonitor = async function callMonitorDeltaStub(method, args) {
        window.__deltaPollMethod = method;
        window.__deltaPollArgs = args;
        return {
          calls: [],
          snapshot: {
            diagnostics: {
              options: {
                captureMinifiedFunctions: true,
                continueTrackingAfterLimit: false,
                pauseNetworkRequests: false,
                pauseNetworkResponses: false,
                safeMode: false,
                wrapDomEventListeners: true
              }
            },
            disabledIds: [],
            frames: [],
            functionCount: 500,
            functions: [],
            network: [],
            running: true,
            totalCalls: 1000,
            variableCount: 250,
            variables: []
          }
        };
      };
      await poll();
      return {
        args: window.__deltaPollArgs,
        lastDrainPayloadSize: currentState.lastDrainPayloadSize,
        method: window.__deltaPollMethod,
        renderCount
      };
    });

    assert(result.method === "drain", `Expected steady poll to drain, got ${JSON.stringify(result)}.`);
    assert(result.args && result.args[0] && result.args[0].includeFunctions === "changed", `Expected steady poll to request changed functions only, got ${JSON.stringify(result)}.`);
    assert(result.args[0].includeNetwork === "changed", `Expected steady poll to request changed network only, got ${JSON.stringify(result)}.`);
    assert(result.args[0].includeVariables === false, `Expected steady Events poll to omit variables, got ${JSON.stringify(result)}.`);
    assert(result.renderCount === 0, `Expected no-call steady poll not to repaint Events, got ${JSON.stringify(result)}.`);
    assert(result.lastDrainPayloadSize > 0, `Expected drain payload size diagnostic, got ${JSON.stringify(result)}.`);

    console.log("PASS panel steady polling uses lightweight drain flags and skips no-op renders.");
  } finally {
    await context.close();
  }
}

await runExtensionActivationStaticTest();

const nodeModules = findNodeModules();
const require = createRequire(path.join(nodeModules, "playwright", "package.json"));
const { chromium } = require("playwright");
const monitorSource = `${await readFile(monitorPath, "utf8")}\n//# sourceURL=javascreen-injected-monitor.js`;
const bridgeSource = extractFrameBridge(await readFile(panelPath, "utf8"));
const server = await startServer();
const crossOriginServer = await startCrossOriginServers();

let browser;
try {
  const executablePath = findBrowserExecutable();
  browser = await chromium.launch({
    executablePath: executablePath || undefined,
    headless: true
  });
  await runTopOnlyReloadBridgeTest(browser, server.url, bridgeSource, monitorSource);
  await runAllFrameEarlyCaptureTest(browser, server.url, bridgeSource, monitorSource);
  await runCrossOriginFrameFeedTest(browser, crossOriginServer.url, bridgeSource, monitorSource);
  await runGameSafeInputTest(browser, server.url, bridgeSource, monitorSource);
  await runEventHandlerTracingTest(browser, server.url, bridgeSource, monitorSource);
  await runFrameworkEventHandlerDiscoveryTest(browser, server.url, bridgeSource, monitorSource);
  await runClientJsAppPatternsTest(browser, server.url, bridgeSource, monitorSource);
  await runNetworkPauseEditTest(browser, server.url, bridgeSource, monitorSource);
  await runAsyncResponseEditUpdatesPageTest(browser, server.url, bridgeSource, monitorSource);
  await runTransparentWrapperTest(browser, bridgeSource, monitorSource);
  await runPanelVariableTreeTest(browser);
  await runPanelEventNoiseTest(browser);
  await runPanelFavoritesPersistenceTest(browser);
  await runPanelShowMinifiedIntegrationTest(browser, monitorSource);
  await runPanelLateFrameOptionsSyncTest(browser, monitorSource);
  await runPanelTreeRetentionTest(browser);
  await runPanelPerformanceVirtualizationTest(browser);
  await runPanelDeltaPollingTest(browser);
} finally {
  if (browser) {
    await browser.close();
  }
  await server.close();
  await crossOriginServer.close();
}
