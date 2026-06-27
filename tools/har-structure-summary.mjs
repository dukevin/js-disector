import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const SECRET_HEADER_RE = /^(authorization|cookie|set-cookie|x-csrf|x-xsrf|x-auth|proxy-authorization)$/i;
const STATIC_EXT_RE = /\.(?:avif|bmp|css|gif|ico|jpe?g|map|mp3|mp4|ogg|otf|png|svg|ttf|wasm|webm|webp|woff2?)$/i;
const SCRIPT_FRAMEWORK_HINTS = [
  ["angular", /angular/i],
  ["backbone", /backbone/i],
  ["createjs", /createjs|easeljs|tweenjs|preloadjs/i],
  ["jquery", /jquery/i],
  ["react", /react|react-dom/i],
  ["requirejs", /require(?:\.min)?\.js|requirejs/i],
  ["saba/spf", /saba|spf/i],
  ["scorm", /scorm/i],
  ["vue", /vue/i],
  ["webpack", /webpack|chunk|bundle/i],
  ["wicket", /wicket/i]
];

function usage() {
  return [
    "Usage: node tools/har-structure-summary.mjs <path-to.har> [output.json]",
    "",
    "Creates a redacted structure report for JS Disector debugging.",
    "It does not emit cookies, auth headers, request bodies, response bodies, or query values."
  ].join("\n");
}

function addCount(map, key, amount = 1) {
  const normalized = String(key || "unknown");
  map.set(normalized, (map.get(normalized) || 0) + amount);
}

function topCounts(map, limit = 20) {
  return Array.from(map.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

function redactSegment(segment) {
  const decoded = decodeURIComponent(String(segment || ""));
  if (!decoded) {
    return "";
  }
  if (/^[0-9]+$/.test(decoded) && decoded.length >= 4) {
    return "{num}";
  }
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(decoded)) {
    return "{uuid}";
  }
  if (decoded.length >= 32 || /={1,2}$/.test(decoded) || /[+/]/.test(decoded)) {
    return "{id}";
  }
  if (decoded.length >= 12 && /\d/.test(decoded) && /^[a-z0-9._-]+$/i.test(decoded)) {
    return "{id}";
  }
  return encodeURIComponent(decoded).replace(/%2F/gi, "%2F");
}

function redactUrl(rawUrl) {
  const text = String(rawUrl || "");
  if (!text) {
    return "";
  }

  try {
    const parsed = new URL(text);
    const segments = parsed.pathname.split("/").map(redactSegment);
    parsed.pathname = segments.join("/");
    const keys = Array.from(parsed.searchParams.keys());
    parsed.search = "";
    for (const key of keys.slice(0, 40)) {
      parsed.searchParams.append(key, "...");
    }
    if (keys.length > 40) {
      parsed.searchParams.append("more_query_keys", String(keys.length - 40));
    }
    parsed.hash = parsed.hash ? "#..." : "";
    return parsed.href;
  } catch (error) {
    return text.replace(/[?#].*$/, (suffix) => suffix.charAt(0) === "?" ? "?..." : "#...");
  }
}

function hostOf(rawUrl) {
  try {
    return new URL(String(rawUrl || "")).host || "unknown";
  } catch (error) {
    return "unknown";
  }
}

function pathOf(rawUrl) {
  try {
    return new URL(String(rawUrl || "")).pathname || "/";
  } catch (error) {
    return "/";
  }
}

function filenameOf(rawUrl) {
  const pathname = pathOf(rawUrl);
  const last = pathname.split("/").filter(Boolean).pop();
  return last || "/";
}

function mimeOf(entry) {
  return String(entry?.response?.content?.mimeType || entry?.response?.headers?.find((header) => /^content-type$/i.test(header.name || ""))?.value || "").split(";")[0].trim().toLowerCase() || "unknown";
}

function resourceTypeOf(entry) {
  const explicit = entry?._resourceType || entry?._type || entry?.resourceType;
  if (explicit) {
    return String(explicit).toLowerCase();
  }

  const mime = mimeOf(entry);
  const url = String(entry?.request?.url || "");
  if (/javascript|ecmascript/.test(mime) || /\.m?js(?:[?#]|$)/i.test(url)) {
    return "script";
  }
  if (/html/.test(mime)) {
    return "document";
  }
  if (/json/.test(mime)) {
    return "xhr";
  }
  if (/css/.test(mime)) {
    return "stylesheet";
  }
  if (/image\//.test(mime)) {
    return "image";
  }
  return "other";
}

function hasSecretHeaders(headers = []) {
  return headers.some((header) => SECRET_HEADER_RE.test(String(header?.name || "")));
}

function safeHeaders(headers = []) {
  return headers
    .filter((header) => header && header.name && !SECRET_HEADER_RE.test(String(header.name)))
    .filter((header) => /^(accept|content-type|origin|referer|x-requested-with)$/i.test(String(header.name)))
    .map((header) => ({
      name: String(header.name).toLowerCase(),
      value: String(header.value || "").slice(0, 160)
    }));
}

function isProbablyApi(entry) {
  const type = resourceTypeOf(entry);
  const method = String(entry?.request?.method || "GET").toUpperCase();
  const mime = mimeOf(entry);
  const url = String(entry?.request?.url || "");
  if (type === "xhr" || type === "fetch") {
    return true;
  }
  if (method !== "GET" && method !== "HEAD") {
    return true;
  }
  if (/json|xml|x-www-form-urlencoded|multipart/.test(mime)) {
    return true;
  }
  if (/\/(?:api|ajax|service|services|rest|graphql|event|content-player)\b/i.test(url)) {
    return !STATIC_EXT_RE.test(url);
  }
  return false;
}

function statusBucket(status) {
  const value = Number(status || 0);
  if (!value) {
    return "0/blocked";
  }
  if (value < 200) {
    return "1xx";
  }
  if (value < 300) {
    return "2xx";
  }
  if (value < 400) {
    return "3xx";
  }
  if (value < 500) {
    return "4xx";
  }
  return "5xx";
}

function frameworkHintsFromUrl(url) {
  const text = `${url} ${filenameOf(url)}`;
  return SCRIPT_FRAMEWORK_HINTS
    .filter(([, pattern]) => pattern.test(text))
    .map(([name]) => name);
}

function entryBytes(entry) {
  const bodySize = Number(entry?.response?.bodySize || 0);
  const contentSize = Number(entry?.response?.content?.size || 0);
  return Math.max(0, bodySize, contentSize);
}

function summarizeHar(har) {
  const entries = Array.isArray(har?.log?.entries) ? har.log.entries : [];
  const pages = Array.isArray(har?.log?.pages) ? har.log.pages : [];
  const hosts = new Map();
  const methods = new Map();
  const mimeTypes = new Map();
  const resourceTypes = new Map();
  const statusBuckets = new Map();
  const frameworks = new Map();
  const secretHeaderCounts = {
    requestHeaders: 0,
    responseHeaders: 0
  };
  const bodyPresence = {
    requestPostDataEntries: 0,
    responseTextEntries: 0
  };
  const scripts = [];
  const documents = [];
  const endpoints = [];
  const suspiciousBlocked = [];

  for (const entry of entries) {
    const request = entry.request || {};
    const response = entry.response || {};
    const url = String(request.url || "");
    const method = String(request.method || "GET").toUpperCase();
    const mime = mimeOf(entry);
    const type = resourceTypeOf(entry);
    const status = Number(response.status || 0);
    const host = hostOf(url);

    addCount(hosts, host);
    addCount(methods, method);
    addCount(mimeTypes, mime);
    addCount(resourceTypes, type);
    addCount(statusBuckets, statusBucket(status));

    if (hasSecretHeaders(request.headers || [])) {
      secretHeaderCounts.requestHeaders += 1;
    }
    if (hasSecretHeaders(response.headers || [])) {
      secretHeaderCounts.responseHeaders += 1;
    }
    if (request.postData) {
      bodyPresence.requestPostDataEntries += 1;
    }
    if (typeof response?.content?.text === "string" && response.content.text.length > 0) {
      bodyPresence.responseTextEntries += 1;
    }

    if (type === "script" || /javascript|ecmascript/.test(mime)) {
      const hints = frameworkHintsFromUrl(url);
      for (const hint of hints) {
        addCount(frameworks, hint);
      }
      scripts.push({
        bytes: entryBytes(entry),
        filename: filenameOf(url),
        frameworkHints: hints,
        host,
        mime,
        status,
        url: redactUrl(url)
      });
    }

    if (type === "document" || /html/.test(mime)) {
      documents.push({
        bytes: entryBytes(entry),
        host,
        mime,
        status,
        url: redactUrl(url)
      });
    }

    if (isProbablyApi(entry)) {
      endpoints.push({
        bytes: entryBytes(entry),
        host,
        method,
        mime,
        requestHeaders: safeHeaders(request.headers || []),
        responseHeaders: safeHeaders(response.headers || []),
        status,
        timeMs: Number(entry.time || 0),
        type,
        url: redactUrl(url)
      });
    }

    if (status === 0 || /blocked|cors|failed|aborted/i.test(String(entry?._error || entry?.comment || ""))) {
      suspiciousBlocked.push({
        error: String(entry?._error || entry?.comment || "").slice(0, 180),
        host,
        method,
        status,
        type,
        url: redactUrl(url)
      });
    }
  }

  scripts.sort((left, right) => right.bytes - left.bytes || left.url.localeCompare(right.url));
  documents.sort((left, right) => right.bytes - left.bytes || left.url.localeCompare(right.url));
  endpoints.sort((left, right) => right.bytes - left.bytes || left.url.localeCompare(right.url));

  const hints = [];
  if (documents.length > 1) {
    hints.push("Multiple HTML documents/frames were loaded. Use Reload + Capture so JS Disector can inject into frames as early as Firefox allows.");
  }
  if (frameworks.size > 0) {
    hints.push(`Framework/script clues from URLs: ${topCounts(frameworks, 8).map((item) => item.name).join(", ")}.`);
  }
  if (endpoints.length > 0) {
    hints.push("XHR/fetch-like endpoints were present. JS Disector's request/response icons and pause controls should be useful for debugging data flow.");
  }
  if (suspiciousBlocked.length > 0) {
    hints.push("Some requests were blocked or status 0. Browser security/CORS/frame isolation may explain missing capture or missing responses.");
  }

  return {
    generatedAt: new Date().toISOString(),
    privacy: {
      omitted: [
        "Cookie and Set-Cookie values",
        "Authorization-like headers",
        "request bodies",
        "response bodies",
        "query parameter values",
        "hash fragments"
      ],
      secretHeaderCounts,
      bodyPresence
    },
    summary: {
      entries: entries.length,
      pages: pages.length,
      totalResponseBytes: entries.reduce((total, entry) => total + entryBytes(entry), 0)
    },
    topHosts: topCounts(hosts, 30),
    methods: topCounts(methods, 12),
    mimeTypes: topCounts(mimeTypes, 30),
    resourceTypes: topCounts(resourceTypes, 20),
    statusBuckets: topCounts(statusBuckets, 12),
    frameworkHints: topCounts(frameworks, 20),
    documents: documents.slice(0, 60),
    scripts: scripts.slice(0, 120),
    endpoints: endpoints.slice(0, 120),
    blockedOrFailed: suspiciousBlocked.slice(0, 60),
    jsDisectorHints: hints
  };
}

function printConsoleSummary(report, outputPath) {
  const lines = [];
  lines.push(`HAR entries: ${report.summary.entries}`);
  lines.push(`Pages/documents: ${report.summary.pages}/${report.documents.length}`);
  lines.push(`Scripts reported: ${report.scripts.length}`);
  lines.push(`XHR/fetch-like endpoints reported: ${report.endpoints.length}`);
  lines.push(`Blocked/failed requests reported: ${report.blockedOrFailed.length}`);
  if (report.frameworkHints.length) {
    lines.push(`Framework clues: ${report.frameworkHints.map((item) => `${item.name} (${item.count})`).join(", ")}`);
  }
  for (const hint of report.jsDisectorHints) {
    lines.push(`Hint: ${hint}`);
  }
  lines.push(`Wrote redacted report: ${outputPath}`);
  console.log(lines.join("\n"));
}

const inputPath = process.argv[2];
if (!inputPath || inputPath === "-h" || inputPath === "--help") {
  console.error(usage());
  process.exit(inputPath ? 0 : 1);
}

const resolvedInput = path.resolve(inputPath);
const outputPath = path.resolve(process.argv[3] || path.join("har-reports", `${path.basename(resolvedInput, path.extname(resolvedInput))}.structure.json`));
const raw = await readFile(resolvedInput, "utf8");
const har = JSON.parse(raw);
const report = summarizeHar(har);
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
printConsoleSummary(report, outputPath);
