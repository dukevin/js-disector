import { createRequire } from "node:module";
import { existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const monitorPath = path.join(rootDir, "devtools", "injected-monitor.js");
const panelPath = path.join(rootDir, "devtools", "panel.js");
const gameUrl = "https://play.famobi.com/wrapper/solitaire-klondike/A1000-10";

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

function extractFrameBridge(panelSource) {
  const start = panelSource.indexOf("function javascreenFrameBridge");
  const end = panelSource.indexOf("\nfunction bridgeExpression", start);
  if (start < 0 || end <= start) {
    throw new Error("Could not extract javascreenFrameBridge from panel.js.");
  }

  return panelSource.slice(start, end).trim();
}

async function callBridge(page, bridgeSource, action, args = []) {
  return page.evaluate(({ bridgeSource: source, action: bridgeAction, args: bridgeArgs }) => {
    const bridge = (0, eval)(`(${source})`);
    return bridge(bridgeAction, bridgeArgs || []);
  }, { bridgeSource, action, args });
}

async function visibleTargets(frame) {
  try {
    return await frame.locator("canvas, button, [role=button]").evaluateAll((nodes) => nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        className: String(node.className || ""),
        height: rect.height,
        id: node.id || "",
        tag: node.tagName,
        text: String(node.textContent || "").trim().slice(0, 50),
        width: rect.width,
        x: rect.x,
        y: rect.y
      };
    }));
  } catch (error) {
    return [];
  }
}

function interestingCalls(calls) {
  return calls
    .filter((call) => !call.suppressed)
    .map((call) => `${call.time} ${call.name} path=${call.path} frame=${call.framePath} parent=${call.parentCallId || ""}`)
    .join("\n");
}

function findGameFrame(page) {
  return page.frames().find((frame) => /games\.cdn\.famobi\.com\/html5games/.test(frame.url()) && !frame.isDetached()) || page.mainFrame();
}

const nodeModules = findNodeModules();
const require = createRequire(path.join(nodeModules, "playwright", "package.json"));
const { chromium, firefox } = require("playwright");
const monitorSource = `${await readFile(monitorPath, "utf8")}\n//# sourceURL=javascreen-injected-monitor.js`;
const bridgeSource = extractFrameBridge(await readFile(panelPath, "utf8"));
const executablePath = findBrowserExecutable();
const browserName = process.env.JAVASCREEN_LIVE_BROWSER || "firefox";
const browserType = browserName === "firefox" ? firefox : chromium;
const shouldTestLiveReplay = process.env.JAVASCREEN_TEST_LIVE_REPLAY === "1";
const browser = await browserType.launch({
  executablePath: browserName === "chromium" ? executablePath || undefined : undefined,
  headless: true
});

function mergePayloads(payloads) {
  const calls = [];
  let snapshot = null;

  for (const payload of payloads) {
    if (!payload) {
      continue;
    }

    calls.push(...(payload.calls || []));
    if (payload.snapshot) {
      snapshot = payload.snapshot;
    }
  }

  return {
    calls,
    snapshot
  };
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function variableLeaf(pathText) {
  const parts = String(pathText || "").split(/[.[\]]+/).filter(Boolean);
  return parts[parts.length - 1] || "";
}

function findEditableNumberVariable(variables, leafName, preferredPattern = null) {
  const candidates = variables
    .filter((variable) => variable &&
      variable.canEdit &&
      variable.kind === "number" &&
      variableLeaf(variable.path) === leafName)
    .sort((first, second) => {
      const firstPreferred = preferredPattern && preferredPattern.test(String(first.path || "")) ? 1 : 0;
      const secondPreferred = preferredPattern && preferredPattern.test(String(second.path || "")) ? 1 : 0;
      if (firstPreferred !== secondPreferred) {
        return secondPreferred - firstPreferred;
      }

      const firstLength = String(first.path || "").length;
      const secondLength = String(second.path || "").length;
      return firstLength - secondLength;
    });

  return candidates[0] || null;
}

function bufferDiffRatio(first, second) {
  const length = Math.min(first.length, second.length);
  if (!length) {
    return 0;
  }

  let changed = 0;
  for (let index = 0; index < length; index += 1) {
    if (first[index] !== second[index]) {
      changed += 1;
    }
  }

  return changed / length;
}

function stockAreaClip(canvasBox) {
  return {
    height: Math.round(canvasBox.height * 0.25),
    width: Math.round(canvasBox.width * 0.9),
    x: Math.max(0, Math.round(canvasBox.x + canvasBox.width * 0.05)),
    y: Math.max(0, Math.round(canvasBox.y + canvasBox.height * 0.12))
  };
}

async function canvasPageBox(frame) {
  const fallback = await frame.locator("canvas").first().boundingBox().catch(() => null);
  const metrics = await frame.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (!canvas) {
      return null;
    }

    const box = canvas.getBoundingClientRect();
    return {
      canvasScale: window.game && Number.isFinite(window.game.canvasScale) ? window.game.canvasScale : 1,
      height: box.height,
      innerHeight,
      innerWidth,
      width: box.width,
      x: box.x,
      y: box.y
    };
  }).catch(() => null);

  if (!metrics) {
    return fallback;
  }

  const frameElement = await frame.frameElement().catch(() => null);
  const frameBox = frameElement ? await frameElement.boundingBox().catch(() => null) : null;
  const frameWidth = frameBox ? frameBox.width : metrics.innerWidth;
  const frameHeight = frameBox ? frameBox.height : metrics.innerHeight;
  const frameScale = frameBox && metrics.width > frameBox.width + 2
    ? frameBox.width / metrics.width
    : 1;
  const visibleScale = metrics.canvasScale > 0 && metrics.canvasScale < 0.99
    ? metrics.canvasScale
    : frameScale;
  const shouldUseScaledCanvas = visibleScale > 0 &&
    visibleScale < 0.99 &&
    (metrics.width > frameWidth + 2 || metrics.height > frameHeight + 2);
  const rect = shouldUseScaledCanvas
    ? {
        height: metrics.height * visibleScale,
        width: metrics.width * visibleScale,
        x: (frameWidth - metrics.width * visibleScale) / 2,
        y: (frameHeight - metrics.height * visibleScale) / 2
      }
    : metrics;
  return {
    height: rect.height,
    width: rect.width,
    x: (frameBox ? frameBox.x : 0) + rect.x,
    y: (frameBox ? frameBox.y : 0) + rect.y
  };
}

async function clickCanvasRatio(page, canvasBox, xRatio, yRatio) {
  const x = canvasBox.x + canvasBox.width * xRatio;
  const y = canvasBox.y + canvasBox.height * yRatio;
  return clickPagePoint(page, { x, y });
}

async function clickPagePoint(page, point) {
  const x = point.x;
  const y = point.y;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(80);
  await page.mouse.up();
  return {
    x,
    y
  };
}

async function framePageOffset(frame) {
  const frameElement = await frame.frameElement().catch(() => null);
  const frameBox = frameElement ? await frameElement.boundingBox().catch(() => null) : null;
  return {
    x: frameBox ? frameBox.x : 0,
    y: frameBox ? frameBox.y : 0
  };
}

async function solitaireStockClickCandidates(frame, canvasBox) {
  const offset = await framePageOffset(frame);
  const gamePoints = await frame.evaluate(() => {
    const level = window.game && window.game.menuManager && window.game.menuManager.cardFaceMenu && window.game.menuManager.cardFaceMenu.level;
    const deckSprite = level && level.deck && level.deck.sprite;
    const points = [];

    try {
      const matrix = deckSprite && deckSprite.getConcatenatedMatrix && deckSprite.getConcatenatedMatrix();
      if (matrix && Number.isFinite(matrix.tx) && Number.isFinite(matrix.ty)) {
        points.push({ x: matrix.tx, y: matrix.ty });
        points.push({ x: matrix.tx - 80, y: matrix.ty });
      }
    } catch (error) {
      // Fall through to ratio-based candidates.
    }

    return points;
  }).catch(() => []);

  const candidates = [];
  for (const point of gamePoints) {
    candidates.push({
      x: offset.x + point.x,
      y: offset.y + point.y
    });
  }

  for (const [xRatio, yRatio] of [[0.86, 0.22], [0.72, 0.14], [0.78, 0.18], [0.82, 0.18]]) {
    candidates.push({
      x: canvasBox.x + canvasBox.width * xRatio,
      y: canvasBox.y + canvasBox.height * yRatio
    });
  }

  return candidates.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
}

function callClientPoint(call) {
  const descriptor = call && call.forceReplayArgs && call.forceReplayArgs[0];
  const init = descriptor && descriptor.init || {};
  const x = Number(init.clientX);
  const y = Number(init.clientY);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return {
    x,
    y
  };
}

function distanceToPoint(call, point) {
  const clientPoint = callClientPoint(call);
  if (!clientPoint || !point) {
    return Infinity;
  }

  const dx = clientPoint.x - point.x;
  const dy = clientPoint.y - point.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function chooseStockReplayEvent(calls, stockPoint) {
  const candidates = calls
    .map((call, index) => ({
      call,
      distance: distanceToPoint(call, stockPoint),
      index
    }))
    .filter((item) => /canvas.*(?:mousedown|pointerdown|click) event/i.test(String(item.call.name || "")))
    .filter((item) => item.call.forceReplayable && item.call.forceReplayArgs && item.call.forceReplayArgs[0] && item.call.forceReplayArgs[0].type === "dom-event")
    .filter((item) => !stockPoint || item.distance <= 260);

  for (const pattern of [/mousedown/i, /pointerdown/i, /click/i]) {
    const matched = candidates
      .slice()
      .reverse()
      .find((item) => pattern.test(String(item.call.name || "")));
    if (matched) {
      return matched.call;
    }
  }

  const fallback = candidates[candidates.length - 1];
  return fallback && fallback.call || null;
}

function chooseReplayableInstanceMethod(calls) {
  const candidates = calls
    .slice()
    .reverse()
    .filter((call) => call && call.forceReplayable && call.forceReplayThis && Array.isArray(call.forceReplayArgs))
    .filter((call) => /#prototype\./.test(String(call.path || "")));

  return candidates.find((call) =>
    /(?:^|\.|#prototype\.)_?handle(?:Mouse|Pointer)(?:Down|Up)/i.test(String(call.path || call.name || "")) &&
    call.forceReplayArgs.some((arg) => arg && arg.type === "dom-event")) ||
    candidates[0] ||
    null;
}

function startPanelPolling(page, pollBridgeSource, pollMonitorSource, intervalMs = 250) {
  const payloads = [];
  const errors = [];
  let stopped = false;

  const done = (async () => {
    while (!stopped) {
      try {
        payloads.push(await callBridge(page, pollBridgeSource, "drain", [pollMonitorSource]));
      } catch (error) {
        errors.push(String(error && error.message ? error.message : error));
      }

      await sleep(intervalMs);
    }
  })();

  return {
    async stop() {
      stopped = true;
      await done;
      try {
        payloads.push(await callBridge(page, pollBridgeSource, "drain", [pollMonitorSource]));
      } catch (error) {
        errors.push(String(error && error.message ? error.message : error));
      }

      return {
        errors,
        payload: mergePayloads(payloads),
        pollCount: payloads.length
      };
    }
  };
}

async function gameState(frame) {
  return frame.evaluate(() => {
    function rectFor(selector) {
      const element = document.querySelector(selector);
      if (!element) {
        return null;
      }

      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        className: String(element.className || ""),
        display: style.display,
        height: rect.height,
        opacity: style.opacity,
        pointerEvents: style.pointerEvents,
        visibility: style.visibility,
        width: rect.width,
        x: rect.x,
        y: rect.y
      };
    }

    const centerElement = document.elementFromPoint(innerWidth / 2, innerHeight / 2);

    return {
      canvas: rectFor("canvas"),
      centerElement: centerElement
        ? {
          className: String(centerElement.className || ""),
          id: centerElement.id || "",
          tag: centerElement.tagName
        }
        : null,
      loading: rectFor("[class*=load], .fg-loading-screen"),
      playButton: rectFor(".btn-play"),
      stage: rectFor(".fg-click2play-stage")
    };
  });
}

async function solitaireMovesState(page) {
  const frame = findGameFrame(page);
  return frame.evaluate(() => {
    const level = window.game && window.game.menuManager && window.game.menuManager.cardFaceMenu && window.game.menuManager.cardFaceMenu.level;
    return {
      moves: level && level.moves,
      text: level && level.hud && level.hud.movesText && level.hud.movesText.text
    };
  });
}

async function solitaireScoreState(page) {
  const frame = findGameFrame(page);
  return frame.evaluate(() => {
    const level = window.game && window.game.menuManager && window.game.menuManager.cardFaceMenu && window.game.menuManager.cardFaceMenu.level;
    return {
      famobiScore: level && level.famobiScore && level.famobiScore.score,
      lastNonWinScore: level && level.lastNonWinScore,
      score: level && level.score,
      text: level && level.hud && level.hud.scoreText && level.hud.scoreText.text,
      usualScore: level && level.usualScore
    };
  });
}

async function clickPlayButton(page, frame) {
  const playButton = await frame.locator(".btn-play").first().boundingBox().catch(() => null);
  assert(playButton, "Expected the live Famobi play button to be visible before clicking.");
  await page.mouse.click(playButton.x + playButton.width / 2, playButton.y + playButton.height / 2);
}

async function waitForGameCanvas(frame) {
  await frame.waitForFunction(() => !document.querySelector(".btn-play") && !document.querySelector(".fg-click2play-stage"), null, {
    timeout: 15000
  });

  await frame.waitForFunction(() => {
    const loading = document.querySelector("[class*=load], .fg-loading-screen");
    if (!loading) {
      return true;
    }

    const style = getComputedStyle(loading);
    return style.display === "none" || style.visibility === "hidden" || style.opacity === "0";
  }, null, {
    timeout: 20000
  });
}

try {
  const context = await browser.newContext({
    viewport: {
      height: 900,
      width: 1365
    }
  });
  await context.addInitScript({
    content: `${monitorSource}
try {
  window.__JAVASCREEN__.setOptions({
    captureMinifiedFunctions: false,
    safeMode: true,
    wrapDomEventListeners: false
  });
} catch (error) {
}`
  });

  const page = await context.newPage();
  await page.goto(gameUrl, {
    timeout: 60000,
    waitUntil: "domcontentloaded"
  });
  await page.waitForTimeout(18000);

  console.log("Frames:");
  for (const frame of page.frames()) {
    console.log(`- ${frame.url()}`);
  }

  for (const frame of page.frames()) {
    const targets = await visibleTargets(frame);
    if (targets.length) {
      console.log(`Targets in ${frame.url()}:`);
      console.log(JSON.stringify(targets, null, 2));
    }
  }

  for (const frame of page.frames()) {
    const acceptButton = frame.locator("#onetrust-accept-btn-handler").first();
    if (await acceptButton.isVisible().catch(() => false)) {
      await acceptButton.click();
      await page.waitForTimeout(1200);
      break;
    }
  }

  await callBridge(page, bridgeSource, "drain", [monitorSource]);

  let gameFrame = findGameFrame(page);
  const beforePlay = await gameState(gameFrame);
  console.log("Before play:", JSON.stringify(beforePlay, null, 2));
  assert(beforePlay.playButton, "Expected the Famobi click-to-play button before testing capture.");

  const poller = startPanelPolling(page, bridgeSource, monitorSource);
  await clickPlayButton(page, gameFrame);
  await waitForGameCanvas(gameFrame);

  const afterPlay = await gameState(gameFrame);
  console.log("After play:", JSON.stringify(afterPlay, null, 2));
  assert(!afterPlay.playButton, "Expected the Famobi play button to disappear after click.");
  assert(!afterPlay.stage, "Expected the Famobi click-to-play stage to disappear after click.");
  assert(afterPlay.centerElement && afterPlay.centerElement.tag === "CANVAS", `Expected the live game canvas to receive pointer input after loading, got ${JSON.stringify(afterPlay.centerElement)}.`);

  let canvasBox = await canvasPageBox(gameFrame);
  console.log("Canvas:", JSON.stringify(canvasBox));
  assert(canvasBox, "Expected a canvas after the Famobi game loads.");

  await clickCanvasRatio(page, canvasBox, 0.50, 0.63);
  await page.waitForTimeout(4000);
  gameFrame = findGameFrame(page);
  canvasBox = await canvasPageBox(gameFrame);
  assert(canvasBox, "Expected a canvas after starting the Solitaire board.");

  const naturalMovesBefore = await solitaireMovesState(page);
  let stockPoint = null;
  let naturalMovesAfter = naturalMovesBefore;
  let replayPayload = { calls: [] };
  let replayCalls = [];
  let stockPayload = { calls: [] };
  let stockRealDiff = 0;
  let stockReplayDiff = 0;
  let stockReplayEvent = null;
  let stockMethodReplayCall = null;

  if (shouldTestLiveReplay) {
    const stockClip = stockAreaClip(canvasBox);
    const stockBefore = await page.screenshot({ clip: stockClip });
    let stockAfterRealClick = stockBefore;
    const stockCandidates = await solitaireStockClickCandidates(gameFrame, canvasBox);
    const stockAttempts = [];
    for (let attempt = 0; attempt < Math.max(4, stockCandidates.length); attempt += 1) {
      stockPoint = await clickPagePoint(page, stockCandidates[attempt % stockCandidates.length]);
      await page.waitForTimeout(900);
      gameFrame = findGameFrame(page);
      naturalMovesAfter = await solitaireMovesState(page);
      stockAttempts.push({ attempt, point: stockPoint, state: naturalMovesAfter });
      stockAfterRealClick = await page.screenshot({ clip: stockClip });
      if (Number(naturalMovesAfter.moves) > Number(naturalMovesBefore.moves)) {
        break;
      }
    }
    const stockPollResult = await poller.stop();
    assert(!stockPollResult.errors.length, `Panel polling produced errors: ${stockPollResult.errors.join("; ")}`);
    console.log(`Panel polls before stock replay: ${stockPollResult.pollCount}`);

    stockPayload = stockPollResult.payload;
    const stockCalls = stockPayload.calls || [];
    stockReplayEvent = chooseStockReplayEvent(stockCalls, stockPoint);
    stockMethodReplayCall = chooseReplayableInstanceMethod(stockCalls);
    stockRealDiff = bufferDiffRatio(stockBefore, stockAfterRealClick);
    assert(stockRealDiff > 0.001, `Expected a real stock-pile click to visibly change the stock/waste area, got diff ratio ${stockRealDiff}.`);
    if (Number(naturalMovesAfter.moves) > Number(naturalMovesBefore.moves)) {
      assert(String(naturalMovesAfter.moves) === naturalMovesAfter.text, `Expected Solitaire HUD moves text to match internal moves after click, got ${JSON.stringify(naturalMovesAfter)}.`);
    } else {
      console.log(`Stock click changed the board but did not increment moves in this wrapper run: before=${JSON.stringify(naturalMovesBefore)} after=${JSON.stringify(naturalMovesAfter)} attempts=${JSON.stringify(stockAttempts)}`);
    }
    if (stockReplayEvent) {
      await callBridge(page, bridgeSource, "replay", [
        stockReplayEvent.functionId,
        stockReplayEvent.forceReplayArgs,
        { forceDescriptors: true }
      ]);
      await page.waitForTimeout(1200);
      const stockAfterForceReplay = await page.screenshot({ clip: stockClip });
      stockReplayDiff = bufferDiffRatio(stockAfterRealClick, stockAfterForceReplay);
      replayPayload = await callBridge(page, bridgeSource, "drain", [monitorSource]);
      replayCalls = replayPayload.calls || [];
      assert(stockReplayDiff > 0.001, `Expected Force Resend on ${stockReplayEvent.name} to visibly change the stock/waste area, got diff ratio ${stockReplayDiff}.`);
      assert(replayCalls.some((call) => /canvas.*(?:mousedown|click|pointerdown) event/i.test(String(call.name || ""))), `Expected Force Resend to log replayed canvas events, got: ${interestingCalls(replayCalls).slice(0, 2000)}`);
    } else {
      console.log(`Skipping stock Force Resend check: no replayable canvas stock event near ${JSON.stringify(stockPoint)}. Recent calls: ${stockCalls.slice(-80).map((call) => `${call.name} ${JSON.stringify(callClientPoint(call))}`).join(", ")}`);
    }

    if (stockMethodReplayCall) {
      await callBridge(page, bridgeSource, "replay", [
        stockMethodReplayCall.functionId,
        stockMethodReplayCall.forceReplayArgs,
        {
          forceDescriptors: true,
          forceThis: stockMethodReplayCall.forceReplayThis,
          forceThisDescriptor: true
        }
      ]);
      await page.waitForTimeout(450);
      const methodReplayPayload = await callBridge(page, bridgeSource, "drain", [monitorSource]);
      const methodReplayErrors = (methodReplayPayload.calls || []).filter((call) => call.threw || call.error);
      assert(!methodReplayErrors.length, `Expected Force Resend on ${stockMethodReplayCall.name} to preserve this/event state, got errors: ${methodReplayErrors.map((call) => `${call.name}: ${call.error}`).join("; ")}`);
      replayPayload = mergePayloads([replayPayload, methodReplayPayload]);
      replayCalls = replayPayload.calls || [];
    } else {
      console.log("Skipping instance-method Force Resend check: no replayable prototype method with captured this was present in the live call window.");
    }
  } else {
    const startupPollResult = await poller.stop();
    assert(!startupPollResult.errors.length, `Panel polling produced errors: ${startupPollResult.errors.join("; ")}`);
    stockPayload = startupPollResult.payload;
    console.log(`Panel polls before card clicks: ${startupPollResult.pollCount}`);
    console.log("Skipping stock replay/candidate-click checks by default; local fixtures cover replay without mutating the live game state.");
  }

  const cardPoints = [
    [0.25, 0.70],
    [0.42, 0.70],
    [0.58, 0.70],
    [0.75, 0.70]
  ];

  await callBridge(page, bridgeSource, "setVariableWatch", [true]);
  const cardPoller = startPanelPolling(page, bridgeSource, monitorSource);
  for (const [xRatio, yRatio] of cardPoints) {
    await clickCanvasRatio(page, canvasBox, xRatio, yRatio);
    await page.waitForTimeout(650);
  }

  const cardPollResult = await cardPoller.stop();
  assert(!cardPollResult.errors.length, `Panel polling produced errors: ${cardPollResult.errors.join("; ")}`);
  console.log(`Panel polls after stock replay: ${cardPollResult.pollCount}`);
  const variableScanPayload = await callBridge(page, bridgeSource, "setVariableWatch", [true, { forceScan: true }]);
  await page.waitForTimeout(250);
  const variableDrainPayload = await callBridge(page, bridgeSource, "drain", [monitorSource]);
  const variablePayload = mergePayloads([variableScanPayload, variableDrainPayload]);
  const variables = variablePayload.snapshot && variablePayload.snapshot.variables || [];
  const numericVariables = variables
    .filter((variable) => variable.kind === "number")
    .slice(0, 20);
  const gameTimeVariable = variables.find((variable) => variable.path === "game.gameTime") ||
    findEditableNumberVariable(variables, "gameTime", /^game\./);
  const scoreVariable = findEditableNumberVariable(variables, "score", /^game\./);
  const movesVariable = findEditableNumberVariable(variables, "moves", /^game\./);
  const turnLikeVariables = variables
    .filter((variable) => /(?:turn|stock|waste|move|score|time|card|deck|draw|count|step)/i.test(String(variable.path || "")))
    .slice(0, 20);
  const junkVariable = variables
    .find((variable) =>
      variable.value === undefined ||
      variable.kind === "undefined" ||
      String(variable.path || "") === "undefined" ||
      /^\d+(?:\.|\[|$)/.test(String(variable.path || "")));
  const junkVariables = variables
    .filter((variable) => /(?:google_|criteo|doubleclick|googlesyndication|recaptcha|adscale)/i.test(String(variable.path || "")))
    .slice(0, 5);

  assert(gameTimeVariable && gameTimeVariable.canEdit, `Expected Variables Rescan to find an editable gameTime-style counter, got: ${JSON.stringify(gameTimeVariable)}.`);
  assert(scoreVariable && scoreVariable.canEdit, `Expected Variables Rescan to find an editable score-style counter, got candidates: ${JSON.stringify(turnLikeVariables)}`);
  assert(movesVariable && movesVariable.canEdit, `Expected Variables Rescan to find an editable moves-style counter, got candidates: ${JSON.stringify(turnLikeVariables)}`);
  assert(!junkVariable, `Expected Variables Rescan to skip undefined/numeric frame-root junk, got: ${JSON.stringify(junkVariable)}.`);

  await callBridge(page, bridgeSource, "setVariable", [gameTimeVariable.id, 1234]);
  await page.waitForTimeout(250);
  const gameTimeEditPayload = await callBridge(page, bridgeSource, "drain", [monitorSource]);
  gameFrame = findGameFrame(page);
  const editedGameTime = await gameFrame.evaluate(() => window.game && window.game.gameTime);
  assert(editedGameTime > 1200 && editedGameTime < 1300, `Expected setVariable to edit Solitaire game.gameTime near 1234, got ${editedGameTime}.`);

  await callBridge(page, bridgeSource, "setVariable", [movesVariable.id, 5]);
  await page.waitForTimeout(400);
  const editedMovesUp = await solitaireMovesState(page);
  assert(editedMovesUp.moves === 5 && editedMovesUp.text === "5", `Expected setVariable to edit Solitaire moves to visible 5, got ${JSON.stringify(editedMovesUp)}.`);

  const movesSetZeroPayload = await callBridge(page, bridgeSource, "setVariable", [movesVariable.id, 0]);
  await page.waitForTimeout(400);
  const movesEditPayload = await callBridge(page, bridgeSource, "drain", [monitorSource]);
  const editedMovesDown = await solitaireMovesState(page);
  assert(editedMovesDown.moves === 0 && editedMovesDown.text === "0", `Expected setVariable to edit Solitaire moves back to visible 0, got ${JSON.stringify({
    editedMovesDown,
    movesVariable,
    setSnapshot: movesSetZeroPayload && movesSetZeroPayload.snapshot && (movesSetZeroPayload.snapshot.variables || []).find((variable) => variable.id === movesVariable.id)
  })}.`);

  await callBridge(page, bridgeSource, "setVariable", [scoreVariable.id, 123]);
  await page.waitForTimeout(850);
  const editedScoreUp = await solitaireScoreState(page);
  assert(editedScoreUp.score === 123 && editedScoreUp.famobiScore === 123, `Expected setVariable to edit Solitaire score internals to 123, got ${JSON.stringify(editedScoreUp)}.`);
  assert(editedScoreUp.text === "123", `Expected setVariable to keep Solitaire HUD score text at 123, got ${JSON.stringify(editedScoreUp)}.`);

  await callBridge(page, bridgeSource, "setVariable", [scoreVariable.id, 0]);
  await page.waitForTimeout(850);
  const scoreEditPayload = await callBridge(page, bridgeSource, "drain", [monitorSource]);
  const editedScoreDown = await solitaireScoreState(page);
  assert(editedScoreDown.score === 0 && editedScoreDown.famobiScore === 0, `Expected setVariable to edit Solitaire score internals back to 0, got ${JSON.stringify(editedScoreDown)}.`);
  assert(editedScoreDown.text === "0", `Expected setVariable to keep Solitaire HUD score text at 0, got ${JSON.stringify(editedScoreDown)}.`);

  const payload = mergePayloads([stockPayload, replayPayload, cardPollResult.payload, variableDrainPayload, gameTimeEditPayload, movesEditPayload, scoreEditPayload]);
  const calls = payload.calls || [];
  const renderedWindow = calls.slice(-600);
  const thrownCalls = calls.filter((call) => call.threw || call.error);
  if (thrownCalls.length) {
    throw new Error(`Famobi click produced thrown captured calls: ${thrownCalls.map((call) => {
      const source = call.source && call.source.url ? `${call.source.url}:${call.source.line || ""}:${call.source.column || ""}` : "unknown source";
      return `${call.name} path=${call.path} frame=${call.framePath} source=${source}: ${call.error}`;
    }).join(", ")}`);
  }

  const menuManagerFailure = calls.find((call) => String(call.error || "").includes("MenuManager.instance"));
  if (menuManagerFailure) {
    throw new Error(`Famobi click failed inside wrapped listener: ${menuManagerFailure.error}`);
  }

  const diagnostics = payload.snapshot && payload.snapshot.diagnostics || [];
  const gameDiagnostics = diagnostics.find((diagnostic) => String(diagnostic.frameUrl || "").includes("games.cdn.famobi.com")) || diagnostics[0];
  const observedEvent = calls.find((call) => String(call.note || "").includes("Observed DOM event"));
  const observedListener = calls.find((call) => String(call.note || "").includes("Observed listener"));
  const renderedCanvasEvent = renderedWindow.find((call) => /canvas.*(?:mousedown|click|pointerdown) event/i.test(String(call.name || "")));
  const unsuppressedGetAtlas = calls.find((call) => call.name === "getAtlas" && !call.suppressed);
  const wrappedInputListener = calls.find((call) =>
    /addEventListener\("(?:click|dblclick|mousedown|mouseup|pointerdown|pointerup|touchstart|touchend)"\)/.test(String(call.path || "")) &&
    call.returnValue !== "observed");

  assert(gameDiagnostics, "Expected JS Disector diagnostics in Famobi smoke payload.");
  assert(gameDiagnostics.domCaptureMode === "safe mode: observe DOM input listeners without wrapping so clicks remain native", `Unexpected DOM capture mode: ${gameDiagnostics.domCaptureMode}`);
  assert(!wrappedInputListener, wrappedInputListener
    ? `Expected input listeners to be observed-only, but ${wrappedInputListener.name} returned ${wrappedInputListener.returnValue}.`
    : "Expected input listeners to be observed-only.");
  assert(observedEvent, "Expected at least one observed DOM event row after Famobi clicks.");
  assert(observedListener, "Expected at least one observed listener row after Famobi clicks.");
  if (stockReplayEvent && shouldTestLiveReplay) {
    assert(renderedCanvasEvent, "Expected the panel-sized live call window to retain a canvas click/mousedown event.");
  }
  assert(!unsuppressedGetAtlas, "Expected getAtlas to be suppressed instead of flooding the panel.");
  assert(variablePayload.snapshot, "Expected explicit Variables Rescan to return a snapshot after Famobi card clicks.");
  assert(!junkVariables.length, `Expected Variables Rescan to filter obvious ad globals, got ${JSON.stringify(junkVariables)}.`);

  console.log(`Calls after clicks: ${calls.length}`);
  console.log(`Stock replay event: ${stockReplayEvent ? stockReplayEvent.name : "skipped"} moves ${naturalMovesBefore.moves} -> ${naturalMovesAfter.moves} diff real=${stockRealDiff.toFixed(4)} replay=${stockReplayDiff.toFixed(4)}`);
  console.log(`Method replay event: ${stockMethodReplayCall ? stockMethodReplayCall.name : "skipped"}`);
  console.log(`Edited Solitaire variable: ${gameTimeVariable.path} -> ${editedGameTime}`);
  console.log(`Edited Solitaire move counter: ${movesVariable.path} ${naturalMovesAfter.moves} -> 5 -> ${editedMovesDown.moves}, HUD=${editedMovesDown.text}`);
  console.log(`Edited Solitaire score counter: ${scoreVariable.path} -> 123 -> ${editedScoreDown.score}, HUD=${editedScoreDown.text}`);
  console.log(`Variable samples: ${numericVariables.map((variable) => `${variable.path}=${variable.displayValue}`).join("; ") || "none after ad filtering"}`);
  console.log(`Turn-like variable samples: ${turnLikeVariables.map((variable) => `${variable.path}=${variable.displayValue}`).join("; ") || "none"}`);
  console.log(interestingCalls(calls).slice(0, 12000));
  await context.close();
} finally {
  await browser.close();
}
