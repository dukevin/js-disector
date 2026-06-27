import { createRequire } from "node:module";
import { existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const monitorPath = path.join(rootDir, "devtools", "injected-monitor.js");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
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

const nodeModules = findNodeModules();
const require = createRequire(path.join(nodeModules, "playwright", "package.json"));
const { chromium } = require("playwright");
const monitorSource = `${await readFile(monitorPath, "utf8")}
//# sourceURL=javascreen-injected-monitor.js
try {
  window.__JAVASCREEN__.setOptions({
    captureMinifiedFunctions: true,
    continueTrackingAfterLimit: true,
    wrapDomEventListeners: true
  });
} catch (error) {
}`;

let browser;
try {
  const executablePath = findBrowserExecutable();
  browser = await chromium.launch({
    executablePath: executablePath || undefined,
    headless: true
  });
  const context = await browser.newContext();
  await context.addInitScript({ content: monitorSource });
  const page = await context.newPage();

  await page.goto("https://javascriptquiz.com/", {
    timeout: 45000,
    waitUntil: "domcontentloaded"
  });
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.__JAVASCREEN__ && window.__JAVASCREEN__.rescan());
  await page.evaluate(() => window.__JAVASCREEN__ && window.__JAVASCREEN__.drain());
  await page.getByRole("button", { name: /let/i }).click().catch(() => {});
  await page.waitForTimeout(900);
  await page.evaluate(() => window.__JAVASCREEN__ && window.__JAVASCREEN__.rescan());

  const handlerSources = await page.evaluate(() => {
    function visibleAnswerButton() {
      const buttons = Array.from(document.querySelectorAll("button"))
        .filter((button) => Boolean(button.offsetWidth || button.offsetHeight || button.getClientRects().length));
      return buttons.find((button) => String(button.className || "").includes("w-full") && button.textContent.trim()) || null;
    }

    function summarizeFunction(fn) {
      try {
        return Function.prototype.toString.call(fn);
      } catch (error) {
        return String(error && error.message || error);
      }
    }

    const button = visibleAnswerButton();
    if (!button) {
      return [];
    }

    const stores = [];
    const ownKeys = Object.getOwnPropertyNames(button).concat(Object.getOwnPropertySymbols(button));
    for (const ownKey of ownKeys) {
      const keyText = typeof ownKey === "symbol" ? ownKey.description || ownKey.toString() : String(ownKey);
      if (!keyText || !keyText.toLowerCase().includes("_vei")) {
        continue;
      }

      try {
        if (button[ownKey]) {
          stores.push({
            keyText,
            store: button[ownKey]
          });
        }
      } catch (error) {
        // Ignore guarded framework internals.
      }
    }

    return stores
      .flatMap(({ keyText, store }) => Object.entries(store).map(([key, value]) => ({
        key: `${keyText}.${key}`,
        value
      })))
      .map(({ key, value }) => {
        const handler = value && typeof value === "object" && "value" in value ? value.value : value;
        if (Array.isArray(handler)) {
          return handler.map((fn, index) => ({
            key: `${key}[${index}]`,
            source: typeof fn === "function" ? summarizeFunction(fn) : String(fn)
          }));
        }

        return {
          key,
          source: typeof handler === "function" ? summarizeFunction(handler) : String(handler)
        };
      })
      .flat();
  });

  const clicked = await page.evaluate(() => {
    function visibleAnswerButton() {
      const buttons = Array.from(document.querySelectorAll("button"))
        .filter((button) => Boolean(button.offsetWidth || button.offsetHeight || button.getClientRects().length));
      return buttons.find((button) => String(button.className || "").includes("w-full") && button.textContent.trim()) || null;
    }

    const button = visibleAnswerButton();
    if (!button) {
      return { ok: false };
    }

    const text = button.textContent.trim();
    button.click();
    return { ok: true, text };
  });
  assert(clicked.ok, "Could not find a visible JavaScript Quiz answer button.");

  await page.waitForTimeout(2600);
  const payload = await page.evaluate(() => window.__JAVASCREEN__ && window.__JAVASCREEN__.drain());
  const calls = payload && payload.calls || [];
  const diagnostics = payload && payload.snapshot && payload.snapshot.diagnostics || {};
  const frameworkHandlers = diagnostics.listenerCounts && diagnostics.listenerCounts.frameworkEventHandlers || 0;
  const handlerCall = calls.find((call) => /onClick\.value handler$/.test(String(call.name || "")));
  const handlerParent = handlerCall && calls.find((call) => call.id === handlerCall.parentCallId);
  const actualSendAnswer = calls.find((call) => call.name === "sendAnswer" && /Question\.ctx\.sendAnswer/.test(String(call.path || "")));
  const actualAnswerClasses = calls.filter((call) => call.name === "answerClass" && /Question\.ctx\.answerClass/.test(String(call.path || "")));
  const inferredSendAnswer = calls.find((call) => call.name === "sendAnswer() inferred");
  const inferredAnswerClass = calls.find((call) => call.name === "answerClass() inferred");

  if (process.env.JAVASCREEN_VERBOSE_DISCOVERY) {
    const compactCalls = calls.map((call) => ({
      args: call.args,
      id: call.id,
      name: call.name,
      parentCallId: call.parentCallId,
      path: call.path,
      returnValue: call.returnValue,
      sourceHint: Boolean(call.sourceHint)
    }));
    console.log(JSON.stringify({
      clicked: clicked.text,
      diagnostics,
      handlerSources,
      calls: compactCalls
    }, null, 2));
  }

  assert(diagnostics.domCaptureMode === "aggressive mode: wrap DOM input listeners to trace event-handler call trees", `Unexpected DOM mode: ${diagnostics.domCaptureMode}`);
  assert(frameworkHandlers > 0, `Expected framework event handlers to be discovered, got ${frameworkHandlers}.`);
  assert(handlerCall, `Expected JavaScript Quiz answer click to log a framework onClick handler. Calls: ${calls.map((call) => call.name).join(", ")}`);
  assert(handlerParent && /click listener$/.test(String(handlerParent.name || "")), `Expected the framework handler to be a child of the answer click listener, got ${JSON.stringify(handlerParent)}.`);
  assert(actualSendAnswer && actualSendAnswer.parentCallId === handlerCall.id, `Expected JavaScript Quiz to log the real Question.ctx.sendAnswer call under the framework handler. Calls: ${calls.map((call) => `${call.name} @ ${call.path}`).join(", ")}`);
  assert(actualSendAnswer.args && String(actualSendAnswer.args[0] || "").includes(`text: ${JSON.stringify(clicked.text)}`), `Expected real sendAnswer args to include clicked value ${clicked.text}, got ${JSON.stringify(actualSendAnswer.args)}.`);
  assert(actualSendAnswer.args && /correct:\s*(true|false)/.test(String(actualSendAnswer.args[0] || "")), `Expected real sendAnswer args to include the answer correctness flag, got ${JSON.stringify(actualSendAnswer.args)}.`);
  assert(actualAnswerClasses.some((call) => String(call.args && call.args[0] || "").includes("correct: true")), `Expected render-time Question.ctx.answerClass calls to expose the correct answer object. Calls: ${actualAnswerClasses.map((call) => JSON.stringify(call.args)).join(", ")}`);
  assert(inferredSendAnswer && inferredSendAnswer.parentCallId === handlerCall.id, `Expected JavaScript Quiz closure call sendAnswer() to be inferred under the framework handler. Calls: ${calls.map((call) => call.name).join(", ")}`);
  assert(inferredAnswerClass && inferredAnswerClass.parentCallId === inferredSendAnswer.id, `Expected JavaScript Quiz render-related answerClass() to be inferred under sendAnswer(). Calls: ${calls.map((call) => call.name).join(", ")}`);
  assert(inferredSendAnswer.args && inferredSendAnswer.args.includes(`v ~= ${JSON.stringify(clicked.text)}`), `Expected inferred sendAnswer(v) args to include clicked value ${clicked.text}, got ${JSON.stringify(inferredSendAnswer.args)}.`);
  assert(inferredAnswerClass.args && inferredAnswerClass.args.includes(`v ~= ${JSON.stringify(clicked.text)}`), `Expected inferred answerClass(v) args to include clicked value ${clicked.text}, got ${JSON.stringify(inferredAnswerClass.args)}.`);

  console.log(`PASS javascriptquiz.com answer click traced framework handler "${handlerCall.name}" and inferred sendAnswer()/answerClass() after clicking "${clicked.text}".`);
} finally {
  if (browser) {
    await browser.close();
  }
}
