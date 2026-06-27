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
        const playwrightDir = readdirSync(pnpmRoot).find((name) => name.startsWith("playwright@"));
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

async function answerState(page, label) {
  return page.evaluate((stateLabel) => {
    const answers = Array.from(document.querySelectorAll("button"))
      .filter((button) => String(button.className || "").includes("w-full") && button.textContent.trim())
      .map((button) => ({
        className: String(button.className || ""),
        disabled: Boolean(button.disabled),
        green: String(button.className || "").includes("#4fc08d"),
        red: String(button.className || "").includes("#e14440"),
        text: button.textContent.trim()
      }));
    const progress = Array.from(document.querySelectorAll("span"))
      .map((span) => span.textContent.trim())
      .find((text) => /^\d+\/\d+$/.test(text)) || "";
    return {
      answers,
      label: stateLabel,
      progress
    };
  }, label);
}

async function currentCorrectAnswer(page) {
  return page.evaluate(() => {
    function vnodeComponentName(component) {
      return component && component.type && (component.type.name || component.type.__name || component.type.displayName) || "";
    }

    function visitComponent(component, seen) {
      if (!component || seen.has(component)) {
        return null;
      }
      seen.add(component);
      if (vnodeComponentName(component) === "Question") {
        return component;
      }

      function visitVNode(vnode) {
        if (!vnode || typeof vnode !== "object") {
          return null;
        }

        if (vnode.component) {
          const found = visitComponent(vnode.component, seen);
          if (found) {
            return found;
          }
        }

        const children = vnode.children;
        if (Array.isArray(children)) {
          for (const child of children) {
            const found = visitVNode(child);
            if (found) {
              return found;
            }
          }
        } else if (children && typeof children === "object") {
          for (const child of Object.values(children)) {
            const found = visitVNode(child);
            if (found) {
              return found;
            }
          }
        }

        return null;
      }

      return visitVNode(component.subTree);
    }

    function renderText(value) {
      const div = document.createElement("div");
      div.innerHTML = String(value == null ? "" : value);
      return div.textContent.trim();
    }

    const root = document.querySelector("#app");
    const app = root && root.__vue_app__;
    const rootComponent = root && root._vnode && root._vnode.component ||
      app && app._container && app._container._vnode && app._container._vnode.component ||
      app && app._instance;
    const question = visitComponent(rootComponent, new WeakSet());
    const localQuestion = question && (
      question.data && question.data.localQuestion ||
      question.proxy && question.proxy.localQuestion ||
      question.props && question.props.question
    );
    const answer = localQuestion && Array.isArray(localQuestion.answers)
      ? localQuestion.answers.find((item) => item && item.correct)
      : null;

    return answer ? {
      id: answer.id,
      rawText: answer.text,
      text: renderText(answer.text)
    } : null;
  });
}

async function clickAnswerText(page, text) {
  return page.evaluate((answerText) => {
    const button = Array.from(document.querySelectorAll("button"))
      .find((candidate) =>
        String(candidate.className || "").includes("w-full") &&
        candidate.textContent.trim() === answerText);
    if (!button) {
      return false;
    }
    button.click();
    return true;
  }, text);
}

function findSendAnswerFunction(snapshot) {
  return (snapshot && snapshot.functions || [])
    .find((fn) => fn.name === "sendAnswer" && /Question\.ctx\.sendAnswer/.test(String(fn.path || "")));
}

function findCorrectAnswerClassCall(calls) {
  return (calls || []).find((call) =>
    call.name === "answerClass" &&
    String(call.args && call.args[0] || "").includes("correct: true") &&
    Array.isArray(call.forceReplayArgs));
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
  await page.evaluate(() => window.__JAVASCREEN__ && window.__JAVASCREEN__.drain());

  const firstCorrect = await currentCorrectAnswer(page);
  assert(firstCorrect, "Could not find the current JavaScriptQuiz correct answer for test setup.");
  assert(await clickAnswerText(page, firstCorrect.text), `Could not click correct first answer "${firstCorrect.text}".`);
  await page.waitForTimeout(900);

  const firstPayload = await page.evaluate(() => window.__JAVASCREEN__ && window.__JAVASCREEN__.drain());
  const firstState = await answerState(page, "after first correct answer");
  const firstGreen = firstState.answers.find((answer) => answer.green);
  const firstSendAnswer = (firstPayload.calls || []).find((call) =>
    call.name === "sendAnswer" &&
    /Question\.ctx\.sendAnswer/.test(String(call.path || "")));

  assert(firstGreen && firstGreen.text === firstCorrect.text, `Expected first clicked answer to be green, got ${JSON.stringify(firstState)}.`);
  assert(firstSendAnswer && String(firstSendAnswer.args && firstSendAnswer.args[0] || "").includes("correct: true"), `Expected first correct answer to log real sendAnswer args, got ${(firstPayload.calls || []).map((call) => `${call.name}: ${JSON.stringify(call.args)}`).join(", ")}`);

  await page.getByRole("button", { name: /^next$/i }).click();
  await page.waitForTimeout(1200);
  const nextPayload = await page.evaluate(() => window.__JAVASCREEN__ && window.__JAVASCREEN__.drain());
  const beforeReplay = await answerState(page, "before replay on next question");
  const sendAnswerFn = findSendAnswerFunction(nextPayload.snapshot) || findSendAnswerFunction(firstPayload.snapshot);
  const correctAnswerClass = findCorrectAnswerClassCall(nextPayload.calls);

  assert(sendAnswerFn, `Expected JS Disector to discover Question.ctx.sendAnswer. Functions: ${(nextPayload.snapshot && nextPayload.snapshot.functions || []).map((fn) => `${fn.name} @ ${fn.path}`).join(", ")}`);
  assert(correctAnswerClass, `Expected next-question answerClass calls to reveal the current correct answer. Calls: ${(nextPayload.calls || []).map((call) => `${call.name}: ${JSON.stringify(call.args)}`).join(", ")}`);
  assert(beforeReplay.answers.length && beforeReplay.answers.every((answer) => !answer.disabled), `Expected next question to be unanswered before replay, got ${JSON.stringify(beforeReplay)}.`);

  const replayResult = await page.evaluate(({ args, id }) => {
    try {
      return {
        ok: true,
        value: window.__JAVASCREEN__.replay(id, args, { forceDescriptors: true })
      };
    } catch (error) {
      return {
        error: String(error && error.stack || error),
        ok: false
      };
    }
  }, {
    args: correctAnswerClass.forceReplayArgs,
    id: sendAnswerFn.id
  });
  assert(replayResult.ok, `Replay failed: ${JSON.stringify(replayResult)}`);

  await page.waitForTimeout(900);
  const replayPayload = await page.evaluate(() => window.__JAVASCREEN__ && window.__JAVASCREEN__.drain());
  const afterReplay = await answerState(page, "after sendAnswer replay");
  const replayedSendAnswer = (replayPayload.calls || []).find((call) =>
    call.name === "sendAnswer" &&
    /Question\.ctx\.sendAnswer/.test(String(call.path || "")));

  assert(replayedSendAnswer, `Expected replay to log sendAnswer, got ${(replayPayload.calls || []).map((call) => call.name).join(", ")}`);
  assert(!((replayPayload.calls || []).some((call) => /browser click sequence/.test(String(call.name || "")))), `Expected replay to avoid browser click events, got ${(replayPayload.calls || []).map((call) => call.name).join(", ")}`);
  assert(afterReplay.answers.some((answer) => answer.green), `Expected replayed sendAnswer to mark the next question correct, got ${JSON.stringify(afterReplay)}.`);
  assert(afterReplay.answers.every((answer) => answer.disabled), `Expected replayed sendAnswer to lock the answer buttons, got ${JSON.stringify(afterReplay)}.`);

  console.log(`PASS javascriptquiz.com replayed Question.ctx.sendAnswer with a JS Disector-captured correct answer argument; next question became answered without a second answer click.`);
} finally {
  if (browser) {
    await browser.close();
  }
}
