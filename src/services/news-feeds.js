/**
 * news-feeds.js
 * Pulls live articles from the GDELT 2.0 DOC API (no API key required).
 * Returns normalised article objects with images, outlets, and metadata.
 */

const GDELT_BASE = "https://api.gdeltproject.org/api/v2/doc/doc";
const FEED_TIMEOUT_MS = 9000;
const CACHE_DURATION_MS = 90_000; // match default refresh cadence

const _cache = new Map();

function isHttpUrl(value) {
  if (!value || typeof value !== "string") return false;
  return value.startsWith("http://") || value.startsWith("https://");
}

function dedupeArticles(articles) {
  const seen = new Set();
  const deduped = [];
  articles.forEach(article => {
    const key = `${article.url}|${article.title.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push(article);
  });
  return deduped.sort((left, right) => {
    const leftTs = left.seenAt?.getTime?.() ?? 0;
    const rightTs = right.seenAt?.getTime?.() ?? 0;
    return rightTs - leftTs;
  });
}

function gdeltUrl(query, maxRecords = 12) {
  const params = new URLSearchParams({
    query,
    mode: "ArtList",
    format: "json",
    maxrecords: String(maxRecords),
    sort: "DateDesc"
  });
  return `${GDELT_BASE}?${params}`;
}

function timeoutSignal(ms) {
  const controller = new AbortController();
  const id = window.setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => window.clearTimeout(id) };
}

function parseSeenDate(raw) {
  // "20260318T200000Z" → Date
  if (!raw || raw.length < 8) return null;
  const y  = raw.slice(0, 4);
  const mo = raw.slice(4, 6);
  const d  = raw.slice(6, 8);
  const h  = raw.slice(9, 11) || "00";
  const mi = raw.slice(11, 13) || "00";
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:00Z`);
}

function relativeTime(date) {
  if (!date) return "";
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
  return `${Math.floor(diff / 86400)} d ago`;
}

function domainFavicon(domain) {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`;
}

function normalise(raw) {
  if (!isHttpUrl(raw?.url)) return null;
  const date = parseSeenDate(raw.seendate);
  const domain = raw.domain || "unknown";
  const image = isHttpUrl(raw?.socialimage) ? raw.socialimage : null;
  const title = (raw.title || "Untitled").replace(/\s+/g, " ").trim();
  if (!title || title.length < 8) return null;
  return {
    id: raw.url,
    url: raw.url,
    title,
    image,
    domain,
    favicon: domainFavicon(domain),
    country: raw.sourcecountry || "",
    language: raw.language || "",
    seenAt: date,
    relativeTime: relativeTime(date)
  };
}

async function fetchGdelt(query, cacheKey, maxRecords = 12) {
  const now = Date.now();
  const cached = _cache.get(cacheKey);
  if (cached && now - cached.ts < CACHE_DURATION_MS) {
    return { articles: cached.data, fromCache: true, fetchedAt: new Date(cached.ts) };
  }

  const { signal, cancel } = timeoutSignal(FEED_TIMEOUT_MS);
  try {
    const res = await fetch(gdeltUrl(query, maxRecords), {
      headers: { Accept: "application/json" },
      signal
    });
    cancel();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    const raw = Array.isArray(payload?.articles) ? payload.articles : [];
    const articles = dedupeArticles(raw.map(normalise).filter(Boolean));
    _cache.set(cacheKey, { data: articles, ts: now });
    return { articles, fromCache: false, fetchedAt: new Date(now) };
  } catch (error) {
    cancel();
    return { articles: [], error: error?.message || "Failed", fromCache: false, fetchedAt: new Date() };
  }
}

// ── Named feeds ─────────────────────────────────────────────────────────────

export const NEWS_CATEGORIES = [
  {
    id: "war",
    label: "War",
    icon: "⚔",
    color: "#ff6d8d",
    query: '(war OR airstrike OR "military strike" OR troops OR missile OR combat OR invasion OR offensive)',
    maxRecords: 12
  },
  {
    id: "politics",
    label: "Politics",
    icon: "🏛",
    color: "#7ee0ff",
    query: '(geopolitics OR sanctions OR "foreign policy" OR diplomacy OR NATO OR UN OR summit OR treaty)',
    maxRecords: 12
  },
  {
    id: "intel",
    label: "Intel",
    icon: "◎",
    color: "#af9dff",
    query: '(intelligence OR surveillance OR espionage OR "cyber attack" OR hacking OR NSA OR signal)',
    maxRecords: 12
  },
  {
    id: "energy",
    label: "Energy",
    icon: "⚡",
    color: "#ffbe5c",
    query: '(oil OR gas OR energy OR petroleum OR pipeline OR OPEC OR LNG OR nuclear)',
    maxRecords: 12
  },
  {
    id: "maritime",
    label: "Maritime",
    icon: "⚓",
    color: "#61f5c7",
    query: '(shipping OR maritime OR tanker OR Strait OR Suez OR Hormuz OR piracy OR vessel)',
    maxRecords: 12
  }
];

export async function fetchNewsCategory(categoryId) {
  const cat = NEWS_CATEGORIES.find(c => c.id === categoryId);
  if (!cat) return { articles: [], error: "Unknown category" };
  return fetchGdelt(cat.query, `cat:${categoryId}`, cat.maxRecords);
}

export async function fetchAllNewsCategories() {
  const results = await Promise.all(
    NEWS_CATEGORIES.map(cat =>
      fetchGdelt(cat.query, `cat:${cat.id}`, cat.maxRecords).then(res => ({
        categoryId: cat.id,
        ...res
      }))
    )
  );
  return Object.fromEntries(results.map(r => [r.categoryId, r]));
}

export function invalidateNewsCache() {
  _cache.clear();
}
