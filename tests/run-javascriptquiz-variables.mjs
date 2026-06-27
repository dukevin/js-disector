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

function variableMap(variables) {
  return new Map((variables || []).map((variable) => [variable.path, variable]));
}

function findVariable(variables, pattern) {
  return (variables || []).find((variable) => pattern.test(String(variable.path || "")));
}

function answerIndexFromPath(pathText) {
  const match = /localQuestion\.answers\[(\d+)\]\./.exec(String(pathText || ""));
  return match ? Number(match[1]) : -1;
}

function answerObjectsFromVariables(variables) {
  const byIndex = new Map();
  for (const variable of variables || []) {
    const index = answerIndexFromPath(variable.path);
    if (index < 0) {
      continue;
    }

    const answer = byIndex.get(index) || {};
    if (/\.id$/.test(variable.path)) {
      answer.id = variable.value;
      answer.idVariable = variable;
    } else if (/\.text$/.test(variable.path)) {
      answer.text = variable.value;
      answer.textVariable = variable;
    } else if (/\.correct$/.test(variable.path)) {
      answer.correct = variable.value;
      answer.correctVariable = variable;
    }
    byIndex.set(index, answer);
  }

  return Array.from(byIndex.values())
    .filter((answer) => Object.prototype.hasOwnProperty.call(answer, "id") &&
      Object.prototype.hasOwnProperty.call(answer, "text") &&
      Object.prototype.hasOwnProperty.call(answer, "correct"));
}

async function answerState(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll("button"))
    .filter((button) => String(button.className || "").includes("w-full") && button.textContent.trim())
    .map((button) => ({
      className: String(button.className || ""),
      disabled: Boolean(button.disabled),
      green: String(button.className || "").includes("#4fc08d"),
      red: String(button.className || "").includes("#e14440"),
      text: button.textContent.trim()
    })));
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
  await page.getByRole("button", { name: /let/i }).click().catch(() => {});
  await page.waitForTimeout(900);

  const initialPayload = await page.evaluate(() =>
    window.__JAVASCREEN__ && window.__JAVASCREEN__.setVariableWatch(true, { forceScan: true }));
  const initialVariables = initialPayload && initialPayload.variables || [];
  const initialAnswers = answerObjectsFromVariables(initialVariables);
  const initialVariableByPath = variableMap(initialVariables);
  const questionAnswerTextVariable = findVariable(initialVariables, /^vue\.app\..*Question\[\d+\]\.localQuestion\.answers\[\d+\]\.text$/);
  const correctAnswer = initialAnswers.find((answer) => answer.correct === true);
  const wrongAnswer = initialAnswers.find((answer) => answer.correct === false);

  assert(initialVariables.length > 0, "Expected Variables scan to return framework/page state.");
  assert(questionAnswerTextVariable, `Expected Variables scan to include vue.app Question localQuestion answer text, got ${initialVariables.slice(0, 30).map((variable) => variable.path).join(", ")}`);
  assert(correctAnswer && wrongAnswer, `Expected Variables scan to include current answer objects with correct flags, got ${JSON.stringify(initialAnswers)}`);
  assert(initialVariableByPath.has(correctAnswer.idVariable.path), "Expected correct answer id variable to be indexed by path.");

  assert(await clickAnswerText(page, wrongAnswer.text), `Could not click wrong answer "${wrongAnswer.text}".`);
  await page.waitForTimeout(900);

  const wrongPayload = await page.evaluate(() =>
    window.__JAVASCREEN__ && window.__JAVASCREEN__.setVariableWatch(true, { forceScan: true }));
  const wrongVariables = wrongPayload && wrongPayload.variables || [];
  const answeredVariable = findVariable(wrongVariables, /^vue\.app\..*Question\[\d+\]\.localQuestion\.answered$/);
  const wrongState = await answerState(page);

  assert(answeredVariable && answeredVariable.canEdit, `Expected editable localQuestion.answered after answering, got ${JSON.stringify(answeredVariable)}`);
  assert(answeredVariable.value === wrongAnswer.id, `Expected localQuestion.answered to equal wrong answer id ${wrongAnswer.id}, got ${JSON.stringify(answeredVariable)}`);
  assert(wrongState.some((answer) => answer.text === wrongAnswer.text && answer.red), `Expected wrong answer to be red before variable edit, got ${JSON.stringify(wrongState)}`);

  await page.evaluate(({ id, value }) => window.__JAVASCREEN__.setVariable(id, value), {
    id: answeredVariable.id,
    value: correctAnswer.id
  });
  await page.waitForTimeout(900);

  const editedPayload = await page.evaluate(() =>
    window.__JAVASCREEN__ && window.__JAVASCREEN__.setVariableWatch(true, { forceScan: true }));
  const editedVariables = editedPayload && editedPayload.variables || [];
  const editedAnsweredVariable = findVariable(editedVariables, /^vue\.app\..*Question\[\d+\]\.localQuestion\.answered$/);
  const editedState = await answerState(page);

  assert(editedAnsweredVariable && editedAnsweredVariable.value === correctAnswer.id, `Expected edited localQuestion.answered to equal correct id ${correctAnswer.id}, got ${JSON.stringify(editedAnsweredVariable)}`);
  assert(editedState.some((answer) => answer.text === correctAnswer.text && answer.green), `Expected correct answer to be green after variable edit, got ${JSON.stringify(editedState)}`);
  assert(!editedState.some((answer) => answer.text === wrongAnswer.text && answer.red), `Expected wrong red state to clear after editing localQuestion.answered, got ${JSON.stringify(editedState)}`);

  console.log("PASS javascriptquiz.com Variables tab scan exposes and edits Vue localQuestion state.");
} finally {
  if (browser) {
    await browser.close();
  }
}
