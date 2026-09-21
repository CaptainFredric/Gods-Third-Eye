const LIVE_RELAY_STORAGE_KEY = "panopticon-earth-live-relay";

export const LOCAL_LIVE_RELAY_URL = "http://127.0.0.1:4180/api/live";
export const SAME_ORIGIN_LIVE_RELAY_URL = "/api/live";

const ENV_LIVE_RELAY_BASE = normalizeLiveRelayBase(import.meta.env?.VITE_LIVE_RELAY_URL || "");

function normalizeLiveRelayBase(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.toLowerCase() === "local") return LOCAL_LIVE_RELAY_URL;
  if (["same-origin", "sameorigin", "same_origin", "hosted", "proxy"].includes(trimmed.toLowerCase())) {
    return SAME_ORIGIN_LIVE_RELAY_URL;
  }
  if (!/^https?:\/\//i.test(trimmed) && !trimmed.startsWith("/")) return "";
  return trimmed.replace(/\/+$/, "");
}

function readQueryRelayBase() {
  try {
    const params = new URLSearchParams(window.location.search);
    return normalizeLiveRelayBase(params.get("relay") || "");
  } catch {
    return "";
  }
}

export function getConfiguredLiveRelayBase() {
  try {
    return normalizeLiveRelayBase(window.localStorage.getItem(LIVE_RELAY_STORAGE_KEY) || "");
  } catch {
    return "";
  }
}

export function setConfiguredLiveRelayBase(value) {
  const normalized = normalizeLiveRelayBase(value);
  try {
    if (!normalized) {
      window.localStorage.removeItem(LIVE_RELAY_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(LIVE_RELAY_STORAGE_KEY, normalized);
  } catch {
  }
}

export function getLiveRelayBase() {
  return readQueryRelayBase() || getConfiguredLiveRelayBase() || ENV_LIVE_RELAY_BASE;
}

export function hasLiveRelay() {
  return !!getLiveRelayBase();
}

export function getLiveRelayLabel() {
  const base = getLiveRelayBase();
  if (!base) return "direct browser";
  if (base === LOCAL_LIVE_RELAY_URL || /(?:localhost|127\.0\.0\.1):4180/i.test(base)) {
    return "local relay";
  }
  if (base.startsWith("/")) {
    return "same-origin relay";
  }
  try {
    return new URL(base, window.location.origin).host || "configured relay";
  } catch {
    return "configured relay";
  }
}

export function buildLiveRelayUrl(path, params = {}) {
  const base = getLiveRelayBase();
  if (!base) return "";

  const root = base.startsWith("http")
    ? base.replace(/\/+$/, "")
    : new URL(base, window.location.origin).toString().replace(/\/+$/, "");
  const normalizedPath = String(path || "").replace(/^\/+/, "");
  const url = new URL(`${root}/${normalizedPath}`);

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    url.searchParams.set(key, String(value));
  });

  return url.toString();
}

async function timedFetch(url, { timeoutMs = 9000, headers = {} } = {}) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers: {
        Accept: "application/json",
        ...headers
      },
      signal: controller.signal
    });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function createRelayHttpError(response) {
  let payload = null;
  let bodyText = "";

  try {
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      payload = await response.json();
      bodyText = payload?.error || "";
    } else {
      bodyText = await response.text();
    }
  } catch {
  }

  const error = new Error((bodyText || `Relay HTTP ${response.status}`).trim());
  error.relayStatus = response.status;
  error.relayPayload = payload;
  error.relayUrl = response.url;
  return error;
}

export async function fetchWithOptionalLiveRelay({ relayPath, relayParams = {}, directUrl, timeoutMs = 9000, headers = {}, allowDirectFallback = true } = {}) {
  const relayUrl = relayPath ? buildLiveRelayUrl(relayPath, relayParams) : "";
  let relayError = null;

  if (relayUrl) {
    try {
      const response = await timedFetch(relayUrl, { timeoutMs, headers });
      if (response.ok) {
        return { response, via: "relay", relayUrl, relayError: null };
      }
      relayError = await createRelayHttpError(response);
    } catch (error) {
      relayError = error;
    }
  }

  if (!directUrl || (relayUrl && !allowDirectFallback)) {
    if (relayError) throw relayError;
    return null;
  }

  const response = await timedFetch(directUrl, { timeoutMs, headers });
  return { response, via: "direct", relayUrl, relayError };
}

export function formatLiveRelayError(error, fallback = "Configured relay is unavailable.") {
  const relayStatus = Number(error?.relayStatus || error?.status || 0);
  const retryAfterMs = Number(error?.relayPayload?.retryAfterMs || 0);

  if (relayStatus === 429) {
    return "Relay rate limit reached. Holding until the next refresh window.";
  }
  if (relayStatus === 503) {
    return retryAfterMs > 0
      ? `Relay cooling down after an upstream failure. Retry in ${Math.ceil(retryAfterMs / 1000)}s.`
      : "Relay cooling down after an upstream failure.";
  }
  if (relayStatus === 504) {
    return "Relay timed out waiting for the upstream feed.";
  }

  return error?.relayPayload?.error || error?.message || fallback;
}

export function isLikelyBrowserRestriction(error) {
  const message = String(error?.message ?? "").toLowerCase();
  return error?.name === "TypeError"
    || message.includes("failed to fetch")
    || message.includes("load failed")
    || message.includes("networkerror");
}