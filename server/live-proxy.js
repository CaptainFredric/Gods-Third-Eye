import http from "node:http";
import https from "node:https";

const PORT = Number.parseInt(process.env.LIVE_PROXY_PORT || "4180", 10);
const ALLOW_ORIGIN = process.env.LIVE_PROXY_ALLOW_ORIGIN || "*";
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.LIVE_PROXY_TIMEOUT_MS || "9000", 10);
const GDELT_CACHE_TTL_MS = Number.parseInt(process.env.LIVE_PROXY_GDELT_CACHE_MS || "300000", 10);
const GDELT_STALE_MS = Number.parseInt(process.env.LIVE_PROXY_GDELT_STALE_MS || "1800000", 10);
const GDELT_COOLDOWN_MS = Number.parseInt(process.env.LIVE_PROXY_GDELT_COOLDOWN_MS || "45000", 10);

const ADSB_URL = "https://opensky-network.org/api/states/all";
const ISS_URL = "https://api.wheretheiss.at/v1/satellites/25544";
const GDELT_URL = "https://api.gdeltproject.org/api/v2/doc/doc";
const gdeltCache = new Map();

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function writeJson(res, statusCode, payload) {
  setCorsHeaders(res);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, max-age=0"
  });
  res.end(JSON.stringify(payload));
}

function writeHtml(res, statusCode, html) {
  setCorsHeaders(res);
  res.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store, max-age=0"
  });
  res.end(html);
}

function createRelayHomePage(reqUrl) {
  const isLocalHost = ["127.0.0.1", "localhost"].includes(reqUrl.hostname);
  const localDashboardUrl = `http://${reqUrl.hostname}:5173/?relay=local`;
  const hostedDashboardUrl = `http://${reqUrl.host}/?relay=/api/live`;
  const dashboardUrl = isLocalHost ? localDashboardUrl : hostedDashboardUrl;
  const healthUrl = `http://${reqUrl.host}/health`;
  const apiIndexUrl = `http://${reqUrl.host}/api/live`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="refresh" content="2;url=${dashboardUrl}" />
  <title>God's Third Eye Relay</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #07111c;
      --bg2: #0d1b2a;
      --panel: rgba(10, 18, 31, 0.84);
      --line: rgba(126, 224, 255, 0.22);
      --text: #e8f2ff;
      --muted: #90a6ba;
      --accent: #7ee0ff;
      --accent2: #60f7bf;
      --warn: #ffe08a;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: "Rajdhani", "Segoe UI", sans-serif;
      color: var(--text);
      background:
        radial-gradient(circle at 20% 20%, rgba(126, 224, 255, 0.14), transparent 28%),
        radial-gradient(circle at 80% 15%, rgba(96, 247, 191, 0.14), transparent 24%),
        linear-gradient(160deg, var(--bg), var(--bg2));
      display: grid;
      place-items: center;
      padding: 24px;
    }
    main {
      width: min(920px, 100%);
      border: 1px solid var(--line);
      background: var(--panel);
      backdrop-filter: blur(16px);
      border-radius: 18px;
      padding: 28px;
      box-shadow: 0 18px 80px rgba(0, 0, 0, 0.35);
    }
    .kicker {
      color: var(--accent);
      text-transform: uppercase;
      letter-spacing: 0.2em;
      font-size: 12px;
      margin-bottom: 10px;
    }
    h1 {
      font-size: clamp(34px, 6vw, 56px);
      line-height: 0.95;
      margin: 0;
    }
    p {
      color: var(--muted);
      font-size: 18px;
      max-width: 56ch;
      margin: 14px 0 0;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin: 28px 0;
    }
    a {
      color: inherit;
      text-decoration: none;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 210px;
      padding: 14px 18px;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: rgba(7, 17, 28, 0.7);
      font-size: 17px;
      font-weight: 600;
    }
    .btn.primary {
      background: linear-gradient(135deg, rgba(126, 224, 255, 0.18), rgba(96, 247, 191, 0.14));
      border-color: rgba(126, 224, 255, 0.35);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 14px;
      margin-top: 18px;
    }
    .card {
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 14px;
      background: rgba(6, 12, 22, 0.56);
    }
    .label {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.16em;
      color: var(--warn);
      margin-bottom: 8px;
    }
    code {
      display: block;
      font-family: "Share Tech Mono", monospace;
      font-size: 13px;
      word-break: break-all;
      color: var(--accent2);
    }
  </style>
</head>
<body>
  <main>
    <div class="kicker">Panopticon Earth Relay Online</div>
    <h1>God's Third Eye<br />is running.</h1>
    <p>This is the live relay service for ADS-B, GDELT, and ISS telemetry. If this page is what you opened by accident, it will jump into the dashboard automatically.</p>
    <div class="actions">
      <a class="btn primary" href="${dashboardUrl}">Open Dashboard</a>
      <a class="btn" href="${healthUrl}">Relay Health</a>
      <a class="btn" href="${apiIndexUrl}">API Index</a>
    </div>
    <div class="grid">
      <div class="card">
        <div class="label">Dashboard URL</div>
        <code>${dashboardUrl}</code>
      </div>
      <div class="card">
        <div class="label">Health URL</div>
        <code>${healthUrl}</code>
      </div>
      <div class="card">
        <div class="label">Relay Base</div>
        <code>http://${reqUrl.host}/api/live</code>
      </div>
      <div class="card">
        <div class="label">Auto Redirect</div>
        <code>Jumping to dashboard in 2s</code>
      </div>
    </div>
  </main>
</body>
</html>`;
}

function writeGdeltJson(res, statusCode, payload, meta = {}) {
  writeJson(res, statusCode, {
    ...payload,
    relayMeta: {
      cacheTtlMs: GDELT_CACHE_TTL_MS,
      staleWindowMs: GDELT_STALE_MS,
      ...meta
    }
  });
}

function parseInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function getGdeltCacheKey(params) {
  return params.toString();
}

function getCachedGdeltEntry(key) {
  return gdeltCache.get(key) || null;
}

function shouldServeFresh(entry, now) {
  return !!entry?.payload && now - entry.cachedAt < GDELT_CACHE_TTL_MS;
}

function canServeStale(entry, now) {
  return !!entry?.payload && now - entry.cachedAt < GDELT_STALE_MS;
}

function isInCooldown(entry, now) {
  return !!entry?.lastErrorAt && now - entry.lastErrorAt < GDELT_COOLDOWN_MS;
}

function setGdeltCacheSuccess(key, payload) {
  const previous = gdeltCache.get(key) || {};
  gdeltCache.set(key, {
    ...previous,
    payload,
    cachedAt: Date.now(),
    lastErrorAt: 0,
    lastErrorMessage: "",
    inFlight: null
  });
}

function setGdeltCacheFailure(key, error) {
  const previous = gdeltCache.get(key) || {};
  gdeltCache.set(key, {
    ...previous,
    lastErrorAt: Date.now(),
    lastErrorMessage: error?.message || "Upstream request failed",
    inFlight: null
  });
}

async function fetchGdeltPayload(key, url) {
  const cached = gdeltCache.get(key);
  if (cached?.inFlight) return cached.inFlight;

  const inFlight = fetchJson(url, {
    timeoutMs: 15000,
    transport: "https"
  }).then((payload) => {
    setGdeltCacheSuccess(key, payload);
    return payload;
  }).catch((error) => {
    setGdeltCacheFailure(key, error);
    throw error;
  });

  gdeltCache.set(key, {
    ...(cached || {}),
    inFlight
  });

  return inFlight;
}

function createUpstreamError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function fetchJsonViaHttps(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        Accept: "application/json",
        ...options.headers
      }
    }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        if ((res.statusCode || 500) >= 400) {
          reject(createUpstreamError(res.statusCode || 502, `Upstream HTTP ${res.statusCode}${body ? `: ${body.slice(0, 160)}` : ""}`));
          return;
        }

        try {
          resolve(body ? JSON.parse(body) : {});
        } catch (error) {
          reject(error);
        }
      });
    });

    req.setTimeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS, () => {
      req.destroy(createUpstreamError(504, "Upstream timed out"));
    });
    req.on("error", reject);
  });
}

async function fetchJson(url, options = {}) {
  if (options.transport === "https") {
    return fetchJsonViaHttps(url, options);
  }

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      ...options.headers
    },
    signal: AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS)
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Upstream HTTP ${response.status}${body ? `: ${body.slice(0, 160)}` : ""}`);
  }

  return body ? JSON.parse(body) : {};
}

async function handleAdsbRequest(res) {
  const payload = await fetchJson(ADSB_URL);
  writeJson(res, 200, payload);
}

async function handleIssRequest(res) {
  const payload = await fetchJson(ISS_URL);
  writeJson(res, 200, payload);
}

async function handleGdeltRequest(reqUrl, res) {
  const query = reqUrl.searchParams.get("query")?.trim();
  if (!query) {
    writeJson(res, 400, { error: "Missing required query parameter: query" });
    return;
  }

  const params = new URLSearchParams({
    query,
    mode: reqUrl.searchParams.get("mode") || "ArtList",
    format: "json",
    maxrecords: String(parseInteger(reqUrl.searchParams.get("maxrecords"), 12, 1, 50)),
    sort: reqUrl.searchParams.get("sort") || "DateDesc"
  });

  const timespan = reqUrl.searchParams.get("timespan")?.trim();
  if (timespan) params.set("timespan", timespan);

  const key = getGdeltCacheKey(params);
  const now = Date.now();
  const cached = getCachedGdeltEntry(key);

  if (shouldServeFresh(cached, now)) {
    writeGdeltJson(res, 200, cached.payload, {
      source: "relay-cache",
      cached: true,
      stale: false,
      cachedAt: new Date(cached.cachedAt).toISOString()
    });
    return;
  }

  if (isInCooldown(cached, now)) {
    if (canServeStale(cached, now)) {
      writeGdeltJson(res, 200, cached.payload, {
        source: "relay-cache",
        cached: true,
        stale: true,
        cachedAt: new Date(cached.cachedAt).toISOString(),
        warning: cached.lastErrorMessage || "Serving stale relay cache during cooldown."
      });
      return;
    }

    writeJson(res, 503, {
      error: cached?.lastErrorMessage || "GDELT relay cooling down after upstream failure",
      retryAfterMs: Math.max(0, GDELT_COOLDOWN_MS - (now - cached.lastErrorAt)),
      endpoint: reqUrl.pathname
    });
    return;
  }

  try {
    const payload = await fetchGdeltPayload(key, `${GDELT_URL}?${params.toString()}`);
    const latest = getCachedGdeltEntry(key);
    writeGdeltJson(res, 200, payload, {
      source: "upstream",
      cached: false,
      stale: false,
      cachedAt: latest?.cachedAt ? new Date(latest.cachedAt).toISOString() : new Date().toISOString()
    });
  } catch (error) {
    const fallback = getCachedGdeltEntry(key);
    if (canServeStale(fallback, Date.now())) {
      writeGdeltJson(res, 200, fallback.payload, {
        source: "relay-cache",
        cached: true,
        stale: true,
        cachedAt: new Date(fallback.cachedAt).toISOString(),
        warning: error?.message || "Serving stale relay cache after upstream failure."
      });
      return;
    }

    throw error;
  }
}

const server = http.createServer(async (req, res) => {
  const method = req.method || "GET";
  const reqUrl = new URL(req.url || "/", `http://${req.headers.host || `127.0.0.1:${PORT}`}`);

  if (method === "OPTIONS") {
    setCorsHeaders(res);
    res.writeHead(204);
    res.end();
    return;
  }

  if (method !== "GET") {
    writeJson(res, 405, { error: "Method not allowed" });
    return;
  }

  try {
    switch (reqUrl.pathname) {
      case "/":
        writeHtml(res, 200, createRelayHomePage(reqUrl));
        return;
      case "/api/live":
        writeJson(res, 200, {
          ok: true,
          service: "gods-third-eye-live-relay",
          dashboard: ["127.0.0.1", "localhost"].includes(reqUrl.hostname)
            ? `http://${reqUrl.hostname}:5173/?relay=local`
            : `http://${reqUrl.host}/?relay=/api/live`,
          endpoints: {
            health: "/api/live/health",
            adsb: "/api/live/adsb",
            gdelt: "/api/live/gdelt?query=<query>",
            iss: "/api/live/iss"
          }
        });
        return;
      case "/health":
      case "/api/live/health":
        writeJson(res, 200, {
          ok: true,
          service: "gods-third-eye-live-relay",
          uptimeSec: Math.round(process.uptime()),
          now: new Date().toISOString()
        });
        return;
      case "/api/live/adsb":
        await handleAdsbRequest(res);
        return;
      case "/api/live/gdelt":
        await handleGdeltRequest(reqUrl, res);
        return;
      case "/api/live/iss":
        await handleIssRequest(res);
        return;
      default:
        writeJson(res, 404, { error: "Not found" });
    }
  } catch (error) {
    writeJson(res, error?.status || 502, {
      error: error?.message || "Upstream request failed",
      endpoint: reqUrl.pathname
    });
  }
});

server.listen(PORT, () => {
  console.log(`[God's Third Eye] Live relay listening on http://127.0.0.1:${PORT}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);