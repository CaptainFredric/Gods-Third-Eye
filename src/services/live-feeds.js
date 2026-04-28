const ADSB_URL = "https://opensky-network.org/api/states/all";
const AIS_STORAGE_KEY = "panopticon-earth-ais-endpoint";
const FEED_TIMEOUT_MS = 8000;

function timeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, cancel: () => window.clearTimeout(timeoutId) };
}

function withStatusError(source, message, fallback = {}) {
  return {
    status: "error",
    source,
    message,
    records: [],
    updatedAt: new Date().toISOString(),
    ...fallback
  };
}

function parseOpenSky(states) {
  return (states ?? [])
    .filter(state => Number.isFinite(state?.[5]) && Number.isFinite(state?.[6]))
    .slice(0, 60)
    .map((state, index) => ({
      id: `adsb-${state[0] ?? index}`,
      label: (state[1] || state[0] || `ADSB-${index + 1}`).trim(),
      lng: state[5],
      lat: state[6],
      altitude: Math.max(0, Number(state[7] ?? state[13] ?? 0)),
      velocity: Math.max(0, Number(state[9] ?? 0)),
      heading: Number.isFinite(state[10]) ? state[10] : 0,
      source: "OpenSky",
      lastContact: state[4] ?? null
    }));
}

function normalizeAisRecords(payload) {
  const candidates = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.vessels)
      ? payload.vessels
      : Array.isArray(payload?.data)
        ? payload.data
        : [];

  return candidates
    .filter(record => Number.isFinite(record?.lng ?? record?.lon) && Number.isFinite(record?.lat))
    .slice(0, 40)
    .map((record, index) => ({
      id: record.id ?? record.mmsi ?? `ais-${index + 1}`,
      label: record.label ?? record.name ?? `AIS-${index + 1}`,
      lng: Number(record.lng ?? record.lon),
      lat: Number(record.lat),
      heading: Number(record.heading ?? record.course ?? 0),
      speed: Number(record.speed ?? record.sog ?? 0),
      type: record.type ?? record.vesselType ?? "vessel",
      source: record.source ?? "Configured AIS"
    }));
}

export function getConfiguredAisEndpoint() {
  try {
    return window.localStorage.getItem(AIS_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

export function setConfiguredAisEndpoint(endpoint) {
  try {
    if (!endpoint) {
      window.localStorage.removeItem(AIS_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(AIS_STORAGE_KEY, endpoint);
  } catch {
  }
}

export async function fetchLiveFeeds() {
  const adsbPromise = fetchAdsbFeed();
  const aisPromise = fetchAisFeed();
  const [adsb, ais] = await Promise.all([adsbPromise, aisPromise]);
  return { adsb, ais };
}

export async function fetchAdsbFeed() {
  const { signal, cancel } = timeoutSignal(FEED_TIMEOUT_MS);
  try {
    const response = await fetch(ADSB_URL, {
      headers: { Accept: "application/json" },
      signal
    });
    cancel();
    if (!response.ok) {
      return withStatusError("OpenSky", `HTTP ${response.status}`);
    }
    const payload = await response.json();
    const records = parseOpenSky(payload?.states);
    return {
      status: records.length ? "live" : "idle",
      source: "OpenSky ADS-B",
      message: records.length ? `${records.length} live aircraft tracks` : "No current aircraft returned",
      records,
      updatedAt: new Date().toISOString()
    };
  } catch (error) {
    cancel();
    return withStatusError("OpenSky ADS-B", error?.name === "AbortError" ? "Timed out" : error?.message ?? "Request failed");
  }
}

export async function fetchAisFeed() {
  const endpoint = getConfiguredAisEndpoint();
  if (!endpoint) {
    return {
      status: "config-required",
      source: "AIS Adapter",
      message: "Add a CORS-safe AIS JSON endpoint to enable live vessel ingestion.",
      records: [],
      updatedAt: new Date().toISOString()
    };
  }

  const { signal, cancel } = timeoutSignal(FEED_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      headers: { Accept: "application/json" },
      signal
    });
    cancel();
    if (!response.ok) {
      return withStatusError("AIS Adapter", `HTTP ${response.status}`);
    }
    const payload = await response.json();
    const records = normalizeAisRecords(payload);
    return {
      status: records.length ? "live" : "idle",
      source: "AIS Adapter",
      message: records.length ? `${records.length} live vessel tracks` : "No vessel data in configured payload",
      records,
      updatedAt: new Date().toISOString()
    };
  } catch (error) {
    cancel();
    return withStatusError("AIS Adapter", error?.name === "AbortError" ? "Timed out" : error?.message ?? "Request failed");
  }
}
