import { BASEMAPS, DEFAULT_BOOKMARKS, FX_MODES, LAYERS, SCENARIO, STORAGE_KEYS, INCIDENT_POOL } from "./data/scenario.js";
import { fetchLiveFeeds, fetchAisFeed, getConfiguredAisEndpoint, setConfiguredAisEndpoint } from "./services/live-feeds.js";
import { NEWS_CATEGORIES, fetchNewsCategory, fetchAllNewsCategories, invalidateNewsCache } from "./services/news-feeds.js";
import { initPresence, setPresenceName, getPresencePeers, onPeersChanged, isPresenceConnected } from "./services/presence.js";
import { initAudioEngine, sfx, setAudioEnabled, isAudioEnabled } from "./services/audio-engine.js";

const Cesium = await loadCesium();

function normalizeCesiumModule(module) {
  if (module?.Viewer) return module;
  if (module?.default?.Viewer) return module.default;
  return module?.default ?? module;
}

async function loadCesium() {
  if (globalThis.Cesium?.Viewer) return globalThis.Cesium;
  return normalizeCesiumModule(await import("cesium"));
}

const UI_STORAGE_KEYS = {
  declutter: "panopticon-earth-declutter",
  compact:   "panopticon-earth-compact",
  panelState:"panopticon-earth-panel-state",
  layouts:   "panopticon-earth-layouts",
  onboardingSeen: "panopticon-earth-onboarding-seen",
  panelStateVersion: "panopticon-earth-panel-version"
};

const PANEL_STATE_VERSION = 2;

const BOOT_SESSION_KEY = "panopticon-earth-boot-seen";

const BOOT_STEPS = [
  { pct:  5, msg: "Kernel handshake…" },
  { pct: 14, msg: "Acquiring OpenSky ADS-B transponder feed…" },
  { pct: 26, msg: "Binding GDELT 2.0 news intelligence pipeline…" },
  { pct: 38, msg: "Initialising CesiumJS WebGL globe renderer…" },
  { pct: 50, msg: "Loading ISS orbital telemetry (wheretheiss.at)…" },
  { pct: 62, msg: "Fetching USGS seismic layer — M2.5+ global…" },
  { pct: 74, msg: "Populating global incident pool — 30 hotspot zones…" },
  { pct: 85, msg: "Assembling HUD — 6 data layers · 8 broadcast channels…" },
  { pct: 95, msg: "Calibrating geopolitical overlays…" },
  { pct:100, msg: "● PANOPTICON EARTH ONLINE — ALL FEEDS ACTIVE" },
];

let _incidentCycleTimer = null;
const INCIDENT_DISPLAY_COUNT = 6;
const _eventHistoryPositions = [];
const _EVENT_HISTORY_MAX = 20;
let _eventHistoryEntity = null;

const PANEL_IDS = ["panel-layers", "panel-right", "floating-summary", "map-legend"];

const CAMERA_PRESETS = [
  {
    id: "preset-home",
    label: "Home",
    kicker: "Global",
    destination: {
      lng: SCENARIO.initialView.lng,
      lat: SCENARIO.initialView.lat,
      height: SCENARIO.initialView.height,
      heading: SCENARIO.initialView.heading,
      pitch: SCENARIO.initialView.pitch,
      roll: SCENARIO.initialView.roll
    }
  },
  { id: "preset-gulf", label: "Gulf Ops", kicker: "AOI", destination: DEFAULT_BOOKMARKS[0].destination, regionFocus: "Gulf Ops" },
  { id: "preset-europe", label: "Europe Arc", kicker: "Air", destination: DEFAULT_BOOKMARKS[1].destination, regionFocus: "Europe Arc" },
  { id: "preset-pacific", label: "Pacific Watch", kicker: "Nav", destination: DEFAULT_BOOKMARKS[2].destination, regionFocus: "Pacific Watch" },
  {
    id: "preset-theater",
    label: "Theater Core",
    kicker: "Signal",
    destination: { lng: 51.4, lat: 35.6, height: 2800000, heading: 0.22, pitch: -0.98, roll: 0 },
    regionFocus: "Theater Core"
  }
];

const STARTUP_VIEW = {
  lng: SCENARIO.initialView.lng,
  lat: SCENARIO.initialView.lat,
  height: 15800000,
  heading: SCENARIO.initialView.heading,
  pitch: -1.36,
  roll: 0
};

const SYSTEM_BOOKMARK_IDS = new Set(DEFAULT_BOOKMARKS.map(bookmark => bookmark.id));

const MISSION_GUIDE_STEPS = [
  {
    kicker: "Quick Start",
    title: "Live intelligence, right now",
    lead: "God's Third Eye pulls live ADS-B aircraft from OpenSky Network, real orbital tracks, maritime data, and GDELT 2.0 global news headlines — all rendered on a 3D WebGL globe with no backend required.",
    sections: [
      { title: "Start Here", items: ["Hit Next Hotspot to jump to an active geopolitical alert zone", "Click any aircraft, satellite, vessel, or incident to open its Intel Sheet", "Open News Briefing to see live GDELT headlines linked to map events"] }
    ],
    actions: [
      { id: "hotspot", label: "Go To Hotspot" },
      { id: "random-track", label: "Pick A Track" }
    ]
  },
  {
    kicker: "Workflow",
    title: "A typical intel session",
    lead: "Jump to a hotspot, cross-reference live news headlines, inspect conflict intel when you click any coordinates, then save your layout for the next session.",
    sections: [
      { title: "Core Loop", items: ["Next Hotspot → flies to an active alert with rotating narrative updates", "News Briefing → GDELT 2.0 headlines across 5 intelligence categories", "Click the globe → Conflict Intel Box surfaces nearby alerts by distance", "Brief Focus → generates a live situational summary of the current view"] },
      { title: "Visual Modes", items: ["FX: Night Vision, Thermal, and CRT overlays for different briefing aesthetics", "Event Visuals: ephemeral conflict bursts spawn from live GDELT headlines", "Location HUD: real-time geocoding as you pan across any region"] }
    ],
    actions: [
      { id: "brief", label: "Create Brief" },
      { id: "intel", label: "Open Intel" }
    ]
  },
  {
    kicker: "What It Is",
    title: "A real intelligence platform",
    lead: "Built entirely in vanilla JS and CesiumJS — no framework, no backend. Every aircraft is a live ADS-B transponder. Every news event is a real GDELT headline. Every conflict burst is algorithmically tied to live geospatial data.",
    sections: [
      { title: "Live Data Sources", items: ["OpenSky Network: real ADS-B transponder data, globally, every 90s", "GDELT 2.0 DOC API: 100+ language global media corpus, 5 categories", "OpenStreetMap Nominatim: geocoding for click-to-inspect coordinate popups"] },
      { title: "Technical Highlights", items: ["CesiumJS 3D globe with WebGL bloom, FXAA, and day/night globe lighting", "Persistent layouts, bookmarks, and FX settings via localStorage", "Draggable glass-morphism HUD with live threat-level computation"] }
    ],
    actions: [
      { id: "tour", label: "Start Tour" },
      { id: "save-layout", label: "Save Layout" }
    ]
  }
];

const state = {
  selectedEntity:        null,
  trackedEntity:         null,
  hoveredEntity:         null,
  spinning:              true,
  spinPausedUntil:       0,
  activeDrawer:          null,
  opsHotspotIndex:       0,
  opsTourTimer:          null,
  onboardingSeen:        loadJson(UI_STORAGE_KEYS.onboardingSeen, false),
  onboardingStep:        0,
  intelSheetOpen:        false,
  declutter:             loadJson(UI_STORAGE_KEYS.declutter, false),
  compact:               loadJson(UI_STORAGE_KEYS.compact, false),
  panelState:            loadPanelStateWithVersion(),
  savedLayouts:          loadJson(UI_STORAGE_KEYS.layouts, []),
  tiltMode:              false,
  regionFocus:           null,
  searchAbortController: null,
  searchDebounceTimer:   null,
  searchCursorIndex:     -1,
  searchFlatResults:     [],
  alertNarrativeIndexes: Object.create(null),
  incidentNarrativeIndexes: Object.create(null),
  narrativeTimer:        null,
  newsOpen:              false,
  newsCategory:          "war",
  newsArticles:          [],
  newsTickerPool:        [],
  newsTickerIndex:       0,
  newsLastFetched:       null,
  newsRefreshTimer:      null,
  newsTickerTimer:       null,
  newsTickerPaused:      false,
  newsCategoryTimer:     null,
  newsPanelHovering:     false,
  newsCategoryPaused:    false,
  sessionStats:          { eventsSpawned: 0, articlesIngested: 0, countriesSeen: new Set(), sessionStart: Date.now() },
  locationHudVisible:    false,
  locationLastGeocode:   0,
  locationLastLng:       null,
  locationLastLat:       null,
  locationGeocodeTimer:  null,
  basemapId:             loadJson(STORAGE_KEYS.basemap, BASEMAPS[0].id),
  fxMode:                loadJson(STORAGE_KEYS.fxMode, FX_MODES[0].id),
  bookmarks:             normalizeBookmarks(loadJson(STORAGE_KEYS.bookmarks, DEFAULT_BOOKMARKS)),
  layers:                loadJson(STORAGE_KEYS.layers, Object.fromEntries(LAYERS.map(l => [l.id, l.enabled]))),  refreshIntervalSec:    90,
  fxIntensity:           58,
  fxGlow:                30,
  refreshTimer:          null,
  nextRefreshAt:         null,
  liveFeeds: {
    adsb: { status: "idle", source: "OpenSky ADS-B",  message: "Awaiting refresh", records: [], updatedAt: null },
    ais:  {
      status:  getConfiguredAisEndpoint() ? "idle" : "config-required",
      source:  "AIS Adapter",
      message: getConfiguredAisEndpoint() ? "Awaiting refresh" : "Configure a CORS-safe AIS endpoint",
      records: [], updatedAt: null
    }
  }
};

// Ensure new layer keys added after a user's localStorage was first saved are always present
LAYERS.forEach(l => { if (state.layers[l.id] === undefined) state.layers[l.id] = l.enabled; });

const elements = {};
let refreshPanelRestoreStrip = () => {};
const sparklineData = {
  tracks: [],
  alerts: [],
  orbits: [],
  feeds: []
};
const SPARKLINE_MAX_POINTS = 12;

const EVENT_VISUAL_STYLES = {
  alert: {
    dot: "#ff4d6d",
    cone: "#ff9f43",
    trail: "#00d4ff",
    ttlMs: 120000,
    coneLength: 210000,
    coneRadius: 68000,
    trailDistance: 540000
  },
  incident: {
    dot: "#ff0040",
    cone: "#ff4d6d",
    trail: "#a78bfa",
    ttlMs: 150000,
    coneLength: 260000,
    coneRadius: 82000,
    trailDistance: 680000
  },
  // Category-mapped styles — matched from NEWS_CATEGORIES
  war: {
    dot: "#ff4d6d",
    cone: "#ff0040",
    trail: "#ff6d8d",
    ttlMs: 140000,
    coneLength: 240000,
    coneRadius: 78000,
    trailDistance: 600000
  },
  geopolitics: {
    dot: "#7ee0ff",
    cone: "#00d4ff",
    trail: "#7ee0ff",
    ttlMs: 110000,
    coneLength: 190000,
    coneRadius: 62000,
    trailDistance: 500000
  },
  intelligence: {
    dot: "#af9dff",
    cone: "#a78bfa",
    trail: "#af9dff",
    ttlMs: 130000,
    coneLength: 220000,
    coneRadius: 72000,
    trailDistance: 560000
  },
  energy: {
    dot: "#ffbe5c",
    cone: "#ff9f43",
    trail: "#ffbe5c",
    ttlMs: 100000,
    coneLength: 180000,
    coneRadius: 58000,
    trailDistance: 480000
  },
  maritime: {
    dot: "#60f7bf",
    cone: "#00ffc8",
    trail: "#60f7bf",
    ttlMs: 125000,
    coneLength: 200000,
    coneRadius: 65000,
    trailDistance: 520000
  }
};

const EVENT_REGION_OVERRIDES = {
  gulf: { trail: "#00ffc8", cone: "#ff9f43" },
  pacific: { trail: "#00d4ff", cone: "#a78bfa" },
  theater: { trail: "#ff4d6d", cone: "#ff0040" },
  europe: { trail: "#7ec8ff", cone: "#ff9f43" }
};

// ── Country geocoding for GDELT sourcecountry field ─────────────────────
// Approximate capital / centroid coords for countries GDELT commonly returns.
// Used to spawn event visuals at the real geographic origin of news articles.
const COUNTRY_COORDS = {
  "united states":    { lat: 38.9,  lng: -77.0 },
  "united kingdom":   { lat: 51.5,  lng: -0.13 },
  "france":           { lat: 48.9,  lng: 2.35  },
  "germany":          { lat: 52.5,  lng: 13.4  },
  "russia":           { lat: 55.8,  lng: 37.6  },
  "china":            { lat: 39.9,  lng: 116.4 },
  "india":            { lat: 28.6,  lng: 77.2  },
  "japan":            { lat: 35.7,  lng: 139.7 },
  "south korea":      { lat: 37.6,  lng: 127.0 },
  "north korea":      { lat: 39.0,  lng: 125.8 },
  "iran":             { lat: 35.7,  lng: 51.4  },
  "iraq":             { lat: 33.3,  lng: 44.4  },
  "israel":           { lat: 31.8,  lng: 35.2  },
  "palestine":        { lat: 31.9,  lng: 35.2  },
  "saudi arabia":     { lat: 24.7,  lng: 46.7  },
  "turkey":           { lat: 39.9,  lng: 32.9  },
  "syria":            { lat: 33.5,  lng: 36.3  },
  "lebanon":          { lat: 33.9,  lng: 35.5  },
  "egypt":            { lat: 30.0,  lng: 31.2  },
  "ukraine":          { lat: 50.4,  lng: 30.5  },
  "poland":           { lat: 52.2,  lng: 21.0  },
  "italy":            { lat: 41.9,  lng: 12.5  },
  "spain":            { lat: 40.4,  lng: -3.7  },
  "brazil":           { lat: -15.8, lng: -47.9 },
  "mexico":           { lat: 19.4,  lng: -99.1 },
  "canada":           { lat: 45.4,  lng: -75.7 },
  "australia":        { lat: -35.3, lng: 149.1 },
  "pakistan":          { lat: 33.7,  lng: 73.0  },
  "afghanistan":      { lat: 34.5,  lng: 69.2  },
  "nigeria":          { lat: 9.06,  lng: 7.49  },
  "south africa":     { lat: -25.7, lng: 28.2  },
  "kenya":            { lat: -1.29, lng: 36.8  },
  "ethiopia":         { lat: 9.02,  lng: 38.7  },
  "somalia":          { lat: 2.05,  lng: 45.3  },
  "sudan":            { lat: 15.6,  lng: 32.5  },
  "libya":            { lat: 32.9,  lng: 13.2  },
  "yemen":            { lat: 15.4,  lng: 44.2  },
  "united arab emirates": { lat: 24.5, lng: 54.7 },
  "qatar":            { lat: 25.3,  lng: 51.5  },
  "kuwait":           { lat: 29.4,  lng: 47.9  },
  "bahrain":          { lat: 26.2,  lng: 50.6  },
  "oman":             { lat: 23.6,  lng: 58.5  },
  "jordan":           { lat: 31.9,  lng: 35.9  },
  "morocco":          { lat: 34.0,  lng: -6.83 },
  "algeria":          { lat: 36.8,  lng: 3.06  },
  "tunisia":          { lat: 36.8,  lng: 10.2  },
  "taiwan":           { lat: 25.0,  lng: 121.6 },
  "philippines":      { lat: 14.6,  lng: 121.0 },
  "indonesia":        { lat: -6.2,  lng: 106.8 },
  "malaysia":         { lat: 3.14,  lng: 101.7 },
  "singapore":        { lat: 1.35,  lng: 103.8 },
  "thailand":         { lat: 13.8,  lng: 100.5 },
  "vietnam":          { lat: 21.0,  lng: 105.9 },
  "myanmar":          { lat: 19.8,  lng: 96.2  },
  "bangladesh":       { lat: 23.8,  lng: 90.4  },
  "nepal":            { lat: 27.7,  lng: 85.3  },
  "sri lanka":        { lat: 6.93,  lng: 79.8  },
  "colombia":         { lat: 4.71,  lng: -74.1 },
  "argentina":        { lat: -34.6, lng: -58.4 },
  "venezuela":        { lat: 10.5,  lng: -66.9 },
  "chile":            { lat: -33.4, lng: -70.7 },
  "peru":             { lat: -12.0, lng: -77.0 },
  "cuba":             { lat: 23.1,  lng: -82.4 },
  "greece":           { lat: 37.98, lng: 23.7  },
  "netherlands":      { lat: 52.4,  lng: 4.90  },
  "belgium":          { lat: 50.8,  lng: 4.35  },
  "sweden":           { lat: 59.3,  lng: 18.1  },
  "norway":           { lat: 59.9,  lng: 10.7  },
  "denmark":          { lat: 55.7,  lng: 12.6  },
  "finland":          { lat: 60.2,  lng: 24.9  },
  "switzerland":      { lat: 46.9,  lng: 7.45  },
  "austria":          { lat: 48.2,  lng: 16.4  },
  "romania":          { lat: 44.4,  lng: 26.1  },
  "hungary":          { lat: 47.5,  lng: 19.0  },
  "czech republic":   { lat: 50.1,  lng: 14.4  },
  "czechia":          { lat: 50.1,  lng: 14.4  },
  "portugal":         { lat: 38.7,  lng: -9.14 },
  "ireland":          { lat: 53.3,  lng: -6.26 },
  "new zealand":      { lat: -41.3, lng: 174.8 },
  "congo":            { lat: -4.32, lng: 15.3  },
  "democratic republic of the congo": { lat: -4.32, lng: 15.3 },
  "cameroon":         { lat: 3.87,  lng: 11.5  },
  "ghana":            { lat: 5.56,  lng: -0.19 },
  "mozambique":       { lat: -25.97, lng: 32.6 },
  "zimbabwe":         { lat: -17.8, lng: 31.0  },
  "tanzania":         { lat: -6.16, lng: 35.7  },
  "uganda":           { lat: 0.32,  lng: 32.6  },
  "mali":             { lat: 12.6,  lng: -8.0  },
  "niger":            { lat: 13.5,  lng: 2.12  },
  "burkina faso":     { lat: 12.4,  lng: -1.5  },
  "georgia":          { lat: 41.7,  lng: 44.8  },
  "armenia":          { lat: 40.2,  lng: 44.5  },
  "azerbaijan":       { lat: 40.4,  lng: 49.9  },
  "uzbekistan":       { lat: 41.3,  lng: 69.3  },
  "kazakhstan":       { lat: 51.2,  lng: 71.4  },
  "serbia":           { lat: 44.8,  lng: 20.5  },
  "croatia":          { lat: 45.8,  lng: 16.0  },
  "bosnia":           { lat: 43.9,  lng: 18.4  },
  "kosovo":           { lat: 42.7,  lng: 21.2  },
  // Additional coverage — Sub-Saharan Africa
  "south sudan":      { lat: 4.85,  lng: 31.6  },
  "central african republic": { lat: 4.36, lng: 18.6 },
  "chad":             { lat: 12.1,  lng: 15.0  },
  "rwanda":           { lat: -1.94, lng: 29.9  },
  "burundi":          { lat: -3.39, lng: 29.4  },
  "angola":           { lat: -8.84, lng: 13.2  },
  "zambia":           { lat: -15.4, lng: 28.3  },
  "malawi":           { lat: -13.9, lng: 33.8  },
  "botswana":         { lat: -24.6, lng: 25.9  },
  "namibia":          { lat: -22.6, lng: 17.1  },
  "senegal":          { lat: 14.7,  lng: -17.5 },
  "guinea":           { lat: 9.54,  lng: -13.7 },
  "sierra leone":     { lat: 8.49,  lng: -13.2 },
  "liberia":          { lat: 6.30,  lng: -10.8 },
  "ivory coast":      { lat: 5.35,  lng: -4.00 },
  "cote d'ivoire":    { lat: 5.35,  lng: -4.00 },
  "togo":             { lat: 6.14,  lng: 1.22  },
  "benin":            { lat: 6.37,  lng: 2.43  },
  "gabon":            { lat: 0.39,  lng: 9.45  },
  "eritrea":          { lat: 15.3,  lng: 38.9  },
  "djibouti":         { lat: 11.6,  lng: 43.1  },
  "madagascar":       { lat: -18.9, lng: 47.5  },
  "mauritius":        { lat: -20.2, lng: 57.5  },
  "eswatini":         { lat: -26.3, lng: 31.1  },
  "lesotho":          { lat: -29.3, lng: 27.5  },
  "equatorial guinea":{ lat: 3.75,  lng: 8.78  },
  "cape verde":       { lat: 14.9,  lng: -23.5 },
  "gambia":           { lat: 13.5,  lng: -16.6 },
  "guinea-bissau":    { lat: 11.9,  lng: -15.6 },
  // Additional — Latin America & Caribbean
  "ecuador":          { lat: -0.23, lng: -78.5 },
  "bolivia":          { lat: -16.5, lng: -68.1 },
  "paraguay":         { lat: -25.3, lng: -57.6 },
  "uruguay":          { lat: -34.9, lng: -56.2 },
  "guyana":           { lat: 6.80,  lng: -58.2 },
  "suriname":         { lat: 5.85,  lng: -55.2 },
  "haiti":            { lat: 18.5,  lng: -72.3 },
  "dominican republic":{ lat: 18.5, lng: -69.9 },
  "guatemala":        { lat: 14.6,  lng: -90.5 },
  "honduras":         { lat: 14.1,  lng: -87.2 },
  "el salvador":      { lat: 13.7,  lng: -89.2 },
  "nicaragua":        { lat: 12.1,  lng: -86.3 },
  "costa rica":       { lat: 9.93,  lng: -84.1 },
  "panama":           { lat: 8.99,  lng: -79.5 },
  "trinidad":         { lat: 10.7,  lng: -61.5 },
  "trinidad and tobago": { lat: 10.7, lng: -61.5 },
  "jamaica":          { lat: 18.0,  lng: -76.8 },
  "belize":           { lat: 17.2,  lng: -88.8 },
  // Additional — Europe
  "albania":          { lat: 41.3,  lng: 19.8  },
  "north macedonia":  { lat: 42.0,  lng: 21.4  },
  "macedonia":        { lat: 42.0,  lng: 21.4  },
  "moldova":          { lat: 47.0,  lng: 28.9  },
  "montenegro":       { lat: 42.4,  lng: 19.3  },
  "slovenia":         { lat: 46.1,  lng: 14.5  },
  "slovakia":         { lat: 48.1,  lng: 17.1  },
  "luxembourg":       { lat: 49.6,  lng: 6.13  },
  "iceland":          { lat: 64.1,  lng: -21.9 },
  "malta":            { lat: 35.9,  lng: 14.5  },
  "cyprus":           { lat: 35.2,  lng: 33.4  },
  "bulgaria":         { lat: 42.7,  lng: 23.3  },
  "latvia":           { lat: 56.9,  lng: 24.1  },
  "estonia":          { lat: 59.4,  lng: 24.8  },
  "lithuania":        { lat: 54.7,  lng: 25.3  },
  // Additional — Central & South Asia
  "turkmenistan":     { lat: 37.9,  lng: 58.4  },
  "kyrgyzstan":       { lat: 42.9,  lng: 74.6  },
  "tajikistan":       { lat: 38.6,  lng: 68.8  },
  // Additional — South-East & East Asia
  "cambodia":         { lat: 11.6,  lng: 104.9 },
  "laos":             { lat: 18.0,  lng: 102.6 },
  "mongolia":         { lat: 47.9,  lng: 106.9 },
  "timor-leste":      { lat: -8.56, lng: 125.6 },
  "papua new guinea": { lat: -9.44, lng: 147.2 },
  "fiji":             { lat: -18.1, lng: 178.4 },
  // Additional — Pacific & Island states
  "solomon islands":  { lat: -9.45, lng: 160.0 },
  "vanuatu":          { lat: -17.7, lng: 168.3 },
  "samoa":            { lat: -13.8, lng: -172.1},
  // Key territories & disputed regions
  "taiwan":           { lat: 25.0,  lng: 121.6 },
  "hong kong":        { lat: 22.3,  lng: 114.2 },
  "transnistria":     { lat: 47.1,  lng: 29.3  },
  "western sahara":   { lat: 24.2,  lng: -12.9 },
  "somaliland":       { lat: 9.56,  lng: 44.1  },
  "abkhazia":         { lat: 43.0,  lng: 41.0  },
  "south ossetia":    { lat: 42.3,  lng: 44.0  },
  "kashmir":          { lat: 34.1,  lng: 74.8  },
  "xinjiang":         { lat: 41.2,  lng: 85.3  },
  "tibet":            { lat: 30.0,  lng: 90.0  },
};

/**
 * City-level lookup dictionary — ~200 cities commonly appearing in geopolitical/conflict news.
 * Keys are lowercase. Coordinates are city centres (not country centroids).
 * This is the primary resolution layer; COUNTRY_COORDS is the fallback.
 */
const CITY_COORDS = {
  // Middle East & North Africa
  "gaza":           { lat: 31.52,  lng: 34.47,  name: "Gaza" },
  "gaza city":      { lat: 31.52,  lng: 34.47,  name: "Gaza City" },
  "tel aviv":       { lat: 32.09,  lng: 34.78,  name: "Tel Aviv" },
  "jerusalem":      { lat: 31.78,  lng: 35.22,  name: "Jerusalem" },
  "west bank":      { lat: 31.95,  lng: 35.30,  name: "West Bank" },
  "rafah":          { lat: 31.29,  lng: 34.25,  name: "Rafah" },
  "ramallah":       { lat: 31.90,  lng: 35.21,  name: "Ramallah" },
  "haifa":          { lat: 32.82,  lng: 34.99,  name: "Haifa" },
  "beirut":         { lat: 33.89,  lng: 35.50,  name: "Beirut" },
  "damascus":       { lat: 33.51,  lng: 36.29,  name: "Damascus" },
  "aleppo":         { lat: 36.20,  lng: 37.16,  name: "Aleppo" },
  "raqqa":          { lat: 35.95,  lng: 39.01,  name: "Raqqa" },
  "idlib":          { lat: 35.93,  lng: 36.63,  name: "Idlib" },
  "baghdad":        { lat: 33.34,  lng: 44.40,  name: "Baghdad" },
  "mosul":          { lat: 36.34,  lng: 43.13,  name: "Mosul" },
  "basra":          { lat: 30.51,  lng: 47.81,  name: "Basra" },
  "erbil":          { lat: 36.19,  lng: 44.01,  name: "Erbil" },
  "fallujah":       { lat: 33.35,  lng: 43.79,  name: "Fallujah" },
  "tehran":         { lat: 35.69,  lng: 51.39,  name: "Tehran" },
  "isfahan":        { lat: 32.66,  lng: 51.68,  name: "Isfahan" },
  "natanz":         { lat: 33.72,  lng: 51.93,  name: "Natanz" },
  "sanaa":          { lat: 15.37,  lng: 44.19,  name: "Sanaa" },
  "aden":           { lat: 12.78,  lng: 45.04,  name: "Aden" },
  "hodeidah":       { lat: 14.80,  lng: 42.95,  name: "Hodeidah" },
  "riyadh":         { lat: 24.69,  lng: 46.72,  name: "Riyadh" },
  "jeddah":         { lat: 21.49,  lng: 39.19,  name: "Jeddah" },
  "mecca":          { lat: 21.39,  lng: 39.86,  name: "Mecca" },
  "amman":          { lat: 31.95,  lng: 35.93,  name: "Amman" },
  "cairo":          { lat: 30.04,  lng: 31.24,  name: "Cairo" },
  "alexandria":     { lat: 31.21,  lng: 29.92,  name: "Alexandria" },
  "tripoli":        { lat: 32.90,  lng: 13.18,  name: "Tripoli" },
  "benghazi":       { lat: 32.12,  lng: 20.07,  name: "Benghazi" },
  "tunis":          { lat: 36.82,  lng: 10.17,  name: "Tunis" },
  "algiers":        { lat: 36.74,  lng: 3.06,   name: "Algiers" },
  "casablanca":     { lat: 33.59,  lng: -7.62,  name: "Casablanca" },
  "rabat":          { lat: 34.02,  lng: -6.83,  name: "Rabat" },
  "ankara":         { lat: 39.93,  lng: 32.86,  name: "Ankara" },
  "istanbul":       { lat: 41.01,  lng: 28.98,  name: "Istanbul" },
  "doha":           { lat: 25.29,  lng: 51.53,  name: "Doha" },
  "abu dhabi":      { lat: 24.45,  lng: 54.38,  name: "Abu Dhabi" },
  "dubai":          { lat: 25.20,  lng: 55.27,  name: "Dubai" },
  "muscat":         { lat: 23.62,  lng: 58.59,  name: "Muscat" },
  "kuwait city":    { lat: 29.37,  lng: 47.98,  name: "Kuwait City" },
  "manama":         { lat: 26.22,  lng: 50.59,  name: "Manama" },
  // Ukraine / Russia / Eastern Europe
  "kyiv":           { lat: 50.45,  lng: 30.52,  name: "Kyiv" },
  "kiev":           { lat: 50.45,  lng: 30.52,  name: "Kyiv" },
  "kharkiv":        { lat: 49.99,  lng: 36.23,  name: "Kharkiv" },
  "odessa":         { lat: 46.48,  lng: 30.72,  name: "Odessa" },
  "odesa":          { lat: 46.48,  lng: 30.72,  name: "Odesa" },
  "zaporizhzhia":   { lat: 47.84,  lng: 35.14,  name: "Zaporizhzhia" },
  "donetsk":        { lat: 48.00,  lng: 37.80,  name: "Donetsk" },
  "mariupol":       { lat: 47.10,  lng: 37.54,  name: "Mariupol" },
  "bakhmut":        { lat: 48.59,  lng: 38.00,  name: "Bakhmut" },
  "kherson":        { lat: 46.63,  lng: 32.62,  name: "Kherson" },
  "lviv":           { lat: 49.84,  lng: 24.03,  name: "Lviv" },
  "dnipro":         { lat: 48.46,  lng: 35.05,  name: "Dnipro" },
  "crimea":         { lat: 45.19,  lng: 34.00,  name: "Crimea" },
  "sevastopol":     { lat: 44.59,  lng: 33.52,  name: "Sevastopol" },
  "moscow":         { lat: 55.75,  lng: 37.62,  name: "Moscow" },
  "st. petersburg": { lat: 59.94,  lng: 30.32,  name: "St. Petersburg" },
  "st petersburg":  { lat: 59.94,  lng: 30.32,  name: "St. Petersburg" },
  "belgorod":       { lat: 50.60,  lng: 36.59,  name: "Belgorod" },
  "kaliningrad":    { lat: 54.71,  lng: 20.51,  name: "Kaliningrad" },
  "minsk":          { lat: 53.90,  lng: 27.57,  name: "Minsk" },
  "warsaw":         { lat: 52.23,  lng: 21.01,  name: "Warsaw" },
  "bucharest":      { lat: 44.43,  lng: 26.10,  name: "Bucharest" },
  "budapest":       { lat: 47.50,  lng: 19.04,  name: "Budapest" },
  "prague":         { lat: 50.08,  lng: 14.44,  name: "Prague" },
  "bratislava":     { lat: 48.15,  lng: 17.11,  name: "Bratislava" },
  "vilnius":        { lat: 54.69,  lng: 25.28,  name: "Vilnius" },
  "riga":           { lat: 56.95,  lng: 24.11,  name: "Riga" },
  "tallinn":        { lat: 59.44,  lng: 24.75,  name: "Tallinn" },
  "helsinki":       { lat: 60.17,  lng: 24.94,  name: "Helsinki" },
  "tbilisi":        { lat: 41.69,  lng: 44.83,  name: "Tbilisi" },
  "yerevan":        { lat: 40.18,  lng: 44.51,  name: "Yerevan" },
  "baku":           { lat: 40.41,  lng: 49.87,  name: "Baku" },
  "nagorno-karabakh": { lat: 39.82, lng: 46.76, name: "Nagorno-Karabakh" },
  // Asia-Pacific
  "beijing":        { lat: 39.91,  lng: 116.39, name: "Beijing" },
  "shanghai":       { lat: 31.23,  lng: 121.47, name: "Shanghai" },
  "hong kong":      { lat: 22.32,  lng: 114.17, name: "Hong Kong" },
  "taipei":         { lat: 25.05,  lng: 121.56, name: "Taipei" },
  "seoul":          { lat: 37.57,  lng: 126.98, name: "Seoul" },
  "pyongyang":      { lat: 39.02,  lng: 125.75, name: "Pyongyang" },
  "tokyo":          { lat: 35.69,  lng: 139.69, name: "Tokyo" },
  "osaka":          { lat: 34.69,  lng: 135.50, name: "Osaka" },
  "new delhi":      { lat: 28.61,  lng: 77.21,  name: "New Delhi" },
  "mumbai":         { lat: 19.08,  lng: 72.88,  name: "Mumbai" },
  "kolkata":        { lat: 22.57,  lng: 88.36,  name: "Kolkata" },
  "chennai":        { lat: 13.08,  lng: 80.27,  name: "Chennai" },
  "islamabad":      { lat: 33.72,  lng: 73.06,  name: "Islamabad" },
  "karachi":        { lat: 24.86,  lng: 67.01,  name: "Karachi" },
  "lahore":         { lat: 31.55,  lng: 74.34,  name: "Lahore" },
  "peshawar":       { lat: 34.01,  lng: 71.58,  name: "Peshawar" },
  "quetta":         { lat: 30.19,  lng: 67.01,  name: "Quetta" },
  "kabul":          { lat: 34.53,  lng: 69.17,  name: "Kabul" },
  "kandahar":       { lat: 31.62,  lng: 65.71,  name: "Kandahar" },
  "dhaka":          { lat: 23.81,  lng: 90.41,  name: "Dhaka" },
  "colombo":        { lat: 6.93,   lng: 79.86,  name: "Colombo" },
  "kathmandu":      { lat: 27.72,  lng: 85.32,  name: "Kathmandu" },
  "rangoon":        { lat: 16.87,  lng: 96.19,  name: "Yangon" },
  "yangon":         { lat: 16.87,  lng: 96.19,  name: "Yangon" },
  "naypyidaw":      { lat: 19.74,  lng: 96.12,  name: "Naypyidaw" },
  "bangkok":        { lat: 13.75,  lng: 100.52, name: "Bangkok" },
  "hanoi":          { lat: 21.03,  lng: 105.85, name: "Hanoi" },
  "ho chi minh":    { lat: 10.82,  lng: 106.63, name: "Ho Chi Minh City" },
  "jakarta":        { lat: -6.21,  lng: 106.85, name: "Jakarta" },
  "manila":         { lat: 14.60,  lng: 120.98, name: "Manila" },
  "kuala lumpur":   { lat: 3.14,   lng: 101.69, name: "Kuala Lumpur" },
  "singapore":      { lat: 1.35,   lng: 103.82, name: "Singapore" },
  "sydney":         { lat: -33.87, lng: 151.21, name: "Sydney" },
  "canberra":       { lat: -35.28, lng: 149.13, name: "Canberra" },
  // Africa
  "nairobi":        { lat: -1.29,  lng: 36.82,  name: "Nairobi" },
  "mogadishu":      { lat: 2.05,   lng: 45.34,  name: "Mogadishu" },
  "addis ababa":    { lat: 9.03,   lng: 38.74,  name: "Addis Ababa" },
  "khartoum":       { lat: 15.55,  lng: 32.53,  name: "Khartoum" },
  "omdurman":       { lat: 15.65,  lng: 32.48,  name: "Omdurman" },
  "juba":           { lat: 4.85,   lng: 31.60,  name: "Juba" },
  "asmara":         { lat: 15.34,  lng: 38.93,  name: "Asmara" },
  "djibouti":       { lat: 11.59,  lng: 43.15,  name: "Djibouti" },
  "kinshasa":       { lat: -4.32,  lng: 15.32,  name: "Kinshasa" },
  "lagos":          { lat: 6.52,   lng: 3.38,   name: "Lagos" },
  "abuja":          { lat: 9.07,   lng: 7.40,   name: "Abuja" },
  "accra":          { lat: 5.56,   lng: -0.21,  name: "Accra" },
  "dakar":          { lat: 14.72,  lng: -17.47, name: "Dakar" },
  "bamako":         { lat: 12.65,  lng: -8.00,  name: "Bamako" },
  "ouagadougou":    { lat: 12.37,  lng: -1.53,  name: "Ouagadougou" },
  "niamey":         { lat: 13.51,  lng: 2.12,   name: "Niamey" },
  "ndjamena":       { lat: 12.11,  lng: 15.04,  name: "N'Djamena" },
  "bangui":         { lat: 4.36,   lng: 18.56,  name: "Bangui" },
  "cape town":      { lat: -33.93, lng: 18.42,  name: "Cape Town" },
  "johannesburg":   { lat: -26.20, lng: 28.04,  name: "Johannesburg" },
  "harare":         { lat: -17.83, lng: 31.05,  name: "Harare" },
  "maputo":         { lat: -25.97, lng: 32.59,  name: "Maputo" },
  "luanda":         { lat: -8.84,  lng: 13.23,  name: "Luanda" },
  "dar es salaam":  { lat: -6.79,  lng: 39.21,  name: "Dar es Salaam" },
  "kampala":        { lat: 0.32,   lng: 32.58,  name: "Kampala" },
  "kigali":         { lat: -1.95,  lng: 30.06,  name: "Kigali" },
  // Europe
  "london":         { lat: 51.51,  lng: -0.13,  name: "London" },
  "paris":          { lat: 48.85,  lng: 2.35,   name: "Paris" },
  "berlin":         { lat: 52.52,  lng: 13.40,  name: "Berlin" },
  "brussels":       { lat: 50.85,  lng: 4.35,   name: "Brussels" },
  "madrid":         { lat: 40.42,  lng: -3.70,  name: "Madrid" },
  "barcelona":      { lat: 41.39,  lng: 2.16,   name: "Barcelona" },
  "seville":        { lat: 37.39,  lng: -5.98,  name: "Seville" },
  "valencia":       { lat: 39.47,  lng: -0.38,  name: "Valencia" },
  "bilbao":         { lat: 43.26,  lng: -2.93,  name: "Bilbao" },
  "rome":           { lat: 41.90,  lng: 12.50,  name: "Rome" },
  "milan":          { lat: 45.46,  lng: 9.19,   name: "Milan" },
  "naples":         { lat: 40.85,  lng: 14.27,  name: "Naples" },
  "florence":       { lat: 43.77,  lng: 11.25,  name: "Florence" },
  "turin":          { lat: 45.07,  lng: 7.69,   name: "Turin" },
  "amsterdam":      { lat: 52.37,  lng: 4.90,   name: "Amsterdam" },
  "rotterdam":      { lat: 51.92,  lng: 4.48,   name: "Rotterdam" },
  "stockholm":      { lat: 59.33,  lng: 18.07,  name: "Stockholm" },
  "gothenburg":     { lat: 57.71,  lng: 11.97,  name: "Gothenburg" },
  "oslo":           { lat: 59.91,  lng: 10.75,  name: "Oslo" },
  "copenhagen":     { lat: 55.68,  lng: 12.57,  name: "Copenhagen" },
  "vienna":         { lat: 48.21,  lng: 16.37,  name: "Vienna" },
  "bern":           { lat: 46.95,  lng: 7.45,   name: "Bern" },
  "zurich":         { lat: 47.38,  lng: 8.54,   name: "Zurich" },
  "geneva":         { lat: 46.20,  lng: 6.14,   name: "Geneva" },
  "munich":         { lat: 48.14,  lng: 11.58,  name: "Munich" },
  "frankfurt":      { lat: 50.11,  lng: 8.68,   name: "Frankfurt" },
  "hamburg":        { lat: 53.55,  lng: 9.99,   name: "Hamburg" },
  "cologne":        { lat: 50.94,  lng: 6.96,   name: "Cologne" },
  "düsseldorf":     { lat: 51.23,  lng: 6.78,   name: "Düsseldorf" },
  "dusseldorf":     { lat: 51.23,  lng: 6.78,   name: "Düsseldorf" },
  "lyon":           { lat: 45.76,  lng: 4.84,   name: "Lyon" },
  "marseille":      { lat: 43.30,  lng: 5.37,   name: "Marseille" },
  "toulouse":       { lat: 43.60,  lng: 1.44,   name: "Toulouse" },
  "nice":           { lat: 43.71,  lng: 7.26,   name: "Nice" },
  "strasbourg":     { lat: 48.57,  lng: 7.75,   name: "Strasbourg" },
  // Greece
  "athens":         { lat: 37.98,  lng: 23.73,  name: "Athens" },
  "thessaloniki":   { lat: 40.64,  lng: 22.94,  name: "Thessaloniki" },
  "patras":         { lat: 38.25,  lng: 21.73,  name: "Patras" },
  "heraklion":      { lat: 35.34,  lng: 25.13,  name: "Heraklion" },
  "larissa":        { lat: 39.64,  lng: 22.42,  name: "Larissa" },
  "volos":          { lat: 39.36,  lng: 22.94,  name: "Volos" },
  "ioannina":       { lat: 39.66,  lng: 20.85,  name: "Ioannina" },
  "piraeus":        { lat: 37.94,  lng: 23.65,  name: "Piraeus" },
  "rhodes":         { lat: 36.43,  lng: 28.22,  name: "Rhodes" },
  "corfu":          { lat: 39.62,  lng: 19.92,  name: "Corfu" },
  "crete":          { lat: 35.24,  lng: 24.47,  name: "Crete" },
  "lesbos":         { lat: 39.10,  lng: 26.55,  name: "Lesbos" },
  "samos":          { lat: 37.75,  lng: 26.97,  name: "Samos" },
  "chios":          { lat: 38.37,  lng: 26.14,  name: "Chios" },
  "alexandroupoli": { lat: 40.85,  lng: 25.87,  name: "Alexandroupoli" },
  "kavala":         { lat: 40.94,  lng: 24.40,  name: "Kavala" },
  "chania":         { lat: 35.51,  lng: 24.02,  name: "Chania" },
  // Balkans extended
  "belgrade":       { lat: 44.80,  lng: 20.46,  name: "Belgrade" },
  "zagreb":         { lat: 45.81,  lng: 15.98,  name: "Zagreb" },
  "sarajevo":       { lat: 43.85,  lng: 18.40,  name: "Sarajevo" },
  "pristina":       { lat: 42.67,  lng: 21.17,  name: "Pristina" },
  "skopje":         { lat: 41.99,  lng: 21.43,  name: "Skopje" },
  "tirana":         { lat: 41.33,  lng: 19.82,  name: "Tirana" },
  "podgorica":      { lat: 42.44,  lng: 19.26,  name: "Podgorica" },
  "sofia":          { lat: 42.70,  lng: 23.32,  name: "Sofia" },
  "plovdiv":        { lat: 42.15,  lng: 24.75,  name: "Plovdiv" },
  "chisinau":       { lat: 47.01,  lng: 28.86,  name: "Chișinău" },
  // Portugal
  "lisbon":         { lat: 38.72,  lng: -9.14,  name: "Lisbon" },
  "porto":          { lat: 41.16,  lng: -8.63,  name: "Porto" },
  // UK / Ireland
  "dublin":         { lat: 53.33,  lng: -6.25,  name: "Dublin" },
  "edinburgh":      { lat: 55.95,  lng: -3.19,  name: "Edinburgh" },
  "manchester":     { lat: 53.48,  lng: -2.24,  name: "Manchester" },
  "birmingham":     { lat: 52.49,  lng: -1.89,  name: "Birmingham" },
  "belfast":        { lat: 54.60,  lng: -5.93,  name: "Belfast" },
  "glasgow":        { lat: 55.86,  lng: -4.25,  name: "Glasgow" },
  // Nordics / Poland
  "gdansk":         { lat: 54.35,  lng: 18.65,  name: "Gdańsk" },
  "krakow":         { lat: 50.06,  lng: 19.94,  name: "Kraków" },
  "wroclaw":        { lat: 51.11,  lng: 17.04,  name: "Wrocław" },
  // Americas
  "washington":     { lat: 38.90,  lng: -77.03, name: "Washington D.C." },
  "washington d.c.": { lat: 38.90, lng: -77.03, name: "Washington D.C." },
  "new york":       { lat: 40.71,  lng: -74.01, name: "New York" },
  "los angeles":    { lat: 34.05,  lng: -118.24,name: "Los Angeles" },
  "chicago":        { lat: 41.88,  lng: -87.63, name: "Chicago" },
  "houston":        { lat: 29.76,  lng: -95.37, name: "Houston" },
  "san francisco":  { lat: 37.77,  lng: -122.42,name: "San Francisco" },
  "miami":          { lat: 25.76,  lng: -80.19, name: "Miami" },
  "atlanta":        { lat: 33.75,  lng: -84.39, name: "Atlanta" },
  "boston":          { lat: 42.36,  lng: -71.06, name: "Boston" },
  "seattle":        { lat: 47.61,  lng: -122.33,name: "Seattle" },
  "denver":         { lat: 39.74,  lng: -104.99,name: "Denver" },
  "dallas":         { lat: 32.78,  lng: -96.80, name: "Dallas" },
  "phoenix":        { lat: 33.45,  lng: -112.07,name: "Phoenix" },
  "detroit":        { lat: 42.33,  lng: -83.05, name: "Detroit" },
  "ottawa":         { lat: 45.42,  lng: -75.70, name: "Ottawa" },
  "toronto":        { lat: 43.70,  lng: -79.42, name: "Toronto" },
  "vancouver":      { lat: 49.28,  lng: -123.12,name: "Vancouver" },
  "montreal":       { lat: 45.50,  lng: -73.57, name: "Montreal" },
  "mexico city":    { lat: 19.43,  lng: -99.13, name: "Mexico City" },
  "guadalajara":    { lat: 20.67,  lng: -103.35,name: "Guadalajara" },
  "monterrey":      { lat: 25.69,  lng: -100.32,name: "Monterrey" },
  "tijuana":        { lat: 32.53,  lng: -117.02,name: "Tijuana" },
  "havana":         { lat: 23.14,  lng: -82.38, name: "Havana" },
  "bogota":         { lat: 4.71,   lng: -74.07, name: "Bogotá" },
  "medellin":       { lat: 6.25,   lng: -75.56, name: "Medellín" },
  "caracas":        { lat: 10.48,  lng: -66.88, name: "Caracas" },
  "lima":           { lat: -12.05, lng: -77.04, name: "Lima" },
  "quito":          { lat: -0.18,  lng: -78.47, name: "Quito" },
  "guayaquil":      { lat: -2.19,  lng: -79.89, name: "Guayaquil" },
  "buenos aires":   { lat: -34.61, lng: -58.38, name: "Buenos Aires" },
  "santiago":       { lat: -33.46, lng: -70.65, name: "Santiago" },
  "brasilia":       { lat: -15.78, lng: -47.93, name: "Brasília" },
  "sao paulo":      { lat: -23.55, lng: -46.63, name: "São Paulo" },
  "rio de janeiro": { lat: -22.91, lng: -43.17, name: "Rio de Janeiro" },
  "rio":            { lat: -22.91, lng: -43.17, name: "Rio de Janeiro" },
  "port-au-prince": { lat: 18.54,  lng: -72.34, name: "Port-au-Prince" },
  "panama city":    { lat: 8.98,   lng: -79.52, name: "Panama City" },
  "san juan":       { lat: 18.47,  lng: -66.11, name: "San Juan" },
  "santo domingo":  { lat: 18.47,  lng: -69.90, name: "Santo Domingo" },
  "managua":        { lat: 12.13,  lng: -86.25, name: "Managua" },
  "tegucigalpa":    { lat: 14.07,  lng: -87.19, name: "Tegucigalpa" },
  "san salvador":   { lat: 13.69,  lng: -89.22, name: "San Salvador" },
  "guatemala city": { lat: 14.63,  lng: -90.51, name: "Guatemala City" },
  "montevideo":     { lat: -34.88, lng: -56.16, name: "Montevideo" },
  "asuncion":       { lat: -25.26, lng: -57.58, name: "Asunción" },
  "la paz":         { lat: -16.49, lng: -68.12, name: "La Paz" },
  // Straits / regions
  "strait of hormuz": { lat: 26.60, lng: 56.40, name: "Strait of Hormuz" },
  "red sea":        { lat: 20.0,   lng: 38.0,   name: "Red Sea" },
  "black sea":      { lat: 43.0,   lng: 35.0,   name: "Black Sea" },
  "south china sea":{ lat: 15.0,   lng: 115.0,  name: "South China Sea" },
  "taiwan strait":  { lat: 24.5,   lng: 119.5,  name: "Taiwan Strait" },
  "baltic sea":     { lat: 58.0,   lng: 20.0,   name: "Baltic Sea" },
  "persian gulf":   { lat: 26.5,   lng: 51.5,   name: "Persian Gulf" },
  "gulf of aden":   { lat: 12.0,   lng: 47.0,   name: "Gulf of Aden" },
  "suez canal":     { lat: 30.58,  lng: 32.35,  name: "Suez Canal" },
  "bosporus":       { lat: 41.12,  lng: 29.08,  name: "Bosporus" },
  "hormuz":         { lat: 26.60,  lng: 56.40,  name: "Strait of Hormuz" },
  "mediterranean":  { lat: 35.0,   lng: 18.0,   name: "Mediterranean Sea" },
  "aegean":         { lat: 38.5,   lng: 25.0,   name: "Aegean Sea" },
  "adriatic":       { lat: 42.5,   lng: 16.0,   name: "Adriatic Sea" },
  "arctic":         { lat: 75.0,   lng: 0.0,    name: "Arctic" },
  // Native-script city names (for non-English headlines)
  // Greek
  "αθήνα":          { lat: 37.98,  lng: 23.73,  name: "Athens" },
  "θεσσαλονίκη":   { lat: 40.64,  lng: 22.94,  name: "Thessaloniki" },
  "πάτρα":          { lat: 38.25,  lng: 21.73,  name: "Patras" },
  "ηράκλειο":       { lat: 35.34,  lng: 25.13,  name: "Heraklion" },
  "πειραιάς":       { lat: 37.94,  lng: 23.65,  name: "Piraeus" },
  "λάρισα":         { lat: 39.64,  lng: 22.42,  name: "Larissa" },
  "κρήτη":          { lat: 35.24,  lng: 24.47,  name: "Crete" },
  "ρόδος":          { lat: 36.43,  lng: 28.22,  name: "Rhodes" },
  "κέρκυρα":        { lat: 39.62,  lng: 19.92,  name: "Corfu" },
  "χανιά":          { lat: 35.51,  lng: 24.02,  name: "Chania" },
  "βόλος":          { lat: 39.36,  lng: 22.94,  name: "Volos" },
  "ιωάννινα":       { lat: 39.66,  lng: 20.85,  name: "Ioannina" },
  "αλεξανδρούπολη": { lat: 40.85,  lng: 25.87,  name: "Alexandroupoli" },
  "χεζμπολάχ":      { lat: 33.89,  lng: 35.50,  name: "Beirut" },
  // Arabic
  "بغداد":          { lat: 33.34,  lng: 44.40,  name: "Baghdad" },
  "دمشق":           { lat: 33.51,  lng: 36.29,  name: "Damascus" },
  "بيروت":          { lat: 33.89,  lng: 35.50,  name: "Beirut" },
  "القاهرة":        { lat: 30.04,  lng: 31.24,  name: "Cairo" },
  "الرياض":         { lat: 24.69,  lng: 46.72,  name: "Riyadh" },
  "طهران":          { lat: 35.69,  lng: 51.39,  name: "Tehran" },
  "غزة":            { lat: 31.52,  lng: 34.47,  name: "Gaza" },
  "القدس":          { lat: 31.78,  lng: 35.22,  name: "Jerusalem" },
  "صنعاء":          { lat: 15.37,  lng: 44.19,  name: "Sanaa" },
  "الخرطوم":        { lat: 15.55,  lng: 32.53,  name: "Khartoum" },
  "طرابلس":         { lat: 32.90,  lng: 13.18,  name: "Tripoli" },
  "حلب":            { lat: 36.20,  lng: 37.16,  name: "Aleppo" },
  "إدلب":           { lat: 35.93,  lng: 36.63,  name: "Idlib" },
  "الموصل":         { lat: 36.34,  lng: 43.13,  name: "Mosul" },
  // Russian / Cyrillic
  "москва":         { lat: 55.75,  lng: 37.62,  name: "Moscow" },
  "киев":           { lat: 50.45,  lng: 30.52,  name: "Kyiv" },
  "київ":           { lat: 50.45,  lng: 30.52,  name: "Kyiv" },
  "харків":         { lat: 49.99,  lng: 36.23,  name: "Kharkiv" },
  "харьков":        { lat: 49.99,  lng: 36.23,  name: "Kharkiv" },
  "одеса":          { lat: 46.48,  lng: 30.72,  name: "Odesa" },
  "донецьк":        { lat: 48.00,  lng: 37.80,  name: "Donetsk" },
  "донецк":         { lat: 48.00,  lng: 37.80,  name: "Donetsk" },
  "минск":          { lat: 53.90,  lng: 27.57,  name: "Minsk" },
  "белгород":       { lat: 50.60,  lng: 36.59,  name: "Belgorod" },
  "санкт-петербург": { lat: 59.94, lng: 30.32,  name: "St. Petersburg" },
  // Chinese
  "北京":            { lat: 39.91,  lng: 116.39, name: "Beijing" },
  "上海":            { lat: 31.23,  lng: 121.47, name: "Shanghai" },
  "台北":            { lat: 25.05,  lng: 121.56, name: "Taipei" },
  "香港":            { lat: 22.32,  lng: 114.17, name: "Hong Kong" },
  // Japanese
  "東京":            { lat: 35.69,  lng: 139.69, name: "Tokyo" },
  "大阪":            { lat: 34.69,  lng: 135.50, name: "Osaka" },
  // Korean
  "서울":            { lat: 37.57,  lng: 126.98, name: "Seoul" },
  "평양":            { lat: 39.02,  lng: 125.75, name: "Pyongyang" },
  // Turkish
  "İstanbul":       { lat: 41.01,  lng: 28.98,  name: "Istanbul" },
  // Spanish-language city names
  "ciudad de méxico": { lat: 19.43, lng: -99.13, name: "Mexico City" },
  "nueva york":     { lat: 40.71,  lng: -74.01, name: "New York" },
  // Portuguese
  "são paulo":      { lat: -23.55, lng: -46.63, name: "São Paulo" },
  "rio de janeiro": { lat: -22.91, lng: -43.17, name: "Rio de Janeiro" },
  // Hindi / Devanagari
  "दिल्ली":          { lat: 28.61,  lng: 77.21,  name: "New Delhi" },
  "मुंबई":           { lat: 19.08,  lng: 72.88,  name: "Mumbai" },
  // Hebrew
  "תל אביב":        { lat: 32.09,  lng: 34.78,  name: "Tel Aviv" },
  "ירושלים":        { lat: 31.78,  lng: 35.22,  name: "Jerusalem" },
  // Hezbollah / organisation-as-location (maps to HQ area)
  "hezbollah":      { lat: 33.86,  lng: 35.51,  name: "Beirut" },
  "hamas":          { lat: 31.52,  lng: 34.47,  name: "Gaza" },
  "houthi":         { lat: 15.37,  lng: 44.19,  name: "Sanaa" },
  "houthis":        { lat: 15.37,  lng: 44.19,  name: "Sanaa" },
  "kremlin":        { lat: 55.75,  lng: 37.62,  name: "Moscow" },
  "pentagon":       { lat: 38.87,  lng: -77.06, name: "Washington D.C." },
  "nato":           { lat: 50.88,  lng: 4.43,   name: "Brussels" },
  "wagner":         { lat: 55.75,  lng: 37.62,  name: "Moscow" },
  // Myanmar conflict zones
  "mandalay":       { lat: 21.97,  lng: 96.08,  name: "Mandalay" },
  "lashio":         { lat: 22.93,  lng: 97.75,  name: "Lashio" },
  "myitkyina":      { lat: 25.38,  lng: 97.40,  name: "Myitkyina" },
  "sagaing":        { lat: 21.88,  lng: 95.98,  name: "Sagaing" },
  "chin state":     { lat: 22.0,   lng: 93.6,   name: "Chin State" },
  // DRC conflict zones
  "goma":           { lat: -1.68,  lng: 29.22,  name: "Goma" },
  "bukavu":         { lat: -2.49,  lng: 28.86,  name: "Bukavu" },
  "beni":           { lat: 0.49,   lng: 29.47,  name: "Beni" },
  "bunia":          { lat: 1.56,   lng: 30.25,  name: "Bunia" },
  // Sudan/South Sudan
  "darfur":         { lat: 13.5,   lng: 24.0,   name: "Darfur" },
  "el fasher":      { lat: 13.63,  lng: 25.35,  name: "El Fasher" },
  "malakal":        { lat: 9.53,   lng: 31.66,  name: "Malakal" },
  "bentiu":         { lat: 9.25,   lng: 29.82,  name: "Bentiu" },
  // Sahel
  "timbuktu":       { lat: 16.77,  lng: -3.01,  name: "Timbuktu" },
  "gao":            { lat: 16.27,  lng: -0.04,  name: "Gao" },
  "mopti":          { lat: 14.49,  lng: -4.19,  name: "Mopti" },
  "agadez":         { lat: 16.97,  lng: 7.99,   name: "Agadez" },
  "kidal":          { lat: 18.44,  lng: 1.41,   name: "Kidal" },
  "ménaka":         { lat: 15.92,  lng: 2.40,   name: "Ménaka" },
  // Ethiopia conflict zones
  "mekelle":        { lat: 13.50,  lng: 39.47,  name: "Mekelle" },
  "tigray":         { lat: 14.0,   lng: 38.5,   name: "Tigray" },
  "gondar":         { lat: 12.60,  lng: 37.47,  name: "Gondar" },
  "bahir dar":      { lat: 11.59,  lng: 37.39,  name: "Bahir Dar" },
  // CAR
  "bangui":         { lat: 4.36,   lng: 18.56,  name: "Bangui" },
  "bossangoa":      { lat: 6.49,   lng: 17.45,  name: "Bossangoa" },
  // Mozambique
  "pemba":          { lat: -13.0,  lng: 40.5,   name: "Pemba" },
  "mocímboa":       { lat: -11.35, lng: 40.35,  name: "Mocímboa da Praia" },
  // Kashmir / South Asia border
  "srinagar":       { lat: 34.09,  lng: 74.80,  name: "Srinagar" },
  "leh":            { lat: 34.16,  lng: 77.58,  name: "Leh" },
  "muzaffarabad":   { lat: 34.37,  lng: 73.47,  name: "Muzaffarabad" },
  // Central Asia
  "tashkent":       { lat: 41.30,  lng: 69.25,  name: "Tashkent" },
  "bishkek":        { lat: 42.87,  lng: 74.59,  name: "Bishkek" },
  "dushanbe":       { lat: 38.56,  lng: 68.78,  name: "Dushanbe" },
  "ashgabat":       { lat: 37.95,  lng: 58.38,  name: "Ashgabat" },
  "almaty":         { lat: 43.24,  lng: 76.89,  name: "Almaty" },
  "nur-sultan":     { lat: 51.18,  lng: 71.45,  name: "Astana" },
  "astana":         { lat: 51.18,  lng: 71.45,  name: "Astana" },
  // Pacific / maritime chokepoints
  "luzon":          { lat: 16.0,   lng: 121.0,  name: "Luzon" },
  "mindanao":       { lat: 8.0,    lng: 125.0,  name: "Mindanao" },
  "spratly":        { lat: 10.5,   lng: 114.5,  name: "Spratly Islands" },
  "scarborough":    { lat: 15.2,   lng: 117.7,  name: "Scarborough Shoal" },
  "okinawa":        { lat: 26.5,   lng: 128.0,  name: "Okinawa" },
  "guam":           { lat: 13.5,   lng: 144.8,  name: "Guam" },
  // Key org/institution mappings
  "iaea":           { lat: 48.21,  lng: 16.37,  name: "Vienna" },
  "icc":            { lat: 52.09,  lng: 4.30,   name: "The Hague" },
  "un security council": { lat: 40.75, lng: -73.97, name: "New York" },
  "interpol":       { lat: 45.77,  lng: 4.85,   name: "Lyon" },
};

/**
 * Extract the best location from a news article title and sourcecountry.
 * Returns { lat, lng, name } or null.
 * Priority: city/place match in title > Nominatim-cached lookup > country capital
 */

// Persistent Nominatim geocode cache — survives page reloads
const _GEO_CACHE_KEY = "ge-geocache-v1";
let _nominatimGeoCache = (() => {
  try { return JSON.parse(localStorage.getItem(_GEO_CACHE_KEY) || "{}"); }
  catch(e) { return {}; }
})();
function _saveGeoCache() {
  try { localStorage.setItem(_GEO_CACHE_KEY, JSON.stringify(_nominatimGeoCache)); } catch(e) {}
}

// Rate-limited async enrichment — geocodes unknown place names via Nominatim,
// stores results in _nominatimGeoCache for future synchronous use.
const _enrichQueue = new Set();
async function enrichGeoCache(placeName) {
  if (!placeName || _enrichQueue.has(placeName) || _nominatimGeoCache[placeName]) return;
  _enrichQueue.add(placeName);
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(placeName)}&format=json&limit=1&addressdetails=0`;
    const resp = await nominatimFetch(url);
    if (!resp.ok) return;
    const results = await resp.json();
    if (Array.isArray(results) && results.length > 0) {
      const r = results[0];
      _nominatimGeoCache[placeName] = { lat: parseFloat(r.lat), lng: parseFloat(r.lon), name: r.display_name.split(",")[0] };
      _saveGeoCache();
    }
  } catch(e) { /* non-critical */ } finally {
    _enrichQueue.delete(placeName);
  }
}

function resolveArticleGeo(article) {
  const title = (article?.title || "").toLowerCase();
  const country = (article?.country || "").toLowerCase().trim();

  // 1. Scan title for known city/place names (longest match wins)
  let bestMatch = null;
  let bestLen = 0;
  for (const [key, coords] of Object.entries(CITY_COORDS)) {
    if (key.length > bestLen && title.includes(key)) {
      bestMatch = coords;
      bestLen = key.length;
    }
  }
  if (bestMatch) {
    return {
      lat: bestMatch.lat + (Math.random() - 0.5) * 0.3,
      lng: bestMatch.lng + (Math.random() - 0.5) * 0.3,
      name: bestMatch.name
    };
  }

  // 2. Check Nominatim persistent cache (filled async from previous lookups)
  if (country && _nominatimGeoCache[country]) {
    const c = _nominatimGeoCache[country];
    return { lat: c.lat + (Math.random() - 0.5) * 0.5, lng: c.lng + (Math.random() - 0.5) * 0.5, name: c.name };
  }

  // 3. Fall back to country capital coords (already city-level)
  if (!country) return null;
  const coords = COUNTRY_COORDS[country];
  if (coords) {
    // Fire async enrichment for countries not in our city dict — result cached for next time
    if (!COUNTRY_COORDS[country] || !CITY_COORDS[country]) enrichGeoCache(article.country);
    return {
      lat: coords.lat + (Math.random() - 0.5) * 1.5,
      lng: coords.lng + (Math.random() - 0.5) * 1.5,
      name: article.country
    };
  }

  // 4. Last resort: fire Nominatim and return null this time (will succeed next spawn)
  enrichGeoCache(article.country || title.split(" ").slice(0, 3).join(" "));
  return null;
}

const dynamic = {
  trails:      [],
  zones:       [],
  incidents:   [],
  traffic:     [],
  rings:       [],
  radars:      [],
  liveTraffic: [],
  eventVisuals: [],
  connectionLines: []
};

let frameSamples = [];
let _consolePulseTimer = null;
let _throughputBytes = 0;
let _ambientUpdateTimer = null;
let eventVisualSpawnTimer = null;
let eventVisualPruneTimer = null;
let eventVisualLabelTimer = null;
let threatUpdateTimer = null;

// Global Nominatim rate limiter (≤1 request per second)
let _lastNominatimMs = 0;
async function nominatimFetch(url) {
  const now = Date.now();
  const wait = Math.max(0, 1050 - (now - _lastNominatimMs));
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  _lastNominatimMs = Date.now();
  return fetch(url, {
    headers: { "Accept-Language": "en-US,en", "User-Agent": "GodsEye/1.0 intelligence-dashboard" }
  });
}

// Use open imagery (OpenStreetMap) to avoid Cesium Ion token requirement in sandboxed preview
Cesium.Ion.defaultAccessToken = "";

const viewer = new Cesium.Viewer("cesiumContainer", {
  animation:            false,
  timeline:             false,
  baseLayerPicker:      false,
  geocoder:             false,
  homeButton:           false,
  sceneModePicker:      false,
  navigationHelpButton: false,
  fullscreenButton:     false,
  infoBox:              false,
  selectionIndicator:   false,
  requestRenderMode:    false,
  shouldAnimate:        false,
  terrain:              undefined,
  baseLayer:            false   // disable default Ion WorldImagery; add OSM manually below
});
// Manually add an OSM imagery layer (no Ion token required)
try {
  viewer.imageryLayers.removeAll();
  viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    credit: "© OpenStreetMap contributors",
    maximumLevel: 19
  }));
} catch (err) {
  console.warn("OSM imagery init failed:", err);
}

const postStages = {
  blackAndWhite: Cesium.PostProcessStageLibrary.createBlackAndWhiteStage(),
  brightness:    Cesium.PostProcessStageLibrary.createBrightnessStage()
};
const bloomStage = viewer.scene.postProcessStages.bloom;
viewer.scene.postProcessStages.add(postStages.blackAndWhite);
viewer.scene.postProcessStages.add(postStages.brightness);
viewer.scene.postProcessStages.fxaa.enabled = true;
if (bloomStage) {
  bloomStage.enabled = true;
  bloomStage.uniforms.glowOnly = false;
}
viewer.scene.globe.enableLighting          = true;
viewer.scene.globe.nightFadeOutDistance    = 1e7;
viewer.scene.globe.nightFadeInDistance     = 5e6;
viewer.scene.skyAtmosphere.show            = true;
viewer.scene.skyAtmosphere.hueShift        = -0.05;
viewer.scene.skyAtmosphere.saturationShift = 0.12;
viewer.scene.skyAtmosphere.brightnessShift = -0.08;
viewer.scene.globe.atmosphereLightIntensity = 6.0;
viewer.scene.globe.showGroundAtmosphere    = true;
viewer.scene.globe.depthTestAgainstTerrain = false;
viewer.clock.shouldAnimate                 = false;
viewer.resolutionScale                     = Math.min(window.devicePixelRatio || 1, 1.6);

// ── Performance tuning ────────────────────────────────────────────────────────
viewer.scene.globe.maximumScreenSpaceError = 2.5;   // default 2; slightly fewer tiles = faster
viewer.scene.globe.tileCacheSize           = 120;   // cap tile memory usage
viewer.scene.globe.preloadAncestors        = false; // skip preloading parent tiles
viewer.scene.fog.density                   = 0.0001;// lighter fog = fewer GPU passes
viewer.scene.msaaSamples                   = 1;     // disable MSAA (expensive on globe scenes)

// Adaptive resolution — backs off when FPS drops below 28, recovers when stable above 50
const _targetResScale = Math.min(window.devicePixelRatio || 1, 1.6);
let   _resScaleCooldown = 0;
function adaptResolutionScale(fps) {
  _resScaleCooldown = Math.max(0, _resScaleCooldown - 1);
  if (_resScaleCooldown > 0) return;
  if (fps < 28 && viewer.resolutionScale > 0.8) {
    viewer.resolutionScale = Math.max(0.8, viewer.resolutionScale - 0.15);
    _resScaleCooldown = 20;
  } else if (fps > 50 && viewer.resolutionScale < _targetResScale) {
    viewer.resolutionScale = Math.min(_targetResScale, viewer.resolutionScale + 0.05);
    _resScaleCooldown = 30;
  }
}

// AbortSignal.timeout polyfill for browsers that don't support it yet
if (typeof AbortSignal !== "undefined" && !AbortSignal.timeout) {
  AbortSignal.timeout = (ms) => {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(new DOMException("TimeoutError", "TimeoutError")), ms);
    return ctrl.signal;
  };
}

const homeView = Cesium.Cartesian3.fromDegrees(
  STARTUP_VIEW.lng,
  STARTUP_VIEW.lat,
  STARTUP_VIEW.height
);
// Start zoomed out for dramatic entry, then fly in
viewer.camera.setView({
  destination: Cesium.Cartesian3.fromDegrees(STARTUP_VIEW.lng, STARTUP_VIEW.lat, 28000000),
  orientation: {
    heading: STARTUP_VIEW.heading,
    pitch:   -1.57,
    roll:    STARTUP_VIEW.roll
  }
});
// Animate zoom-in after 500ms delay
setTimeout(() => {
  viewer.camera.flyTo({
    destination: homeView,
    orientation: {
      heading: STARTUP_VIEW.heading,
      pitch:   STARTUP_VIEW.pitch,
      roll:    STARTUP_VIEW.roll
    },
    duration: 3.0,
    easingFunction: Cesium.EasingFunction.QUARTIC_IN_OUT
  });
}, 500);

cacheElements();
startBootIntro();
initializeNarrativeState();
applyFxMode(state.fxMode);
applyFxIntensity();
applyGlow();
applyDeclutterMode();
applyDensityMode();
renderMetricCluster();
renderBasemapButtons();
renderLayerToggles();
renderLegend();
renderCameraPresets();
renderBookmarks();
renderSavedLayouts();
renderFxButtons();
installBasemap(state.basemapId);
seedScene();
renderFeedStatus();
renderTrustIndicators();
registerEvents();
updateSummaryHint();
updateOperationsControls();
elements.btnSpin.classList.toggle("active", state.spinning);
startHudClock();
startWallClock();
renderEventRail();
startNarrativeTicker();
scheduleRefresh();
refreshLiveFeeds();
initNewsPanel();
startLocationHud();
initDraggablePanels();
ensureMobilePanelVisibility();
initPingCanvas();
initCinematicUi();
initHeaderToggle();
viewer.scene.requestRender();

function initializeNarrativeState() {
  SCENARIO.alerts.forEach(alert => {
    state.alertNarrativeIndexes[alert.id] = 0;
  });
  SCENARIO.incidents.forEach(incident => {
    state.incidentNarrativeIndexes[incident.id] = 0;
  });
}

function getRotatingNarrative(item, indexMap, textKey) {
  const updates = Array.isArray(item?.updates) ? item.updates : [];
  const fallback = {
    title: item?.title,
    [textKey]: item?.[textKey],
    sourceLabel: item?.sourceLabel,
    sourceUrl: item?.sourceUrl,
    publishedAt: "Live rolling brief"
  };
  if (!updates.length) return fallback;
  const index = indexMap[item.id] ?? 0;
  const active = updates[index] ?? updates[0];
  return {
    title: active.title ?? fallback.title,
    [textKey]: active[textKey] ?? fallback[textKey],
    sourceLabel: active.sourceLabel ?? fallback.sourceLabel,
    sourceUrl: active.sourceUrl ?? fallback.sourceUrl,
    publishedAt: active.publishedAt ?? fallback.publishedAt
  };
}

function getActiveAlertNarrative(alert) {
  return getRotatingNarrative(alert, state.alertNarrativeIndexes, "summary");
}

function getActiveIncidentNarrative(incident) {
  return getRotatingNarrative(incident, state.incidentNarrativeIndexes, "description");
}

function findScenarioIncidentById(incidentId) {
  return SCENARIO.incidents.find(incident => incident.id === incidentId) ?? null;
}

function tickNarratives() {
  SCENARIO.alerts.forEach(alert => {
    const updateCount = Array.isArray(alert.updates) ? alert.updates.length : 0;
    if (!updateCount) return;
    state.alertNarrativeIndexes[alert.id] = ((state.alertNarrativeIndexes[alert.id] ?? 0) + 1) % updateCount;
  });

  SCENARIO.incidents.forEach(incident => {
    const updateCount = Array.isArray(incident.updates) ? incident.updates.length : 0;
    if (!updateCount) return;
    state.incidentNarrativeIndexes[incident.id] = ((state.incidentNarrativeIndexes[incident.id] ?? 0) + 1) % updateCount;
  });

  renderEventRail(true);

  const selectedType = state.selectedEntity?.properties?.entityType?.getValue?.(viewer.clock.currentTime);
  if (selectedType === "incident" || selectedType === "alert") {
    updateSelectedEntityCard(state.selectedEntity);
    if (state.intelSheetOpen) openIntelSheet(state.selectedEntity);
  }
}

function startNarrativeTicker() {
  if (state.narrativeTimer) window.clearInterval(state.narrativeTimer);
  state.narrativeTimer = window.setInterval(() => {
    tickNarratives();
  }, 12000);
}

function cacheElements() {
  Object.assign(elements, {
    metricCluster:       document.getElementById("metric-cluster"),
    basemapButtons:      document.getElementById("basemap-buttons"),
    layerToggles:        document.getElementById("layer-toggles"),
    cameraPresets:       document.getElementById("camera-presets"),
    bookmarkList:        document.getElementById("bookmark-list"),
    saveBookmark:        document.getElementById("save-bookmark"),
    clearBookmarks:      document.getElementById("clear-bookmarks"),
    layoutList:          document.getElementById("layout-list"),
    saveLayout:          document.getElementById("save-layout"),
    clearLayouts:        document.getElementById("clear-layouts"),
    fxModeButtons:       document.getElementById("fx-mode-buttons"),
    fxIntensity:         document.getElementById("fx-intensity"),
    fxIntensityValue:    document.getElementById("fx-intensity-value"),
    fxGlow:              document.getElementById("fx-glow"),
    fxGlowValue:         document.getElementById("fx-glow-value"),
    refreshInterval:     document.getElementById("refresh-interval"),
    refreshIntervalVal:  document.getElementById("refresh-interval-value"),
    entityInfo:          document.getElementById("entity-info"),
    trackSelected:       document.getElementById("track-selected"),
    releaseTrack:        document.getElementById("release-track"),
    eventRail:           document.getElementById("event-rail"),
    opsNextHotspot:      document.getElementById("ops-next-hotspot"),
    opsRandomTrack:      document.getElementById("ops-random-track"),
    opsOpenIntel:        document.getElementById("ops-open-intel"),
    opsBriefFocus:       document.getElementById("ops-brief-focus"),
    opsTourToggle:       document.getElementById("ops-tour-toggle"),
    opsBrief:            document.getElementById("ops-brief"),
    opsBriefTitle:       document.getElementById("ops-brief-title"),
    opsBriefCopy:        document.getElementById("ops-brief-copy"),
    opsBriefMeta:        document.getElementById("ops-brief-meta"),
    summaryStage:        document.getElementById("summary-stage"),
    summaryTime:         document.getElementById("summary-time"),
    summaryCopy:         document.getElementById("summary-copy"),
    summaryTags:         document.getElementById("summary-tags"),
    summaryHotspot:      document.getElementById("summary-hotspot"),
    summaryRandom:       document.getElementById("summary-random"),
    summaryNews:         document.getElementById("summary-news"),
    summaryGuide:        document.getElementById("summary-guide"),
    summaryHint:         document.getElementById("summary-hint"),
    hudStatusMode:       document.getElementById("hud-status-mode"),
    hudTrackCount:       document.getElementById("hud-track-count"),
    hudAlertCount:       document.getElementById("hud-alert-count"),
    liveRegionLabel:     document.getElementById("live-region-label"),
    liveLastRefresh:     document.getElementById("live-last-refresh"),
    liveNextRefresh:     document.getElementById("live-next-refresh"),
    refreshNow:          document.getElementById("refresh-now"),
    btnFullscreen:       document.getElementById("btn-fullscreen"),
    searchInput:         document.getElementById("search-input"),
    searchButton:        document.getElementById("search-btn"),
    searchResults:       document.getElementById("search-results"),
    searchMeta:          document.getElementById("search-meta"),
    legendItems:         document.getElementById("legend-items"),
    legendUpdated:       document.getElementById("legend-updated"),
    trustIndicators:     document.getElementById("trust-indicators"),
    trustSummary:        document.getElementById("trust-summary"),
    hoverTooltip:        document.getElementById("hover-tooltip"),
    mobileDrawers:       document.getElementById("mobile-drawers"),
    mobileBackdrop:      document.getElementById("mobile-backdrop"),
    btnMobileLayers:     document.getElementById("btn-mobile-layers"),
    btnMobileControls:   document.getElementById("btn-mobile-controls"),
    btnMobileIntel:      document.getElementById("btn-mobile-intel"),
    btnMobileSignals:    document.getElementById("btn-mobile-signals"),
    feedStatus:          document.getElementById("feed-status"),
    refreshFeeds:        document.getElementById("refresh-feeds"),
    aisEndpoint:         document.getElementById("ais-endpoint"),
    saveAisEndpoint:     document.getElementById("save-ais-endpoint"),
    clearAisEndpoint:    document.getElementById("clear-ais-endpoint"),
    testAisEndpoint:     document.getElementById("test-ais-endpoint"),
    feedHint:            document.getElementById("feed-hint"),
    intelSheet:          document.getElementById("intel-sheet"),
    closeIntelSheet:     document.getElementById("close-intel-sheet"),
    intelSheetKicker:    document.getElementById("intel-sheet-kicker"),
    intelSheetTitle:     document.getElementById("intel-sheet-title"),
    intelSheetOverview:  document.getElementById("intel-sheet-overview"),
    intelSheetTelemetry: document.getElementById("intel-sheet-telemetry"),
    intelSheetAssessment:document.getElementById("intel-sheet-assessment"),
    intelSheetTimeline:  document.getElementById("intel-sheet-timeline"),
    intelSourceBar:      document.getElementById("intel-sheet-source-bar"),
    intelSourceLink:     document.getElementById("intel-source-link"),
    btnTranslateIntel:   document.getElementById("btn-translate-intel"),
    intelSheetHandle:    document.getElementById("intel-sheet-handle"),
    hudUtc:              document.getElementById("hud-utc"),
    hudLocal:            document.getElementById("hud-local"),
    hudFps:              document.getElementById("hud-fps"),
    hudCamera:           document.getElementById("hud-camera"),
    hudStatusText:       document.getElementById("hud-status-text"),
    btnGuide:            document.getElementById("btn-guide"),
    btnDeclutter:        document.getElementById("btn-declutter"),
    btnDensity:          document.getElementById("btn-density"),
    btnHome:             document.getElementById("btn-home"),
    btnTilt:             document.getElementById("btn-tilt"),
    btnSpin:             document.getElementById("btn-spin"),
    locationHud:         document.getElementById("location-hud"),
    locLabel:            document.getElementById("loc-label"),
    locDetail:           document.getElementById("loc-detail"),
    locCoords:           document.getElementById("loc-coords"),
    locMeta:             document.getElementById("loc-meta"),
    bootOverlay:         document.getElementById("boot-overlay"),
    bootProgressFill:    document.getElementById("boot-progress-fill"),
    bootStatus:          document.getElementById("boot-status"),
    consoleFrame:        document.querySelector(".console-frame"),
    pingCanvas:          document.getElementById("ping-canvas"),
    clickLocPopup:       document.getElementById("click-location-popup"),
    clpClose:            document.getElementById("clp-close"),
    clpFlag:             document.getElementById("clp-flag"),
    clpCountry:          document.getElementById("clp-country"),
    clpRegion:           document.getElementById("clp-region"),
    clpCoordsPopup:      document.getElementById("clp-coords-popup"),
    clpLoading:          document.getElementById("clp-loading"),
    clickConflictBox:    document.getElementById("click-conflict-box"),
    ccbClose:            document.getElementById("ccb-close"),
    ccbTitle:            document.getElementById("ccb-title"),
    ccbList:             document.getElementById("ccb-list"),
    missionGuide:        document.getElementById("mission-guide"),
    missionGuideKicker:  document.getElementById("mission-guide-kicker"),
    missionGuideTitle:   document.getElementById("mission-guide-title"),
    missionGuideProgress:document.getElementById("mission-guide-progress"),
    missionGuideBody:    document.getElementById("mission-guide-body"),
    missionGuideClose:   document.getElementById("mission-guide-close"),
    missionGuideSkip:    document.getElementById("mission-guide-skip"),
    missionGuidePrev:    document.getElementById("mission-guide-prev"),
    missionGuideNext:    document.getElementById("mission-guide-next"),
    liveNewsHeadline:    document.getElementById("live-news-headline"),
    newsBriefing:        document.getElementById("news-briefing"),
    newsCards:           document.getElementById("news-cards"),
    newsCatNav:          document.getElementById("news-cat-nav"),
    newsUpdated:         document.getElementById("news-updated"),
    newsRefreshBtn:      document.getElementById("news-refresh"),
    newsCloseBtn:        document.getElementById("news-close"),
    newsToggleBtn:       document.getElementById("btn-news-toggle"),
    newsBadge:           document.getElementById("news-badge"),
    threatSegments:      document.getElementById("threat-segments"),
    threatValue:         document.getElementById("threat-value"),
    throughputBars:      document.getElementById("throughput-bars"),
    throughputValue:     document.getElementById("throughput-value"),
    sigAdsb:             document.getElementById("sig-adsb"),
    sigNews:             document.getElementById("sig-news"),
    sigAis:              document.getElementById("sig-ais")
  });

  if (elements.fxIntensity)    elements.fxIntensity.value   = String(state.fxIntensity);
  if (elements.fxGlow)         elements.fxGlow.value        = String(state.fxGlow);
  if (elements.refreshInterval) elements.refreshInterval.value = String(state.refreshIntervalSec);
  if (elements.aisEndpoint)    elements.aisEndpoint.value   = getConfiguredAisEndpoint();
  syncMobileActionButtons();
}

function loadJson(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

function saveJson(key, value) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

function normalizeBookmarks(bookmarks) {
  const source = Array.isArray(bookmarks) && bookmarks.length ? bookmarks : DEFAULT_BOOKMARKS;
  return source.map(bookmark => ({
    ...bookmark,
    system: bookmark.system ?? SYSTEM_BOOKMARK_IDS.has(bookmark.id)
  }));
}

function createDefaultPanelState() {
  const defaults = {
    "panel-layers": { hidden: false, minimized: false },
    "panel-right": { hidden: false, minimized: true },
    "floating-summary": { hidden: false, minimized: true },
    "map-legend": { hidden: true, minimized: true }
  };
  return Object.fromEntries(PANEL_IDS.map(id => [id, defaults[id] ?? { hidden: false, minimized: false }]));
}

function loadPanelStateWithVersion() {
  const storedVersion = loadJson(UI_STORAGE_KEYS.panelStateVersion, 0);
  if (storedVersion < PANEL_STATE_VERSION) {
    // Version mismatch — reset to clean defaults and save new version
    const fresh = createDefaultPanelState();
    saveJson(UI_STORAGE_KEYS.panelState, fresh);
    saveJson(UI_STORAGE_KEYS.panelStateVersion, PANEL_STATE_VERSION);
    return fresh;
  }
  return loadJson(UI_STORAGE_KEYS.panelState, createDefaultPanelState());
}

function normalizePanelState(panelState) {
  return PANEL_IDS.reduce((accumulator, id) => {
    const current = panelState?.[id] ?? {};
    accumulator[id] = {
      hidden: !!current.hidden,
      minimized: !!current.minimized
    };
    return accumulator;
  }, {});
}

function savePanelState() {
  state.panelState = normalizePanelState(state.panelState);
  saveJson(UI_STORAGE_KEYS.panelState, state.panelState);
  saveJson(UI_STORAGE_KEYS.panelStateVersion, PANEL_STATE_VERSION);
}

function getPanelState(panelId) {
  const defaultState = createDefaultPanelState()[panelId] ?? { hidden: false, minimized: false };
  state.panelState[panelId] ??= { ...defaultState };
  return state.panelState[panelId];
}

function getManagedPanel(panelId) {
  return document.getElementById(panelId);
}

function setPanelHidden(panelId, hidden) {
  const panel = getManagedPanel(panelId);
  if (!panel) return;
  getPanelState(panelId).hidden = hidden;
  panel.classList.toggle("panel-hidden", hidden);
  savePanelState();
}

function setPanelMinimized(panelId, minimized) {
  const panel = getManagedPanel(panelId);
  if (!panel) return;
  getPanelState(panelId).minimized = minimized;
  panel.classList.toggle("panel-minimized", minimized);
  const button = panel.querySelector(`[data-minimize-panel="${panelId}"]`);
  if (button) button.textContent = minimized ? "+" : "—";
  savePanelState();
}

function applyStoredPanelState() {
  state.panelState = normalizePanelState(state.panelState);
  PANEL_IDS.forEach(panelId => {
    const panel = getManagedPanel(panelId);
    const current = getPanelState(panelId);
    if (!panel) return;
    panel.classList.toggle("panel-hidden", current.hidden);
    panel.classList.toggle("panel-minimized", current.minimized);
    const button = panel.querySelector(`[data-minimize-panel="${panelId}"]`);
    if (button) button.textContent = current.minimized ? "+" : "—";
  });
  sanitizePanelPositions();
  refreshPanelRestoreStrip();
}

function ensureMobilePanelVisibility() {
  if (window.innerWidth > 980) return;

  let changed = false;
  ["floating-summary", "map-legend"].forEach(panelId => {
    const panel = getManagedPanel(panelId);
    const current = getPanelState(panelId);
    if (!panel) return;
    if (current.hidden) {
      current.hidden = false;
      panel.classList.remove("panel-hidden");
      changed = true;
    }
    if (current.minimized) {
      current.minimized = false;
      panel.classList.remove("panel-minimized");
      const button = panel.querySelector(`[data-minimize-panel="${panelId}"]`);
      if (button) button.textContent = "—";
      changed = true;
    }
  });

  if (changed) savePanelState();
  refreshPanelRestoreStrip();
}

function sanitizePanelPositions() {
  if (window.innerWidth <= 980) return;
  const minTop = 118;
  document.querySelectorAll(".draggable-panel").forEach(panel => {
    if (!(panel instanceof HTMLElement)) return;
    if (panel.classList.contains("panel-hidden")) return;
    const rect = panel.getBoundingClientRect();
    if (rect.top >= minTop) return;
    panel.style.position = "fixed";
    panel.style.left = `${Math.max(12, rect.left)}px`;
    panel.style.top = `${minTop}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
    panel.style.transform = "none";
  });
}

function captureCameraDestination() {
  const cg = Cesium.Cartographic.fromCartesian(viewer.camera.positionWC);
  return {
    lng: Cesium.Math.toDegrees(cg.longitude),
    lat: Cesium.Math.toDegrees(cg.latitude),
    height: cg.height,
    heading: viewer.camera.heading,
    pitch: viewer.camera.pitch,
    roll: viewer.camera.roll
  };
}

function flyToDestination(destination, complete, duration = 1.8) {
  // ── Surgical zoom: blur UI and zoom camera simultaneously ──
  document.body.classList.add("surgical-zoom");
  sfx.zoom();
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(destination.lng, destination.lat, destination.height),
    orientation: {
      heading: destination.heading,
      pitch: destination.pitch,
      roll: destination.roll
    },
    duration,
    easingFunction: Cesium.EasingFunction.QUADRATIC_IN_OUT,
    complete() {
      document.body.classList.remove("surgical-zoom");
      document.body.classList.add("surgical-zoom-landing");
      setTimeout(() => document.body.classList.remove("surgical-zoom-landing"), 600);
      if (complete) complete();
    }
  });
}

function renderCameraPresets() {
  if (!elements.cameraPresets) return;
  elements.cameraPresets.innerHTML = CAMERA_PRESETS.map(preset => `
    <button type="button" class="camera-preset-btn" data-preset-id="${preset.id}">
      <span>${preset.label}</span>
      <small>${preset.kicker}</small>
    </button>
  `).join("");
  elements.cameraPresets.querySelectorAll(".camera-preset-btn").forEach(button => {
    button.addEventListener("click", () => {
      const preset = CAMERA_PRESETS.find(item => item.id === button.dataset.presetId);
      if (!preset) return;
      state.regionFocus = preset.regionFocus ?? null;
      flyToDestination(preset.destination, () => {
        if (preset.regionFocus) applyRegionalContext(preset.regionFocus, preset.destination.lng, preset.destination.lat);
      }, 2.1);
    });
  });
}

function captureLayoutSnapshot(name) {
  return {
    id: `layout-${Date.now()}`,
    name,
    savedAt: Date.now(),
    panelState: normalizePanelState(state.panelState),
    panelPositions: Object.fromEntries(PANEL_IDS.map(id => {
      const panel = getManagedPanel(id);
      return [id, panel ? {
        position: panel.style.position || "",
        left: panel.style.left || "",
        top: panel.style.top || "",
        right: panel.style.right || "",
        bottom: panel.style.bottom || "",
        transform: panel.style.transform || ""
      } : {}];
    })),
    camera: captureCameraDestination(),
    ui: {
      declutter: state.declutter,
      compact: state.compact,
      basemapId: state.basemapId,
      fxMode: state.fxMode
    }
  };
}

function saveCurrentLayout() {
  const layout = captureLayoutSnapshot(`Layout ${state.savedLayouts.length + 1}`);
  state.savedLayouts = [layout, ...state.savedLayouts].slice(0, 8);
  saveJson(UI_STORAGE_KEYS.layouts, state.savedLayouts);
  renderSavedLayouts();
}

function applyLayout(layoutId) {
  const layout = state.savedLayouts.find(item => item.id === layoutId);
  if (!layout) return;
  state.panelState = normalizePanelState(layout.panelState);
  PANEL_IDS.forEach(id => {
    const panel = getManagedPanel(id);
    const pos = layout.panelPositions?.[id];
    if (!panel || !pos) return;
    panel.style.position = pos.position || "";
    panel.style.left = pos.left || "";
    panel.style.top = pos.top || "";
    panel.style.right = pos.right || "";
    panel.style.bottom = pos.bottom || "";
    panel.style.transform = pos.transform || "";
  });
  applyStoredPanelState();
  state.declutter = !!layout.ui?.declutter;
  state.compact = !!layout.ui?.compact;
  applyDeclutterMode();
  applyDensityMode();
  if (layout.ui?.basemapId) installBasemap(layout.ui.basemapId);
  if (layout.ui?.fxMode) {
    state.fxMode = layout.ui.fxMode;
    applyFxMode(state.fxMode);
    renderFxButtons();
  }
  if (layout.camera) flyToDestination(layout.camera, undefined, 2.2);
}

function removeLayout(layoutId) {
  state.savedLayouts = state.savedLayouts.filter(item => item.id !== layoutId);
  saveJson(UI_STORAGE_KEYS.layouts, state.savedLayouts);
  renderSavedLayouts();
}

function renderSavedLayouts() {
  if (!elements.layoutList) return;
  if (!state.savedLayouts.length) {
    elements.layoutList.innerHTML = `<div class="layout-empty">No saved layouts yet.</div>`;
    return;
  }
  elements.layoutList.innerHTML = state.savedLayouts.map(layout => `
    <div class="layout-item">
      <button type="button" class="layout-launch" data-layout-id="${layout.id}">
        <span>${layout.name}</span>
        <small>${new Date(layout.savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small>
      </button>
      <button type="button" class="layout-remove" data-layout-remove="${layout.id}">✕</button>
    </div>
  `).join("");
  elements.layoutList.querySelectorAll(".layout-launch").forEach(button => {
    button.addEventListener("click", () => applyLayout(button.dataset.layoutId));
  });
  elements.layoutList.querySelectorAll(".layout-remove").forEach(button => {
    button.addEventListener("click", () => removeLayout(button.dataset.layoutRemove));
  });
}

function renderMissionGuide() {
  if (!elements.missionGuideBody || !elements.missionGuideProgress) return;
  const step = MISSION_GUIDE_STEPS[state.onboardingStep] ?? MISSION_GUIDE_STEPS[0];
  if (elements.missionGuideKicker) elements.missionGuideKicker.textContent = step.kicker;
  if (elements.missionGuideTitle) elements.missionGuideTitle.textContent = step.title;

  elements.missionGuideProgress.innerHTML = MISSION_GUIDE_STEPS.map((item, index) => `
    <button type="button" class="mission-guide-dot${index === state.onboardingStep ? " active" : ""}" data-guide-step="${index}" aria-label="Go to step ${index + 1}: ${escapeHtml(item.title)}"></button>
  `).join("");

  elements.missionGuideBody.innerHTML = `
    <p class="mission-guide-lead">${step.lead}</p>
    <div class="mission-guide-sections">
      ${step.sections.map(section => `
        <section class="mission-guide-section">
          <h3>${section.title}</h3>
          <ul>
            ${section.items.map(item => `<li>${item}</li>`).join("")}
          </ul>
        </section>
      `).join("")}
    </div>
    <div class="mission-guide-actions">
      ${step.actions.map(action => `<button type="button" class="panel-btn mission-guide-action" data-guide-action="${action.id}">${action.label}</button>`).join("")}
    </div>
  `;

  elements.missionGuideBody.querySelectorAll("[data-guide-action]").forEach(button => {
    button.addEventListener("click", () => executeMissionGuideAction(button.dataset.guideAction));
  });
  elements.missionGuideProgress.querySelectorAll("[data-guide-step]").forEach(button => {
    button.addEventListener("click", () => {
      state.onboardingStep = Number(button.dataset.guideStep) || 0;
      renderMissionGuide();
    });
  });

  if (elements.missionGuidePrev) elements.missionGuidePrev.disabled = state.onboardingStep === 0;
  if (elements.missionGuideNext) {
    elements.missionGuideNext.textContent = state.onboardingStep === MISSION_GUIDE_STEPS.length - 1 ? "Finish" : "Next";
  }
}

function openMissionGuide(step = 0) {
  if (!elements.missionGuide) return;
  if (window.innerWidth <= 980) setMobileDrawer(null);
  state.onboardingStep = clamp(step, 0, MISSION_GUIDE_STEPS.length - 1);
  renderMissionGuide();
  elements.missionGuide.classList.remove("hidden");
  elements.missionGuide.setAttribute("aria-hidden", "false");
  document.body.classList.add("mission-guide-open");
}

function closeMissionGuide(markSeen = true) {
  if (!elements.missionGuide) return;
  elements.missionGuide.classList.add("hidden");
  elements.missionGuide.setAttribute("aria-hidden", "true");
  document.body.classList.remove("mission-guide-open");
  if (markSeen) {
    state.onboardingSeen = true;
    saveJson(UI_STORAGE_KEYS.onboardingSeen, true);
  }
  updateSummaryHint();
}

function updateSummaryHint() {
  if (!elements.summaryHint) return;
  if (!state.onboardingSeen) {
    elements.summaryHint.textContent = "Start with Search or Hotspot. Guide stays available if you want a walkthrough.";
    return;
  }
  if (window.innerWidth <= 980) {
    elements.summaryHint.textContent = "Use Layers, Control, and Intel at the bottom to move through the map quickly.";
    return;
  }
  elements.summaryHint.textContent = "Search, jump to a hotspot, or click the globe to inspect a region.";
}

function stepMissionGuide(direction) {
  const nextStep = state.onboardingStep + direction;
  if (nextStep >= MISSION_GUIDE_STEPS.length) {
    closeMissionGuide(true);
    return;
  }
  state.onboardingStep = clamp(nextStep, 0, MISSION_GUIDE_STEPS.length - 1);
  renderMissionGuide();
}

function executeMissionGuideAction(actionId) {
  if (!actionId) return;
  switch (actionId) {
    case "hotspot":
      focusNextHotspot();
      break;
    case "brief":
      createFocusBrief();
      break;
    case "search-gulf":
      if (elements.searchInput) elements.searchInput.value = "Gulf";
      runSearch("Gulf");
      break;
    case "random-track":
      focusRandomTrack();
      break;
    case "intel":
      if (state.selectedEntity) openIntelSheet(state.selectedEntity);
      else setOpsBrief("Nothing Selected", "Pick a track or jump to a hotspot first, then open intel from there.", "Select something first");
      break;
    case "save-layout":
      saveCurrentLayout();
      break;
    case "tour":
      if (!state.opsTourTimer) toggleAlertTour();
      break;
    case "open-news":
      openNewsPanel();
      break;
    case "save-view":
      saveCurrentBookmark();
      break;
    case "home":
      flyToDestination({
        lng: SCENARIO.initialView.lng,
        lat: SCENARIO.initialView.lat,
        height: SCENARIO.initialView.height,
        heading: SCENARIO.initialView.heading,
        pitch: SCENARIO.initialView.pitch,
        roll: SCENARIO.initialView.roll
      }, undefined, 1.8);
      break;
    default:
      return;
  }
  closeMissionGuide(false);
}

function nowJulian() {
  return Cesium.JulianDate.fromDate(new Date());
}

function startWallClock() {
  window.setInterval(() => {
    viewer.clock.currentTime = nowJulian();
    updateHudFrame();
    updateAmbientEffects();
    updateSelectedEntityCard(state.selectedEntity);
    updateLiveMetrics();
    updateZones();
    updateIncidents();
    if (state.spinning && performance.now() >= state.spinPausedUntil && !state.trackedEntity) {
      viewer.scene.camera.rotate(Cesium.Cartesian3.UNIT_Z, Cesium.Math.toRadians(0.012));
    }
    viewer.scene.requestRender();
  }, 200);
}

function scheduleRefresh() {
  if (state.refreshTimer) window.clearInterval(state.refreshTimer);
  state.nextRefreshAt = Date.now() + state.refreshIntervalSec * 1000;
  updateRefreshCountdown();
  renderTrustIndicators();
  state.refreshTimer = window.setInterval(() => {
    state.nextRefreshAt = Date.now() + state.refreshIntervalSec * 1000;
    refreshLiveFeeds();
  }, state.refreshIntervalSec * 1000);
}

function renderMetricCluster() {
  const metrics = [
    { key: "tracks", label: "Tracks",  value: "\u2014", foot: "Live traffic" },
    { key: "alerts", label: "Alerts",  value: "\u2014", foot: "Active zones" },
    { key: "orbits", label: "Orbit",   value: "\u2014", foot: "Overhead passes" },
    { key: "feeds",  label: "Feeds",   value: "\u2014", foot: "Data sources live" }
  ];
  elements.metricCluster.innerHTML = metrics.map(m => `
    <article class="metric-card" data-metric="${m.key}">
      <span class="metric-label">${m.label}</span>
      <strong class="metric-value counting-value">${m.value}</strong>
      <span class="metric-foot">${m.foot}</span>
      <div class="metric-sparkline" data-sparkline="${m.key}"></div>
    </article>
  `).join("");
}

function updateMetricCard(key, value, foot) {
  const card = elements.metricCluster.querySelector(`[data-metric="${key}"]`);
  if (!card) return;
  const v = card.querySelector(".metric-value");
  const f = card.querySelector(".metric-foot");
  if (v) {
    const oldVal = parseInt(v.textContent, 10);
    const newVal = parseInt(value, 10);
    if (!isNaN(oldVal) && !isNaN(newVal) && oldVal !== newVal) {
      animateCountTo(v, oldVal, newVal, 600);
    } else {
      v.textContent = String(value);
    }
  }
  if (f) f.textContent = foot;
  updateSparkline(key, typeof value === "number" ? value : parseInt(value, 10) || 0);
}

function renderFeedStatus() {
  if (!elements.feedStatus) return;
  const feeds = [state.liveFeeds.adsb, state.liveFeeds.ais];
  elements.feedStatus.innerHTML = feeds.map(feed => `
    <article class="feed-card ${feed.status}">
      <div class="feed-card-head">
        <strong>${feed.source}</strong>
        <span>${feed.status.toUpperCase()}</span>
      </div>
      <p>${feed.message}</p>
      <small>${feed.updatedAt ? new Date(feed.updatedAt).toLocaleTimeString([], { hour12: false }) : "Not yet refreshed"}</small>
    </article>
  `).join("");
}

function renderTrustIndicators() {
  if (!elements.trustIndicators) return;

  const adsbStatus = state.liveFeeds.adsb.status === "live" ? "live" : state.liveFeeds.adsb.status === "error" ? "error" : "pending";
  const aisStatus = state.liveFeeds.ais.status === "live"
    ? "live"
    : state.liveFeeds.ais.status === "config-required"
      ? "config"
      : state.liveFeeds.ais.status === "error"
        ? "error"
        : "pending";
  const refreshStatus = state.nextRefreshAt ? "active" : "pending";

  const indicators = [
    { label: "ADS-B",     value: state.liveFeeds.adsb.status.toUpperCase(), status: adsbStatus },
    { label: "AIS",       value: state.liveFeeds.ais.status.toUpperCase(),  status: aisStatus },
    { label: "UTC Sync",  value: "LOCKED", status: "verified" },
    { label: "Refresh",   value: `${state.refreshIntervalSec}s`, status: refreshStatus }
  ];

  elements.trustIndicators.innerHTML = indicators.map(indicator =>
    `<span class="trust-pill ${indicator.status}">${indicator.label} · ${indicator.value}</span>`
  ).join("");

  if (!elements.trustSummary) return;
  const liveCount = [state.liveFeeds.adsb, state.liveFeeds.ais].filter(feed => feed.status === "live").length;
  const confidence = liveCount === 2 ? "High" : liveCount === 1 ? "Moderate" : "Limited";
  elements.trustSummary.textContent = `Source confidence: ${confidence}. Geospatial index and UTC sync are active.`;
}

function renderLegend() {
  if (!elements.legendItems) return;
  elements.legendItems.innerHTML = LAYERS.map(layer => {
    const active = !!state.layers[layer.id];
    return `
      <div class="legend-item ${active ? "" : "inactive"}">
        <span class="legend-swatch" style="background:${layer.color}"></span>
        <span>${layer.label}</span>
        <span class="legend-state">${active ? "ON" : "OFF"}</span>
      </div>
    `;
  }).join("");

  if (elements.legendUpdated) {
    elements.legendUpdated.textContent = `Layer key · ${new Date().toUTCString().slice(17, 25)} UTC`;
  }
}

function applyDeclutterMode() {
  document.body.classList.toggle("declutter-ui", state.declutter);
  state.declutter ? sfx.toggleOn() : sfx.toggleOff();
  if (elements.btnDeclutter) {
    elements.btnDeclutter.classList.toggle("active", state.declutter);
    elements.btnDeclutter.textContent = state.declutter ? "FOCUS ON" : "FOCUS";
  }
  saveJson(UI_STORAGE_KEYS.declutter, state.declutter);
}

function applyDensityMode() {
  document.body.classList.toggle("compact-ui", state.compact);
  state.compact ? sfx.toggleOn() : sfx.toggleOff();
  if (elements.btnDensity) {
    elements.btnDensity.classList.toggle("active", state.compact);
    elements.btnDensity.textContent = state.compact ? "COMPACT ON" : "COMPACT";
  }
  saveJson(UI_STORAGE_KEYS.compact, state.compact);
}

function renderBasemapButtons() {
  elements.basemapButtons.innerHTML = "";
  BASEMAPS.forEach(basemap => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `basemap-btn${state.basemapId === basemap.id ? " active" : ""}`;
    btn.textContent = basemap.label;
    btn.addEventListener("click", () => installBasemap(basemap.id));
    elements.basemapButtons.appendChild(btn);
  });
}

function renderLayerToggles() {
  elements.layerToggles.innerHTML = "";
  LAYERS.forEach(layer => {
    const active = !!state.layers[layer.id];
    const row = document.createElement("button");
    row.type = "button";
    row.className = `layer-toggle${active ? " active" : ""}`;
    row.dataset.layerId = layer.id;
    let count = 0;
    try {
      const entities = viewer?.entities?.values;
      if (entities) {
        for (const e of entities) {
          if (e.properties?.layerId?.getValue?.() === layer.id) count++;
        }
      }
    } catch { /* */ }
    const badge = count > 0 ? `<span class="layer-count">${count}</span>` : "";
    row.innerHTML = `
      <span class="layer-copy">
        <span class="layer-name">${layer.label}${badge}</span>
        <span class="layer-description">${layer.description}</span>
      </span>
      <span class="layer-switch">${active ? "ON" : "OFF"}</span>
    `;
    row.addEventListener("click", () => {
      state.layers[layer.id] = !state.layers[layer.id];
      saveJson(STORAGE_KEYS.layers, state.layers);
      renderLayerToggles();
      renderLegend();
      refreshEntityVisibility();
    });
    elements.layerToggles.appendChild(row);
  });
}

function renderBookmarks() {
  elements.bookmarkList.innerHTML = "";
  state.bookmarks.forEach(bookmark => {
    const row = document.createElement("div");
    row.className = "bookmark-item";
    const removable = !bookmark.system;
    row.innerHTML = `
      <button type="button" class="bookmark-launch">
        <span>${bookmark.label}</span>
        <small>${bookmark.system ? "SYSTEM PRESET" : "SAVED VIEW"}</small>
      </button>
      ${removable ? `<button type="button" data-remove="${bookmark.id}">✕</button>` : `<span class="bookmark-badge">SYS</span>`}
    `;
    row.firstElementChild.addEventListener("click", () => flyToBookmark(bookmark));
    if (removable) row.lastElementChild.addEventListener("click", () => removeBookmark(bookmark.id));
    elements.bookmarkList.appendChild(row);
  });
}

function renderFxButtons() {
  elements.fxModeButtons.innerHTML = "";
  FX_MODES.forEach(mode => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `fx-btn${state.fxMode === mode.id ? " active" : ""}`;
    btn.textContent = mode.label;
    btn.addEventListener("click", () => {
      state.fxMode = mode.id;
      saveJson(STORAGE_KEYS.fxMode, state.fxMode);
      applyFxMode(mode.id);
      renderFxButtons();
    });
    elements.fxModeButtons.appendChild(btn);
  });
}

function renderEventRail(animate = false) {
  const existing = new Map(
    Array.from(elements.eventRail.querySelectorAll(".event-item")).map(button => [button.dataset.alertId, button])
  );

  SCENARIO.alerts.forEach(alert => {
    let btn = existing.get(alert.id);
    if (!btn) {
      btn = document.createElement("button");
      btn.type = "button";
      btn.className = "event-item";
      btn.dataset.alertId = alert.id;
      btn.addEventListener("click", () => focusAlert(alert));
      elements.eventRail.appendChild(btn);
    }

    const narrative = getActiveAlertNarrative(alert);
    const sourceText = narrative.publishedAt ? escapeHtml(narrative.publishedAt) : "Live rolling brief";
    const sourceLabel = narrative.sourceLabel ? escapeHtml(narrative.sourceLabel) : "Operational source";
    const sourceLink = narrative.sourceUrl
      ? `<a class="event-source-link" href="${escapeHtml(narrative.sourceUrl)}" target="_blank" rel="noopener noreferrer">${sourceLabel} ↗</a>`
      : `<span class="event-source-label">${sourceLabel}</span>`;

    btn.innerHTML = `
      <span class="event-minute">${escapeHtml(alert.region)}</span>
      <span class="event-title">${escapeHtml(narrative.title ?? alert.title)}</span>
      <span class="event-summary">${escapeHtml(narrative.summary ?? alert.summary)}</span>
      <span class="event-source-row">
        <span class="event-source-time">${sourceText}</span>
        ${sourceLink}
      </span>
    `;

    btn.querySelectorAll(".event-source-link").forEach(link => {
      link.addEventListener("click", event => event.stopPropagation());
    });

    if (animate) {
      btn.classList.remove("updating");
      void btn.offsetWidth;
      btn.classList.add("updating");
    }
  });
}

function setOpsBrief(title, copy, meta = "Quick actions") {
  if (elements.opsBriefTitle) elements.opsBriefTitle.textContent = title;
  if (elements.opsBriefCopy) elements.opsBriefCopy.textContent = copy;
  if (elements.opsBriefMeta) elements.opsBriefMeta.textContent = meta;
  if (elements.opsBrief) {
    elements.opsBrief.classList.remove("is-updating");
    void elements.opsBrief.offsetWidth;
    elements.opsBrief.classList.add("is-updating");
  }
}

function updateOperationsControls() {
  if (elements.opsOpenIntel) elements.opsOpenIntel.disabled = !state.selectedEntity;
  if (elements.opsTourToggle) {
    const active = !!state.opsTourTimer;
    elements.opsTourToggle.classList.toggle("active", active);
    elements.opsTourToggle.textContent = active ? "Stop Tour" : "Tour Alerts";
  }
}

function focusAlert(alert) {
  if (!alert) return;
  pausePassiveSpin(7000);
  const activeNarrative = getActiveAlertNarrative(alert);
  const activeTitle = activeNarrative.title ?? alert.title;
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(alert.location.lng, alert.location.lat, 2600000),
    duration: 1.8,
    complete: () => applyRegionalContext(activeTitle, alert.location.lng, alert.location.lat)
  });
  setOpsBrief(
    activeTitle,
    activeNarrative.summary ?? alert.summary,
    `${alert.region} · ${activeNarrative.publishedAt ?? "Live rolling brief"}`
  );
}

function focusNextHotspot() {
  // Combine scenario alerts with live geo events for richer cycling
  const geoEvents = dynamic.eventVisuals.filter(v => v.geoSpawned && v.lng != null);
  const combinedCount = SCENARIO.alerts.length + geoEvents.length;
  if (!combinedCount) return;

  const idx = state.opsHotspotIndex % combinedCount;
  state.opsHotspotIndex = (state.opsHotspotIndex + 1) % combinedCount;

  if (idx < SCENARIO.alerts.length) {
    focusAlert(SCENARIO.alerts[idx]);
  } else {
    const ev = geoEvents[idx - SCENARIO.alerts.length];
    if (ev) {
      pausePassiveSpin(7000);
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(ev.lng, ev.lat, 1200000),
        duration: 1.5
      });
    }
  }
}

function focusRandomTrack() {
  const candidates = [...dynamic.liveTraffic, ...dynamic.traffic].filter(entity => entity?.show !== false && entity?.position);
  if (!candidates.length) {
    setOpsBrief("No Tracks Right Now", "There are not any active tracks to inspect at the moment.", "Waiting for refresh");
    return;
  }
  const entity = candidates[Math.floor(Math.random() * candidates.length)];
  const info = getEntityInfo(entity);
  const coords = getEntityLngLat(entity);
  if (!info || !coords) return;
  pausePassiveSpin(7000);
  state.selectedEntity = entity;
  updateSelectedEntityCard(entity);
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(coords.lng, coords.lat, info.type.startsWith("live-") ? 1600000 : 2000000),
    duration: 1.6,
    complete: () => applyRegionalContext(info.label, coords.lng, coords.lat)
  });
  setOpsBrief(info.label, info.description || "A track from the current scene.", `${info.type.toUpperCase()} · ${info.locationMeta}`);
}

function createFocusBrief() {
  const now = new Date().toUTCString().slice(17, 25);
  if (state.selectedEntity) {
    const info = getEntityInfo(state.selectedEntity);
    if (info) {
      setOpsBrief(
        `${info.label} Brief`,
        `${info.type.toUpperCase()} at ${info.locationMeta}. ${info.description || "Still visible in the current scene."}`,
        `ALT ${Math.round(info.altitude).toLocaleString()} m · ${now} UTC`
      );
      return;
    }
  }
  if (state.regionFocus) {
    setOpsBrief(
      `${state.regionFocus.label} Brief`,
      state.regionFocus.summary,
      `${state.regionFocus.tracks} tracks · ${state.regionFocus.alerts} alerts · ${now} UTC`
    );
    return;
  }
  const liveCount = [state.liveFeeds.adsb, state.liveFeeds.ais].filter(feed => feed.status === "live").length;
  setOpsBrief(
    "Global Brief",
    `The scene currently shows ${dynamic.traffic.length + dynamic.liveTraffic.length} tracked assets and ${SCENARIO.alerts.length + SCENARIO.incidents.length} alerts or incidents in the scenario layer.`,
    `${liveCount} live feeds online · ${now} UTC`
  );
}

function toggleAlertTour() {
  if (state.opsTourTimer) {
    window.clearInterval(state.opsTourTimer);
    state.opsTourTimer = null;
    updateOperationsControls();
    setOpsBrief("Tour Paused", "You can keep exploring manually, or step through hotspots one at a time.", "Tour off");
    return;
  }
  focusNextHotspot();
  state.opsTourTimer = window.setInterval(() => {
    focusNextHotspot();
  }, 9000);
  updateOperationsControls();
  setOpsBrief("Tour Running", "Cycling through hotspots every 9 seconds.", "Tour on");
}

function minuteToRealJulian(offsetMinutes) {
  return Cesium.JulianDate.addMinutes(nowJulian(), offsetMinutes - SCENARIO.durationMinutes / 2, new Cesium.JulianDate());
}

function seedScene() {
  const commercial = [...SCENARIO.flights.commercial, ...generateVariants(SCENARIO.flights.commercial, "COM", 1, 0.9, 0.5)];
  const military   = [...SCENARIO.flights.military,   ...generateVariants(SCENARIO.flights.military,   "MIL", 1, 0.45, 0.28)];
  const maritime   = [...SCENARIO.maritime,            ...generateVariants(SCENARIO.maritime,           "SEA", 1, 0.35, 0.22)];
  createTrafficEntities(commercial,          "commercial", Cesium.Color.fromCssColorString("#7ee0ff"), 3600 * 8);
  createTrafficEntities(military,            "military",   Cesium.Color.fromCssColorString("#ffbe5c"), 3600 * 12, 9);
  createTrafficEntities(SCENARIO.satellites, "satellites", Cesium.Color.fromCssColorString("#af9dff"), 3600 * 24, 8);
  createTrafficEntities(maritime,            "maritime",   Cesium.Color.fromCssColorString("#60f7bf"), 3600 * 24, 7);
  createZones();
  initIncidentPool(); // pick random global subset from INCIDENT_POOL before creating entities
  createIncidents();
}

function generateVariants(items, prefix, count, lngDrift, latDrift) {
  return items.flatMap((item, i) => Array.from({ length: count }, (_, v) => {
    const d = i + v + 1;
    return {
      ...item,
      id:          `${item.id}-${prefix.toLowerCase()}-${v + 1}`,
      label:       `${prefix}-${String(d).padStart(2, "0")}`,
      description: `${item.description} Auxiliary model track.`,
      showLabel:   false,
      positions:   item.positions.map((pt, pi) => ({
        ...pt,
        lng:    pt.lng + Math.sin((pi + 1) * 0.8 + d) * lngDrift,
        lat:    pt.lat + Math.cos((pi + 1) * 0.6 + d) * latDrift,
        minute: clamp(pt.minute + v, 0, SCENARIO.durationMinutes)
      }))
    };
  }));
}

function createTrafficEntities(items, layerId, color, trailTime, pixelSize = 9) {
  items.forEach(item => {
    const position = new Cesium.SampledPositionProperty();
    item.positions.forEach(pt => {
      position.addSample(
        minuteToRealJulian(pt.minute),
        Cesium.Cartesian3.fromDegrees(pt.lng, pt.lat, pt.altitude ?? item.altitude ?? 0)
      );
    });
    position.setInterpolationOptions({
      interpolationDegree: 2,
      interpolationAlgorithm: Cesium.LagrangePolynomialApproximation
    });

    const entity = viewer.entities.add({
      id: item.id,
      position,
      point: {
        pixelSize,
        color,
        outlineColor: color.brighten(0.4, new Cesium.Color()).withAlpha(0.85),
        outlineWidth: layerId === "military" ? 3 : layerId === "satellites" ? 2.5 : 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new Cesium.NearFarScalar(1.5e5, 1.6, 1.5e7, 0.8),
        translucencyByDistance: new Cesium.NearFarScalar(5.0e5, 1.0, 2.0e7, 0.5)
      },
      path: {
        show:       true,
        width:      layerId === "satellites" ? 1.6 : 2.3,
        material:   color.withAlpha(layerId === "satellites" ? 0.5 : 0.8),
        trailTime,
        leadTime:   0,
        resolution: 120
      },
      label: item.showLabel === false ? undefined : {
        text: item.label,
        font: '12px "Share Tech Mono"',
        fillColor:        Cesium.Color.WHITE,
        showBackground:   true,
        backgroundColor:  Cesium.Color.fromCssColorString("rgba(5,12,23,0.75)"),
        horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
        pixelOffset:      new Cesium.Cartesian2(12, -10),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scale: 0.85,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 18000000)
      },
      properties: {
        layerId,
        label:       item.label,
        description: item.description,
        entityType:  layerId,
        altitude:    item.altitude ?? 0,
        synthetic:   item.showLabel === false
      }
    });
    entity._basePixelSize = pixelSize;
    entity._pulseSeed     = Math.random() * Math.PI * 2;
    entity._layerColor    = color;
    dynamic.traffic.push(entity);
    if (layerId === "military") createRadarSweep(entity, color);
  });
}

function destinationPoint(latDeg, lngDeg, distanceMeters, bearingDeg) {
  const d   = distanceMeters / 6378137;
  const brg = Cesium.Math.toRadians(bearingDeg);
  const lat = Cesium.Math.toRadians(latDeg);
  const lng = Cesium.Math.toRadians(lngDeg);
  const tLat = Math.asin(Math.sin(lat) * Math.cos(d) + Math.cos(lat) * Math.sin(d) * Math.cos(brg));
  const tLng = lng + Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(lat), Math.cos(d) - Math.sin(lat) * Math.sin(tLat));
  return { lat: Cesium.Math.toDegrees(tLat), lng: Cesium.Math.toDegrees(tLng) };
}

function resolveEventRegionKey(lng, lat) {
  if (lng >= 43 && lng <= 62 && lat >= 22 && lat <= 38) return "gulf";
  if (lng >= 125 && lng <= 170 && lat >= 15 && lat <= 45) return "pacific";
  if (lng >= 44 && lng <= 58 && lat >= 30 && lat <= 40) return "theater";
  if (lng >= -10 && lng <= 35 && lat >= 35 && lat <= 60) return "europe";
  return null;
}

function resolveEventVisualStyle(kind, lng, lat) {
  const base = EVENT_VISUAL_STYLES[kind] ?? EVENT_VISUAL_STYLES.alert;
  const regionKey = resolveEventRegionKey(lng, lat);
  const override = regionKey ? EVENT_REGION_OVERRIDES[regionKey] : null;
  if (!override) return base;
  return {
    ...base,
    ...override
  };
}

function pickEventSource() {
  // Fallback pool from scenario data (used when no live geo articles available)
  const weighted = [
    ...SCENARIO.alerts.map(item => ({ kind: "alert", source: item, weight: 2 })),
    ...SCENARIO.incidents.map(item => ({ kind: "incident", source: item, weight: 3 }))
  ];
  if (!weighted.length) return null;

  const pool = [];
  weighted.forEach(item => {
    for (let i = 0; i < item.weight; i += 1) pool.push(item);
  });

  if (state.regionFocus?.label) {
    const camCarto = Cesium.Cartographic.fromCartesian(viewer.camera.positionWC);
    const camLat = Cesium.Math.toDegrees(camCarto.latitude);
    const camLng = Cesium.Math.toDegrees(camCarto.longitude);
    const focused = pool.filter(item => {
      const loc = item.source.location;
      if (!loc) return false;
      return haversineKm(loc.lat, loc.lng, camLat, camLng) <= 2200;
    });
    if (focused.length) return focused[Math.floor(Math.random() * focused.length)];
  }

  return pool[Math.floor(Math.random() * pool.length)];
}

// Track recently-used article URLs to maximize geographic diversity
const _recentGeoArticles = new Set();
const _RECENT_GEO_MAX = 16;

/**
 * Pick a geolocatable news article from the live ticker pool.
 * Uses title-based city extraction + country fallback (no external GEO API).
 * Returns { article, geo: {lat, lng, name} } or null.
 */
function pickGeoArticle() {
  const pool = state.newsTickerPool;
  if (!pool.length) return null;

  // Build list of geolocatable articles
  const geoPool = [];
  for (const article of pool) {
    const geo = resolveArticleGeo(article);
    if (geo) geoPool.push({ article, geo });
  }
  if (!geoPool.length) return null;

  // Prefer articles we haven't used recently for diversity
  const fresh = geoPool.filter(item => !_recentGeoArticles.has(item.article.url));
  const selection = fresh.length ? fresh : geoPool;
  const pick = selection[Math.floor(Math.random() * selection.length)];

  // Track usage
  _recentGeoArticles.add(pick.article.url);
  if (_recentGeoArticles.size > _RECENT_GEO_MAX) {
    const first = _recentGeoArticles.values().next().value;
    _recentGeoArticles.delete(first);
  }

  return pick;
}

function pruneEventVisuals(forceTrim = false) {
  const now = Date.now();
  const maxVisuals = 20;
  for (let i = dynamic.eventVisuals.length - 1; i >= 0; i -= 1) {
    const item = dynamic.eventVisuals[i];
    const expired = forceTrim || now - item.bornAt > item.ttlMs;
    if (!expired) continue;
    viewer.entities.remove(item.dot);
    viewer.entities.remove(item.cone);
    viewer.entities.remove(item.trail);
    dynamic.eventVisuals.splice(i, 1);
  }

  while (dynamic.eventVisuals.length > maxVisuals) {
    const oldest = dynamic.eventVisuals.shift();
    if (!oldest) break;
    viewer.entities.remove(oldest.dot);
    viewer.entities.remove(oldest.cone);
    viewer.entities.remove(oldest.trail);
  }
  updateEventCount();
  rebuildConnectionLines();
}

// ── CONNECTION LINES between nearby events ──────────────────────────────────
// Links events within ~40° of each other with faint geodesic arcs.
function rebuildConnectionLines() {
  // Remove old lines
  for (const line of dynamic.connectionLines) {
    viewer.entities.remove(line);
  }
  dynamic.connectionLines.length = 0;

  const events = dynamic.eventVisuals.filter(v => v.lng != null && v.lat != null);
  if (events.length < 2) return;

  const MAX_DEG_DIST = 40;
  const MAX_LINES = 8;
  const pairs = [];

  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      const a = events[i], b = events[j];
      const dlat = a.lat - b.lat;
      const dlng = a.lng - b.lng;
      const dist = Math.sqrt(dlat * dlat + dlng * dlng);
      if (dist < MAX_DEG_DIST) {
        pairs.push({ a, b, dist });
      }
    }
  }

  // Sort by distance, take closest pairs
  pairs.sort((x, y) => x.dist - y.dist);
  const selected = pairs.slice(0, MAX_LINES);

  for (const { a, b } of selected) {
    const midAlt = 6000 + Math.random() * 4000;
    const line = viewer.entities.add({
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArrayHeights([
          a.lng, a.lat, 1200,
          (a.lng + b.lng) / 2, (a.lat + b.lat) / 2, midAlt,
          b.lng, b.lat, 1200
        ]),
        width: 1.5,
        material: new Cesium.PolylineDashMaterialProperty({
          color: Cesium.Color.fromCssColorString("#8b5cf6").withAlpha(0.4),
          gapColor: Cesium.Color.TRANSPARENT,
          dashLength: 16
        }),
        arcType: Cesium.ArcType.GEODESIC
      },
      properties: {
        layerId: "incidents",
        entityType: "connection-line",
        label: "Intel link",
        description: "Event correlation link"
      }
    });
    dynamic.connectionLines.push(line);
  }

  // Update link count badge
  const linkEl = document.getElementById("hud-link-count");
  if (linkEl) linkEl.textContent = `⟁ ${dynamic.connectionLines.length}`;
}

function updateEventCount() {
  const el = document.getElementById("hud-event-count");
  if (!el) return;
  const n = dynamic.eventVisuals.length;
  const prev = parseInt(el.dataset.count) || 0;
  el.dataset.count = n;
  // Animated counting effect
  if (n !== prev && prev > 0) {
    animateCounter(el, prev, n, 600);
  } else {
    el.textContent = n > 0 ? `${n} events` : "— events";
  }
  el.classList.toggle("has-events", n > 0);
  // Pop animation when count increases
  if (n > prev) {
    el.classList.remove("count-bump");
    void el.offsetWidth; // reflow
    el.classList.add("count-bump");
  }
  // Classification bar glow when events active
  const cbar = document.getElementById("classification-bar");
  if (cbar) cbar.classList.toggle("events-active", n > 0);
  // Update page title with event count for background tab awareness
  document.title = n > 0
    ? `(${n}) God's Third Eye — Live Global Surveillance Dashboard`
    : "God's Third Eye — Live Global Surveillance Dashboard";
  // Flash title if tab is hidden
  if (document.hidden && n > 0 && !_titleFlashInterval) {
    let alt = false;
    _titleFlashInterval = setInterval(() => {
      alt = !alt;
      document.title = alt
        ? `⚡ NEW EVENT — God's Third Eye`
        : `(${dynamic.eventVisuals.length}) God's Third Eye — Live Global Surveillance Dashboard`;
    }, 1500);
  }
}

function animateCounter(el, from, to, duration) {
  const start = performance.now();
  const diff = to - from;
  function tick(now) {
    const t = Math.min((now - start) / duration, 1);
    const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; // easeInOut
    const current = Math.round(from + diff * ease);
    el.textContent = `${current} events`;
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

let _titleFlashInterval = null;
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && _titleFlashInterval) {
    clearInterval(_titleFlashInterval);
    _titleFlashInterval = null;
    updateEventCount();
  }
  // Throttle rendering when tab is hidden to save GPU/CPU
  if (viewer && viewer.scene) {
    viewer.scene.requestRenderMode = document.hidden;
    if (!document.hidden) viewer.scene.requestRender();
  }
});

// ── SPAWN FLASH — expanding ring when new event appears ─────────────────────
function flashEventSpawn(lng, lat) {
  const ring = viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(lng, lat, 800),
    ellipse: {
      semiMinorAxis: 10000,
      semiMajorAxis: 10000,
      height: 800,
      material: Cesium.Color.fromCssColorString("#00f0ff").withAlpha(0.5),
      outline: true,
      outlineColor: Cesium.Color.fromCssColorString("#00f0ff").withAlpha(0.8),
      outlineWidth: 2
    },
    properties: { layerId: "incidents", entityType: "spawn-flash" }
  });

  let step = 0;
  const maxSteps = 20;
  const interval = setInterval(() => {
    step++;
    const t = step / maxSteps;
    const radius = 10000 + t * 120000;
    const alpha = 0.5 * (1 - t);
    ring.ellipse.semiMinorAxis = radius;
    ring.ellipse.semiMajorAxis = radius;
    ring.ellipse.material = Cesium.Color.fromCssColorString("#00f0ff").withAlpha(alpha);
    ring.ellipse.outlineColor = Cesium.Color.fromCssColorString("#00f0ff").withAlpha(alpha * 1.5);
    if (step >= maxSteps) {
      clearInterval(interval);
      viewer.entities.remove(ring);
    }
  }, 80);

  // Second ring — delayed, pink, for double-shockwave effect
  setTimeout(() => {
    const ring2 = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lng, lat, 800),
      ellipse: {
        semiMinorAxis: 10000,
        semiMajorAxis: 10000,
        height: 800,
        material: Cesium.Color.TRANSPARENT,
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString("#ff4d6d").withAlpha(0.6),
        outlineWidth: 1.5
      },
      properties: { layerId: "incidents", entityType: "spawn-flash" }
    });
    let s2 = 0;
    const i2 = setInterval(() => {
      s2++;
      const t = s2 / maxSteps;
      const radius = 10000 + t * 80000;
      const alpha = 0.6 * (1 - t);
      ring2.ellipse.semiMinorAxis = radius;
      ring2.ellipse.semiMajorAxis = radius;
      ring2.ellipse.outlineColor = Cesium.Color.fromCssColorString("#ff4d6d").withAlpha(alpha);
      if (s2 >= maxSteps) {
        clearInterval(i2);
        viewer.entities.remove(ring2);
      }
    }, 80);
  }, 200);

  // Radar blip
  spawnRadarBlip();
}

function pickNewsLabel() {
  const pool = state.newsTickerPool;
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

// Refresh the label/description on existing event visuals so hover tooltips
// and the selected-entity card always reflect current news headlines.
function refreshEventVisualLabels() {
  if (!dynamic.eventVisuals.length) return;
  for (const item of dynamic.eventVisuals) {
    // Geo-spawned visuals keep their original article-specific label
    if (item.geoSpawned) continue;
    const newsItem = pickNewsLabel();
    if (!newsItem) continue;
    const headline = newsItem.title.slice(0, 80);
    const aUrl = newsItem.url || "";
    const aLang = newsItem.language || "";
    const aDomain = newsItem.domain || "";
    for (const ent of [item.dot, item.cone, item.trail]) {
      ent.properties.articleUrl    = aUrl;
      ent.properties.articleLang   = aLang;
      ent.properties.articleDomain = aDomain;
    }
    item.dot.properties.label       = `${headline} marker`;
    item.dot.properties.description = `${newsItem.domain} — ${newsItem.title}`;
    item.cone.properties.label       = `${headline} cone`;
    item.cone.properties.description = `${newsItem.domain} — projection`;
    item.trail.properties.label       = `${headline} trail`;
    item.trail.properties.description = `${newsItem.domain} — trajectory`;
  }
  // Keep sidebar card fresh if the user has an event visual selected
  const selectedType = state.selectedEntity?.properties?.entityType
    ?.getValue?.(viewer.clock.currentTime);
  if (selectedType === "event-visual" || selectedType === "event-cone" || selectedType === "event-trail") {
    updateSelectedEntityCard(state.selectedEntity);
  }
}

function spawnEventVisualBurst() {
  if (!state.layers.incidents) return;

  // ── PRIMARY: Try to spawn from a geolocated live news article ──────────
  const geoPick = pickGeoArticle();
  if (geoPick) {
    const { article, geo } = geoPick;
    const lng = geo.lng;
    const lat = geo.lat;
    const kind = (article.category && EVENT_VISUAL_STYLES[article.category]) ? article.category : "alert"; // use news category color if available
    const style = resolveEventVisualStyle(kind, lng, lat);
    const bearing = (performance.now() / 40 + Math.random() * 360) % 360;
    const target = destinationPoint(lat, lng, style.trailDistance, bearing);

    const eventLabel = article.title.slice(0, 80);
    const articleUrl = article.url || "";
    const articleLang = article.language || "";
    const articleDomain = article.domain || "";
    const geoName = geo.name || article.country || null;
    const countryNote = geoName ? ` [${geoName}]` : article.country ? ` [${article.country}]` : "";
    // Pin label: show place name when we have real coords, else truncated title
    const pinLabel = geoName || (article.country ? article.country.toUpperCase() : eventLabel.slice(0, 28));

    const dot = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lng, lat, 1200),
      point: {
        pixelSize: 10,
        color: Cesium.Color.fromCssColorString(style.dot).withAlpha(0.95),
        outlineColor: Cesium.Color.WHITE.withAlpha(0.85),
        outlineWidth: 1.5,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      },
      label: {
        text: pinLabel,
        font: '11px "Share Tech Mono", monospace',
        fillColor: Cesium.Color.fromCssColorString(style.dot).withAlpha(0.95),
        outlineColor: Cesium.Color.BLACK.withAlpha(0.7),
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString("rgba(5,12,23,0.72)"),
        backgroundPadding: new Cesium.Cartesian2(5, 3),
        horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(8, -8),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new Cesium.NearFarScalar(5e5, 1.0, 8e6, 0.4),
        translucencyByDistance: new Cesium.NearFarScalar(1e6, 1.0, 1.2e7, 0.0)
      },
      properties: {
        layerId: "incidents",
        entityType: "event-visual",
        label: eventLabel,
        description: `${articleDomain}${countryNote} — ${article.title}`,
        articleUrl,
        articleLang,
        articleDomain
      }
    });

    const coneLen = style.coneLength;
    const cone = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lng, lat, coneLen / 2),
      cylinder: {
        length: coneLen,
        topRadius: 0,
        bottomRadius: style.coneRadius,
        material: Cesium.Color.fromCssColorString(style.cone).withAlpha(0.14),
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString(style.cone).withAlpha(0.35)
      },
      properties: {
        layerId: "incidents",
        entityType: "event-cone",
        label: `${eventLabel} — projection`,
        description: `${articleDomain}${countryNote} — projection cone`,
        articleUrl,
        articleLang,
        articleDomain
      }
    });

    const trail = viewer.entities.add({
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArrayHeights([
          lng, lat, 1000,
          target.lng, target.lat, 22000
        ]),
        width: 2.2,
        material: Cesium.Color.fromCssColorString(style.trail).withAlpha(0.72),
        arcType: Cesium.ArcType.GEODESIC
      },
      properties: {
        layerId: "incidents",
        entityType: "event-trail",
        label: `${eventLabel} — trajectory`,
        description: `${articleDomain}${countryNote} — trajectory`,
        articleUrl,
        articleLang,
        articleDomain
      }
    });

    dynamic.eventVisuals.push({
      bornAt: Date.now(),
      ttlMs: style.ttlMs + Math.floor(Math.random() * 30000),
      geoSpawned: true,
      lng, lat,
      dot, cone, trail
    });

    pruneEventVisuals();
    updateEventCount();
    flashEventSpawn(lng, lat);
    updateEventHistoryTrail(lng, lat);
    rebuildConnectionLines();
    // Show translated toast for non-English articles
    if (articleLang && isNonEnglish(articleLang)) {
      const cacheKey = `${articleLang}::${article.title}`;
      const cached = _translationCache.get(cacheKey);
      if (cached && cached !== article.title) {
        showEventToast(cached, article.country);
      } else {
        showEventToast(article.title, article.country);
        translateTitle(article.title, articleLang).then(translated => {
          // Toast already shown with original — next time it'll be cached
        });
      }
    } else {
      showEventToast(article.title, article.country);
    }
    updateSessionStats(article.country);
    // Haptic buzz on mobile when a geo event spawns
    if (navigator.vibrate) navigator.vibrate(40);
    // Auto-fly to the first geo event so the user immediately sees live data
    if (state.sessionStats.eventsSpawned === 1 && viewer) {
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(lng, lat, 4500000),
        duration: 2.2,
        easingFunction: Cesium.EasingFunction.QUARTIC_OUT
      });
    }
    return;
  }

  // ── FALLBACK: Use scenario locations when no geolocatable articles ─────
  const picked = pickEventSource();
  if (!picked?.source?.location) return;

  const { kind, source } = picked;
  const { lng: baseLng, lat: baseLat } = source.location;

  // Apply positional jitter so visuals don't pile on the exact same coordinate
  const lng = baseLng + (Math.random() - 0.5) * 3.2;
  const lat = baseLat + (Math.random() - 0.5) * 2.4;

  const style = resolveEventVisualStyle(kind, baseLng, baseLat);
  const bearing = (performance.now() / 40 + Math.random() * 360) % 360;
  const target = destinationPoint(lat, lng, style.trailDistance, bearing);

  // Pull a live news headline for the label when available
  const newsItem = pickNewsLabel();
  const eventLabel = newsItem
    ? newsItem.title.slice(0, 80)
    : (source.title || source.label || "Event");
  const articleUrl = newsItem?.url || "";
  const articleLang = newsItem?.language || "";

  const dot = viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(lng, lat, 1200),
    point: {
      pixelSize: kind === "incident" ? 12 : 9,
      color: Cesium.Color.fromCssColorString(style.dot).withAlpha(0.95),
      outlineColor: Cesium.Color.WHITE.withAlpha(0.85),
      outlineWidth: 1.5,
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    },
    properties: {
      layerId: "incidents",
      entityType: "event-visual",
      label: `${eventLabel} marker`,
      description: newsItem ? `${newsItem.domain} — ${newsItem.title}` : "Ephemeral conflict marker",
      articleUrl,
      articleLang,
      articleDomain: newsItem?.domain || ""
    }
  });

  const coneLen = style.coneLength;
  const cone = viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(lng, lat, coneLen / 2),
    cylinder: {
      length: coneLen,
      topRadius: 0,
      bottomRadius: style.coneRadius,
      material: Cesium.Color.fromCssColorString(style.cone).withAlpha(0.14),
      outline: true,
      outlineColor: Cesium.Color.fromCssColorString(style.cone).withAlpha(0.35)
    },
    properties: {
      layerId: "incidents",
      entityType: "event-cone",
      label: `${eventLabel} cone`,
      description: newsItem ? `${newsItem.domain} — projection` : "Ephemeral event projection cone",
      articleUrl,
      articleLang,
      articleDomain: newsItem?.domain || ""
    }
  });

  const trail = viewer.entities.add({
    polyline: {
      positions: Cesium.Cartesian3.fromDegreesArrayHeights([
        lng, lat, 1000,
        target.lng, target.lat, 22000
      ]),
      width: kind === "incident" ? 2.6 : 2.1,
      material: Cesium.Color.fromCssColorString(style.trail).withAlpha(0.72),
      arcType: Cesium.ArcType.GEODESIC
    },
    properties: {
      layerId: "incidents",
      entityType: "event-trail",
      label: `${eventLabel} trail`,
      description: newsItem ? `${newsItem.domain} — trajectory` : "Ephemeral event trajectory",
      articleUrl,
      articleLang,
      articleDomain: newsItem?.domain || ""
    }
  });

  dynamic.eventVisuals.push({
    bornAt: Date.now(),
    ttlMs: style.ttlMs + Math.floor(Math.random() * 30000),
    lng, lat,
    dot, cone, trail
  });

  pruneEventVisuals();
  updateEventCount();
  flashEventSpawn(lng, lat);
  updateEventHistoryTrail(lng, lat);
  rebuildConnectionLines();
}

function startEventVisualLifecycle() {
  if (eventVisualSpawnTimer) window.clearInterval(eventVisualSpawnTimer);
  if (eventVisualPruneTimer) window.clearInterval(eventVisualPruneTimer);
  if (eventVisualLabelTimer) window.clearInterval(eventVisualLabelTimer);

  // Delay first spawn so the globe opens clean before anything appears
  window.setTimeout(() => {
    spawnEventVisualBurst();
    eventVisualSpawnTimer = window.setInterval(() => {
      spawnEventVisualBurst();
    }, 8000);
  }, 3000);

  eventVisualPruneTimer = window.setInterval(() => {
    pruneEventVisuals();
  }, 12000);

  // Refresh descriptions/labels on living visuals every 30 s so
  // the hover tooltip and entity card always show current headlines.
  eventVisualLabelTimer = window.setInterval(() => {
    refreshEventVisualLabels();
  }, 30000);
}

function headingBetweenPositions(a, b) {
  if (!a || !b) return 0;
  const ac = Cesium.Cartographic.fromCartesian(a);
  const bc = Cesium.Cartographic.fromCartesian(b);
  const dL = bc.longitude - ac.longitude;
  const y  = Math.sin(dL) * Math.cos(bc.latitude);
  const x  = Math.cos(ac.latitude) * Math.sin(bc.latitude) - Math.sin(ac.latitude) * Math.cos(bc.latitude) * Math.cos(dL);
  return (Cesium.Math.toDegrees(Math.atan2(y, x)) + 360) % 360;
}

function createRadarSweep(entity, color) {
  const rc = color.brighten(0.2, new Cesium.Color());
  const radarEntity = viewer.entities.add({
    id: `${entity.id}-radar`,
    polygon: {
      hierarchy: new Cesium.CallbackProperty(() => {
        const now  = viewer.clock.currentTime;
        const cur  = entity.position?.getValue?.(now);
        const fwd  = entity.position?.getValue?.(Cesium.JulianDate.addSeconds(now, 45, new Cesium.JulianDate()));
        if (!cur) return undefined;
        const cg   = Cesium.Cartographic.fromCartesian(cur);
        const cLat = Cesium.Math.toDegrees(cg.latitude);
        const cLng = Cesium.Math.toDegrees(cg.longitude);
        const baseH = headingBetweenPositions(cur, fwd);
        const sweep = baseH + Math.sin(performance.now() / 700 + entity._pulseSeed) * 62;
        const half  = 18;
        const range = 260000;
        const pts   = [cLng, cLat];
        for (let s = 0; s <= 12; s++) {
          const brg = sweep - half + (s / 12) * half * 2;
          const pt  = destinationPoint(cLat, cLng, range, brg);
          pts.push(pt.lng, pt.lat);
        }
        return new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(pts));
      }, false),
      material:          rc.withAlpha(0.14),
      outline:           true,
      outlineColor:      rc.withAlpha(0.42),
      perPositionHeight: false,
      height:            0
    },
    properties: {
      layerId:     "military",
      label:       `${entity.properties.label.getValue(viewer.clock.currentTime)} Radar Sweep`,
      description: "Ground-projected radar search cone.",
      entityType:  "radar"
    }
  });
  radarEntity._pulseSeed = entity._pulseSeed;
  dynamic.radars.push({ entity: radarEntity, parent: entity });
}

function createZones() {
  SCENARIO.zones.forEach(zone => {
    let entity;
    const color = Cesium.Color.fromCssColorString(zone.color);
    if (zone.kind === "rectangle") {
      entity = viewer.entities.add({
        id: zone.id,
        rectangle: {
          coordinates: Cesium.Rectangle.fromDegrees(
            zone.coordinates.west, zone.coordinates.south,
            zone.coordinates.east, zone.coordinates.north
          ),
          material:     color.withAlpha(zone.fill),
          outline:      true,
          outlineColor: color.withAlpha(0.75),
          height:       0
        },
        properties: { layerId: "zones", label: zone.label, description: zone.label, entityType: "zone" }
      });
    } else {
      entity = viewer.entities.add({
        id: zone.id,
        polygon: {
          hierarchy:    Cesium.Cartesian3.fromDegreesArray(zone.coordinates.flat()),
          material:     color.withAlpha(zone.fill),
          outline:      true,
          outlineColor: color.withAlpha(0.8),
          perPositionHeight: false
        },
        properties: { layerId: "zones", label: zone.label, description: zone.label, entityType: "zone" }
      });
    }
    entity._zoneColor = color;
    entity._baseFill  = zone.fill;
    entity._pulseSeed = Math.random() * Math.PI * 2;
    dynamic.zones.push({ entity, zone });
  });
}

function createIncidents() {
  SCENARIO.incidents.forEach(incident => {
    const entity = viewer.entities.add({
      id: incident.id,
      position: Cesium.Cartesian3.fromDegrees(incident.location.lng, incident.location.lat, 1500),
      billboard: {
        image:          createMarkerSvg("#ff6d8d", incident.label.slice(0, 1)),
        scale:          1.0,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new Cesium.NearFarScalar(1.5e5, 1.4, 8.0e6, 0.6),
        translucencyByDistance: new Cesium.NearFarScalar(1.5e5, 1.0, 2.0e7, 0.3)
      },
      label: {
        text:           incident.label,
        font:           '12px "Share Tech Mono"',
        fillColor:      Cesium.Color.WHITE,
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString("rgba(5,12,23,0.75)"),
        pixelOffset:    new Cesium.Cartesian2(0, -42),
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      },
      properties: { layerId: "incidents", label: incident.label, description: incident.description, entityType: "incident" }
    });
    entity._pulseSeed = Math.random() * Math.PI * 2;
    dynamic.incidents.push({ entity, incident });

    const ring = viewer.entities.add({
      id: `${incident.id}-ring`,
      position: Cesium.Cartesian3.fromDegrees(incident.location.lng, incident.location.lat, 0),
      ellipse: {
        semiMajorAxis: 180000,
        semiMinorAxis: 180000,
        material:     Cesium.Color.fromCssColorString("#ff6d8d").withAlpha(0.09),
        outline:      true,
        outlineColor: Cesium.Color.fromCssColorString("#ff6d8d").withAlpha(0.4),
        height:       0
      }
    });
    ring._pulseSeed = Math.random() * Math.PI * 2;
    dynamic.rings.push({ entity: ring, incident });
  });
}

function createMarkerSvg(color, text) {
  const uid = `m${Math.random().toString(36).slice(2, 7)}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="88" viewBox="0 0 72 88">
  <defs>
    <filter id="glow-${uid}" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="3.5" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="shadow-${uid}" x="-30%" y="-10%" width="160%" height="160%">
      <feDropShadow dx="0" dy="6" stdDeviation="5" flood-color="${color}" flood-opacity="0.45"/>
      <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="rgba(0,0,0,0.6)" flood-opacity="1"/>
    </filter>
    <radialGradient id="body-${uid}" cx="38%" cy="30%" r="60%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.45"/>
      <stop offset="45%" stop-color="${color}" stop-opacity="1"/>
      <stop offset="100%" stop-color="${color}" stop-opacity="0.75"/>
    </radialGradient>
    <radialGradient id="shine-${uid}" cx="35%" cy="25%" r="45%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <!-- Drop shadow ellipse -->
  <ellipse cx="36" cy="84" rx="14" ry="4" fill="rgba(0,0,0,0.35)" filter="url(#shadow-${uid})"/>
  <!-- Pin body with 3D gradient -->
  <g filter="url(#glow-${uid})">
    <path d="M36 3C21.6 3 10 14.6 10 29c0 20 26 56 26 56s26-36 26-56C62 14.6 50.4 3 36 3z"
      fill="url(#body-${uid})" stroke="rgba(255,255,255,0.5)" stroke-width="1.5"/>
    <!-- Shine highlight -->
    <path d="M36 3C21.6 3 10 14.6 10 29c0 20 26 56 26 56s26-36 26-56C62 14.6 50.4 3 36 3z"
      fill="url(#shine-${uid})"/>
    <!-- Outline ring inside pin -->
    <circle cx="36" cy="29" r="15" fill="rgba(0,0,0,0.25)" stroke="rgba(255,255,255,0.3)" stroke-width="1.2"/>
    <!-- Icon letter -->
    <text x="36" y="35" text-anchor="middle" font-size="16" font-weight="700"
      font-family="Share Tech Mono, monospace" fill="#ffffff"
      style="text-shadow: 0 1px 3px rgba(0,0,0,0.8)">${text}</text>
  </g>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function refreshEntityVisibility() {
  dynamic.traffic.forEach(entity => {
    entity.show = !!state.layers[entity.properties.layerId.getValue()];
  });
  dynamic.radars.forEach(({ entity }) => {
    entity.show = !!state.layers.military;
  });
  dynamic.liveTraffic.forEach(entity => {
    entity.show = !!state.layers[entity.properties.layerId.getValue(viewer.clock.currentTime)];
  });
  updateMyLocation();
  // Sync country borders layer toggle
  if (typeof toggleCountryOverlay === "function") {
    toggleCountryOverlay(state.layers.borders !== false);
  }
  // Sync ISS layer toggle
  const issOn = !!state.layers.iss;
  if (issOn && !_issEntity) initISSTracking();
  else if (!issOn && _issEntity) destroyISSTracking();
  if (_issEntity) _issEntity.show = issOn;
  if (_issTrailEntity) _issTrailEntity.show = issOn;
  // Sync seismic layer toggle
  const seismicOn = !!state.layers.seismic;
  _seismicEntities.forEach(e => { e.show = seismicOn; });
  if (seismicOn && _seismicEntities.length === 0) loadSeismicData();
}

function updateZones() {
  dynamic.zones.forEach(({ entity }) => { entity.show = !!state.layers.zones; });
}

// ══════════════════════════════════════════════════════════════════════════════
// DYNAMIC INCIDENT POOL — no hardcoded fixtures; positions rotate globally
// every 20-30 min; descriptions enriched live from GDELT where possible.
// ══════════════════════════════════════════════════════════════════════════════

// ── Utility ──────────────────────────────────────────────────────────────────
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ── GDELT enrichment ─────────────────────────────────────────────────────────
// Tries to pull a real recent headline for a hotspot from GDELT DOC API.
// Falls back to the pool's built-in description silently on any failure.
async function fetchGdeltDescriptionForRegion(label, tags) {
  try {
    const query = encodeURIComponent(label.replace(/[^a-zA-Z0-9 ]/g, ""));
    const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${query}&mode=artlist&maxrecords=3&timespan=12h&format=json`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) return null;
    const data = await resp.json();
    const articles = data?.articles;
    if (!Array.isArray(articles) || !articles.length) return null;
    // Pick the first article with a non-trivial title
    const art = articles.find(a => a.title && a.title.length > 20) ?? articles[0];
    if (!art?.title) return null;
    return {
      description: art.title,
      sourceLabel: art.domain ?? "GDELT News Feed",
      sourceUrl: art.url ?? "https://www.gdeltproject.org",
      publishedAt: art.seendate ? new Date(
        art.seendate.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, "$1-$2-$3T$4:$5:$6Z")
      ).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC" : "Moments ago"
    };
  } catch {
    return null;
  }
}

// ── Build a scenario-compatible incident entry from a pool item ───────────────
function buildScenarioIncident(poolItem, gdelt = null) {
  const desc   = gdelt?.description  ?? poolItem.description;
  const source = gdelt?.sourceLabel  ?? poolItem.sourceLabel;
  const url    = gdelt?.sourceUrl    ?? poolItem.sourceUrl;
  const pubAt  = gdelt?.publishedAt  ?? "Updated moments ago";
  return {
    id:          poolItem.id,
    label:       poolItem.label,
    description: desc,
    sourceLabel: source,
    sourceUrl:   url,
    tags:        poolItem.tags ?? [],
    location:    { ...poolItem.location },
    updates: [
      { description: desc,                                                      sourceLabel: source, sourceUrl: url, publishedAt: pubAt },
      { description: `${poolItem.label} — situational update under assessment.`, sourceLabel: source, sourceUrl: url, publishedAt: "Update +12 min" },
      { description: `Continuous monitoring active for ${poolItem.label} area.`, sourceLabel: source, sourceUrl: url, publishedAt: "Update +26 min" }
    ]
  };
}

// ── Pre-populate SCENARIO.incidents before createIncidents() runs at boot ─────
function initIncidentPool() {
  const pool = shuffleArray([...INCIDENT_POOL]);
  const selected = pool.slice(0, INCIDENT_DISPLAY_COUNT);
  SCENARIO.incidents.length = 0;
  selected.forEach(item => SCENARIO.incidents.push(buildScenarioIncident(item)));
  SCENARIO.incidents.forEach(inc => { state.incidentNarrativeIndexes[inc.id] = 0; });

  // Kick off async GDELT enrichment — updates descriptions in the background
  selected.forEach((poolItem, i) => {
    fetchGdeltDescriptionForRegion(poolItem.label, poolItem.tags).then(gdelt => {
      if (!gdelt) return;
      const entry = SCENARIO.incidents[i];
      if (!entry || entry.id !== poolItem.id) return; // already cycled away
      const enriched = buildScenarioIncident(poolItem, gdelt);
      Object.assign(entry, enriched);
      // If this incident is currently open in the intel sheet, refresh it
      if (state.selectedEntity?.id === entry.id && state.intelSheetOpen) {
        openIntelSheet(state.selectedEntity);
      }
    });
  });
}

// ── Reposition all incident Cesium entities from a new pool selection ─────────
function cycleIncidentPool() {
  if (!INCIDENT_POOL?.length) return;
  if (!dynamic.incidents.length) return;

  const pool     = shuffleArray([...INCIDENT_POOL]);
  const count    = dynamic.incidents.length;
  const selected = pool.slice(0, count);

  // Deselect if current selection is an incident (it's about to move)
  if (state.selectedEntity) {
    const selType = state.selectedEntity.properties?.entityType?.getValue?.(viewer.clock.currentTime);
    if (selType === "incident") {
      state.selectedEntity = null;
      if (elements.entityInfo) {
        elements.entityInfo.innerHTML = "Click any entity on the globe to view telemetry, assessment, and tracking options.";
        elements.entityInfo.classList.add("empty");
      }
    }
  }

  // Update each entity in-place (keeps Cesium IDs intact)
  selected.forEach((poolItem, i) => {
    const newEntry = buildScenarioIncident(poolItem);

    // Mutate SCENARIO.incidents so findScenarioIncidentById still works
    if (SCENARIO.incidents[i]) Object.assign(SCENARIO.incidents[i], newEntry);
    else SCENARIO.incidents[i] = newEntry;
    state.incidentNarrativeIndexes[newEntry.id] = 0;

    // Reposition dot entity
    const dotEntry = dynamic.incidents[i];
    if (dotEntry) {
      dotEntry.entity.position = new Cesium.ConstantPositionProperty(
        Cesium.Cartesian3.fromDegrees(poolItem.location.lng, poolItem.location.lat, 1500)
      );
      if (dotEntry.entity.billboard)
        dotEntry.entity.billboard.image = createMarkerSvg("#ff6d8d", poolItem.label.slice(0, 1));
      if (dotEntry.entity.label)
        dotEntry.entity.label.text = new Cesium.ConstantProperty(poolItem.label);
      dotEntry.incident = SCENARIO.incidents[i];
    }

    // Reposition ring entity
    const ringEntry = dynamic.rings[i];
    if (ringEntry) {
      ringEntry.entity.position = new Cesium.ConstantPositionProperty(
        Cesium.Cartesian3.fromDegrees(poolItem.location.lng, poolItem.location.lat, 0)
      );
      ringEntry.incident = SCENARIO.incidents[i];
    }

    // Async GDELT enrichment — updates description after entity is already placed
    fetchGdeltDescriptionForRegion(poolItem.label, poolItem.tags).then(gdelt => {
      if (!gdelt) return;
      const entry = SCENARIO.incidents[i];
      if (!entry || entry.id !== poolItem.id) return;
      const enriched = buildScenarioIncident(poolItem, gdelt);
      Object.assign(entry, enriched);
    });
  });

  showToast("Incident overlay updated — new global hotspots online", "info", 3500);
}

// ── Start the cycling timer (20–30 min, re-randomised each cycle) ─────────────
function startIncidentCycling() {
  if (_incidentCycleTimer) clearTimeout(_incidentCycleTimer);
  const scheduleNext = () => {
    const delay = (20 + Math.floor(Math.random() * 10)) * 60 * 1000;
    _incidentCycleTimer = setTimeout(() => { cycleIncidentPool(); scheduleNext(); }, delay);
  };
  scheduleNext();
}

function updateIncidents() {
  dynamic.incidents.forEach(({ entity }) => { entity.show = !!state.layers.incidents; });
  dynamic.rings.forEach(({ entity })     => { entity.show = !!state.layers.incidents; });
  dynamic.eventVisuals.forEach(({ dot, cone, trail }) => {
    dot.show = !!state.layers.incidents;
    cone.show = !!state.layers.incidents;
    trail.show = !!state.layers.incidents;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// MY LOCATION — optional IP-geolocation marker (opt-in via Layers panel)
// ─────────────────────────────────────────────────────────────────────────────
let _myLocationEntities = []; // [dot, ring, label]
let _myLocationFetched  = false;
let _myLocationData     = null; // { lat, lng, city, country, ip }

async function fetchIpLocation() {
  try {
    const res = await fetch("https://ipwho.is/", { signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();
    if (!d.success || !d.latitude || !d.longitude) throw new Error("No location");
    return { lat: d.latitude, lng: d.longitude, city: d.city || "", country: d.country || "", ip: d.ip || "" };
  } catch (_) {
    // Fallback: second provider
    try {
      const res2 = await fetch("https://ipapi.co/json/", { signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined });
      if (!res2.ok) throw new Error(`HTTP ${res2.status}`);
      const d2 = await res2.json();
      if (!d2.latitude || !d2.longitude) throw new Error("No location");
      return { lat: d2.latitude, lng: d2.longitude, city: d2.city || "", country: d2.country_name || "", ip: d2.ip || "" };
    } catch (_2) { return null; }
  }
}

function placeMyLocationMarker(data) {
  removeMyLocationMarker();
  const { lat, lng, city, country } = data;
  const pos = Cesium.Cartesian3.fromDegrees(lng, lat, 800);

  // Pulsing dot
  const dot = viewer.entities.add({
    position: pos,
    point: {
      pixelSize: 11,
      color: Cesium.Color.fromCssColorString("#00ff88").withAlpha(0.95),
      outlineColor: Cesium.Color.fromCssColorString("#ffffff").withAlpha(0.9),
      outlineWidth: 2,
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    },
    properties: { layerId: "location", entityType: "my-location" }
  });

  // Outer ring
  const ring = viewer.entities.add({
    position: pos,
    ellipse: {
      semiMajorAxis: 55000,
      semiMinorAxis: 55000,
      height: 0,
      material: Cesium.Color.fromCssColorString("#00ff88").withAlpha(0.08),
      outline: true,
      outlineColor: Cesium.Color.fromCssColorString("#00ff88").withAlpha(0.55),
      outlineWidth: 1.5
    },
    properties: { layerId: "location", entityType: "my-location-ring" }
  });

  // Label
  const locationLabel = city ? `${city}, ${country}` : country || "Unknown";
  const label = viewer.entities.add({
    position: pos,
    label: {
      text: `◎ YOU ARE HERE\n${locationLabel}`,
      font: "11px 'Share Tech Mono', monospace",
      fillColor: Cesium.Color.fromCssColorString("#00ff88"),
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      pixelOffset: new Cesium.Cartesian2(0, -24),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      showBackground: true,
      backgroundColor: Cesium.Color.fromCssColorString("#0a0e1a").withAlpha(0.75),
      backgroundPadding: new Cesium.Cartesian2(6, 4),
      horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      scale: 1.0
    },
    properties: { layerId: "location", entityType: "my-location-label" }
  });

  _myLocationEntities = [dot, ring, label];
}

function removeMyLocationMarker() {
  for (const e of _myLocationEntities) {
    try { viewer.entities.remove(e); } catch (_) { /* */ }
  }
  _myLocationEntities = [];
}

async function enableMyLocation() {
  if (!_myLocationFetched) {
    showToast("Locating via IP address…", "info");
    const data = await fetchIpLocation();
    _myLocationFetched = true;
    if (data) {
      _myLocationData = data;
      placeMyLocationMarker(data);
      showToast(`Location resolved: ${data.city || data.country}`, "info");
    } else {
      showToast("Could not resolve IP location", "warning");
      // Turn the layer back off silently
      state.layers.location = false;
      saveJson(STORAGE_KEYS.layers, state.layers);
      renderLayerToggles();
    }
  } else if (_myLocationData) {
    placeMyLocationMarker(_myLocationData);
  }
}

function updateMyLocation() {
  const on = !!state.layers.location;
  if (on) {
    enableMyLocation();
  } else {
    removeMyLocationMarker();
  }
}

function updateLiveMetrics() {
  const visibleTraffic = dynamic.traffic.filter(e => e.show).length + dynamic.liveTraffic.filter(e => e.show).length;
  const activeAlerts   = dynamic.incidents.filter(({ entity }) => entity.show).length + dynamic.zones.filter(({ entity }) => entity.show).length;
  const visibleOrbits  = dynamic.traffic.filter(e => e.show && e.properties.layerId.getValue(viewer.clock.currentTime) === "satellites").length;
  const liveFeeds      = [state.liveFeeds.adsb, state.liveFeeds.ais].filter(f => f.status === "live").length;

  updateMetricCard("tracks", visibleTraffic, `${Math.max(1, Math.round(visibleTraffic * 0.35))} sectors monitored`);
  updateMetricCard("alerts", activeAlerts,   activeAlerts ? "Active disruptions" : "No disruptions");
  updateMetricCard("orbits", visibleOrbits,  "Overhead coverage");
  updateMetricCard("feeds",  liveFeeds,      liveFeeds === 2 ? "All sources live" : liveFeeds === 1 ? "Partial live" : "Feeds loading");

  if (elements.hudTrackCount) elements.hudTrackCount.textContent = `${visibleTraffic} tracks`;
  if (elements.hudAlertCount) elements.hudAlertCount.textContent = `${activeAlerts} alerts`;
  if (elements.hudStatusText) elements.hudStatusText.textContent = "LIVE";
  if (elements.liveRegionLabel) elements.liveRegionLabel.textContent = "Global Intelligence Active";
  if (elements.hudStatusMode) elements.hudStatusMode.textContent = "LIVE FEED";

  if (elements.summaryStage) elements.summaryStage.textContent = "LIVE";
  if (elements.summaryCopy) {
    const adsbMsg = state.liveFeeds.adsb.status === "live"
      ? `${state.liveFeeds.adsb.records.length} aircraft` : "ADS-B pending";
    const aisMsg  = state.liveFeeds.ais.status === "live"
      ? `${state.liveFeeds.ais.records.length} vessels` : "AIS unconfigured";
    elements.summaryCopy.textContent = `${adsbMsg} \u00b7 ${aisMsg} \u00b7 ${visibleOrbits} orbital tracks monitored.`;
  }

  if (state.regionFocus && Date.now() - state.regionFocus.timestamp < 120000) {
    if (elements.liveRegionLabel) {
      elements.liveRegionLabel.textContent = `${state.regionFocus.label.toUpperCase()} · ${state.regionFocus.tracks} tracks · ${state.regionFocus.alerts} alerts`;
    }
    if (elements.hudStatusMode) {
      elements.hudStatusMode.textContent = "REGION FOCUS";
    }
    if (elements.summaryCopy) {
      elements.summaryCopy.textContent = state.regionFocus.summary;
    }
  }

  if (elements.summaryTags) renderSummaryTags();
}

function renderSummaryTags() {
  const active = LAYERS.filter(l => state.layers[l.id]).map(l => l.label);
  const stats = getSessionSummary();
  const statsHtml = `<span class="summary-tag session-stat">⏱ <span class="session-stat-value">${stats.duration}</span></span>` +
    `<span class="summary-tag session-stat">⚡ <span class="session-stat-value">${stats.eventsSpawned}</span> events</span>` +
    `<span class="summary-tag session-stat">🌍 <span class="session-stat-value">${stats.countriesSeen}</span> countries</span>`;
  elements.summaryTags.innerHTML = active.slice(0, 4).map(t => `<span class="summary-tag">${t}</span>`).join("") + statsHtml;
}

function updateHudFrame() {
  updateFps();
}

function updateAmbientEffects() {
  const phase = performance.now() / 700;
  dynamic.traffic.forEach(entity => {
    if (!entity.show || !entity.point) return;
    const layerId    = entity.properties.layerId.getValue(viewer.clock.currentTime);
    const pulseRange = layerId === "military" ? 1.8 : layerId === "commercial" ? 0.9 : layerId === "satellites" ? 0.6 : 0.7;
    entity.point.pixelSize = entity._basePixelSize + Math.max(0, Math.sin(phase + entity._pulseSeed)) * pulseRange;
  });
  dynamic.liveTraffic.forEach(entity => {
    if (!entity.show || !entity.point) return;
    entity.point.pixelSize = entity._basePixelSize + Math.max(0, Math.sin(phase * 1.15 + entity._pulseSeed)) * 1.6;
  });
  dynamic.incidents.forEach(({ entity }) => {
    if (!entity.show || !entity.billboard) return;
    entity.billboard.scale = 0.9 + (Math.sin(phase * 1.6 + entity._pulseSeed) + 1) * 0.08;
  });
  dynamic.zones.forEach(({ entity }) => {
    if (!entity.show) return;
    const alpha = entity._baseFill + (Math.sin(phase + entity._pulseSeed) + 1) * 0.02;
    if (entity.rectangle) entity.rectangle.material = entity._zoneColor.withAlpha(alpha);
    if (entity.polygon)   entity.polygon.material   = entity._zoneColor.withAlpha(alpha);
  });
  dynamic.rings.forEach(({ entity }) => {
    if (!entity.show || !entity.ellipse) return;
    const pulse = (Math.sin(phase + entity._pulseSeed) + 1) / 2;
    entity.ellipse.semiMajorAxis = 160000 + pulse * 90000;
    entity.ellipse.semiMinorAxis = 160000 + pulse * 90000;
    entity.ellipse.material = Cesium.Color.fromCssColorString("#ff6d8d").withAlpha(0.05 + pulse * 0.08);
  });
}

function openIntelSheet(entity) {
  const info = getEntityInfo(entity);
  if (!info || !elements.intelSheet) return;
  sfx.ping();
  if (window.innerWidth <= 980) {
    setMobileDrawer(null);
    // Show backdrop for intel sheet on mobile
    if (elements.mobileBackdrop) elements.mobileBackdrop.classList.remove("hidden");
  }

  const isEvent = info.type === "event-visual" || info.type === "event-cone" || info.type === "event-trail";
  const incident = info.type === "incident" ? findScenarioIncidentById(info.entityId) : null;
  const incidentNarrative = incident ? getActiveIncidentNarrative(incident) : null;
  const effectiveDescription = incidentNarrative?.description ?? info.description;

  // Build source link for events and incidents
  const articleUrl = info.articleUrl || incidentNarrative?.sourceUrl || "";
  const articleDomain = info.articleDomain || incidentNarrative?.sourceLabel || "";
  const intelSourceLine = articleUrl
    ? `<div><a class="intel-source-link" href="${escapeHtml(articleUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(articleDomain || "Source article")} ↗</a></div>`
    : articleDomain
      ? `<div>${escapeHtml(articleDomain)}</div>`
      : "";

  state.intelSheetOpen = true;
  state._intelSheetInfo = info; // Save for translate
  document.body.classList.add("intel-sheet-open");
  elements.intelSheet.classList.remove("hidden");
  elements.intelSheet.classList.add("classified");
  elements.intelSheet.setAttribute("aria-hidden", "false");

  // Source article bar
  if (elements.intelSourceBar && elements.intelSourceLink) {
    if (articleUrl) {
      elements.intelSourceLink.href = articleUrl;
      elements.intelSourceLink.textContent = `${articleDomain || "View article"} ↗`;
      elements.intelSourceBar.classList.remove("hidden");
    } else {
      elements.intelSourceBar.classList.add("hidden");
    }
  }

  // Translate button visibility
  if (elements.btnTranslateIntel) {
    const showTranslate = info.articleLang && isNonEnglish(info.articleLang);
    elements.btnTranslateIntel.classList.toggle("hidden", !showTranslate);
  }

  const typeLabel = isEvent ? "LIVE EVENT" : info.type.toUpperCase();
  elements.intelSheetKicker.textContent = `${typeLabel} — LIVE TRACK`;
  elements.intelSheetTitle.textContent = info.label;
  elements.intelSheetOverview.textContent = effectiveDescription || "Track selected for review.";

  const now = new Date();
  elements.intelSheetTelemetry.innerHTML = `
    <div>${info.locationMeta}</div>
    <div>Altitude: ${info.altitude > 0 ? Math.round(info.altitude).toLocaleString() + ' m' : '—'}</div>
    <div>Status: LIVE MONITORING</div>
    <div>Class: ${isEvent ? "Ephemeral event marker" : info.synthetic ? "Auxiliary model track" : "Primary track"}</div>
  `;

  const assessmentText = isEvent
    ? "Live intelligence event — sourced from real-time global news feeds."
    : info.type === "incident"
      ? "Active incident — conflict marker or disruption event."
      : info.type === "zone"
        ? "Active exclusion or disruption zone."
        : info.type === "military" || info.type === "radar"
          ? "Military-linked track with active radar coverage."
          : info.type === "satellite"
            ? "Orbital asset under continuous tracking."
            : info.type === "maritime"
              ? "Maritime vessel — shipping lane monitoring."
              : "Traffic track contributing to current route density.";

  const feedText = isEvent
    ? "GDELT real-time news feed"
    : info.type === "incident" || info.type === "zone"
      ? "Scenario intelligence overlay"
      : info.type.startsWith("live-") ? "Live feed adapter" : "Static backdrop overlay";

  elements.intelSheetAssessment.innerHTML = `
    <div>${assessmentText}</div>
    <div>Feed: ${feedText}</div>
    <div>Last updated: ${now.toUTCString().slice(17, 25)} UTC</div>
    ${intelSourceLine}
  `;
  elements.intelSheetTimeline.innerHTML = [
    { kicker: "Now",  copy: `${info.label} under active surveillance` },
    { kicker: "Feed", copy: isEvent ? "GDELT DOC API — real-time news intelligence" : info.type.startsWith("live-") ? "Real-time ADS-B / AIS data" : "Static backdrop model track" },
    { kicker: "Next", copy: "Continue monitoring — auto-refresh active" }
  ].map(item => `
    <div class="intel-timeline-item">
      <strong>${escapeHtml(item.kicker)}</strong>
      <span>${escapeHtml(item.copy)}</span>
    </div>
  `).join("");
  syncMobileActionButtons();
}

function closeIntelSheet() {
  state.intelSheetOpen = false;
  state._intelSheetInfo = null;
  sfx.panelClose();
  document.body.classList.remove("intel-sheet-open");
  if (!elements.intelSheet) return;
  elements.intelSheet.classList.add("hidden");
  elements.intelSheet.classList.remove("classified");
  elements.intelSheet.setAttribute("aria-hidden", "true");
  if (elements.intelSourceBar) elements.intelSourceBar.classList.add("hidden");
  // Hide mobile backdrop if no drawer is open
  if (window.innerWidth <= 980 && !state.activeDrawer && elements.mobileBackdrop) {
    elements.mobileBackdrop.classList.add("hidden");
  }
  syncMobileActionButtons();
}

async function testAisEndpoint() {
  if (!elements.feedHint) return;
  elements.feedHint.textContent = "Testing AIS endpoint\u2026";
  const result = await fetchAisFeed();
  elements.feedHint.textContent = result.status === "live"
    ? `AIS OK: ${result.records?.length ?? 0} vessel tracks.`
    : `AIS test: ${result.message}`;
}

function setMobileDrawer(drawer) {
  const wasOpen = !!state.activeDrawer;
  state.activeDrawer = state.activeDrawer === drawer ? null : drawer;
  if (state.activeDrawer && !wasOpen) sfx.panelOpen();
  else if (!state.activeDrawer && wasOpen) sfx.panelClose();
  document.body.classList.toggle("mobile-drawer-open",    !!state.activeDrawer);
  document.body.classList.toggle("mobile-layers-open",   state.activeDrawer === "layers");
  document.body.classList.toggle("mobile-controls-open", state.activeDrawer === "controls");
  elements.mobileBackdrop.classList.toggle("hidden", !state.activeDrawer);
  syncMobileActionButtons();
}

function openMobileDrawer(drawer) {
  const panelId = drawer === "layers"
    ? "panel-layers"
    : drawer === "controls"
      ? "panel-right"
      : null;

  if (panelId) setPanelHidden(panelId, false);
  if (window.innerWidth <= 980) {
    closeIntelSheet();
    closeNewsPanel();
  }
  setMobileDrawer(drawer);
}

function syncMobileActionButtons() {
  elements.btnMobileLayers?.classList.toggle("active", state.activeDrawer === "layers");
  elements.btnMobileControls?.classList.toggle("active", state.activeDrawer === "controls");
  elements.btnMobileSignals?.classList.toggle("active", !!state.newsOpen);

  if (elements.btnMobileIntel) {
    const hasSelection = !!state.selectedEntity;
    elements.btnMobileIntel.disabled = !hasSelection;
    elements.btnMobileIntel.classList.toggle("active", hasSelection && state.intelSheetOpen);
  }
}

function clearLiveTraffic() {
  dynamic.liveTraffic.forEach(entity => viewer.entities.remove(entity));
  dynamic.liveTraffic.length = 0;
}

function addLiveTrafficEntities(records, layerId, color, entityType) {
  records.forEach(record => {
    const entity = viewer.entities.add({
      id: record.id,
      position: Cesium.Cartesian3.fromDegrees(record.lng, record.lat, record.altitude ?? 0),
      point: {
        pixelSize:    layerId === "maritime" ? 7 : 8,
        color,
        outlineColor: Cesium.Color.WHITE.withAlpha(0.6),
        outlineWidth: 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      },
      label: {
        text:           record.label,
        font:           '11px "Share Tech Mono"',
        fillColor:      Cesium.Color.WHITE,
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString("rgba(4,10,18,0.68)"),
        pixelOffset:    new Cesium.Cartesian2(10, -8),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scale: 0.76,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 12000000)
      },
      properties: {
        layerId,
        label:       record.label,
        description: `${record.source} live feed`,
        entityType,
        altitude:    record.altitude ?? 0,
        synthetic:   false
      }
    });
    entity._basePixelSize = layerId === "maritime" ? 7 : 8;
    entity._pulseSeed     = Math.random() * Math.PI * 2;
    dynamic.liveTraffic.push(entity);
  });
}

async function refreshLiveFeeds() {
  if (elements.liveLastRefresh) elements.liveLastRefresh.textContent = "Refreshing feeds\u2026";
  const shimmer = document.getElementById("refresh-shimmer");
  if (shimmer) shimmer.classList.add("active");
  state.liveFeeds = await fetchLiveFeeds();
  if (shimmer) shimmer.classList.remove("active");
  renderFeedStatus();
  renderTrustIndicators();
  // Only clear + recreate entities if at least one feed has data;
  // otherwise keep previous entities visible until next successful refresh
  const hasAdsb = state.liveFeeds.adsb.status === "live" && state.liveFeeds.adsb.records.length;
  const hasAis  = state.liveFeeds.ais.status  === "live" && state.liveFeeds.ais.records.length;
  if (hasAdsb || hasAis) {
    clearLiveTraffic();
    if (hasAdsb) {
      addLiveTrafficEntities(state.liveFeeds.adsb.records, "commercial", Cesium.Color.fromCssColorString("#90f4ff"), "live-adsb");
    }
    if (hasAis) {
      addLiveTrafficEntities(state.liveFeeds.ais.records, "maritime", Cesium.Color.fromCssColorString("#7bffcb"), "live-ais");
    }
  }
  refreshEntityVisibility();
  const now = new Date().toLocaleTimeString([], { hour12: false });
  if (elements.liveLastRefresh) elements.liveLastRefresh.textContent = `Last refresh: ${now} UTC`;
  if (elements.hudStatusMode)   elements.hudStatusMode.textContent   = "LIVE FEED";
  state.nextRefreshAt = Date.now() + state.refreshIntervalSec * 1000;
  state._lastRefreshTime = Date.now();
  updateRefreshCountdown();
  renderLegend();
  renderLayerToggles();

  // Pulse the LIVE badge to indicate fresh data
  const liveBadge = document.querySelector(".hud-live");
  if (liveBadge) {
    liveBadge.classList.add("data-pulse");
    setTimeout(() => liveBadge.classList.remove("data-pulse"), 1200);
  }
}

function pausePassiveSpin(duration = 5000) {
  state.spinPausedUntil = performance.now() + duration;
}

function focusCameraOnCartesian(cartesian, duration = 1.6) {
  if (!cartesian) return;
  const currentHeight = viewer.camera.positionCartographic.height;
  const desiredPitch  = clamp(viewer.camera.pitch, Cesium.Math.toRadians(-82), Cesium.Math.toRadians(-48));
  const desiredRange  = clamp(currentHeight * 0.82, 850000, 4800000);
  viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(cartesian, 1), {
    duration,
    offset: new Cesium.HeadingPitchRange(viewer.camera.heading, desiredPitch, desiredRange)
  });
}

function clickedCartesian(position, picked) {
  if (picked?.id?.position) return picked.id.position.getValue(viewer.clock.currentTime);
  const precise = viewer.scene.pickPositionSupported ? viewer.scene.pickPosition(position) : null;
  return precise ?? viewer.camera.pickEllipsoid(position, viewer.scene.globe.ellipsoid);
}

const DECRYPT_CHARS = "█▓▒░<>/\\|_+-=*#0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function animateDecryptText(element, targetText, duration = 520) {
  if (!element) return;
  const finalText = String(targetText ?? "");
  if (!finalText) {
    element.textContent = "";
    element.classList.remove("is-decrypting");
    return;
  }
  const startedAt = performance.now();
  element.classList.add("is-decrypting");
  let lastTypeFrame = 0;

  function frame(now) {
    const progress = Math.min((now - startedAt) / duration, 1);
    const revealCount = Math.floor(finalText.length * progress);
    // Throttled type sound (max every ~60ms)
    if (revealCount > lastTypeFrame + 2) {
      lastTypeFrame = revealCount;
      sfx.type();
    }
    let scrambled = "";
    for (let index = 0; index < finalText.length; index += 1) {
      const currentChar = finalText[index];
      if (currentChar === " ") {
        scrambled += " ";
        continue;
      }
      if (index < revealCount) {
        scrambled += currentChar;
        continue;
      }
      scrambled += DECRYPT_CHARS[Math.floor(Math.random() * DECRYPT_CHARS.length)];
    }
    element.textContent = scrambled;
    if (progress < 1) {
      requestAnimationFrame(frame);
    } else {
      element.textContent = finalText;
      element.classList.remove("is-decrypting");
    }
  }

  requestAnimationFrame(frame);
}

function computeGeoDistanceKm(latA, lngA, latB, lngB) {
  const toRadians = value => value * Math.PI / 180;
  const dLat = toRadians(latB - latA);
  const dLng = toRadians(lngB - lngA);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(latA)) * Math.cos(toRadians(latB)) * Math.sin(dLng / 2) ** 2;
  return 6371 * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function findNearbyConflictIntel(lat, lng) {
  const alerts = SCENARIO.alerts.map(alert => ({
    kind: "alert",
    title: alert.title,
    summary: getActiveAlertNarrative(alert).summary ?? alert.summary,
    sourceLabel: getActiveAlertNarrative(alert).sourceLabel ?? alert.sourceLabel,
    sourceUrl: getActiveAlertNarrative(alert).sourceUrl ?? alert.sourceUrl,
    distanceKm: computeGeoDistanceKm(lat, lng, alert.location.lat, alert.location.lng),
    severity: 3,
    tags: alert.tags ?? []
  }));
  const incidents = SCENARIO.incidents.map(incident => ({
    kind: "incident",
    title: incident.label,
    summary: getActiveIncidentNarrative(incident).description ?? incident.description,
    sourceLabel: getActiveIncidentNarrative(incident).sourceLabel ?? incident.sourceLabel,
    sourceUrl: getActiveIncidentNarrative(incident).sourceUrl ?? incident.sourceUrl,
    distanceKm: computeGeoDistanceKm(lat, lng, incident.location.lat, incident.location.lng),
    severity: 4,
    tags: incident.tags ?? []
  }));
  const combined = [...alerts, ...incidents].sort((left, right) => {
    if (left.distanceKm !== right.distanceKm) return left.distanceKm - right.distanceKm;
    return right.severity - left.severity;
  });
  const closeMatches = combined.filter(item => item.distanceKm <= 1800).slice(0, 4);
  if (closeMatches.length) return closeMatches;
  return combined.filter(item => item.distanceKm <= 3200).slice(0, 3);
}

function formatDistanceLabel(distanceKm) {
  return distanceKm >= 1000 ? `${(distanceKm / 1000).toFixed(1)} Mm` : `${Math.round(distanceKm)} km`;
}

let _conflictWatchRefreshTimer = null;

function renderConflictIntel(screenX, screenY, lat, lng, geoContext = {}) {
  const box = elements.clickConflictBox;
  if (!box || !elements.ccbList || !elements.ccbTitle) return;
  const areaLabel = [geoContext.city, geoContext.state, geoContext.country].filter(Boolean)[0] || "Selected Area";

  clearInterval(_conflictWatchRefreshTimer);

  const vw = window.innerWidth, vh = window.innerHeight;
  const boxW = 320, boxH = 280;
  let left = screenX + 12, top = screenY + 12;
  if (left + boxW > vw - 16) left = screenX - boxW - 12;
  if (top  + boxH > vh - 16) top  = screenY - boxH - 12;
  box.style.left = `${Math.max(8, left)}px`;
  box.style.top  = `${Math.max(8, top)}px`;
  box.classList.remove("hidden");

  animateDecryptText(elements.ccbTitle, `${areaLabel.toUpperCase()} // LIVE INTELLIGENCE`, 620);

  const loadArticles = () => {
    elements.ccbList.innerHTML = `
      <div class="conflict-articles-skeleton">
        <div class="conflict-skel-line"></div><div class="conflict-skel-line short"></div>
        <div class="conflict-skel-line"></div><div class="conflict-skel-line short"></div>
        <div class="conflict-skel-line"></div><div class="conflict-skel-line short"></div>
      </div>`;

    fetchGdeltArticlesForLocation(geoContext.country || areaLabel, lat, lng)
      .then(articles => {
        if (!box || box.classList.contains("hidden")) return;
        if (!articles.length) {
          const nearby = findNearbyConflictIntel(lat, lng);
          if (!nearby.length) {
            elements.ccbList.innerHTML = `<article class="conflict-card quiet"><strong>No active intelligence for this area</strong><p>No tracked alerts or live articles found nearby.</p></article>`;
          } else {
            elements.ccbList.innerHTML = nearby.map(item => `
              <article class="conflict-card ${item.kind}">
                <div class="conflict-card-head">
                  <span class="conflict-card-kicker">${escapeHtml(item.kind.toUpperCase())}</span>
                  <span class="conflict-card-dist">${Math.round(item.distanceKm)} km</span>
                </div>
                <strong data-decrypt="${escapeHtml(item.title)}">${escapeHtml(item.title)}</strong>
                <p data-decrypt="${escapeHtml(item.summary)}">${escapeHtml(item.summary)}</p>
              </article>`).join("");
            elements.ccbList.querySelectorAll("[data-decrypt]").forEach((node, i) => {
              window.setTimeout(() => animateDecryptText(node, node.getAttribute("data-decrypt") || node.textContent, 480), i * 80);
            });
          }
          return;
        }

        const cats = [...new Set(articles.map(a => a.category).filter(Boolean))];
        const catChips = cats.map(c =>
          `<span class="ccb-cat-chip" style="border-color:${c.color};color:${c.color}">${c.label}</span>`
        ).join("");
        const now = new Date().toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit",timeZone:"UTC"})+" UTC";

        elements.ccbList.innerHTML =
          `<div class="ccb-articles-header"><span class="ccb-cat-chips">${catChips}</span><span class="ccb-updated">↻ ${now}</span></div>` +
          articles.map(art => {
            const catBadge = art.category
              ? `<span class="conflict-article-cat" style="color:${art.category.color}">${art.category.label}</span>`
              : "";
            return `<a class="conflict-article" href="${escapeHtml(art.url)}" target="_blank" rel="noopener noreferrer">
              <div class="conflict-article-kicker">
                <span class="conflict-article-live-dot"></span>
                <span>${escapeHtml(art.domain)}</span>${catBadge}
                <span style="margin-left:auto;opacity:0.6">${escapeHtml(art.time)}</span>
              </div>
              <div class="conflict-article-headline">${escapeHtml(art.title)}</div>
              <div class="conflict-article-meta">↗ Read full article</div>
            </a>`;
          }).join("");
      })
      .catch(() => {
        if (!box.classList.contains("hidden"))
          elements.ccbList.innerHTML = `<article class="conflict-card quiet"><strong>Feed unavailable</strong><p>Unable to reach GDELT at this time.</p></article>`;
      });
  };

  loadArticles();
  _conflictWatchRefreshTimer = setInterval(() => {
    if (box.classList.contains("hidden")) { clearInterval(_conflictWatchRefreshTimer); return; }
    loadArticles();
  }, 5 * 60 * 1000);
}

// ── GDELT real-time article fetch — multi-strategy, conflict-ranked ───────────
const CONFLICT_KEYWORDS  = ["attack","strike","war","conflict","military","troops","killed","missile","bomb","offensive","ceasefire","artillery","drone","sanction","coup","protest","uprising","insurgent","terrorist","crisis","threat","invasion","detention","siege"];
const NOISE_KEYWORDS     = ["football","soccer","cricket","golf","tennis","nba","nfl","recipe","fashion","celebrity","oscar","grammy","box office","movie","film","album"];
const ARTICLE_CATEGORIES = [
  { id:"military",     label:"Military",     color:"#ff6d8d", keys:["military","troops","army","navy","air force","soldier","weapon","missile","drone","tank","artillery","strike","attack","bomb","offensive","ceasefire"] },
  { id:"diplomatic",   label:"Diplomatic",   color:"#7ee0ff", keys:["diplomatic","minister","summit","agreement","treaty","sanction","negotiate","embassy","un ","nato","g7","g20"] },
  { id:"humanitarian", label:"Humanitarian", color:"#60f7bf", keys:["refugee","civilian","humanitarian","aid","displaced","casualt","death","famine","hospital","medical"] },
  { id:"political",    label:"Political",    color:"#af9dff", keys:["government","president","parliament","election","coup","protest","opposition","minister","party"] },
  { id:"economic",     label:"Economic",     color:"#ffbe5c", keys:["economy","oil","gas","energy","sanction","trade","market","inflation","gdp","currency"] },
];

function detectArticleCategory(title) {
  const t = title.toLowerCase();
  for (const cat of ARTICLE_CATEGORIES) {
    if (cat.keys.some(k => t.includes(k))) return cat;
  }
  return null;
}

function scoreArticleRelevance(title, countryName) {
  const t = title.toLowerCase();
  let score = 0;
  if (countryName && t.includes(countryName.toLowerCase())) score += 30;
  CONFLICT_KEYWORDS.forEach(kw => { if (t.includes(kw)) score += 8; });
  if (NOISE_KEYWORDS.some(kw => t.includes(kw))) score -= 50;
  return score;
}

function formatGdeltDate(seendate) {
  if (!seendate) return "Recent";
  try {
    const d = new Date(seendate.replace(
      /(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/,
      "$1-$2-$3T$4:$5:$6Z"
    ));
    const diff = Math.round((Date.now() - d) / 60000);
    if (diff < 1)   return "Just now";
    if (diff < 60)  return `${diff}m ago`;
    if (diff < 1440) return `${Math.round(diff/60)}h ago`;
    return d.toLocaleDateString("en-US", { month:"short", day:"numeric" });
  } catch { return "Recent"; }
}

// Map lat/lng to regional intelligence keywords for GDELT fallback queries
function latLngToRegionKeywords(lat, lng) {
  if (lat > 55  && lng > -30  && lng <  45) return '"Russia" OR "Ukraine" OR "NATO" OR "Baltic"';
  if (lat > 45  && lng > -10  && lng <  45) return '"Europe" OR "EU" OR "NATO"';
  if (lat > 25  && lat < 50   && lng >  25 && lng <  65) return '"Middle East" OR "Iran" OR "Iraq" OR "Syria" OR "Turkey"';
  if (lat > 15  && lat < 35   && lng >  25 && lng <  55) return '"Israel" OR "Gaza" OR "Lebanon" OR "Red Sea"';
  if (lat >  0  && lat < 40   && lng >  55 && lng < 100) return '"South Asia" OR "India" OR "Pakistan" OR "Afghanistan"';
  if (lat > -15 && lat < 40   && lng > -20 && lng <  55) return '"Africa" OR "Sudan" OR "Ethiopia" OR "Somalia" OR "Sahel"';
  if (lat >  0  && lng > 100  && lng < 150) return '"Asia Pacific" OR "China" OR "Taiwan" OR "Philippines" OR "South China Sea"';
  if (lat > 25  && lat < 45   && lng > 105 && lng < 145) return '"East Asia" OR "China" OR "Japan" OR "Korea"';
  if (lat > -60 && lat <  15  && lng > -85 && lng < -35) return '"Latin America" OR "Venezuela" OR "Colombia" OR "Haiti"';
  if (lat >  0  && lat < 30   && lng > 100 && lng < 110) return '"Southeast Asia" OR "Myanmar" OR "Vietnam" OR "Thailand"';
  return '(conflict OR military OR attack OR crisis OR security)';
}

async function gdeltDocFetch(query, maxrecords = 5) {
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=artlist&maxrecords=${maxrecords}&timespan=48h&sort=DateDesc&format=json`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(9000) });
  if (!resp.ok) return [];
  const data = await resp.json();
  return Array.isArray(data?.articles) ? data.articles : [];
}

async function fetchGdeltArticlesForLocation(countryOrArea, lat, lng) {
  const name    = (countryOrArea || "").trim();
  const iso3    = _countryIsoMap[name.toLowerCase()] ?? "";
  const safeName = name.replace(/[^\w\s\-]/g, "").trim();

  // Strategy chain — most specific → most lenient
  const strategies = [
    // 1. Country code filter + conflict terms (most precise for known countries)
    iso3 ? `country:${iso3} (conflict OR military OR security OR attack OR crisis)` : null,
    // 2. Exact country name + conflict terms
    safeName ? `"${safeName}" (conflict OR military OR attack OR war OR crisis OR security)` : null,
    // 3. Country name alone (catches diplomatic, economic, etc.)
    safeName ? `"${safeName}"` : null,
    // 4. Regional keyword fallback — catches obscure areas by geographic region
    (lat != null && lng != null) ? `${latLngToRegionKeywords(lat, lng)} (conflict OR military OR attack OR crisis)` : null,
  ].filter(Boolean);

  let raw = [];
  for (const strategy of strategies) {
    try {
      raw = await gdeltDocFetch(strategy, 8);
      // Keep articles with some title length
      raw = raw.filter(a => a.title?.length > 20 && a.url);
      if (raw.length >= 2) break; // good enough — stop trying
    } catch { /* try next strategy */ }
  }

  if (!raw.length) return [];

  // Score, filter noise, deduplicate by domain
  const seenDomains = new Set();
  return raw
    .map(a => {
      const score = scoreArticleRelevance(a.title, name);
      const cat   = detectArticleCategory(a.title);
      let domain  = a.domain ?? "";
      try { if (!domain) domain = new URL(a.url).hostname.replace(/^www\./, ""); } catch {}
      return { ...a, _score: score, _cat: cat, _domain: domain };
    })
    .filter(a => a._score > -20) // drop obvious noise
    .sort((a, b) => b._score - a._score)
    .filter(a => { // deduplicate by domain (keep top article per source)
      if (seenDomains.has(a._domain)) return false;
      seenDomains.add(a._domain);
      return true;
    })
    .slice(0, 4)
    .map(a => ({
      title:    a.title,
      url:      a.url,
      domain:   a._domain,
      time:     formatGdeltDate(a.seendate),
      category: a._cat,
      score:    a._score,
    }));
}

function getEntityInfo(entity) {
  if (!entity) return null;
  const props       = entity.properties;
  const label       = props?.label?.getValue?.(viewer.clock.currentTime)       ?? entity.id;
  const description = props?.description?.getValue?.(viewer.clock.currentTime) ?? "";
  const type        = props?.entityType?.getValue?.(viewer.clock.currentTime)  ?? "unknown";
  const position    = entity.position?.getValue?.(viewer.clock.currentTime);
  let locationMeta  = "Static overlay";
  if (position) {
    const cg = Cesium.Cartographic.fromCartesian(position);
    locationMeta = `${Cesium.Math.toDegrees(cg.latitude).toFixed(2)}\u00b0, ${Cesium.Math.toDegrees(cg.longitude).toFixed(2)}\u00b0`;
  }
  const altitude    = props?.altitude?.getValue?.(viewer.clock.currentTime) ?? 0;
  const synthetic   = !!props?.synthetic?.getValue?.(viewer.clock.currentTime);
  const articleUrl  = props?.articleUrl?.getValue?.(viewer.clock.currentTime) ?? "";
  const articleLang = props?.articleLang?.getValue?.(viewer.clock.currentTime) ?? "";
  const articleDomain = props?.articleDomain?.getValue?.(viewer.clock.currentTime) ?? "";
  return { label, description, type, locationMeta, altitude, synthetic, entityId: entity.id, articleUrl, articleLang, articleDomain };
}

function hideHoverTooltip() { elements.hoverTooltip.classList.add("hidden"); }

function showCountryNameTooltip(name, screenPosition) {
  if (!elements.hoverTooltip) return;
  elements.hoverTooltip.innerHTML = `
    <strong>${escapeHtml(name.toUpperCase())}</strong>
    <span style="opacity:0.55;font-size:10px;letter-spacing:0.08em">TERRITORY</span>
  `;
  elements.hoverTooltip.style.left = `${screenPosition.x + 18}px`;
  elements.hoverTooltip.style.top  = `${screenPosition.y - 8}px`;
  elements.hoverTooltip.classList.remove("hidden");
}

// ── Country 3D popup (shown after 2s hover on same country) ──────────────────
let _countryPopupEl     = null;
let _countryPopupTimer  = null;
let _countryPopupActive = "";

function getCountryPopupEl() {
  if (!_countryPopupEl) _countryPopupEl = document.getElementById("country-popup");
  return _countryPopupEl;
}

function showCountryPopup(name, x, y) {
  const el = getCountryPopupEl();
  if (!el) return;
  const nameEl = el.querySelector("#country-popup-name");
  const subEl  = el.querySelector("#country-popup-sub");
  if (nameEl) nameEl.textContent = name.toUpperCase();
  if (subEl)  subEl.textContent  = "TERRITORY // HOVER";
  // Position above cursor, centred
  el.style.left = `${x}px`;
  el.style.top  = `${y - 80}px`;
  el.style.transform = "translateX(-50%) translateY(14px) scale(0.88)";
  // Force reflow then animate in
  void el.offsetWidth;
  el.style.transform = "";
  el.classList.add("visible");
  _countryPopupActive = name;
}

function hideCountryPopup() {
  const el = getCountryPopupEl();
  if (el) el.classList.remove("visible");
  _countryPopupActive = "";
  clearTimeout(_countryPopupTimer);
}

function showHoverTooltip(entity, screenPosition) {
  const info = getEntityInfo(entity);
  if (!info) { hideHoverTooltip(); return; }
  const isEvent = info.type === "event-visual" || info.type === "event-cone" || info.type === "event-trail";
  const articleLine = isEvent && info.articleUrl
    ? `<span class="tooltip-article-hint">${escapeHtml(info.articleDomain || "Source article")} ↗</span>`
    : "";
  const langLine = isEvent && info.articleLang && isNonEnglish(info.articleLang)
    ? `<span class="tooltip-lang">${escapeHtml(langDisplayName(info.articleLang))}</span>`
    : "";
  const typeDisplay = isEvent ? "LIVE EVENT" : info.type.toUpperCase();
  // Try to get entity coordinates
  let coordLine = "";
  if (entity.position) {
    try {
      const pos = entity.position.getValue ? entity.position.getValue(viewer.clock.currentTime) : entity.position;
      if (pos) {
        const cg = Cesium.Cartographic.fromCartesian(pos);
        const lat = Cesium.Math.toDegrees(cg.latitude).toFixed(2);
        const lng = Cesium.Math.toDegrees(cg.longitude).toFixed(2);
        coordLine = `<span class="tooltip-coords">${lat}° ${lng}°</span>`;
      }
    } catch { /* ignore */ }
  }
  elements.hoverTooltip.innerHTML = `
    <strong>${escapeHtml(info.label)}</strong>
    <span>${escapeHtml(typeDisplay)}</span>
    <p>${escapeHtml(info.description || info.locationMeta)}</p>
    ${coordLine}${langLine}${articleLine}
  `;
  elements.hoverTooltip.style.left = `${screenPosition.x + 18}px`;
  elements.hoverTooltip.style.top  = `${screenPosition.y + 18}px`;
  elements.hoverTooltip.classList.remove("hidden");
}

function updateSelectedEntityCard(entity) {
  if (!entity) {
    elements.entityInfo.classList.add("empty");
    elements.entityInfo.innerHTML = "Select a track, satellite, ship, event, or zone on the globe.";
    updateTrackButtons();
    return;
  }
  elements.entityInfo.classList.remove("empty");
  const { label, description, type, locationMeta, altitude, synthetic, entityId, articleUrl, articleLang, articleDomain } = getEntityInfo(entity);
  const incident = type === "incident" ? findScenarioIncidentById(entityId) : null;
  const incidentNarrative = incident ? getActiveIncidentNarrative(incident) : null;
  const effectiveDescription = incidentNarrative?.description ?? description;

  // Article source link — from scenario incidents OR from event-visual news links
  const isEventVisual = type === "event-visual" || type === "event-cone" || type === "event-trail";
  let sourceMarkup;
  if (incidentNarrative?.sourceUrl) {
    sourceMarkup = `<a class="entity-source-link" href="${escapeHtml(incidentNarrative.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(incidentNarrative.sourceLabel || "Source article")} ↗</a>`;
  } else if (incidentNarrative?.sourceLabel) {
    sourceMarkup = `<span class="entity-source-text">${escapeHtml(incidentNarrative.sourceLabel)}</span>`;
  } else if (isEventVisual && articleUrl) {
    const langNote = articleLang && isNonEnglish(articleLang)
      ? ` <span class="entity-lang-chip">${escapeHtml(langDisplayName(articleLang))}</span>`
      : "";
    sourceMarkup = `<a class="entity-source-link" href="${escapeHtml(articleUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(articleDomain || "Read article")} ↗</a>${langNote}`;
  } else {
    sourceMarkup = "";
  }
  const typeDisplay = isEventVisual ? "LIVE EVENT" : type.toUpperCase();
  elements.entityInfo.innerHTML = `
    <strong>${escapeHtml(label)}</strong>
    <div>${escapeHtml(effectiveDescription)}</div>
    ${sourceMarkup}
    <div class="entity-meta">
      <span>${escapeHtml(typeDisplay)}</span>
      <span>${escapeHtml(locationMeta)}</span>
    </div>
    <div class="entity-stats">
      <span>ALT ${altitude > 0 ? Math.round(altitude).toLocaleString() + ' m' : '—'}</span>
      <span>${synthetic ? "AUX MODEL" : "PRIMARY TRACK"}</span>
      <span>LIVE</span>
    </div>
  `;
  elements.entityInfo.onclick = (e) => { if (e.target.closest('a')) return; openIntelSheet(entity); };
  updateTrackButtons();
}

function updateTrackButtons() {
  const canTrack = !!state.selectedEntity && !!state.selectedEntity.position;
  elements.trackSelected.disabled = !canTrack;
  elements.releaseTrack.disabled  = !state.trackedEntity;
  updateOperationsControls();
  syncMobileActionButtons();
}

function saveCurrentBookmark() {
  const next = {
    id:    `bookmark-${Date.now()}`,
    label: `View ${state.bookmarks.length + 1}`,
    destination: captureCameraDestination()
  };
  state.bookmarks = [...state.bookmarks, next].slice(-8);
  saveJson(STORAGE_KEYS.bookmarks, state.bookmarks);
  sfx.success();
  renderBookmarks();
}

function removeBookmark(id) {
  state.bookmarks = state.bookmarks.filter(b => b.id !== id);
  saveJson(STORAGE_KEYS.bookmarks, state.bookmarks);
  renderBookmarks();
}

function flyToBookmark(bookmark) {
  flyToDestination(bookmark.destination, undefined, 1.4);
}

function installBasemap(basemapId) {
  state.basemapId = basemapId;
  saveJson(STORAGE_KEYS.basemap, basemapId);
  viewer.imageryLayers.removeAll();
  const bm = BASEMAPS.find(b => b.id === basemapId) || BASEMAPS[0];
  const provider = bm.type === "osm"
    ? new Cesium.OpenStreetMapImageryProvider({ url: bm.url })
    : new Cesium.UrlTemplateImageryProvider({ url: bm.url, credit: bm.credit });
  viewer.imageryLayers.addImageryProvider(provider);
  renderBasemapButtons();
}

function applyFxMode(mode) {
  document.body.dataset.fxMode = mode;
  const isWarroom = mode === "warroom";
  postStages.blackAndWhite.enabled             = mode === "nightvision" || mode === "thermal";
  postStages.blackAndWhite.uniforms.gradations = mode === "thermal" ? 8 : 14;
  postStages.brightness.enabled                = mode !== "normal";
  postStages.brightness.uniforms.brightness    = mode === "nightvision" ? 0.08 : mode === "thermal" ? 0.15 : mode === "crt" ? 0.05 : isWarroom ? 0.03 : 0;
  if (isWarroom && bloomStage) {
    bloomStage.uniforms.brightness = 0.05;
    bloomStage.uniforms.delta      = 2.5;
    bloomStage.uniforms.sigma      = 3.2;
  }
}

function applyFxIntensity() {
  if (elements.fxIntensityValue) elements.fxIntensityValue.textContent = String(state.fxIntensity);
  document.documentElement.style.setProperty("--fx-intensity", String(state.fxIntensity / 100));
}

function applyGlow() {
  if (elements.fxGlowValue) elements.fxGlowValue.textContent = String(state.fxGlow);
  if (!bloomStage) return;
  bloomStage.uniforms.glowOnly   = false;
  bloomStage.uniforms.contrast   = 128 - state.fxGlow * 0.4;
  bloomStage.uniforms.brightness = -0.15 + state.fxGlow / 300;
  bloomStage.uniforms.delta      = 1 + state.fxGlow / 60;
  bloomStage.uniforms.sigma      = 2 + state.fxGlow / 24;
  bloomStage.uniforms.stepSize   = 3 + state.fxGlow / 35;
}

function startHudClock() {
  window.setInterval(() => {
    const now = new Date();
    if (elements.hudUtc)      elements.hudUtc.textContent      = `UTC ${now.toUTCString().slice(17, 25)}`;
    if (elements.hudLocal)    elements.hudLocal.textContent    = `LOCAL ${now.toLocaleTimeString([], { hour12: false })}`;
    if (elements.summaryTime) elements.summaryTime.textContent = `${now.toUTCString().slice(17, 25)} UTC`;
    updateRefreshCountdown();
  }, 250);
}

function updateRefreshCountdown() {
  if (!elements.liveNextRefresh) return;
  if (!state.nextRefreshAt) {
    elements.liveNextRefresh.textContent = "Next refresh pending";
    return;
  }
  const remainingMs = state.nextRefreshAt - Date.now();
  if (remainingMs <= 0) {
    elements.liveNextRefresh.textContent = "Refreshing now…";
    return;
  }
  const remainingSec = Math.max(1, Math.ceil(remainingMs / 1000));
  elements.liveNextRefresh.textContent = `Next refresh in ${remainingSec}s`;
}

function updateFps() {
  const now = performance.now();
  frameSamples.push(now);
  frameSamples = frameSamples.filter(s => now - s < 1000);
  if (elements.hudFps) elements.hudFps.textContent = `${frameSamples.length} FPS`;
  adaptResolutionScale(frameSamples.length);
}

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

// ─────────────────────────────────────────────────────────────────────────────
// BOOT INTRO CINEMATIC
// ─────────────────────────────────────────────────────────────────────────────

function startBootIntro() {
  const overlay    = elements.bootOverlay;
  const fillEl     = elements.bootProgressFill;
  const statusEl   = elements.bootStatus;
  if (!overlay || !fillEl || !statusEl) {
    if (overlay) overlay.style.display = "none";
    return;
  }

  overlay.classList.remove("boot-fading");
  overlay.style.display = "";

  const quickBoot = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    || window.sessionStorage.getItem(BOOT_SESSION_KEY) === "1";

  if (quickBoot) {
    fillEl.style.width = "100%";
    statusEl.textContent = "● GOD'S THIRD EYE ONLINE";
    finishBoot({ immediate: true });
    return;
  }

  let stepIdx = 0;
  const STEP_DELAY = 180;
  const bootTimeout = setTimeout(() => { finishBoot(); }, 4800);
  const bootLog = document.getElementById("boot-log");

  const LOG_LINES = [
    "[SYS] Kernel handshake .............. OK",
    "[NET] OpenSky ADS-B uplink .......... LIVE",
    "[GEO] CesiumJS WebGL renderer ....... OK",
    "[INT] GDELT 2.0 news pipeline ....... LIVE",
    "[SAT] ISS orbital telemetry ......... LIVE",
    "[SES] USGS seismic feed (M2.5+) ..... LIVE",
    "[AIS] Maritime AIS decoder .......... STANDBY",
    "[INC] Incident pool (30 zones) ...... ARMED",
    "[HUD] Tactical HUD · 6 layers ....... OK",
    "[GPU] WebGL context · bloom · FXAA .. OK",
    "[BC]  8 broadcast channels .......... READY",
    "[SYS] All subsystems nominal — PANOPTICON EARTH ONLINE",
  ];

  function appendBootLog(idx) {
    if (!bootLog || idx >= LOG_LINES.length) return;
    const line = document.createElement("div");
    line.className = "boot-log-line" + (idx === LOG_LINES.length - 1 ? " ok" : "");
    line.textContent = LOG_LINES[idx];
    bootLog.appendChild(line);
    // Keep max 8 visible lines
    while (bootLog.children.length > 8) bootLog.removeChild(bootLog.firstChild);
  }

  function runStep() {
    if (stepIdx >= BOOT_STEPS.length) {
      clearTimeout(bootTimeout);
      finishBoot();
      return;
    }
    const { pct, msg } = BOOT_STEPS[stepIdx];
    if (fillEl)   fillEl.style.width = `${pct}%`;
    if (statusEl) statusEl.textContent = msg;
    appendBootLog(stepIdx);
    stepIdx++;
    setTimeout(runStep, STEP_DELAY);
  }

  setTimeout(runStep, 140);
}

function finishBoot({ immediate = false } = {}) {
  const overlay = elements.bootOverlay;
  if (!overlay) return;

  const finishOverlay = () => {
    overlay.classList.add("boot-fading");
    overlay.style.pointerEvents = "none";
    document.body.classList.add("boot-complete");
    pulseConsoleFrame("boot");
    applyCleanLandingLayout();
    startAmbientUpdates();
    startIncidentCycling();
    initPresenceLayer();
    initCountryOverlay();
    initOperatorSystem();
    initBroadcastSystem();
    initLiveDataLayers();
    setTimeout(initSituationBriefing, 2200);
    updateSummaryHint();
    // ── Audio engine: first gesture already happened (boot overlay click) ──
    initAudioEngine();
    sfx.startAmbient();
    try {
      window.sessionStorage.setItem(BOOT_SESSION_KEY, "1");
    } catch {
      // Ignore unavailable session storage.
    }
    // After boot animations finish, remove animation classes so
    // panel-hidden / panel-minimized CSS takes effect properly.
    setTimeout(() => {
      document.body.classList.remove("ui-booting");
      document.querySelectorAll(".draggable-panel, #hud-top, #hud-bottom, .news-toggle-btn").forEach(el => {
        el.style.animation = "none";
      });
      // Re-apply stored panel state now that animations are cleared
      applyStoredPanelState();
    }, immediate ? 200 : 900);
    setTimeout(() => {
      overlay.style.display = "none";
      overlay.remove();
      // Show first-visit tip
      if (!localStorage.getItem("ge-visited")) {
        localStorage.setItem("ge-visited", "1");
        setTimeout(() => {
          showToast("Press ? for keyboard shortcuts · Backtick for console", "info");
        }, 2000);
      }
    }, immediate ? 120 : 560);
  };

  if (immediate) {
    finishOverlay();
    return;
  }

  const shutterTop    = overlay.querySelector(".boot-shutter-top");
  const shutterBottom = overlay.querySelector(".boot-shutter-bottom");
  if (shutterTop)    shutterTop.classList.add("open");
  if (shutterBottom) shutterBottom.classList.add("open");

  viewer.camera.flyTo({
    destination: homeView,
    orientation: {
      heading: STARTUP_VIEW.heading,
      pitch:   STARTUP_VIEW.pitch,
      roll:    STARTUP_VIEW.roll
    },
    duration: 0.9,
    complete: () => {
      startGlobeSpinDown();
    }
  });

  setTimeout(finishOverlay, 320);
}

function applyCleanLandingLayout() {
  if (window.innerWidth <= 980) return;
  setPanelMinimized("panel-right", true);
  setPanelMinimized("floating-summary", true);
  setPanelHidden("map-legend", true);
  refreshPanelRestoreStrip();
}

function pulseConsoleFrame(mode = "click") {
  const frame = elements.consoleFrame;
  if (!frame) return;
  frame.classList.remove("console-frame-pulse", "console-frame-boot-pulse", "console-frame-scan-burst");
  void frame.offsetWidth;
  frame.classList.add(mode === "boot" ? "console-frame-boot-pulse" : "console-frame-pulse");
  frame.classList.add("console-frame-scan-burst");
  if (_consolePulseTimer) window.clearTimeout(_consolePulseTimer);
  _consolePulseTimer = window.setTimeout(() => {
    frame.classList.remove("console-frame-pulse", "console-frame-boot-pulse", "console-frame-scan-burst");
  }, mode === "boot" ? 1800 : 900);
}

function initCinematicUi() {
  document.body.classList.add("ui-booting");

  const zoneBindings = [
    [document.getElementById("panel-layers"), "left"],
    [document.getElementById("map-legend"), "left"],
    [document.getElementById("panel-right"), "right"],
    [document.getElementById("floating-summary"), "center"],
    [document.getElementById("hud-top"), "top"],
    [document.getElementById("hud-bottom"), "bottom"],
    [document.getElementById("news-briefing"), "right"]
  ];

  zoneBindings.forEach(([node, zone]) => {
    if (!(node instanceof HTMLElement)) return;
    node.addEventListener("mouseenter", () => {
      document.body.dataset.consoleFocus = zone;
    });
    node.addEventListener("mouseleave", () => {
      if (document.body.dataset.consoleFocus === zone) delete document.body.dataset.consoleFocus;
    });
  });

  document.querySelectorAll(".hud-action, .panel-btn, .transport-btn, .news-btn, .search-btn").forEach(node => {
    if (!(node instanceof HTMLElement)) return;
    node.addEventListener("mouseenter", () => pulseConsoleFrame("hover"));
  });

  // ── Settings gear button ──
  document.getElementById("btn-settings")?.addEventListener("click", openSettings);
  document.getElementById("btn-mobile-settings")?.addEventListener("click", openSettings);

  // ── Audio toggle button ──
  const audioBtn = document.getElementById("btn-audio-toggle");
  if (audioBtn) {
    syncAudioIcon();
    audioBtn.addEventListener("click", () => {
      initAudioEngine();
      setAudioEnabled(!isAudioEnabled());
      syncAudioIcon();
      sfx.click();
    });
  }

  // ── Terminal CLI ──
  initTerminalCli();

  // ── Click sound on all interactive elements ──
  document.addEventListener("click", (e) => {
    const t = e.target;
    if (t.closest("button, .panel-btn, .hud-action, .layer-toggle, .camera-preset-btn, .news-btn, .transport-btn, .search-btn, .fx-mode-btn, .basemap-btn")) {
      sfx.click();
    }
  }, { passive: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// HEADER COLLAPSE TOGGLE
// ─────────────────────────────────────────────────────────────────────────────
function initHeaderToggle() {
  const btn    = document.getElementById("header-toggle-btn");
  const hudTop = document.getElementById("hud-top");
  if (!btn || !hudTop) return;

  const STORAGE_KEY_HDR = "panopticon-hdr-collapsed";
  let collapsed = localStorage.getItem(STORAGE_KEY_HDR) === "1";

  function apply(animate) {
    document.body.classList.toggle("header-collapsed", collapsed);
    positionBtn();
  }

  function positionBtn() {
    if (collapsed) {
      btn.style.top = "0";
    } else {
      const rect = hudTop.getBoundingClientRect();
      btn.style.top = rect.bottom + "px";
    }
  }

  // Initial state
  apply(false);

  btn.addEventListener("click", () => {
    collapsed = !collapsed;
    localStorage.setItem(STORAGE_KEY_HDR, collapsed ? "1" : "0");
    apply(true);
    if (typeof sfx !== "undefined") sfx.click();
  });

  // Reposition after transitions and on resize
  hudTop.addEventListener("transitionend", positionBtn);
  window.addEventListener("resize", positionBtn);
}

// ─────────────────────────────────────────────────────────────────────────────
// TERMINAL CLI
// ─────────────────────────────────────────────────────────────────────────────
function initTerminalCli() {
  const cliWrap  = document.getElementById("terminal-cli");
  const cliInput = document.getElementById("terminal-cli-input");
  const cliOut   = document.getElementById("terminal-cli-output");
  if (!cliWrap || !cliInput) return;

  let cliVisible = false;

  function toggleCli(show) {
    cliVisible = typeof show === "boolean" ? show : !cliVisible;
    cliWrap.classList.toggle("hidden", !cliVisible);
    if (cliVisible) { sfx.panelOpen(); cliInput.focus(); } else { sfx.panelClose(); }
  }

  // Backtick (`) or Ctrl+/ toggles the terminal
  document.addEventListener("keydown", (e) => {
    if (e.key === "`" && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (document.activeElement === cliInput) { toggleCli(false); return; }
      if (document.activeElement?.tagName === "INPUT" || document.activeElement?.tagName === "TEXTAREA") return;
      e.preventDefault();
      toggleCli();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "/") {
      e.preventDefault();
      toggleCli();
    }
    if (e.key === "Escape" && cliVisible) {
      toggleCli(false);
    }
  });

  function appendOutput(text, cls = "cmd-info") {
    if (!cliOut) return;
    const line = document.createElement("div");
    line.className = `cmd-line ${cls}`;
    // Support multiline output
    if (text.includes("\n")) {
      line.style.whiteSpace = "pre-wrap";
    }
    line.textContent = text;
    cliOut.appendChild(line);
    cliOut.scrollTop = cliOut.scrollHeight;
    // Auto-clear old lines
    while (cliOut.children.length > 50) cliOut.removeChild(cliOut.firstChild);
  }

  const _cmdHistory = [];
  let _cmdHistoryIdx = 0;

  function runCommand(raw) {
    const input = raw.trim();
    if (!input) return;
    sfx.type();
    _cmdHistory.push(input);
    _cmdHistoryIdx = _cmdHistory.length;

    const parts = input.split(/\s+/);
    const cmd   = parts[0].toLowerCase();
    const arg   = parts.slice(1).join(" ");

    switch (cmd) {
      case "/help":
        appendOutput("Commands: /focus <region> · /mode <fx> · /alert <level> · /scan · /warroom · /normal · /stats · /events · /country <name> · /refresh · /screenshot · /theme · /fullscreen · /cycle · /borders [on|off] · /broadcast [off] · /iss · /quake · /goto <lat,lng> · /layers · /layer toggle <id> · /fly <dest> · /perf · /reset · /search <term> · /time · /opacity <0-1> · /summary · /bookmark <name> · /measure · /export · /clear · /settings · /locate · /toast <msg> · /spin · /uptime · /version · /help", "cmd-info");
        break;

      case "/focus": {
        const preset = CAMERA_PRESETS.find(p => p.label.toLowerCase().includes(arg.toLowerCase()));
        if (preset) {
          appendOutput(`FOCUS → ${preset.label}`, "cmd-ok");
          state.regionFocus = preset.regionFocus ?? null;
          flyToDestination(preset.destination, () => {
            if (preset.regionFocus) applyRegionalContext(preset.regionFocus, preset.destination.lng, preset.destination.lat);
          }, 2.1);
        } else {
          appendOutput(`Unknown region: ${arg}. Try: gulf, europe, pacific`, "cmd-err");
        }
        break;
      }

      case "/mode": {
        const mode = FX_MODES.find(m => m.id === arg.toLowerCase() || m.label.toLowerCase() === arg.toLowerCase());
        if (mode) {
          appendOutput(`FX MODE → ${mode.label}`, "cmd-ok");
          state.fxMode = mode.id;
          applyFxMode(mode.id);
        } else {
          appendOutput(`Unknown mode: ${arg}. Try: normal, nightvision, thermal, crt, warroom`, "cmd-err");
        }
        break;
      }

      case "/warroom":
        appendOutput("WAR ROOM ENGAGED", "cmd-warn");
        state.fxMode = "warroom";
        applyFxMode("warroom");
        break;

      case "/normal":
        appendOutput("Normal mode restored", "cmd-ok");
        state.fxMode = "normal";
        applyFxMode("normal");
        break;

      case "/alert": {
        const lvl = parseInt(arg) || 0;
        appendOutput(`THREAT LEVEL OVERRIDE → ${Math.min(100, Math.max(0, lvl))}%`, "cmd-warn");
        if (elements.threatFill) elements.threatFill.style.width = `${Math.min(100, Math.max(0, lvl))}%`;
        sfx.alert();
        break;
      }

      case "/scan":
        appendOutput("Initiating regional scan sweep…", "cmd-info");
        sfx.ping();
        pulseConsoleFrame("scan");
        break;

      case "/clear":
        if (cliOut) cliOut.innerHTML = "";
        break;

      case "/stats": {
        const s = getSessionSummary();
        appendOutput(`SESSION: ${s.duration} uptime · ${s.eventsSpawned} events · ${s.countriesSeen} countries · ${s.articlesIngested} articles`, "cmd-info");
        break;
      }

      case "/events":
        appendOutput(`Active events: ${dynamic.eventVisuals.length} (${dynamic.eventVisuals.filter(v => v.geoSpawned).length} geo-sourced)`, "cmd-info");
        break;

      case "/country": {
        if (!arg) { appendOutput("Usage: /country <name>", "cmd-err"); break; }
        const match = Object.entries(COUNTRY_COORDS).find(([k]) => k.includes(arg.toLowerCase()));
        if (match) {
          const [name, coords] = match;
          appendOutput(`FOCUS → ${name.split(" ").map(w => w[0].toUpperCase() + w.slice(1)).join(" ")} (${coords.lat}°, ${coords.lng}°)`, "cmd-ok");
          viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(coords.lng, coords.lat, 2500000),
            duration: 1.8
          });
        } else {
          appendOutput(`Country not found: ${arg}`, "cmd-err");
        }
        break;
      }

      case "/refresh":
        appendOutput("Force-refreshing all live feeds…", "cmd-info");
        refreshLiveFeeds();
        break;

      case "/screenshot":
        captureGlobeScreenshot();
        appendOutput("Screenshot captured — downloading…", "cmd-ok");
        break;

      case "/theme":
        toggleDarkTheme();
        appendOutput(`Theme: ${_ultraDark ? "ultra-dark" : "normal"}`, "cmd-ok");
        break;

      case "/fullscreen":
        toggleFullscreen();
        appendOutput(document.fullscreenElement ? "Exiting fullscreen…" : "Entering fullscreen…", "cmd-ok");
        break;

      case "/uptime": {
        const summary = getSessionSummary();
        appendOutput(`Session uptime: ${summary.duration} · ${summary.eventsSpawned} events · ${summary.countriesSeen} countries · ${summary.articlesIngested} articles`, "cmd-ok");
        break;
      }

      case "/goto": {
        const coords = arg.split(/[,\s]+/).map(Number).filter(n => !isNaN(n));
        if (coords.length >= 2) {
          const [lat, lng] = coords;
          const alt = coords[2] || 2000000;
          appendOutput(`Flying to ${lat.toFixed(2)}, ${lng.toFixed(2)} at ${(alt/1000).toFixed(0)}km`, "cmd-ok");
          pausePassiveSpin(8000);
          viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(lng, lat, alt),
            duration: 2.5
          });
        } else {
          appendOutput("Usage: /goto <lat>, <lng> [, alt]  e.g. /goto 48.85, 2.35", "cmd-err");
        }
        break;
      }

      case "/layers": {
        const layers = state.layerVisibility;
        const lines = Object.entries(layers).map(([id, vis]) => `  ${vis ? "●" : "○"} ${id}`);
        appendOutput("Active layers:\n" + lines.join("\n"), "cmd-info");
        break;
      }

      case "/fly": {
        const presetNames = CAMERA_PRESETS.map(p => p.label).join(", ");
        if (!arg) {
          appendOutput(`Available: ${presetNames}`, "cmd-info");
        } else {
          const preset = CAMERA_PRESETS.find(p => p.label.toLowerCase().includes(arg.toLowerCase()));
          if (preset) {
            appendOutput(`Flying to ${preset.label}`, "cmd-ok");
            pausePassiveSpin(8000);
            flyToDestination(preset.destination, null, 2.5);
          } else {
            appendOutput(`Unknown destination. Available: ${presetNames}`, "cmd-err");
          }
        }
        break;
      }

      case "/perf": {
        const totalEntities = viewer.entities.values.length;
        const fps = frameSamples.length;
        const mem = performance.memory ? `${(performance.memory.usedJSHeapSize / 1048576).toFixed(1)} MB` : "N/A";
        const lines = [
          `Entities: ${totalEntities}`,
          `Events: ${dynamic.eventVisuals.length}`,
          `Connections: ${dynamic.connectionLines.length}`,
          `FPS: ${fps}`,
          `Memory: ${mem}`,
          `Imagery layers: ${viewer.imageryLayers.length}`,
        ];
        appendOutput("Performance:\n" + lines.join("\n"), "cmd-info");
        break;
      }

      case "/reset": {
        appendOutput("Resetting camera to home view…", "cmd-ok");
        navFlyHome();
        break;
      }

      case "/search": {
        if (!arg) {
          appendOutput("Usage: /search <keyword>  — search entity names", "cmd-info");
        } else {
          const q = arg.toLowerCase();
          const hits = viewer.entities.values.filter(e => {
            const n = e.name || "";
            return n.toLowerCase().includes(q);
          });
          if (hits.length === 0) {
            appendOutput(`No entities matching "${arg}"`, "cmd-err");
          } else {
            const names = hits.slice(0, 10).map(e => e.name).join(", ");
            appendOutput(`Found ${hits.length} entit${hits.length === 1 ? "y" : "ies"}: ${names}${hits.length > 10 ? "…" : ""}`, "cmd-ok");
            // Fly to first match
            if (hits[0].position) {
              const pos = hits[0].position.getValue ? hits[0].position.getValue(Cesium.JulianDate.now()) : hits[0].position;
              if (pos) {
                const carto = Cesium.Cartographic.fromCartesian(pos);
                pausePassiveSpin(6000);
                viewer.camera.flyTo({
                  destination: Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, 2000000),
                  duration: 2.0
                });
              }
            }
          }
        }
        break;
      }

      case "/time": {
        const now = new Date();
        const utc = now.toISOString().replace("T", " ").split(".")[0] + " UTC";
        const local = now.toLocaleTimeString();
        const up = document.getElementById("session-uptime");
        appendOutput(`UTC: ${utc}\nLocal: ${local}\nSession: ${up ? up.textContent : "N/A"}`, "cmd-info");
        break;
      }

      case "/opacity": {
        const val = parseFloat(arg);
        if (isNaN(val) || val < 0 || val > 1) {
          appendOutput("Usage: /opacity <0-1>  — set globe base opacity", "cmd-info");
        } else {
          viewer.scene.globe.baseColor = Cesium.Color.fromAlpha(Cesium.Color.BLACK, val);
          appendOutput(`Globe opacity set to ${val}`, "cmd-ok");
        }
        break;
      }

      case "/summary": {
        const totalEntities = viewer.entities.values.length;
        const events = dynamic.eventVisuals.length;
        const conns = dynamic.connectionLines.length;
        const upEl = document.getElementById("session-uptime");
        const uptime = upEl ? upEl.textContent : "N/A";
        const layerCounts = Object.entries(state.layerVisibility)
          .filter(([, v]) => v)
          .map(([k]) => k);
        const lines = [
          "╔══════════════════════════════════════╗",
          "║       SESSION INTELLIGENCE BRIEF      ║",
          "╚══════════════════════════════════════╝",
          `Uptime:      ${uptime}`,
          `Entities:    ${totalEntities}`,
          `Live events: ${events}`,
          `Connections: ${conns}`,
          `Active layers: ${layerCounts.join(", ") || "none"}`,
          `Threat level: ${document.getElementById("threat-value")?.textContent || "N/A"}`,
          `Mode:        ${state.uiMode || "normal"}`,
          `Camera alt:  ${Math.round(viewer.camera.positionCartographic.height / 1000)} km`,
        ];
        appendOutput(lines.join("\n"), "cmd-info");
        break;
      }

      case "/bookmark": {
        if (!arg) {
          // List bookmarks
          const bm = JSON.parse(localStorage.getItem("ge-bookmarks") || "{}");
          const names = Object.keys(bm);
          if (names.length === 0) appendOutput("No bookmarks saved. Use /bookmark <name> to save current view.", "cmd-info");
          else appendOutput(`Bookmarks: ${names.join(", ")}`, "cmd-info");
        } else if (arg.startsWith("-d ")) {
          // Delete bookmark
          const name = arg.slice(3).trim();
          const bm = JSON.parse(localStorage.getItem("ge-bookmarks") || "{}");
          delete bm[name];
          localStorage.setItem("ge-bookmarks", JSON.stringify(bm));
          appendOutput(`Deleted bookmark: ${name}`, "cmd-ok");
        } else {
          // Check if bookmark exists — if so, fly to it; otherwise save
          const bm = JSON.parse(localStorage.getItem("ge-bookmarks") || "{}");
          if (bm[arg]) {
            const { lat, lng, alt, heading, pitch } = bm[arg];
            pausePassiveSpin(8000);
            viewer.camera.flyTo({
              destination: Cesium.Cartesian3.fromDegrees(lng, lat, alt),
              orientation: { heading: Cesium.Math.toRadians(heading), pitch: Cesium.Math.toRadians(pitch), roll: 0 },
              duration: 2.0
            });
            appendOutput(`Flying to bookmark: ${arg}`, "cmd-ok");
          } else {
            const cam = viewer.camera.positionCartographic;
            bm[arg] = {
              lat: Cesium.Math.toDegrees(cam.latitude),
              lng: Cesium.Math.toDegrees(cam.longitude),
              alt: cam.height,
              heading: Cesium.Math.toDegrees(viewer.camera.heading),
              pitch: Cesium.Math.toDegrees(viewer.camera.pitch),
            };
            localStorage.setItem("ge-bookmarks", JSON.stringify(bm));
            appendOutput(`Saved bookmark: ${arg}`, "cmd-ok");
          }
        }
        break;
      }

      case "/measure": {
        _measurePoint = null;
        appendOutput("Measurement mode: Shift+click two points on the globe to measure distance.", "cmd-info");
        break;
      }

      case "/export": {
        // Export current live events as JSON to clipboard
        try {
          const exportData = {
            exportedAt: new Date().toISOString(),
            threatLevel: document.getElementById("threat-value")?.textContent || "N/A",
            liveEvents: dynamic.eventVisuals.map((v, i) => ({
              index: i,
              lat: v.lat ?? null,
              lng: v.lng ?? null,
              bornAt: new Date(v.bornAt).toISOString(),
              ttlMs: v.ttlMs,
              geoSpawned: v.geoSpawned ?? false
            })),
            connectionCount: dynamic.connectionLines.length,
            entityCount: viewer.entities.values.length
          };
          const json = JSON.stringify(exportData, null, 2);
          navigator.clipboard.writeText(json).then(() => {
            appendOutput(`✓ Exported ${exportData.liveEvents.length} events to clipboard as JSON.`, "cmd-ok");
          }).catch(() => {
            appendOutput(json.slice(0, 500) + "\n[...truncated — copy from above]", "cmd-info");
          });
        } catch (e) {
          appendOutput(`Export failed: ${e.message}`, "cmd-err");
        }
        break;
      }

      case "/settings":
        openSettings();
        toggleCli(false);
        break;

      case "/locate": {
        const cam = viewer.camera.positionCartographic;
        const latD = Cesium.Math.toDegrees(cam.latitude).toFixed(4);
        const lngD = Cesium.Math.toDegrees(cam.longitude).toFixed(4);
        const altKm = (cam.height / 1000).toFixed(1);
        const hdgD = Cesium.Math.toDegrees(viewer.camera.heading).toFixed(1);
        appendOutput(`Camera: ${latD}°N  ${lngD}°E  Alt: ${altKm} km  Hdg: ${hdgD}°`, "cmd-ok");
        break;
      }

      case "/toast": {
        const toastTypes = ["success", "error", "warning", "info"];
        const tParts = arg.split(/\s+/);
        const lastToken = tParts[tParts.length - 1];
        const toastType = toastTypes.includes(lastToken) ? tParts.pop() && lastToken : "info";
        const toastMsg = tParts.join(" ") || "Test notification";
        showToast(toastMsg, toastType);
        appendOutput(`Sent ${toastType} toast`, "cmd-ok");
        break;
      }

      case "/layer": {
        const [layerSub, layerId] = arg.split(/\s+/);
        if (layerSub === "toggle" && layerId) {
          if (state.layers[layerId] !== undefined) {
            state.layers[layerId] = !state.layers[layerId];
            saveJson(STORAGE_KEYS.layers, state.layers);
            renderLayerToggles();
            renderLegend();
            refreshEntityVisibility();
            appendOutput(`Layer "${layerId}" → ${state.layers[layerId] ? "ON" : "OFF"}`, "cmd-ok");
          } else {
            appendOutput(`Unknown layer: ${layerId}. Available: ${Object.keys(state.layers).join(", ")}`, "cmd-err");
          }
        } else {
          const layerList = Object.entries(state.layers).map(([id, v]) => `  ${v ? "●" : "○"} ${id}`).join("\n");
          appendOutput("Layers (use /layer toggle <id>):\n" + layerList, "cmd-info");
        }
        break;
      }

      case "/spin":
        state.spinning = !state.spinning;
        elements.btnSpin?.classList.toggle("active", state.spinning);
        appendOutput(`Globe spin: ${state.spinning ? "ON" : "OFF"}`, "cmd-ok");
        break;

      case "/version":
        appendOutput(`Panopticon Earth v2.0 — God's Third Eye (build ${new Date().getFullYear()})`, "cmd-info");
        break;

      case "/cycle":
        appendOutput("INCIDENT OVERLAY — cycling global hotspots now…", "cmd-warn");
        sfx.alert?.();
        pulseConsoleFrame("scan");
        cycleIncidentPool();
        break;

      case "/broadcast":
        if (arg === "off" || arg === "dismiss") {
          dismissBroadcast();
          appendOutput("Broadcast dismissed", "cmd-ok");
        } else {
          const pool = state.newsTickerPool ?? [];
          const art  = pool[Math.floor(Math.random() * pool.length)];
          _lastBroadcastAt = 0; // override cooldown for manual trigger
          showBroadcast(art ?? null);
          appendOutput(`BROADCAST — ${BROADCAST_CHANNELS[_broadcastChanIndex]?.name ?? ""}`, "cmd-ok");
        }
        break;

      case "/iss": {
        if (_issLastData) {
          const d = _issLastData;
          appendOutput(`ISS: ${d.latitude.toFixed(3)}°N  ${d.longitude.toFixed(3)}°E  Alt: ${Math.round(d.altitude)}km  Vel: ${Math.round(d.velocity)}km/h`, "cmd-ok");
          viewer.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(d.longitude, d.latitude, 3000000), duration: 2.5 });
        } else {
          appendOutput("ISS data not yet loaded — enable the ISS layer first", "cmd-err");
        }
        break;
      }

      case "/quake": {
        const recentQ = _seismicEntities.slice().sort((a, b) => {
          const ma = parseFloat(a.properties?.label?.getValue?.()?.match(/M([\d.]+)/)?.[1] ?? 0);
          const mb = parseFloat(b.properties?.label?.getValue?.()?.match(/M([\d.]+)/)?.[1] ?? 0);
          return mb - ma;
        }).slice(0, 5);
        if (recentQ.length) {
          appendOutput(`Top earthquakes (M2.5+, past 24h):`, "cmd-info");
          recentQ.forEach(e => appendOutput(`  ${e.properties?.label?.getValue?.() ?? "Unknown"}`, "cmd-info"));
          const topQ = recentQ[0];
          if (topQ?.position) {
            const posQ = topQ.position.getValue(viewer.clock.currentTime);
            if (posQ) {
              const cgQ = Cesium.Cartographic.fromCartesian(posQ);
              viewer.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(Cesium.Math.toDegrees(cgQ.longitude), Cesium.Math.toDegrees(cgQ.latitude), 3000000), duration: 2.5 });
            }
          }
        } else {
          appendOutput("No seismic data — enable the Seismic Activity layer", "cmd-err");
        }
        break;
      }

      case "/borders":
        if (arg === "off") {
          toggleCountryOverlay(false);
          appendOutput("Country borders hidden", "cmd-ok");
        } else if (arg === "on") {
          toggleCountryOverlay(true);
          appendOutput("Country borders enabled", "cmd-ok");
        } else {
          toggleCountryOverlay();
          appendOutput(`Country borders: ${_countryOverlayVisible ? "ON" : "OFF"}`, "cmd-ok");
        }
        break;

      default:
        appendOutput(`Unknown command: ${cmd}. Type /help for available commands.`, "cmd-err");
    }
  }

  const CLI_COMMANDS = ["/help", "/focus", "/mode", "/alert", "/scan", "/warroom", "/normal", "/stats", "/events", "/country", "/refresh", "/screenshot", "/theme", "/fullscreen", "/uptime", "/goto", "/cycle", "/borders", "/layers", "/layer", "/fly", "/perf", "/reset", "/search", "/time", "/opacity", "/summary", "/bookmark", "/measure", "/export", "/clear", "/settings", "/locate", "/toast", "/spin", "/version"];

  cliInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const val = cliInput.value;
      cliInput.value = "";
      runCommand(val);
    }
    // Tab autocomplete
    if (e.key === "Tab") {
      e.preventDefault();
      const val = cliInput.value.toLowerCase();
      if (!val.startsWith("/")) return;
      const matches = CLI_COMMANDS.filter(c => c.startsWith(val));
      if (matches.length === 1) {
        cliInput.value = matches[0] + " ";
      } else if (matches.length > 1) {
        appendOutput(matches.join("  "), "cmd-info");
      }
    }
    // Up arrow for command history
    if (e.key === "ArrowUp" && _cmdHistory.length) {
      _cmdHistoryIdx = Math.max(0, _cmdHistoryIdx - 1);
      cliInput.value = _cmdHistory[_cmdHistoryIdx] || "";
    }
    if (e.key === "ArrowDown" && _cmdHistory.length) {
      _cmdHistoryIdx = Math.min(_cmdHistory.length, _cmdHistoryIdx + 1);
      cliInput.value = _cmdHistory[_cmdHistoryIdx] || "";
    }
  });
}

function startGlobeSpinDown() {
  if (!viewer) return;
  const scene  = viewer.scene;
  const camera = viewer.camera;

  // Spin rate: radians/second.  ~0.6 rad/s = noticeable fast spin
  let spinRate   = 0.55;
  const TARGET   = 0.0;        // end at rest (autoRotate handles slow spin after)
  const DURATION = 3200;       // ms to decelerate
  const start    = performance.now();

  function tick() {
    const now     = performance.now();
    const elapsed = now - start;
    const t       = Math.min(elapsed / DURATION, 1);
    // Ease-out cubic
    const ease    = 1 - Math.pow(1 - t, 3);
    spinRate      = 0.55 * (1 - ease);

    camera.rotate(Cesium.Cartesian3.UNIT_Z, spinRate * 0.016);

    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// ─────────────────────────────────────────────────────────────────────────────
// DRAGGABLE PANELS
// ─────────────────────────────────────────────────────────────────────────────
function initDraggablePanels() {
  const panels = document.querySelectorAll(".draggable-panel");

  // Build a restore strip (hidden by default)
  let restoreStrip = document.getElementById("panel-restore-strip");
  if (!restoreStrip) {
    restoreStrip = document.createElement("div");
    restoreStrip.id = "panel-restore-strip";
    restoreStrip.className = "panel-restore-strip";
    document.body.appendChild(restoreStrip);
  }

  function refreshRestoreStrip() {
    restoreStrip.innerHTML = "";
    document.querySelectorAll(".draggable-panel.panel-hidden").forEach(panel => {
      if (window.innerWidth <= 980 && (panel.id === "panel-layers" || panel.id === "panel-right")) return;
      const bar   = panel.querySelector(".panel-drag-bar");
      const label = bar?.querySelector(".drag-label")?.textContent ?? panel.id;
      const btn   = document.createElement("button");
      btn.className = "panel-restore-btn";
      btn.textContent = `⊕ ${label}`;
      btn.title = `Restore ${label} panel`;
      btn.addEventListener("click", () => {
        setPanelHidden(panel.id, false);
        // Reset any drag transform back to CSS default
        panel.style.left = "";
        panel.style.top  = "";
        panel.style.right = "";
        panel.style.bottom = "";
        panel.style.transform = "";
        if (window.innerWidth <= 980) {
          if (panel.id === "panel-layers") openMobileDrawer("layers");
          else if (panel.id === "panel-right") openMobileDrawer("controls");
          else panel.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        refreshRestoreStrip();
      });
      restoreStrip.appendChild(btn);
    });

    // Also show restore button for the news panel if it was closed
    const newsBriefing = document.getElementById("news-briefing");
    if (newsBriefing && newsBriefing.classList.contains("hidden") && !state.newsOpen && window.innerWidth > 980) {
      const btn = document.createElement("button");
      btn.className = "panel-restore-btn";
      btn.textContent = "⊕ SIGNALS";
      btn.title = "Restore news intelligence panel";
      btn.addEventListener("click", () => {
        toggleNewsPanel();
        refreshRestoreStrip();
      });
      restoreStrip.appendChild(btn);
    }
  }

  refreshPanelRestoreStrip = refreshRestoreStrip;

  // Close buttons
  document.querySelectorAll(".panel-close-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const targetId = btn.dataset.closePanel;
      const panel    = targetId ? document.getElementById(targetId) : btn.closest(".draggable-panel");
      if (!panel) return;
      setPanelHidden(panel.id, true);
      // If a mobile drawer is open for this panel, close it too
      if (window.innerWidth <= 980) setMobileDrawer(null);
      refreshRestoreStrip();
    });
  });

  document.querySelectorAll(".panel-minimize-btn").forEach(btn => {
    btn.addEventListener("click", event => {
      event.stopPropagation();
      const targetId = btn.dataset.minimizePanel;
      const panel = targetId ? document.getElementById(targetId) : btn.closest(".draggable-panel");
      if (!panel) return;
      const current = getPanelState(panel.id);
      setPanelMinimized(panel.id, !current.minimized);
    });
  });

  // Drag behaviour (desktop only)
  panels.forEach(panel => {
    const bar = panel.querySelector(".panel-drag-bar");
    if (!bar) return;

    let startX = 0, startY = 0, origLeft = 0, origTop = 0;

    bar.addEventListener("mousedown", e => {
      if (e.button !== 0) return;
      e.preventDefault();

      const rect = panel.getBoundingClientRect();
      startX  = e.clientX;
      startY  = e.clientY;
      origLeft = rect.left;
      origTop  = rect.top;

      // Switch to absolute top/left positioning
      panel.style.position = "fixed";
      panel.style.left     = `${origLeft}px`;
      panel.style.top      = `${origTop}px`;
      panel.style.right    = "auto";
      panel.style.bottom   = "auto";
      panel.style.transform = "none";
      panel.classList.add("is-dragging");

      function onMove(me) {
        const dx = me.clientX - startX;
        const dy = me.clientY - startY;
        panel.style.left = `${clamp(origLeft + dx, 0, window.innerWidth  - 60)}px`;
        panel.style.top  = `${clamp(origTop  + dy, 0, window.innerHeight - 40)}px`;
      }

      function onUp() {
        panel.classList.remove("is-dragging");
        savePanelState();
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup",   onUp);
      }

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup",   onUp);
    });

    // Touch drag support
    bar.addEventListener("touchstart", e => {
      const touch  = e.touches[0];
      const rect   = panel.getBoundingClientRect();
      startX  = touch.clientX;
      startY  = touch.clientY;
      origLeft = rect.left;
      origTop  = rect.top;
      panel.style.position  = "fixed";
      panel.style.left      = `${origLeft}px`;
      panel.style.top       = `${origTop}px`;
      panel.style.right     = "auto";
      panel.style.bottom    = "auto";
      panel.style.transform = "none";

      function onTouchMove(te) {
        const t  = te.touches[0];
        const dx = t.clientX - startX;
        const dy = t.clientY - startY;
        panel.style.left = `${clamp(origLeft + dx, 0, window.innerWidth  - 60)}px`;
        panel.style.top  = `${clamp(origTop  + dy, 0, window.innerHeight - 40)}px`;
      }
      function onTouchEnd() {
        savePanelState();
        document.removeEventListener("touchmove", onTouchMove);
        document.removeEventListener("touchend",  onTouchEnd);
      }
      document.addEventListener("touchmove", onTouchMove, { passive: true });
      document.addEventListener("touchend",  onTouchEnd);
    }, { passive: true });
  });

  applyStoredPanelState();
}

// ─────────────────────────────────────────────────────────────────────────────
// PING CANVAS
// ─────────────────────────────────────────────────────────────────────────────
let _pingAnimId = null;
const _pings = [];

function initPingCanvas() {
  const canvas = elements.pingCanvas;
  if (!canvas) return;
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  window.addEventListener("resize", () => {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
  });
  // Don't auto-start animation — wait for first ping
}

function spawnPing(x, y, color = "rgba(126,224,255,") {
  _pings.push({ x, y, r: 0, maxR: 80, alpha: 1.0, color, born: performance.now() });
  if (!_pingAnimId) {
    _pingAnimId = requestAnimationFrame(animatePings);
  }
}

function animatePings() {
  const canvas = elements.pingCanvas;
  if (!canvas) {
    _pingAnimId = null;
    return;
  }
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const now = performance.now();
  for (let i = _pings.length - 1; i >= 0; i--) {
    const p = _pings[i];
    const age = (now - p.born) / 900; // 0→1 over 900ms
    if (age >= 1) {
      _pings.splice(i, 1);
      continue;
    }
    const ease  = 1 - Math.pow(1 - age, 2);
    const r     = ease * p.maxR;
    const alpha = (1 - age) * 0.75;

    // Outer ring
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.strokeStyle = `${p.color}${alpha})`;
    ctx.lineWidth   = 2.5 * (1 - age);
    ctx.stroke();

    // Inner dot (only first 30%)
    if (age < 0.3) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5 * (1 - age / 0.3), 0, Math.PI * 2);
      ctx.fillStyle = `${p.color}${(0.3 - age / 0.3 * 0.3)}`;
      ctx.fill();
    }
  }

  if (_pings.length > 0) {
    _pingAnimId = requestAnimationFrame(animatePings);
  } else {
    _pingAnimId = null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CLICK-LOCATION POPUP
// ─────────────────────────────────────────────────────────────────────────────
let _clpGeoTimer     = null;
let _clpGeoCancelFn  = null;

function showClickLocationPopup(screenX, screenY, lat, lng) {
  const popup = elements.clickLocPopup;
  if (!popup) return;

  // Position — keep within viewport
  const PAD  = 16;
  const W    = 276;
  const H    = 196;
  let px = screenX + 18;
  let py = screenY - H / 2;
  if (px + W > window.innerWidth  - PAD) px = screenX - W - 18;
  if (py < PAD)                          py = PAD;
  if (py + H > window.innerHeight - PAD) py = window.innerHeight - H - PAD;

  popup.style.left = `${px}px`;
  popup.style.top  = `${py}px`;

  // Reset state
  if (elements.clpFlag)         elements.clpFlag.textContent    = "";
  if (elements.clpCountry)      elements.clpCountry.textContent = "██████████";
  if (elements.clpRegion)       elements.clpRegion.textContent  = "▒▒▒▒▒▒▒▒▒▒▒▒";
  if (elements.clpCoordsPopup)  elements.clpCoordsPopup.textContent =
    `${lat >= 0 ? "N" : "S"}${Math.abs(lat).toFixed(4)}°  ` +
    `${lng >= 0 ? "E" : "W"}${Math.abs(lng).toFixed(4)}°`;
  elements.clpLoading?.classList.remove("hidden");
  popup.classList.remove("hidden");

  renderConflictIntel(screenX, screenY, lat, lng);

  // Cancel any previous in-flight geocode
  if (_clpGeoTimer) clearTimeout(_clpGeoTimer);
  if (_clpGeoCancelFn) _clpGeoCancelFn();

  let cancelled = false;
  _clpGeoCancelFn = () => { cancelled = true; };

  _clpGeoTimer = setTimeout(async () => {
    try {
      const url  = `https://nominatim.openstreetmap.org/reverse?lat=${lat.toFixed(5)}&lon=${lng.toFixed(5)}&format=json`;
      const resp = await nominatimFetch(url);
      if (cancelled || !resp.ok) return;
      const data = await resp.json();
      if (cancelled) return;
      const addr    = data.address || {};
      const country = addr.country  || "Open Ocean";
      const state_  = addr.state    || addr.county || "";
      const city    = addr.city     || addr.town   || addr.village || addr.municipality || "";
      const code    = (addr.country_code || "").toUpperCase();
      const flag    = code.length === 2
        ? String.fromCodePoint(...[...code].map(c => 0x1F1E6 - 65 + c.charCodeAt(0)))
        : "";

      if (elements.clpFlag)    elements.clpFlag.textContent    = flag;
      animateDecryptText(elements.clpCountry, country, 540);
      animateDecryptText(elements.clpRegion, [city, state_].filter(Boolean).join(", ") || "Area match pending", 640);
      renderConflictIntel(screenX, screenY, lat, lng, { country, state: state_, city });
    } catch { /* ignore */ } finally {
      if (!cancelled) elements.clpLoading?.classList.add("hidden");
    }
  }, 120);
}

function hideClickLocationPopup() {
  elements.clickLocPopup?.classList.add("hidden");
  elements.clickConflictBox?.classList.add("hidden");
  clearInterval(_conflictWatchRefreshTimer);
  if (_clpGeoTimer)   clearTimeout(_clpGeoTimer);
  if (_clpGeoCancelFn) _clpGeoCancelFn();
  _clpGeoCancelFn = null;
}

// Reverse-geocode the camera's center position via Nominatim and display it.
// Throttled to one request per 3 seconds; cached while camera hasn't moved.

let _locGeocodeTimer = null;
let _locLastLat      = null;
let _locLastLng      = null;
let _locInFlight     = false;

function startLocationHud() {
  if (!viewer) return;
  viewer.scene.postRender.addEventListener(onScenePostRender);
}

function onScenePostRender() {
  const hud = elements.locationHud;
  if (!hud) return;

  const carto = Cesium.Cartographic.fromCartesian(viewer.camera.positionWC);
  const altKm = carto.height / 1000;

  if (altKm > 4500) {
    if (!hud.classList.contains("hidden")) hud.classList.add("hidden");
    return;
  }

  // Show HUD
  hud.classList.remove("hidden");

  const lat = Cesium.Math.toDegrees(carto.latitude);
  const lng = Cesium.Math.toDegrees(carto.longitude);

  // Update coords + meta immediately (local, no network)
  const locCoords = elements.locCoords;
  const locMeta   = elements.locMeta;
  if (locCoords) {
    locCoords.textContent =
      `${lat >= 0 ? "N" : "S"}${Math.abs(lat).toFixed(4)}°  ` +
      `${lng >= 0 ? "E" : "W"}${Math.abs(lng).toFixed(4)}°`;
  }
  if (locMeta) {
    locMeta.textContent = `ALT ${altKm.toFixed(0)} km  ·  ZOOM ${altKm < 300 ? "HIGH" : altKm < 1500 ? "MED" : "LOW"}`;
  }

  // Debounce geocode: only fire if we moved > ~0.12° or 3s passed
  const moved = _locLastLat === null ||
    Math.abs(lat - _locLastLat) > 0.12 ||
    Math.abs(lng - _locLastLng) > 0.12;

  if (moved) {
    clearTimeout(_locGeocodeTimer);
    _locGeocodeTimer = setTimeout(() => reverseGeocode(lat, lng), 800);
  }
}

async function reverseGeocode(lat, lng) {
  if (_locInFlight) return;
  _locInFlight  = true;
  _locLastLat   = lat;
  _locLastLng   = lng;

  const label  = elements.locLabel;
  const detail = elements.locDetail;

  try {
    const url  = `https://nominatim.openstreetmap.org/reverse?lat=${lat.toFixed(5)}&lon=${lng.toFixed(5)}&format=json`;
    const resp = await nominatimFetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const addr = data.address || {};

    const country = addr.country  || "";
    const state   = addr.state    || addr.county || "";
    const city    = addr.city     || addr.town   || addr.village || addr.municipality || "";
    const code    = (addr.country_code || "").toUpperCase();

    // Country flag emoji
    const flag = code.length === 2
      ? String.fromCodePoint(...[...code].map(c => 0x1F1E6 - 65 + c.charCodeAt(0)))
      : "";

    if (label)  label.textContent  = `${flag}  ${country || "Open Ocean"}`.trim();
    if (detail) detail.textContent = [city, state].filter(Boolean).join(", ") || "";
  } catch {
    if (label)  label.textContent  = "Scanning…";
    if (detail) detail.textContent = "";
  } finally {
    _locInFlight = false;
  }
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// ── Levenshtein edit distance (for fuzzy search tolerance) ───────────────────
function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 3) return 99;
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => i || j)
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
}

function normalizeSearchTerm(value) {
  return String(value ?? "").trim().toLowerCase();
}

function computeSearchScore(query, text) {
  if (!query || !text) return 0;
  const q  = normalizeSearchTerm(query);
  const t  = normalizeSearchTerm(text);

  if (t === q)              return 100;   // exact
  if (t.startsWith(q))      return 92;    // prefix
  if (t.includes(q))        return 78;    // substring

  // Token-based: break both into words
  const qTokens = q.split(/[\s\-_,]+/).filter(Boolean);
  const tTokens = t.split(/[\s\-_,]+/).filter(Boolean);

  if (qTokens.length > 1) {
    // All query words found as substrings in text words
    const allFound = qTokens.every(qt => tTokens.some(tt => tt.includes(qt)));
    if (allFound) return 65;
    const hitCount = qTokens.filter(qt => tTokens.some(tt => tt.includes(qt))).length;
    if (hitCount > 0) return 30 + Math.round((hitCount / qTokens.length) * 25);
  }

  // Single-token: prefix on any text word
  if (tTokens.some(tt => tt.startsWith(q))) return 55;

  // Fuzzy: 1-edit tolerance for queries ≥ 4 chars
  if (q.length >= 4) {
    const bestDist = Math.min(...tTokens.map(tt => editDistance(q, tt)));
    if (bestDist <= 1) return 40;
    if (bestDist <= 2 && q.length >= 6) return 25;
  }

  return 0;
}

function getEntityLngLat(entity) {
  const position = entity?.position?.getValue?.(viewer.clock.currentTime);
  if (!position) return null;
  const cg = Cesium.Cartographic.fromCartesian(position);
  return {
    lng: Cesium.Math.toDegrees(cg.longitude),
    lat: Cesium.Math.toDegrees(cg.latitude)
  };
}

function getZoneCenter(zone) {
  if (!zone) return null;
  if (zone.kind === "rectangle") {
    return {
      lng: (zone.coordinates.west + zone.coordinates.east) / 2,
      lat: (zone.coordinates.south + zone.coordinates.north) / 2
    };
  }
  if (zone.kind === "polygon" && Array.isArray(zone.coordinates) && zone.coordinates.length) {
    const sums = zone.coordinates.reduce((acc, [lng, lat]) => ({ lng: acc.lng + lng, lat: acc.lat + lat }), { lng: 0, lat: 0 });
    return { lng: sums.lng / zone.coordinates.length, lat: sums.lat / zone.coordinates.length };
  }
  return null;
}

function buildOperationalSearchResults(query) {
  const normalizedQuery = normalizeSearchTerm(query);
  if (!normalizedQuery) return [];

  const results = [];
  const pushResult = (entry) => {
    if (!entry?.score || entry.score <= 0) return;
    results.push(entry);
  };

  SCENARIO.alerts.forEach(alert => {
    const score = Math.max(
      computeSearchScore(normalizedQuery, alert.title),
      computeSearchScore(normalizedQuery, alert.region),
      computeSearchScore(normalizedQuery, alert.summary),
      computeSearchScore(normalizedQuery, alert.tags?.join(" "))
    );
    pushResult({
      id: `alert:${alert.id}`,
      kind: "alert",
      title: alert.title,
      subtitle: `${alert.region} · ${alert.summary}`,
      meta: `${alert.location.lat.toFixed(2)}°, ${alert.location.lng.toFixed(2)}°`,
      lng: alert.location.lng,
      lat: alert.location.lat,
      score
    });
  });

  SCENARIO.incidents.forEach(incident => {
    const score = Math.max(
      computeSearchScore(normalizedQuery, incident.label),
      computeSearchScore(normalizedQuery, incident.description),
      computeSearchScore(normalizedQuery, "incident")
    );
    pushResult({
      id: `incident:${incident.id}`,
      kind: "incident",
      title: incident.label,
      subtitle: incident.description,
      meta: `${incident.location.lat.toFixed(2)}°, ${incident.location.lng.toFixed(2)}°`,
      lng: incident.location.lng,
      lat: incident.location.lat,
      score
    });
  });

  SCENARIO.zones.forEach(zone => {
    const center = getZoneCenter(zone);
    if (!center) return;
    const score = Math.max(
      computeSearchScore(normalizedQuery, zone.label),
      computeSearchScore(normalizedQuery, zone.id),
      computeSearchScore(normalizedQuery, "zone")
    );
    pushResult({
      id: `zone:${zone.id}`,
      kind: "zone",
      title: zone.label,
      subtitle: "Airspace disruption / closure zone",
      meta: `${center.lat.toFixed(2)}°, ${center.lng.toFixed(2)}°`,
      lng: center.lng,
      lat: center.lat,
      score
    });
  });

  state.bookmarks.forEach(bookmark => {
    const score = Math.max(
      computeSearchScore(normalizedQuery, bookmark.label),
      computeSearchScore(normalizedQuery, "bookmark")
    );
    pushResult({
      id: `bookmark:${bookmark.id}`,
      kind: "bookmark",
      title: bookmark.label,
      subtitle: "Saved camera viewpoint",
      meta: `${bookmark.destination.lat.toFixed(2)}°, ${bookmark.destination.lng.toFixed(2)}°`,
      lng: bookmark.destination.lng,
      lat: bookmark.destination.lat,
      score
    });
  });

  [...dynamic.liveTraffic, ...dynamic.traffic].forEach(entity => {
    const info = getEntityInfo(entity);
    const coords = getEntityLngLat(entity);
    if (!info || !coords) return;
    const score = Math.max(
      computeSearchScore(normalizedQuery, info.label),
      computeSearchScore(normalizedQuery, info.description),
      computeSearchScore(normalizedQuery, info.type)
    );
    pushResult({
      id: `track:${entity.id}`,
      kind: "track",
      title: info.label,
      subtitle: `${info.type.toUpperCase()} · ${info.description || "Live monitored entity"}`,
      meta: `${coords.lat.toFixed(2)}°, ${coords.lng.toFixed(2)}°`,
      lng: coords.lng,
      lat: coords.lat,
      entityId: entity.id,
      score
    });
  });

  const deduped = new Map();
  results.sort((a, b) => b.score - a.score).forEach(result => {
    if (!deduped.has(result.id)) deduped.set(result.id, result);
  });

  // Also match COUNTRY_COORDS for quick country-code / country-name jumps
  for (const [name, coords] of Object.entries(COUNTRY_COORDS)) {
    const score = computeSearchScore(normalizedQuery, name);
    if (score > 0.3 && !deduped.has(`country:${name}`)) {
      deduped.set(`country:${name}`, {
        id: `country:${name}`,
        kind: "country",
        title: name.split(" ").map(w => w[0].toUpperCase() + w.slice(1)).join(" "),
        subtitle: "Country — news-monitored region",
        meta: `${coords.lat.toFixed(1)}°, ${coords.lng.toFixed(1)}°`,
        lng: coords.lng,
        lat: coords.lat,
        score
      });
    }
  }

  return Array.from(deduped.values()).sort((a, b) => b.score - a.score).slice(0, 8);
}

function parseBoundingBox(rawBoundingBox) {
  if (!Array.isArray(rawBoundingBox) || rawBoundingBox.length !== 4) return null;
  const [southRaw, northRaw, westRaw, eastRaw] = rawBoundingBox.map(Number);
  if ([southRaw, northRaw, westRaw, eastRaw].some(Number.isNaN)) return null;
  const south = Math.min(southRaw, northRaw);
  const north = Math.max(southRaw, northRaw);
  const lonRawSpan = Math.abs(eastRaw - westRaw);
  return {
    south,
    north,
    west: westRaw,
    east: eastRaw,
    latSpan: Math.abs(north - south),
    lonSpan: Math.min(lonRawSpan, 360 - lonRawSpan),
    crossesDateLine: lonRawSpan > 180
  };
}

function haversineKm(latA, lngA, latB, lngB) {
  const toRad = value => value * Math.PI / 180;
  const dLat = toRad(latB - latA);
  const dLng = toRad(lngB - lngA);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(latA)) * Math.cos(toRad(latB)) * Math.sin(dLng / 2) ** 2;
  return 6371 * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function collectOperationalPoints() {
  const points = [];

  [...dynamic.liveTraffic, ...dynamic.traffic].forEach(entity => {
    const info = getEntityInfo(entity);
    const coords = getEntityLngLat(entity);
    if (!info || !coords) return;
    points.push({ kind: "track", label: info.label, lat: coords.lat, lng: coords.lng, entityId: entity.id });
  });

  SCENARIO.alerts.forEach(alert => {
    points.push({ kind: "alert", label: alert.title, lat: alert.location.lat, lng: alert.location.lng });
  });
  SCENARIO.incidents.forEach(incident => {
    points.push({ kind: "incident", label: incident.label, lat: incident.location.lat, lng: incident.location.lng });
  });
  SCENARIO.zones.forEach(zone => {
    const center = getZoneCenter(zone);
    if (center) points.push({ kind: "zone", label: zone.label, lat: center.lat, lng: center.lng });
  });

  return points;
}

function applyRegionalContext(label, lng, lat) {
  const radiusKm = 1600;
  const nearby = collectOperationalPoints()
    .map(point => ({ ...point, distanceKm: haversineKm(lat, lng, point.lat, point.lng) }))
    .filter(point => point.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);

  const nearbyTracks = nearby.filter(point => point.kind === "track").length;
  const nearbyAlerts = nearby.filter(point => point.kind !== "track").length;

  if (elements.liveRegionLabel) {
    elements.liveRegionLabel.textContent = `${label.toUpperCase()} · ${nearbyTracks} tracks · ${nearbyAlerts} alerts`;
  }
  if (elements.hudStatusMode) {
    elements.hudStatusMode.textContent = nearby.length ? "REGION FOCUS" : "LIVE FEED";
  }
  if (elements.summaryCopy) {
    if (!nearby.length) {
      elements.summaryCopy.textContent = `${label}: no nearby monitored assets in ${radiusKm.toLocaleString()} km. Live feeds continue to update globally.`;
    } else {
      const nearestPoint = nearby[0];
      elements.summaryCopy.textContent = `${label}: ${nearbyTracks} tracked assets and ${nearbyAlerts} alerts within ${radiusKm.toLocaleString()} km. Nearest signal: ${nearestPoint.label} (${Math.round(nearestPoint.distanceKm)} km).`;
    }
  }
  if (elements.searchMeta) {
    elements.searchMeta.textContent = nearby.length
      ? `Focused on ${label} · ${nearby.length} nearby signals`
      : `Focused on ${label} · no nearby signals`;
  }

  const closestEntity = nearby.find(point => point.entityId);
  if (closestEntity) {
    const entity = viewer.entities.getById(closestEntity.entityId);
    if (entity) {
      state.selectedEntity = entity;
      updateSelectedEntityCard(entity);
    }
  }

  state.regionFocus = {
    label,
    tracks: nearbyTracks,
    alerts: nearbyAlerts,
    summary: !nearby.length
      ? `${label}: no nearby monitored assets in ${radiusKm.toLocaleString()} km. Live feeds continue to update globally.`
      : `${label}: ${nearbyTracks} tracked assets and ${nearbyAlerts} alerts within ${radiusKm.toLocaleString()} km. Nearest signal: ${nearby[0].label} (${Math.round(nearby[0].distanceKm)} km).`,
    timestamp: Date.now()
  };
}

function flyToSearchResult(result) {
  if (!result) return;
  pausePassiveSpin(7000);

  if (result.kind === "geo") {
    const bounds = parseBoundingBox(result.boundingbox);
    const zoomHeight = clamp(Math.max(bounds?.latSpan ?? 8, bounds?.lonSpan ?? 8) * 150000, 1100000, 19000000);
    const flyOptions = {
      destination: Cesium.Cartesian3.fromDegrees(result.lng, result.lat, zoomHeight),
      duration: 1.7,
      complete: () => applyRegionalContext(result.title, result.lng, result.lat)
    };
    if (bounds && !bounds.crossesDateLine && (bounds.latSpan > 1.5 || bounds.lonSpan > 1.5)) {
      flyOptions.destination = Cesium.Rectangle.fromDegrees(bounds.west, bounds.south, bounds.east, bounds.north);
    }
    viewer.camera.flyTo(flyOptions);
    return;
  }

  if (result.entityId) {
    const entity = viewer.entities.getById(result.entityId);
    if (entity) {
      state.selectedEntity = entity;
      updateSelectedEntityCard(entity);
    }
  }

  const height = result.kind === "track" ? 1800000 : result.kind === "zone" ? 2800000 : 2300000;
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(result.lng, result.lat, height),
    duration: 1.5,
    complete: () => applyRegionalContext(result.title, result.lng, result.lat)
  });
}

function setSearchCursor(index) {
  const buttons = Array.from(elements.searchResults.querySelectorAll(".search-result"));
  if (!buttons.length) {
    state.searchCursorIndex = -1;
    return;
  }

  const nextIndex = clamp(index, 0, buttons.length - 1);
  state.searchCursorIndex = nextIndex;
  buttons.forEach((button, buttonIndex) => {
    const active = buttonIndex === nextIndex;
    button.classList.toggle("selected", active);
    button.setAttribute("aria-selected", String(active));
  });

  buttons[nextIndex].scrollIntoView({ block: "nearest" });
}

function activateSearchResultByIndex(index) {
  const result = state.searchFlatResults[index];
  if (!result) return;
  elements.searchResults.classList.add("hidden");
  elements.searchInput.value = result.title;
  flyToSearchResult(result);
}

async function runSearch(query) {
  const trimmed = query.trim();
  if (!trimmed) {
    elements.searchResults.classList.add("hidden");
    state.searchFlatResults = [];
    state.searchCursorIndex = -1;
    if (elements.searchMeta) elements.searchMeta.textContent = "Type a place or live object to jump into active context.";
    return;
  }

  if (state.searchAbortController) state.searchAbortController.abort();
  state.searchAbortController = new AbortController();

  const operationalResults = buildOperationalSearchResults(trimmed);
  if (elements.searchMeta) elements.searchMeta.textContent = "Searching global geospatial index…";

  let placeResults = [];
  try {
    const geoUrl = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=7&q=${encodeURIComponent(trimmed)}`;
    const response = await nominatimFetch(geoUrl);
    const payload = await response.json();
    placeResults = Array.isArray(payload)
      ? payload
        .map(result => ({
          id: `geo:${result.place_id}`,
          kind: "geo",
          title: result.display_name?.split(",")?.[0]?.trim() || "Unknown location",
          subtitle: result.display_name ?? "Geographic result",
          meta: `${result.type || "place"} · ${result.class || "geography"}`,
          lng: Number(result.lon),
          lat: Number(result.lat),
          boundingbox: result.boundingbox ?? null
        }))
        .filter(result => Number.isFinite(result.lng) && Number.isFinite(result.lat))
      : [];
  } catch {
    placeResults = [];
  }

  renderSearchResults(trimmed, operationalResults, placeResults);
}

function appendSearchGroup(label, results, startIndex) {
  if (!results.length) return;
  const header = document.createElement("div");
  header.className = "search-group-label";
  header.textContent = label;
  elements.searchResults.appendChild(header);

  let cursor = startIndex;
  results.forEach(result => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "search-result";
    btn.setAttribute("role", "option");
    btn.dataset.searchIndex = String(cursor);
    btn.innerHTML = `
      <span class="search-result-head">
        <span class="search-result-kind">${escapeHtml(result.kind)}</span>
        <strong>${escapeHtml(result.title)}</strong>
      </span>
      <span class="search-result-sub">${escapeHtml(result.subtitle)}</span>
      <span class="search-result-meta">${escapeHtml(result.meta)}</span>
    `;
    btn.addEventListener("mouseenter", () => setSearchCursor(Number(btn.dataset.searchIndex)));
    btn.addEventListener("click", () => activateSearchResultByIndex(Number(btn.dataset.searchIndex)));
    elements.searchResults.appendChild(btn);
    cursor += 1;
  });

  return cursor;
}

function renderSearchResults(query, operationalResults, placeResults) {
  const op = operationalResults.slice(0, 6);
  const geo = placeResults.slice(0, 6);
  state.searchFlatResults = [...op, ...geo];
  state.searchCursorIndex = -1;

  if (!op.length && !geo.length) {
    elements.searchResults.classList.add("hidden");
    if (elements.searchMeta) elements.searchMeta.textContent = `No matches found for “${query}”.`;
    return;
  }

  elements.searchResults.innerHTML = "";
  elements.searchResults.setAttribute("role", "listbox");
  let nextIndex = 0;
  nextIndex = appendSearchGroup("Operational Matches", op, nextIndex) ?? nextIndex;
  nextIndex = appendSearchGroup("Geographic Matches", geo, nextIndex) ?? nextIndex;
  elements.searchResults.classList.remove("hidden");
  if (state.searchFlatResults.length) setSearchCursor(0);

  if (elements.searchMeta) {
    const total = op.length + geo.length;
    elements.searchMeta.textContent = `${total} results · ${op.length} operational · ${geo.length} geographic`;
  }
}

function registerEvents() {
  if (elements.refreshInterval) {
    elements.refreshInterval.addEventListener("input", event => {
      state.refreshIntervalSec = Number(event.target.value);
      if (elements.refreshIntervalVal) elements.refreshIntervalVal.textContent = `${state.refreshIntervalSec}s`;
      scheduleRefresh();
    });
  }

  elements.fxIntensity.addEventListener("input", event => {
    state.fxIntensity = Number(event.target.value);
    applyFxIntensity();
  });
  elements.fxGlow.addEventListener("input", event => {
    state.fxGlow = Number(event.target.value);
    applyGlow();
  });

  elements.saveBookmark.addEventListener("click",  saveCurrentBookmark);
  elements.clearBookmarks.addEventListener("click", () => {
    state.bookmarks = state.bookmarks.filter(bookmark => bookmark.system);
    saveJson(STORAGE_KEYS.bookmarks, state.bookmarks);
    renderBookmarks();
  });
  elements.saveLayout?.addEventListener("click", saveCurrentLayout);
  elements.clearLayouts?.addEventListener("click", () => {
    state.savedLayouts = [];
    saveJson(UI_STORAGE_KEYS.layouts, state.savedLayouts);
    renderSavedLayouts();
  });

  elements.refreshFeeds?.addEventListener("click",       () => refreshLiveFeeds());
  elements.opsNextHotspot?.addEventListener("click",     focusNextHotspot);
  elements.opsRandomTrack?.addEventListener("click",     focusRandomTrack);
  elements.opsOpenIntel?.addEventListener("click",       () => {
    if (state.selectedEntity) openIntelSheet(state.selectedEntity);
  });
  elements.opsBriefFocus?.addEventListener("click",      createFocusBrief);
  elements.opsTourToggle?.addEventListener("click",      toggleAlertTour);
  elements.saveAisEndpoint?.addEventListener("click",    () => {
    const endpoint = elements.aisEndpoint.value.trim();
    setConfiguredAisEndpoint(endpoint);
    if (elements.feedHint) elements.feedHint.textContent = endpoint ? "AIS endpoint saved. Refreshing\u2026" : "AIS endpoint cleared.";
    refreshLiveFeeds();
  });
  elements.clearAisEndpoint?.addEventListener("click",   () => {
    elements.aisEndpoint.value = "";
    setConfiguredAisEndpoint("");
    if (elements.feedHint) elements.feedHint.textContent = "AIS endpoint cleared.";
    refreshLiveFeeds();
  });
  elements.testAisEndpoint?.addEventListener("click",    testAisEndpoint);
  elements.refreshNow?.addEventListener("click",         () => refreshLiveFeeds());
  elements.btnGuide?.addEventListener("click",           () => openMissionGuide(state.onboardingStep || 0));
  elements.summaryGuide?.addEventListener("click",       () => openMissionGuide(state.onboardingStep || 0));
  elements.summaryHotspot?.addEventListener("click",     focusNextHotspot);
  elements.summaryRandom?.addEventListener("click",      focusRandomTrack);
  elements.summaryNews?.addEventListener("click",        toggleNewsPanel);
  elements.missionGuideClose?.addEventListener("click",  () => closeMissionGuide(true));
  elements.missionGuideSkip?.addEventListener("click",   () => closeMissionGuide(true));
  elements.missionGuidePrev?.addEventListener("click",   () => stepMissionGuide(-1));
  elements.missionGuideNext?.addEventListener("click",   () => stepMissionGuide(1));
  elements.missionGuide?.addEventListener("click", event => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.dataset.closeGuide === "true") closeMissionGuide(true);
  });
  elements.btnFullscreen?.addEventListener("click",      () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  });

  elements.btnDeclutter?.addEventListener("click",       () => { state.declutter = !state.declutter; applyDeclutterMode(); });
  elements.btnDensity?.addEventListener("click",         () => { state.compact   = !state.compact;   applyDensityMode();   });
  elements.closeIntelSheet?.addEventListener("click",    closeIntelSheet);

  // ── Translate to English button in intel sheet ──
  elements.btnTranslateIntel?.addEventListener("click", async () => {
    const info = state._intelSheetInfo;
    if (!info || !info.articleLang || !isNonEnglish(info.articleLang)) return;
    elements.btnTranslateIntel.disabled = true;
    elements.btnTranslateIntel.textContent = "⏳";
    try {
      const translatedTitle = await translateTitle(info.label, info.articleLang);
      const translatedDesc = await translateTitle(info.description || "", info.articleLang);
      if (elements.intelSheetTitle) elements.intelSheetTitle.textContent = translatedTitle;
      if (elements.intelSheetOverview) elements.intelSheetOverview.textContent = translatedDesc || "Track selected for review.";
    } catch { /* silent */ }
    elements.btnTranslateIntel.textContent = "✓ EN";
    elements.btnTranslateIntel.disabled = false;
  });

  // ── Swipe-to-dismiss for intel sheet on mobile ──
  if (elements.intelSheetHandle) {
    let startY = 0;
    elements.intelSheetHandle.addEventListener("touchstart", (e) => {
      startY = e.touches[0].clientY;
    }, { passive: true });
    elements.intelSheetHandle.addEventListener("touchend", (e) => {
      const dy = e.changedTouches[0].clientY - startY;
      if (dy > 60) closeIntelSheet();
    }, { passive: true });
  }

  // ── Threat bar: click to jump to nearest critical event ──
  elements.threatSegments?.closest("#threat-level-bar")?.addEventListener("click", () => {
    sfx.click();
    // Find the nearest active incident or event visual and fly to it
    const incidents = dynamic.incidents.filter(({ entity }) => entity.show);
    if (incidents.length) {
      const pick = incidents[Math.floor(Math.random() * incidents.length)];
      state.selectedEntity = pick.entity;
      const pos = pick.entity.position?.getValue(viewer.clock.currentTime);
      if (pos) {
        const cg = Cesium.Cartographic.fromCartesian(pos);
        flyToDestination({
          lng: Cesium.Math.toDegrees(cg.longitude),
          lat: Cesium.Math.toDegrees(cg.latitude),
          height: 1200000,
          heading: 0, pitch: -0.7, roll: 0
        }, () => openIntelSheet(pick.entity));
      }
    } else if (dynamic.eventVisuals.length) {
      const ev = dynamic.eventVisuals[Math.floor(Math.random() * dynamic.eventVisuals.length)];
      state.selectedEntity = ev.dot;
      const pos = ev.dot.position?.getValue(viewer.clock.currentTime);
      if (pos) {
        const cg = Cesium.Cartographic.fromCartesian(pos);
        flyToDestination({
          lng: Cesium.Math.toDegrees(cg.longitude),
          lat: Cesium.Math.toDegrees(cg.latitude),
          height: 1200000,
          heading: 0, pitch: -0.7, roll: 0
        }, () => openIntelSheet(ev.dot));
      }
    }
  });

  elements.clpClose?.addEventListener("click",            hideClickLocationPopup);
  elements.ccbClose?.addEventListener("click",            hideClickLocationPopup);

  // Copy coordinates button on the click-location popup
  document.getElementById("clp-copy")?.addEventListener("click", () => {
    const coords = elements.clpCoordsPopup?.textContent?.trim();
    if (coords) {
      navigator.clipboard.writeText(coords).then(() => {
        const btn = document.getElementById("clp-copy");
        if (btn) { btn.textContent = "✓ COPIED"; setTimeout(() => { btn.textContent = "⎘ COPY"; }, 1500); }
      }).catch(() => {});
    }
  });
  elements.mobileBackdrop?.addEventListener("click",     () => { setMobileDrawer(null); closeIntelSheet(); });
  elements.btnMobileLayers?.addEventListener("click",    () => openMobileDrawer("layers"));
  elements.btnMobileControls?.addEventListener("click",  () => openMobileDrawer("controls"));
  elements.btnMobileIntel?.addEventListener("click",     () => {
    if (!state.selectedEntity) return;
    setMobileDrawer(null);
    openIntelSheet(state.selectedEntity);
  });
  elements.btnMobileSignals?.addEventListener("click",   () => {
    if (window.innerWidth <= 980) setMobileDrawer(null);
    toggleNewsPanel();
  });
  elements.trackSelected?.addEventListener("click",      () => {
    if (state.selectedEntity) {
      viewer.trackedEntity = state.selectedEntity;
      state.trackedEntity  = state.selectedEntity;
      updateTrackButtons();
    }
  });
  elements.releaseTrack?.addEventListener("click",       () => {
    viewer.trackedEntity = undefined;
    state.trackedEntity  = null;
    updateTrackButtons();
  });

  elements.searchButton?.addEventListener("click",  () => { sfx.click(); runSearch(elements.searchInput.value); });
  elements.searchInput?.addEventListener("input", event => {
    if (state.searchDebounceTimer) window.clearTimeout(state.searchDebounceTimer);
    state.searchDebounceTimer = window.setTimeout(() => runSearch(event.target.value), 220);
  });
  elements.searchInput?.addEventListener("focus", () => {
    if (elements.searchInput.value.trim()) runSearch(elements.searchInput.value);
  });
  elements.searchInput?.addEventListener("keydown", event => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (elements.searchResults.classList.contains("hidden")) {
        runSearch(elements.searchInput.value);
        return;
      }
      setSearchCursor(state.searchCursorIndex + 1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (elements.searchResults.classList.contains("hidden")) {
        runSearch(elements.searchInput.value);
        return;
      }
      setSearchCursor(state.searchCursorIndex - 1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (!elements.searchResults.classList.contains("hidden") && state.searchCursorIndex >= 0) {
        activateSearchResultByIndex(state.searchCursorIndex);
      } else {
        runSearch(elements.searchInput.value);
      }
      return;
    }
    if (event.key === "Escape") {
      elements.searchResults.classList.add("hidden");
      state.searchCursorIndex = -1;
      return;
    }
  });
  document.addEventListener("click", event => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (!target.closest(".hud-search")) elements.searchResults.classList.add("hidden");
  });
  document.addEventListener("keydown", event => {
    state._shiftHeld = event.shiftKey;
    if (event.key === "Escape" && !elements.missionGuide?.classList.contains("hidden")) {
      closeMissionGuide(true);
      return;
    }
    if (event.key === "?" || (event.shiftKey && event.key === "/")) {
      event.preventDefault();
      openMissionGuide(state.onboardingStep || 0);
    }
  });

  elements.btnHome?.addEventListener("click",  () => {
    state.regionFocus = null;
    state.selectedEntity = null;
    if (elements.searchMeta) elements.searchMeta.textContent = "Search a place, alert, route, or saved view.";
    if (elements.hudStatusMode) elements.hudStatusMode.textContent = "LIVE FEED";
    if (elements.liveRegionLabel) elements.liveRegionLabel.textContent = "Global Intelligence Active";
    closeIntelSheet();
    flyToDestination({
      lng: SCENARIO.initialView.lng,
      lat: SCENARIO.initialView.lat,
      height: SCENARIO.initialView.height,
      heading: SCENARIO.initialView.heading,
      pitch: SCENARIO.initialView.pitch,
      roll: SCENARIO.initialView.roll
    }, undefined, 1.8);
  });
  elements.btnTilt?.addEventListener("click",  () => {
    state.tiltMode = !state.tiltMode;
    state.tiltMode ? sfx.toggleOn() : sfx.toggleOff();
    elements.btnTilt.classList.toggle("active", state.tiltMode);
    viewer.camera.flyTo({
      destination: viewer.camera.positionWC,
      orientation: {
        heading: viewer.camera.heading,
        pitch:   state.tiltMode ? Cesium.Math.toRadians(-38) : Cesium.Math.toRadians(-90),
        roll:    0
      },
      duration: 0.8
    });
  });
  elements.btnSpin?.addEventListener("click",  () => {
    state.spinning = !state.spinning;
    state.spinning ? sfx.toggleOn() : sfx.toggleOff();
    elements.btnSpin.classList.toggle("active", state.spinning);
  });

  viewer.scene.postRender.addEventListener(() => {
    const cg = Cesium.Cartographic.fromCartesian(viewer.camera.positionWC);
    if (cg && elements.hudCamera) {
      elements.hudCamera.textContent = `ALT ${(cg.height / 1000).toFixed(0)} km \u00b7 HEADING ${Cesium.Math.toDegrees(viewer.camera.heading).toFixed(0)}\u00b0`;
    }
  });

  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction(click => {
    const picked    = viewer.scene.pick(click.position);
    pausePassiveSpin(5500);
    const cartesian = clickedCartesian(click.position, picked);
    focusCameraOnCartesian(cartesian);
    pulseConsoleFrame("click");

    // Always spawn a ping ripple at the click screen position
    spawnPing(click.position.x, click.position.y);

    // Distance measurement mode (hold Shift+click)
    if (state._shiftHeld && cartesian) {
      handleMeasureClick(cartesian);
      return;
    }

    if (Cesium.defined(picked) && picked.id) {
      state.selectedEntity = picked.id;
      updateSelectedEntityCard(picked.id);
      showHoverTooltip(picked.id, click.position);
      openIntelSheet(picked.id);
      setMobileDrawer(null);
      hideClickLocationPopup();
      showSelectionRing(picked.id);
    } else {
      state.selectedEntity = null;
      updateSelectedEntityCard(null);
      hideHoverTooltip();
      hideSelectionRing();

      // Show location popup for blank globe clicks
      if (cartesian) {
        const cg  = Cesium.Cartographic.fromCartesian(cartesian);
        const lat = Cesium.Math.toDegrees(cg.latitude);
        const lng = Cesium.Math.toDegrees(cg.longitude);
        showClickLocationPopup(click.position.x, click.position.y, lat, lng);
      } else {
        hideClickLocationPopup();
      }
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  handler.setInputAction(() => pausePassiveSpin(6500), Cesium.ScreenSpaceEventType.LEFT_DOWN);
  handler.setInputAction(() => { pausePassiveSpin(6500); sfx.zoomTick(); }, Cesium.ScreenSpaceEventType.WHEEL);

  // Double-click: fly to clicked entity for close inspection, or fly to globe location
  handler.setInputAction(click => {
    const picked = viewer.scene.pick(click.position);
    if (Cesium.defined(picked) && picked.id && picked.id.position) {
      pausePassiveSpin(15000);
      const pos = picked.id.position.getValue(viewer.clock.currentTime);
      if (pos) {
        const cg = Cesium.Cartographic.fromCartesian(pos);
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromRadians(cg.longitude, cg.latitude, 800000),
          orientation: {
            heading: Cesium.Math.toRadians(0),
            pitch: Cesium.Math.toRadians(-45),
            roll: 0
          },
          duration: 1.8
        });
      }
    } else {
      // Double-click on blank globe: fly closer to that location
      const cartesian = viewer.scene.pickPosition(click.position)
        || viewer.camera.pickEllipsoid(click.position, viewer.scene.globe.ellipsoid);
      if (cartesian) {
        pausePassiveSpin(15000);
        const cg = Cesium.Cartographic.fromCartesian(cartesian);
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromRadians(cg.longitude, cg.latitude, 2500000),
          orientation: {
            heading: 0,
            pitch: Cesium.Math.toRadians(-35),
            roll: 0
          },
          duration: 2.0
        });
      }
    }
  }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

  let _lastMouseMoveMs = 0;
  let _countryHoverTimer = null;
  let _countryPopupPending = null;

  handler.setInputAction(movement => {
    const now = performance.now();
    if (now - _lastMouseMoveMs < 34) return;
    _lastMouseMoveMs = now;

    const picked = viewer.scene.pick(movement.endPosition);
    if (Cesium.defined(picked) && picked.id && !picked.id._isCountryEntity) {
      state.hoveredEntity = picked.id;
      clearTimeout(_countryHoverTimer);
      clearTimeout(_countryPopupPending);
      hideCountryPopup();
      showHoverTooltip(picked.id, movement.endPosition);
    } else {
      state.hoveredEntity = null;
      clearTimeout(_countryHoverTimer);
      clearTimeout(_countryPopupPending);

      _countryHoverTimer = setTimeout(() => {
        if (!_countryDataSource || !_countryOverlayVisible) { hideHoverTooltip(); return; }
        try {
          const drilled = viewer.scene.drillPick(movement.endPosition, 5);
          const hit = drilled.find(p => p.id?._isCountryEntity);
          if (hit && hit.id._countryName) {
            const name = hit.id._countryName;
            // Show the small chip tooltip immediately
            showCountryNameTooltip(name, movement.endPosition);
            // Schedule the big 3D popup after 2 seconds of staying in same country
            clearTimeout(_countryPopupPending);
            if (_countryPopupActive !== name) {
              hideCountryPopup();
              _countryPopupPending = setTimeout(() => {
                showCountryPopup(name, movement.endPosition.x, movement.endPosition.y);
              }, 2000);
            }
            return;
          }
        } catch { /* ignore picking errors */ }
        hideHoverTooltip();
        hideCountryPopup();
      }, 80);
    }
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

  // Right-click context menu on globe
  handler.setInputAction(click => {
    const picked = viewer.scene.pick(click.position);
    const cartesian = clickedCartesian(click.position, picked);
    const entity = (Cesium.defined(picked) && picked.id) ? picked.id : null;

    let lat = null, lng = null;
    if (cartesian) {
      const cg = Cesium.Cartographic.fromCartesian(cartesian);
      lat = Cesium.Math.toDegrees(cg.latitude);
      lng = Cesium.Math.toDegrees(cg.longitude);
    }

    showGlobeContextMenu(click.position.x, click.position.y, entity, lat, lng);
  }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);

  window.addEventListener("resize", () => {
    viewer.resize();
    if (window.innerWidth > 980) setMobileDrawer(null);
    ensureMobilePanelVisibility();
    sanitizePanelPositions();
    updateSummaryHint();
  });

  window.addEventListener("keydown", event => {
    const target = event.target;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
    if (event.key === "/")                { event.preventDefault(); elements.searchInput.focus(); elements.searchInput.select(); return; }
    if (event.key.toLowerCase() === "f") { state.declutter = !state.declutter; applyDeclutterMode(); return; }
    if (event.key.toLowerCase() === "d") { state.compact   = !state.compact;   applyDensityMode();   return; }
    if (event.key.toLowerCase() === "r") { refreshLiveFeeds(); return; }
    if (event.key.toLowerCase() === "l") { setMobileDrawer(window.innerWidth <= 980 ? "layers"   : null); return; }
    if (event.key.toLowerCase() === "c") { setMobileDrawer(window.innerWidth <= 980 ? "controls" : null); return; }
    if (event.key.toLowerCase() === "n") { toggleNewsPanel(); return; }
    if (event.key.toLowerCase() === "i") { if (state.selectedEntity) openIntelSheet(state.selectedEntity); return; }
    if (event.key.toLowerCase() === "h") { navFlyHome(); return; }
    if (event.key.toLowerCase() === "j") { focusNextHotspot(); return; }
    if (event.key === "+" || event.key === "=") { document.getElementById("nav-zoom-in")?.click(); return; }
    if (event.key === "-" || event.key === "_") { document.getElementById("nav-zoom-out")?.click(); return; }
    if (event.key === "?")               { toggleKeyboardShortcuts(); return; }
    if (event.key === "S" && event.shiftKey) { captureGlobeScreenshot(); showToast("Screenshot captured", "info"); return; }
    if (event.key.toLowerCase() === "s" && !event.shiftKey) { elements.btnSpin?.click(); return; }
    if (event.key.toLowerCase() === "g") { toggleFullscreen(); return; }
    if (event.key.toLowerCase() === "t") { toggleDarkTheme(); return; }
    if (event.key.toLowerCase() === "w") { toggleGlobeGrid(); return; }
    if (event.key.toLowerCase() === "m") { toggleAudioMute(); return; }
    if (event.key.toLowerCase() === "c") { toggleCinemaMode(); return; }
    if (event.key === ",")               { openSettings(); return; }
    if (event.key === " ")               { event.preventDefault(); toggleAutoRotatePause(); return; }
    if (event.key === "Escape")          { closeSettings(); closeIntelSheet(); elements.searchResults.classList.add("hidden"); closeNewsPanel(); document.getElementById("shortcuts-overlay")?.classList.add("hidden"); }
  });
  document.addEventListener("keyup", event => { state._shiftHeld = event.shiftKey; });

  // ── Konami Code Easter Egg ────────────────────────────────────
  const KONAMI = ["ArrowUp","ArrowUp","ArrowDown","ArrowDown","ArrowLeft","ArrowRight","ArrowLeft","ArrowRight","b","a"];
  let _konamiIdx = 0;
  document.addEventListener("keydown", e => {
    if (e.key === KONAMI[_konamiIdx]) {
      _konamiIdx++;
      if (_konamiIdx === KONAMI.length) {
        _konamiIdx = 0;
        showToast("🎮 GOD MODE ACTIVATED", "info");
        document.body.style.filter = "hue-rotate(180deg)";
        setTimeout(() => { document.body.style.filter = ""; }, 5000);
        // Fly to a dramatic random location
        pausePassiveSpin(10000);
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(
            -73.935, 40.730, 500 // NYC low flyover
          ),
          orientation: { heading: Cesium.Math.toRadians(45), pitch: Cesium.Math.toRadians(-15), roll: 0 },
          duration: 3.0
        });
      }
    } else {
      _konamiIdx = 0;
    }
  });

  // ── Globe navigation toolbar ──────────────────────────────────
  const navZoomIn    = document.getElementById("nav-zoom-in");
  const navZoomOut   = document.getElementById("nav-zoom-out");
  const navNorth     = document.getElementById("nav-north");
  const navTiltUp    = document.getElementById("nav-tilt-up");
  const navTiltDown  = document.getElementById("nav-tilt-down");
  const navFlyHomeBtn  = document.getElementById("nav-fly-home");
  const navFlyRandom   = document.getElementById("nav-fly-random");

  navZoomIn?.addEventListener("click", () => {
    const cg = Cesium.Cartographic.fromCartesian(viewer.camera.positionWC);
    const newHeight = Math.max(cg.height * 0.5, 5000);
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromRadians(cg.longitude, cg.latitude, newHeight),
      orientation: { heading: viewer.camera.heading, pitch: viewer.camera.pitch, roll: 0 },
      duration: 0.6
    });
    sfx.zoom();
    pausePassiveSpin(4000);
  });

  navZoomOut?.addEventListener("click", () => {
    const cg = Cesium.Cartographic.fromCartesian(viewer.camera.positionWC);
    const newHeight = Math.min(cg.height * 2.0, 40000000);
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromRadians(cg.longitude, cg.latitude, newHeight),
      orientation: { heading: viewer.camera.heading, pitch: viewer.camera.pitch, roll: 0 },
      duration: 0.6
    });
    sfx.zoom();
    pausePassiveSpin(4000);
  });

  navNorth?.addEventListener("click", () => {
    viewer.camera.flyTo({
      destination: viewer.camera.positionWC,
      orientation: { heading: 0, pitch: viewer.camera.pitch, roll: 0 },
      duration: 0.5
    });
  });

  navTiltUp?.addEventListener("click", () => {
    const newPitch = Math.min(viewer.camera.pitch + Cesium.Math.toRadians(15), Cesium.Math.toRadians(-5));
    viewer.camera.flyTo({
      destination: viewer.camera.positionWC,
      orientation: { heading: viewer.camera.heading, pitch: newPitch, roll: 0 },
      duration: 0.4
    });
  });

  navTiltDown?.addEventListener("click", () => {
    const newPitch = Math.max(viewer.camera.pitch - Cesium.Math.toRadians(15), Cesium.Math.toRadians(-90));
    viewer.camera.flyTo({
      destination: viewer.camera.positionWC,
      orientation: { heading: viewer.camera.heading, pitch: newPitch, roll: 0 },
      duration: 0.4
    });
  });

  navFlyHomeBtn?.addEventListener("click", navFlyHome);
  navFlyRandom?.addEventListener("click", focusNextHotspot);
}

function navFlyHome() {
  state.regionFocus = null;
  flyToDestination({
    lng: SCENARIO.initialView.lng,
    lat: SCENARIO.initialView.lat,
    height: SCENARIO.initialView.height,
    heading: SCENARIO.initialView.heading,
    pitch: SCENARIO.initialView.pitch,
    roll: SCENARIO.initialView.roll
  }, undefined, 1.8);
}

/* ═══════════════════════════════════════════════════════════════════════════
   LIVE NEWS MODULE
   ═══════════════════════════════════════════════════════════════════════════ */

function initNewsPanel() {
  // Build category pills
  const nav = elements.newsCatNav;
  if (!nav) return;
  nav.innerHTML = "";
  NEWS_CATEGORIES.forEach(cat => {
    const btn = document.createElement("button");
    btn.className = "news-cat-pill";
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", cat.id === state.newsCategory ? "true" : "false");
    btn.dataset.catId = cat.id;
    btn.style.setProperty("--active-color", cat.color);
    btn.innerHTML = `<span class="news-cat-icon">${cat.icon}</span>${cat.label}<span class="news-cat-count" id="news-count-${cat.id}">—</span>`;
    btn.addEventListener("click", () => switchNewsCategory(cat.id));
    nav.appendChild(btn);
  });

  // Wire header buttons
  elements.newsToggleBtn?.addEventListener("click", toggleNewsPanel);
  elements.newsCloseBtn?.addEventListener("click",  closeNewsPanel);
  elements.newsRefreshBtn?.addEventListener("click", () => {
    invalidateNewsCache();
    loadNewsCategory(state.newsCategory, true);
  });
  // Refresh all categories
  elements.newsRefreshAll = document.getElementById("news-refresh-all");
  elements.newsRefreshAll?.addEventListener("click", () => {
    invalidateNewsCache();
    prefetchAllCategories();
  });
  // Pause/play auto-rotation
  elements.newsRotateToggle = document.getElementById("news-rotate-toggle");
  elements.newsRotateToggle?.addEventListener("click", () => {
    const paused = elements.newsRotateToggle.getAttribute("aria-pressed") === "false";
    elements.newsRotateToggle.setAttribute("aria-pressed", paused ? "true" : "false");
    state.newsCategoryPaused = !paused;
  });

  elements.liveNewsHeadline?.addEventListener("mouseenter", () => { state.newsTickerPaused = true; });
  elements.liveNewsHeadline?.addEventListener("mouseleave", () => { state.newsTickerPaused = false; });
  elements.liveNewsHeadline?.addEventListener("focus", () => { state.newsTickerPaused = true; });
  elements.liveNewsHeadline?.addEventListener("blur", () => { state.newsTickerPaused = false; });

  elements.newsBriefing?.addEventListener("mouseenter", () => { state.newsPanelHovering = true; });
  elements.newsBriefing?.addEventListener("mouseleave", () => { state.newsPanelHovering = false; });

  // Auto-refresh every 90 seconds (matches main refresh cadence)
  state.newsRefreshTimer = window.setInterval(() => {
    invalidateNewsCache();
    loadNewsCategory(state.newsCategory, false);
  }, 90_000);

  // Background full-category refresh every 3 minutes so the event visual
  // label pool stays current even when the news panel is closed
  window.setInterval(() => {
    prefetchAllCategories();
  }, 180_000);

  startNewsTicker();

  // Kick off initial fetch silently (panel starts closed)
  prefetchAllCategories();
}

function toggleNewsPanel() {
  if (state.newsOpen) {
    closeNewsPanel();
  } else {
    openNewsPanel();
  }
}

function openNewsPanel() {
  if (window.innerWidth <= 980) setMobileDrawer(null);
  state.newsOpen = true;
  sfx.panelOpen();
  elements.newsBriefing?.classList.remove("hidden");
  elements.newsToggleBtn?.classList.add("active");
  startNewsCategoryRotation();
  hideBadge();
  if (!state.newsArticles.length) {
    loadNewsCategory(state.newsCategory, true);
  } else {
    renderNewsCards(state.newsArticles);
  }
  syncMobileActionButtons();
  if (typeof refreshPanelRestoreStrip === "function") refreshPanelRestoreStrip();
}

function closeNewsPanel() {
  if (!state.newsOpen) return;
  state.newsOpen = false;
  sfx.panelClose();
  elements.newsBriefing?.classList.add("hidden");
  elements.newsToggleBtn?.classList.remove("active");
  stopNewsCategoryRotation();
  syncMobileActionButtons();
  if (typeof refreshPanelRestoreStrip === "function") refreshPanelRestoreStrip();
}

async function switchNewsCategory(catId) {
  if (catId === state.newsCategory && state.newsArticles.length) {
    // Just re-render; no re-fetch unless stale
    renderNewsCards(state.newsArticles);
    return;
  }
  state.newsCategory = catId;
  updateCatPillSelection(catId);
  renderNewsSkeletons();
  await loadNewsCategory(catId, false);
}

function updateCatPillSelection(catId) {
  const nav = elements.newsCatNav;
  if (!nav) return;
  nav.querySelectorAll(".news-cat-pill").forEach(pill => {
    const isActive = pill.dataset.catId === catId;
    pill.setAttribute("aria-selected", isActive ? "true" : "false");
    const cat = NEWS_CATEGORIES.find(c => c.id === pill.dataset.catId);
    if (cat) pill.style.setProperty("--active-color", cat.color);
  });
}

async function loadNewsCategory(catId, forceRefresh) {
  if (forceRefresh) {
    invalidateNewsCache();
    renderNewsSkeletons();
    animateRefreshButton(true);
  }
  try {
    const result = await fetchNewsCategory(catId);
    if (catId !== state.newsCategory) return; // category switched mid-fetch
    state.newsArticles  = result.articles ?? [];
    state.newsLastFetched = result.fetchedAt ?? new Date();
    setNewsUpdatedLabel(state.newsLastFetched);
    renderNewsCards(state.newsArticles);
    updateCategoryCount(catId, state.newsArticles.length);
    updateBadge(state.newsArticles.length);
    if (state.newsCategory === catId) {
      setNewsTickerPool(state.newsArticles);
    }
  } catch (err) {
    renderNewsError(`Fetch failed: ${err?.message ?? "Network error"}`);
  } finally {
    animateRefreshButton(false);
  }
}

async function prefetchAllCategories() {
  try {
    const all = await fetchAllNewsCategories();
    const combinedPool = [];
    Object.entries(all).forEach(([catId, result]) => {
      const catArticles = result.articles ?? [];
      updateCategoryCount(catId, catArticles.length);
      combinedPool.push(...catArticles.slice(0, 4));
    });
    setNewsTickerPool(combinedPool);

    // Seed default category
    const defaultResult = all[state.newsCategory];
    if (defaultResult?.articles?.length) {
      state.newsArticles   = defaultResult.articles;
      state.newsLastFetched = defaultResult.fetchedAt;
      setNewsUpdatedLabel(state.newsLastFetched);
      updateBadge(state.newsArticles.length);
    }
  } catch { /* silent — will load on open */ }
}

// ── Renderers ──────────────────────────────────────────────────────────────

function renderNewsSkeletons() {
  if (!elements.newsCards) return;
  elements.newsCards.innerHTML = `
    <div class="news-skeleton-list">
      <div class="news-skeleton"></div>
      <div class="news-skeleton"></div>
      <div class="news-skeleton"></div>
      <div class="news-skeleton"></div>
      <div class="news-skeleton"></div>
    </div>`;
}

function renderNewsError(message) {
  if (!elements.newsCards) return;
  elements.newsCards.innerHTML = `<div class="news-error">⚠ ${escHtml(message)}</div>`;
}

function renderNewsCards(articles) {
  if (!elements.newsCards) return;
  if (!articles.length) {
    elements.newsCards.innerHTML = `<div class="news-empty">No articles found. Try another category or refresh.</div>`;
    return;
  }
  const cat = NEWS_CATEGORIES.find(c => c.id === state.newsCategory) ?? NEWS_CATEGORIES[0];
  const frag = document.createDocumentFragment();
  articles.forEach((article, i) => {
    const card = buildNewsCard(article, cat, i);
    card.tabIndex = 0;
    card.addEventListener("keydown", event => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        const next = card.nextElementSibling;
        if (next instanceof HTMLElement) next.focus();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        const prev = card.previousElementSibling;
        if (prev instanceof HTMLElement) prev.focus();
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        card.click();
      }
    });
    frag.appendChild(card);
  });
  elements.newsCards.innerHTML = "";
  elements.newsCards.appendChild(frag);
}

function buildNewsCard(article, cat, index) {
  const a = document.createElement("a");
  a.className = "news-card";
  a.href = article.url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.style.setProperty("--card-accent", cat.color);
  a.style.animationDelay = `${index * 0.045}s`;
  a.setAttribute("role", "listitem");

  const thumbWrap = document.createElement("div");
  thumbWrap.className = "news-card-thumb-wrap";

  const fallback = document.createElement("span");
  fallback.className = "news-card-thumb-fallback";
  fallback.textContent = cat.icon;

  if (article.image) {
    const img = document.createElement("img");
    img.className = "news-card-thumb";
    img.src = article.image;
    img.alt = "";
    img.loading = "lazy";
    fallback.style.display = "none";
    img.addEventListener("error", () => {
      img.remove();
      fallback.style.display = "flex";
    });
    thumbWrap.appendChild(img);
  }
  thumbWrap.appendChild(fallback);

  const body = document.createElement("div");
  body.className = "news-card-body";

  const meta = document.createElement("div");
  meta.className = "news-card-meta";

  const catChip = document.createElement("span");
  catChip.className = "news-card-cat";
  catChip.style.background = cat.color;
  catChip.textContent = cat.label;

  const outlet = document.createElement("span");
  outlet.className = "news-card-outlet";

  const favicon = document.createElement("img");
  favicon.className = "news-outlet-favicon";
  favicon.src = article.favicon;
  favicon.alt = "";
  favicon.loading = "lazy";
  favicon.addEventListener("error", () => favicon.remove());

  const domain = document.createElement("span");
  domain.className = "news-outlet-domain";
  domain.textContent = article.domain;

  outlet.appendChild(favicon);
  outlet.appendChild(domain);
  meta.appendChild(catChip);
  meta.appendChild(outlet);

  const titleRow = document.createElement("div");
  titleRow.className = "news-card-title-row";

  const title = document.createElement("span");
  title.className = "news-card-title";

  const lang = article.language;
  const nonEng = isNonEnglish(lang);
  const cacheKey = nonEng ? `${lang}::${article.title}` : null;
  const cachedTranslation = cacheKey ? _translationCache.get(cacheKey) : undefined;

  if (nonEng) {
    const showingTranslated = cachedTranslation && cachedTranslation !== article.title && !article._cardShowOriginal;
    title.textContent = showingTranslated ? cachedTranslation : article.title;

    const langTag = document.createElement("button");
    langTag.type = "button";
    langTag.className = "card-lang-tag";
    const lname = langDisplayName(lang);
    if (article._cardShowOriginal || !showingTranslated) {
      langTag.textContent = lang.slice(0, 3).toUpperCase();
      langTag.title = cachedTranslation
        ? `Translated from ${lname} · click to show translation`
        : `Source language: ${lname}`;
      if (article._cardShowOriginal) langTag.classList.add("showing-original");
    } else {
      langTag.textContent = lang.slice(0, 3).toUpperCase();
      langTag.title = `Translated from ${lname} · click to show original`;
    }

    langTag.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      article._cardShowOriginal = !article._cardShowOriginal;
      if (article._cardShowOriginal) {
        title.textContent = article.title;
        langTag.textContent = "EN";
        langTag.title = `Show English translation (from ${lname})`;
        langTag.classList.add("showing-original");
      } else {
        const latest = _translationCache.get(cacheKey);
        title.textContent = (latest && latest !== article.title) ? latest : article.title;
        langTag.textContent = lang.slice(0, 3).toUpperCase();
        langTag.title = `Translated from ${lname} · click to show original`;
        langTag.classList.remove("showing-original");
      }
    };

    titleRow.appendChild(title);
    titleRow.appendChild(langTag);

    // Async translate if not already cached
    if (!cachedTranslation) {
      translateTitle(article.title, lang).then(translated => {
        if (translated && translated !== article.title && !article._cardShowOriginal) {
          title.textContent = translated;
          langTag.title = `Translated from ${lname} · click to show original`;
        }
      });
    }
  } else {
    title.textContent = article.title;
    titleRow.appendChild(title);
  }

  const time = document.createElement("div");
  time.className = "news-card-time";
  time.textContent = `${article.relativeTime}${article.country ? ` · ${article.country}` : ""}`;

  body.appendChild(meta);
  body.appendChild(titleRow);
  body.appendChild(time);

  a.appendChild(thumbWrap);
  a.appendChild(body);
  return a;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function setNewsTickerPool(items) {
  if (!Array.isArray(items) || !items.length) return;
  const deduped = [];
  const seen = new Set();
  items.forEach(item => {
    const key = item?.url || item?.title;
    if (!key || seen.has(key)) return;
    seen.add(key);
    deduped.push(item);
  });
  state.newsTickerPool = deduped.slice(0, 40);
  state.newsTickerIndex = 0;
  renderNewsTickerHeadline();

  // Pre-translate non-English articles in background so they're ready when displayed
  preTranslatePool(state.newsTickerPool);
}

/** Fire-and-forget: translate up to 16 non-English titles ahead of time */
function preTranslatePool(pool) {
  let queued = 0;
  for (const item of pool) {
    if (queued >= 16) break;
    if (!item.language || !isNonEnglish(item.language)) continue;
    const cacheKey = `${item.language}::${item.title}`;
    if (_translationCache.has(cacheKey)) continue;
    queued++;
    // Stagger requests to avoid rate-limiting (200ms apart)
    setTimeout(() => translateTitle(item.title, item.language), queued * 200);
  }
}

function startNewsTicker() {
  if (!elements.liveNewsHeadline) return;
  renderNewsTickerHeadline();
  if (state.newsTickerTimer) window.clearInterval(state.newsTickerTimer);
  state.newsTickerTimer = window.setInterval(() => {
    if (state.newsTickerPaused) return;
    if (!state.newsTickerPool.length) return;
    state.newsTickerIndex = (state.newsTickerIndex + 1) % state.newsTickerPool.length;
    renderNewsTickerHeadline(true);
  }, 12000);

  // Swipe left/right on ticker to cycle headlines manually
  let _tickerTouchStartX = 0;
  const tickerEl = elements.liveNewsHeadline;
  if (tickerEl) {
    tickerEl.addEventListener("touchstart", (e) => {
      _tickerTouchStartX = e.touches[0].clientX;
    }, { passive: true });
    tickerEl.addEventListener("touchend", (e) => {
      const dx = e.changedTouches[0].clientX - _tickerTouchStartX;
      if (Math.abs(dx) < 40) return; // not a swipe
      if (!state.newsTickerPool.length) return;
      if (dx < 0) {
        // Swipe left → next
        state.newsTickerIndex = (state.newsTickerIndex + 1) % state.newsTickerPool.length;
      } else {
        // Swipe right → previous
        state.newsTickerIndex = (state.newsTickerIndex - 1 + state.newsTickerPool.length) % state.newsTickerPool.length;
      }
      renderNewsTickerHeadline(true);
      if (navigator.vibrate) navigator.vibrate(15);
    }, { passive: true });
  }
}

function startNewsCategoryRotation() {
  if (!_settingsPrefs.newsAutoRotate) return;
  if (state.newsCategoryTimer) window.clearInterval(state.newsCategoryTimer);
  state.newsCategoryTimer = window.setInterval(() => {
    if (!state.newsOpen || state.newsPanelHovering || state.newsCategoryPaused) return;
    rotateToNextNewsCategory();
  }, 22000);
}

function stopNewsCategoryRotation() {
  if (!state.newsCategoryTimer) return;
  window.clearInterval(state.newsCategoryTimer);
  state.newsCategoryTimer = null;
}

function rotateToNextNewsCategory() {
  const index = NEWS_CATEGORIES.findIndex(category => category.id === state.newsCategory);
  const nextIndex = index >= 0 ? (index + 1) % NEWS_CATEGORIES.length : 0;
  const nextCategory = NEWS_CATEGORIES[nextIndex];
  if (!nextCategory) return;
  switchNewsCategory(nextCategory.id);
}

/* ══════════════════════════════════════════════════════════════════════════
   TRANSLATION LAYER  (MyMemory free tier — no key required)
   ══════════════════════════════════════════════════════════════════════════ */
const _translationCache = new Map(); // key: `${langCode}::${text}` → translated string

// GDELT returns full language names; MyMemory expects ISO 639-1 codes
const _LANG_TO_ISO = {
  "arabic": "ar", "chinese": "zh", "dutch": "nl", "french": "fr",
  "german": "de", "greek": "el", "hebrew": "he", "hindi": "hi",
  "hungarian": "hu", "indonesian": "id", "italian": "it", "japanese": "ja",
  "korean": "ko", "malay": "ms", "marathi": "mr", "norwegian": "no",
  "persian": "fa", "polish": "pl", "portuguese": "pt", "romanian": "ro",
  "russian": "ru", "serbian": "sr", "spanish": "es", "swedish": "sv",
  "tamil": "ta", "telugu": "te", "thai": "th", "turkish": "tr",
  "ukrainian": "uk", "urdu": "ur", "vietnamese": "vi", "bengali": "bn",
  "czech": "cs", "danish": "da", "finnish": "fi", "bulgarian": "bg",
  "catalan": "ca", "croatian": "hr", "slovak": "sk", "slovenian": "sl",
  "swahili": "sw", "tagalog": "tl", "afrikaans": "af", "albanian": "sq",
  "amharic": "am", "azerbaijani": "az", "basque": "eu", "belarusian": "be",
  "bosnian": "bs", "burmese": "my", "estonian": "et", "georgian": "ka",
  "gujarati": "gu", "hausa": "ha", "icelandic": "is", "kannada": "kn",
  "kazakh": "kk", "khmer": "km", "latvian": "lv", "lithuanian": "lt",
  "macedonian": "mk", "malayalam": "ml", "mongolian": "mn", "nepali": "ne",
  "pashto": "ps", "punjabi": "pa", "sinhala": "si", "somali": "so",
  "uzbek": "uz", "yoruba": "yo", "zulu": "zu"
};

function langToIso(code) {
  if (!code) return code;
  // If already a 2-3 letter code, return as-is
  if (code.length <= 3) return code.toLowerCase();
  // Try lookup by full name
  const iso = _LANG_TO_ISO[code.toLowerCase()];
  return iso || code.toLowerCase();
}

let _langNames;
try {
  _langNames = new Intl.DisplayNames(["en"], { type: "language" });
} catch (_) {
  _langNames = null;
}

function langDisplayName(code) {
  if (!code) return code;
  try {
    const name = _langNames?.of(code);
    if (name && name !== code) return name;
  } catch (_) { /* ignore */ }
  // fallback: capitalize the code
  return code.toUpperCase();
}

function isNonEnglish(langCode) {
  if (!langCode) return false;
  const lc = langCode.toLowerCase();
  return lc !== "en" && lc !== "eng" && lc !== "english";
}

/**
 * Translate a single title via Google Translate (free, no key).
 * Returns the translated string, or the original if translation fails/matches.
 * Results are cached in-memory.
 */
async function translateTitle(text, fromLang) {
  if (!text || !fromLang || !isNonEnglish(fromLang)) return text;
  const cacheKey = `${fromLang}::${text}`;
  if (_translationCache.has(cacheKey)) return _translationCache.get(cacheKey);

  const isoCode = langToIso(fromLang);
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(isoCode)}&tl=en&dt=t&q=${encodeURIComponent(text)}`;
    const signal = AbortSignal.timeout ? AbortSignal.timeout(7000) : undefined;
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    // Response is nested array: [[["translated","original",...],...],...]
    const translated = data?.[0]?.map(s => s[0]).join("");
    if (translated && translated !== text) {
      _translationCache.set(cacheKey, translated);
      return translated;
    }
  } catch (_) { /* silently fall back */ }
  _translationCache.set(cacheKey, text); // cache original to avoid re-fetching
  return text;
}

function renderNewsTickerHeadline(animate = false) {
  const el = elements.liveNewsHeadline;
  const langBtn = document.getElementById("ticker-lang-btn");
  if (!el) return;

  if (!state.newsTickerPool.length) {
    el.href = "https://www.gdeltproject.org";
    el.textContent = "◉ Initializing signal feed…";
    if (langBtn) langBtn.hidden = true;
    return;
  }

  const item = state.newsTickerPool[state.newsTickerIndex] ?? state.newsTickerPool[0];
  el.href = item.url;

  const lang = item.language;
  const nonEng = isNonEnglish(lang);

  if (nonEng) {
    const cacheKey = `${lang}::${item.title}`;
    const cached = _translationCache.get(cacheKey);

    if (cached !== undefined && cached !== item.title) {
      // We have a translation ready
      const showOrig = item._tickerShowOriginal;
      el.textContent = `◉ ${showOrig ? item.title : cached}`;

      if (langBtn) {
        langBtn.hidden = false;
        const lname = langDisplayName(lang);
        if (showOrig) {
          langBtn.textContent = "EN";
          langBtn.title = "Show English translation";
          langBtn.classList.add("showing-original");
        } else {
          langBtn.textContent = lang.slice(0, 3).toUpperCase();
          langBtn.title = `Translated from ${lname} · click to show original`;
          langBtn.classList.remove("showing-original");
        }
        langBtn.onclick = () => {
          item._tickerShowOriginal = !item._tickerShowOriginal;
          renderNewsTickerHeadline(false);
        };
      }
    } else {
      // No translation yet — show original while we fetch
      el.textContent = `◉ ${item.title}`;
      if (langBtn) langBtn.hidden = true;
      translateTitle(item.title, lang).then(translated => {
        if (translated && translated !== item.title) {
          // Re-render only if this is still the current item
          const cur = state.newsTickerPool[state.newsTickerIndex] ?? state.newsTickerPool[0];
          if (cur?.url === item.url && !item._tickerShowOriginal) {
            renderNewsTickerHeadline(false);
          }
        }
      });
    }
  } else {
    el.textContent = `◉ ${item.title}`;
    if (langBtn) langBtn.hidden = true;
  }

  // Append country badge if available
  if (item.country) {
    const tag = document.createElement("span");
    tag.className = "ticker-country-tag";
    tag.textContent = item.country.toUpperCase();
    el.appendChild(tag);
  }

  if (animate) {
    el.classList.remove("updating");
    void el.offsetWidth;
    el.classList.add("updating");
  }

  // Update the news count badge in the footer
  const newsCountEl = document.getElementById("hud-news-count");
  if (newsCountEl) {
    const n = state.newsTickerPool.length;
    newsCountEl.textContent = n > 0 ? `${n} news` : "— news";
    newsCountEl.classList.toggle("has-news", n > 0);
  }
}

function setNewsUpdatedLabel(date) {
  if (!elements.newsUpdated || !date) return;
  const mins = Math.floor((Date.now() - date.getTime()) / 60000);
  elements.newsUpdated.textContent = mins < 1 ? "Just now" : `${mins}m ago`;
}

function updateCategoryCount(catId, count) {
  const el = document.getElementById(`news-count-${catId}`);
  if (el) el.textContent = count > 0 ? String(count) : "—";
}

function updateBadge(count) {
  if (!elements.newsBadge) return;
  if (!state.newsOpen && count > 0) {
    elements.newsBadge.textContent = count > 99 ? "99+" : String(count);
    elements.newsBadge.classList.remove("hidden");
    return;
  }
  elements.newsBadge.classList.add("hidden");
}

function hideBadge() {
  if (!elements.newsBadge) return;
  elements.newsBadge.classList.add("hidden");
}

function animateRefreshButton(spinning) {
  if (!elements.newsRefreshBtn) return;
  elements.newsRefreshBtn.classList.toggle("spinning", spinning);
}

function escHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ═══════════════════════════════════════════════════════════════════════════
   ENHANCED LIVE DYNAMICS
   ═══════════════════════════════════════════════════════════════════════════ */

// Animated number counter
function animateCountTo(el, from, to, duration) {
  if (!el) return;
  const start = performance.now();
  el.classList.add("updating");
  function tick(now) {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    el.textContent = String(Math.round(from + (to - from) * eased));
    if (progress < 1) {
      requestAnimationFrame(tick);
    } else {
      el.textContent = String(to);
      el.classList.remove("updating");
    }
  }
  requestAnimationFrame(tick);
}

function updateSparkline(key, value) {
  if (!sparklineData[key]) return;
  sparklineData[key].push(value);
  if (sparklineData[key].length > SPARKLINE_MAX_POINTS) sparklineData[key].shift();
  renderSparkline(key);
}

function renderSparkline(key) {
  const container = document.querySelector(`[data-sparkline="${key}"]`);
  if (!container) return;
  const data = sparklineData[key];
  if (data.length < 2) return;
  const max = Math.max(...data, 1);
  container.innerHTML = data.map(v => {
    const h = Math.max(2, (v / max) * 18);
    return `<span class="spark-bar" style="height:${h}px"></span>`;
  }).join("");
}

// Threat level system
function updateThreatLevel() {
  if (!elements.threatSegments) return;
  const segs = elements.threatSegments.querySelectorAll(".threat-seg");
  const activeIncidentCount = dynamic.incidents.filter(({ entity }) => entity.show).length;
  const activeZoneCount = dynamic.zones.filter(({ entity }) => entity.show).length;
  const burstCount = dynamic.eventVisuals.length;
  const level = Math.min(10, Math.max(1, Math.round(activeIncidentCount * 1.6 + activeZoneCount * 0.7 + burstCount * 0.08)));
  const prevLevel = state._prevThreatLevel ?? 0;

  segs.forEach((seg, i) => {
    seg.classList.remove("active", "low", "med", "high", "crit");
    if (i < level) {
      seg.classList.add("active");
      if (i < 3) seg.classList.add("low");
      else if (i < 6) seg.classList.add("med");
      else if (i < 8) seg.classList.add("high");
      else seg.classList.add("crit");
    }
  });
  // Alert sound when threat crosses into critical (level 8+)
  if (level >= 8 && prevLevel < 8) {
    sfx.alert();
    flashTabTitle("CRITICAL ALERT — God's Third Eye");
  }
  state._prevThreatLevel = level;
  if (elements.threatValue) {
    elements.threatValue.textContent = String(level);
    elements.threatValue.style.color =
      level <= 3 ? "var(--threat-low)" :
      level <= 6 ? "var(--threat-med)" :
      level <= 8 ? "var(--threat-high)" : "var(--threat-crit)";
  }
  // Update threat ring SVG
  const ringFill = document.getElementById("threat-ring-fill");
  if (ringFill) {
    const circumference = 75.4; // 2 * PI * 12
    const offset = circumference * (1 - level / 10);
    ringFill.style.strokeDashoffset = offset;
  }
}

// Data throughput simulation
function updateThroughput() {
  if (!elements.throughputBars || !elements.throughputValue) return;
  // Simulate data flow based on active feeds
  const feedCount = [state.liveFeeds.adsb, state.liveFeeds.ais].filter(f => f.status === "live").length;
  const base = feedCount * 1200 + Math.random() * 800;
  _throughputBytes = Math.max(0, Math.round(base + Math.random() * 400 - 200));
  const bars = elements.throughputBars.querySelectorAll(".throughput-bar");
  bars.forEach(bar => {
    bar.style.height = `${Math.round(3 + Math.random() * 11)}px`;
  });
  const formatted = _throughputBytes > 1024
    ? `${(_throughputBytes / 1024).toFixed(1)} KB/s`
    : `${_throughputBytes} B/s`;
  elements.throughputValue.textContent = formatted;
}

// Signal status indicators
function updateSignalIndicators() {
  if (!elements.sigAdsb) return;
  const setSignal = (el, status) => {
    el.classList.remove("green", "amber", "red");
    el.classList.add(status === "live" ? "green" : status === "error" ? "red" : "amber");
  };
  setSignal(elements.sigAdsb, state.liveFeeds.adsb.status);
  setSignal(elements.sigNews, state.newsLastFetched || state.newsArticles.length ? "live" : "pending");
  setSignal(elements.sigAis, state.liveFeeds.ais.status);
}

// Master ambient update loop for all dynamic indicators
function startAmbientUpdates() {
  if (_ambientUpdateTimer) clearInterval(_ambientUpdateTimer);
  if (threatUpdateTimer) clearInterval(threatUpdateTimer);
  // Fast updates (every 2s) for throughput/signal
  _ambientUpdateTimer = setInterval(() => {
    updateThroughput();
    updateSignalIndicators();
  }, 2000);
  // Slower threat update every 8s
  // threatUpdateTimer = setInterval(updateThreatLevelEnhanced, 8000); // disabled — threat bar removed
  startEventVisualLifecycle();
  // Initial run
  updateThroughput();
  updateSignalIndicators();
  updateThreatLevelEnhanced();
}

// ─────────────────────────────────────────────────────────────────────────────
// MULTIPLAYER PRESENCE LAYER
// ─────────────────────────────────────────────────────────────────────────────

/** @type {Map<string, Cesium.Entity>} */
const presenceEntities = new Map();

function initPresenceLayer() {
  // Restore saved operator name or generate one
  let operatorName;
  try { operatorName = localStorage.getItem("panopticon-earth-operator-name"); } catch { /* */ }
  if (!operatorName) {
    operatorName = `Operator-${Math.floor(Math.random() * 9000 + 1000)}`;
    try { localStorage.setItem("panopticon-earth-operator-name", operatorName); } catch { /* */ }
  }

  initPresence(viewer);
  setPresenceName(operatorName);

  // Render peer entities whenever the peer list changes
  onPeersChanged(renderPresencePeers);

  // Update the presence status indicator every 3 seconds
  setInterval(updatePresenceIndicator, 3000);
  updatePresenceIndicator();
}

function renderPresencePeers(peers) {
  // Remove entities for peers that left
  for (const [id, entity] of presenceEntities) {
    if (!peers.has(id)) {
      viewer.entities.remove(entity);
      presenceEntities.delete(id);
    }
  }

  // Update or create entities for current peers
  for (const [id, peer] of peers) {
    let entity = presenceEntities.get(id);
    const position = Cesium.Cartesian3.fromDegrees(peer.lng, peer.lat, Math.min(peer.alt * 0.5, 600000));

    if (entity) {
      entity.position = position;
      if (entity.label) entity.label.text = peer.name;
    } else {
      entity = viewer.entities.add({
        id: `presence-${id}`,
        position,
        point: {
          pixelSize: 10,
          color: Cesium.Color.fromCssColorString(peer.color).withAlpha(0.9),
          outlineColor: Cesium.Color.WHITE.withAlpha(0.8),
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        },
        label: {
          text: peer.name,
          font: '12px "Share Tech Mono"',
          fillColor: Cesium.Color.fromCssColorString(peer.color),
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString("rgba(4,10,18,0.82)"),
          backgroundPadding: new Cesium.Cartesian2(6, 4),
          pixelOffset: new Cesium.Cartesian2(14, -4),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          scale: 0.8
        },
        properties: {
          layerId: "presence",
          entityType: "presence-peer",
          label: peer.name,
          description: `Remote operator: ${peer.name}`
        }
      });
      presenceEntities.set(id, entity);
    }
  }
}

function updatePresenceIndicator() {
  const el = document.getElementById("presence-indicator");
  if (!el) return;
  const connected = isPresenceConnected();
  const peerCount = getPresencePeers().size;
  const online = navigator.onLine;
  el.classList.toggle("connected", connected && online);
  el.classList.toggle("offline", !online);
  if (!online) {
    el.textContent = "NET COMMS: OFFLINE";
  } else {
    el.textContent = connected
      ? `NET COMMS: ${peerCount + 1} ACTIVE`
      : "NET COMMS: STANDBY";
  }
}

// Listen for online/offline events
window.addEventListener("online", () => {
  showToast("Network connection restored", "info");
  updatePresenceIndicator();
});
window.addEventListener("offline", () => {
  showToast("Network connection lost", "info");
  updatePresenceIndicator();
});

// ─────────────────────────────────────────────────────────────────────────────
// IDLE AUTO-ROTATE — Globe slowly spins after 60 s of no interaction
// ─────────────────────────────────────────────────────────────────────────────
let _idleTimer = null;
let _idleSpinning = false;
const IDLE_TIMEOUT_MS = 60000;
let _idleBadgeEl = null;

function resetIdleTimer() {
  if (_idleSpinning) stopIdleSpin();
  clearTimeout(_idleTimer);
  _idleTimer = setTimeout(startIdleSpin, IDLE_TIMEOUT_MS);
}

function startIdleSpin() {
  if (state.spinning || state.trackedEntity || _autoRotatePaused) return; // manual spin, tracking, or paused
  _idleSpinning = true;
  state.spinning = true;
  elements.btnSpin?.classList.add("active");
  if (!_idleBadgeEl) {
    _idleBadgeEl = document.createElement("div");
    _idleBadgeEl.className = "idle-spin-badge";
    _idleBadgeEl.textContent = "IDLE — AUTO-ROTATE";
    document.body.appendChild(_idleBadgeEl);
  }
  requestAnimationFrame(() => _idleBadgeEl.classList.add("visible"));
  setTimeout(() => _idleBadgeEl?.classList.remove("visible"), 3000);
}

function stopIdleSpin() {
  if (!_idleSpinning) return;
  _idleSpinning = false;
  state.spinning = false;
  elements.btnSpin?.classList.remove("active");
  _idleBadgeEl?.classList.remove("visible");
}

function initIdleAutoRotate() {
  const events = ["pointerdown", "pointermove", "wheel", "keydown", "touchstart"];
  events.forEach(evt => document.addEventListener(evt, resetIdleTimer, { passive: true }));
  resetIdleTimer();
}

let _autoRotatePaused = false;
function toggleAutoRotatePause() {
  _autoRotatePaused = !_autoRotatePaused;
  if (_autoRotatePaused) {
    // Stop any current auto-rotation
    if (_passiveSpinListener) {
      viewer?.clock?.onTick?.removeEventListener(_passiveSpinListener);
      _passiveSpinListener = null;
    }
    showEventToast("Auto-rotate paused", "SYSTEM");
  } else {
    resetIdleTimer();
    showEventToast("Auto-rotate resumed", "SYSTEM");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FULLSCREEN TOGGLE — Enter/exit fullscreen with G key
// ─────────────────────────────────────────────────────────────────────────────
function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.().catch(() => {});
    showEventToast("Fullscreen ON", "SYSTEM");
  } else {
    document.exitFullscreen?.();
    showEventToast("Fullscreen OFF", "SYSTEM");
  }
}

function toggleCinemaMode() {
  document.body.classList.toggle("cinema-mode");
  const on = document.body.classList.contains("cinema-mode");
  showToast(on ? "Cinema mode ON" : "Cinema mode OFF", "info");
}

// ─────────────────────────────────────────────────────────────────────────────
// DARK THEME TOGGLE — cycle between default and ultra-dark
// ─────────────────────────────────────────────────────────────────────────────
let _ultraDark = false;
function toggleDarkTheme() {
  _ultraDark = !_ultraDark;
  document.body.classList.toggle("ultra-dark", _ultraDark);
  showEventToast(_ultraDark ? "Ultra-dark mode ON" : "Normal theme", "SYSTEM");
}

// Auto-detect system dark preference
if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
  _ultraDark = true;
  document.body.classList.add("ultra-dark");
}

// ─────────────────────────────────────────────────────────────────────────────
// KEYBOARD SHORTCUTS OVERLAY — Toggle with ?
// ─────────────────────────────────────────────────────────────────────────────
let _kbdOverlay = null;

function toggleKeyboardShortcuts() {
  const overlay = document.getElementById("shortcuts-overlay");
  if (!overlay) return;
  overlay.classList.toggle("hidden");
  // Wire close button once
  if (!overlay._wired) {
    overlay._wired = true;
    document.getElementById("shortcuts-close")?.addEventListener("click", () => overlay.classList.add("hidden"));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.classList.add("hidden");
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS PANEL — Centralised settings overlay
// ─────────────────────────────────────────────────────────────────────────────
const _settingsPrefs = {
  newsToasts: true,
  newsAutoRotate: true,
  ambientAudio: true,
  uiSfx: true,
  notifySfx: true,
  scanlines: true,
  gpuHints: true,
  smoothScroll: true,
  consoleFrame: true,
  compass: true,
  reticle: true,
  footer: true,
  summaryPanel: true,
  classificationBar: true,
  fpsCounter: true,
  uptimeCounter: true,
};

// Wrap sfx calls so UI/notify prefs are respected
const _origSfxPanelOpen  = sfx.panelOpen;
const _origSfxPanelClose = sfx.panelClose;
const _origSfxToggleOn   = sfx.toggleOn;
const _origSfxToggleOff  = sfx.toggleOff;
const _origSfxClick      = sfx.click;
const _origSfxZoomTick   = sfx.zoomTick;
const _origSfxZoom       = sfx.zoom;
const _origSfxNotify     = sfx.notify;
const _origSfxSuccess    = sfx.success;
const _origSfxType       = sfx.type;
const _origSfxPing       = sfx.ping;

function _wrapSfxPrefs() {
  sfx.panelOpen  = () => { if (_settingsPrefs.uiSfx) _origSfxPanelOpen(); };
  sfx.panelClose = () => { if (_settingsPrefs.uiSfx) _origSfxPanelClose(); };
  sfx.toggleOn   = () => { if (_settingsPrefs.uiSfx) _origSfxToggleOn(); };
  sfx.toggleOff  = () => { if (_settingsPrefs.uiSfx) _origSfxToggleOff(); };
  sfx.click      = () => { if (_settingsPrefs.uiSfx) _origSfxClick(); };
  sfx.zoomTick   = () => { if (_settingsPrefs.uiSfx) _origSfxZoomTick(); };
  sfx.zoom       = () => { if (_settingsPrefs.uiSfx) _origSfxZoom(); };
  sfx.type       = () => { if (_settingsPrefs.uiSfx) _origSfxType(); };
  sfx.ping       = () => { if (_settingsPrefs.uiSfx) _origSfxPing(); };
  sfx.notify     = () => { if (_settingsPrefs.notifySfx) _origSfxNotify(); };
  sfx.success    = () => { if (_settingsPrefs.notifySfx) _origSfxSuccess(); };
}
_wrapSfxPrefs();

function openSettings() {
  const overlay = document.getElementById("settings-overlay");
  if (!overlay) return;
  overlay.classList.remove("hidden");
  sfx.panelOpen();
  _syncSettingsUI();
  if (!overlay._wired) {
    overlay._wired = true;
    _wireSettingsPanel(overlay);
  }
}

function closeSettings() {
  const overlay = document.getElementById("settings-overlay");
  if (!overlay) return;
  overlay.classList.add("hidden");
  sfx.panelClose();
}

function _syncSettingsUI() {
  // Display tab
  const el = (id) => document.getElementById(id);
  _setCheck("set-declutter", state.declutter);
  _setCheck("set-compact", state.compact);
  _setCheck("set-ultra-dark", _ultraDark);
  _setCheck("set-cinema", document.body.classList.contains("cinema-mode"));
  _setCheck("set-scanlines", _settingsPrefs.scanlines);

  // FX
  const fxSel = el("set-fx-mode");
  if (fxSel) fxSel.value = state.fxMode;
  _setRange("set-fx-intensity", state.fxIntensity);
  _setRange("set-fx-glow", state.fxGlow);

  // Basemap buttons
  const bmRow = el("set-basemap-row");
  if (bmRow) {
    bmRow.innerHTML = "";
    BASEMAPS.forEach(bm => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `settings-basemap-btn${state.basemapId === bm.id ? " active" : ""}`;
      btn.textContent = bm.label;
      btn.addEventListener("click", () => {
        installBasemap(bm.id);
        renderBasemapButtons();
        _syncSettingsUI();
      });
      bmRow.appendChild(btn);
    });
  }

  // Globe tab
  _setCheck("set-spin", state.spinning);
  _setCheck("set-tilt", state.tiltMode);
  _setCheck("set-globe-grid", !!_gridLayer);
  _setCheck("set-console-frame", _settingsPrefs.consoleFrame);
  _setCheck("set-compass", _settingsPrefs.compass);
  _setCheck("set-reticle", _settingsPrefs.reticle);
  _setCheck("set-footer", _settingsPrefs.footer);
  _setCheck("set-summary-panel", _settingsPrefs.summaryPanel);
  _setCheck("set-classbar", _settingsPrefs.classificationBar);
  _setCheck("set-fps-counter", _settingsPrefs.fpsCounter);
  _setCheck("set-uptime-counter", _settingsPrefs.uptimeCounter);

  // Layers
  const layersList = el("set-layers-list");
  if (layersList) {
    layersList.innerHTML = "";
    LAYERS.forEach(layer => {
      const lbl = document.createElement("label");
      lbl.className = "settings-toggle";
      lbl.innerHTML = `<span>${layer.label}</span><input type="checkbox" ${state.layers[layer.id] ? "checked" : ""} data-settings-layer="${layer.id}" /><span class="settings-switch"></span>`;
      lbl.querySelector("input").addEventListener("change", (e) => {
        state.layers[layer.id] = e.target.checked;
        saveJson(STORAGE_KEYS.layers, state.layers);
        renderLayerToggles();
        renderLegend();
        refreshEntityVisibility();
      });
      layersList.appendChild(lbl);
    });
  }

  // Data tab
  _setRange("set-refresh-interval", state.refreshIntervalSec, `${state.refreshIntervalSec}s`);
  _setCheck("set-news-toasts", _settingsPrefs.newsToasts);
  _setCheck("set-news-autorotate", _settingsPrefs.newsAutoRotate);

  const aisInput = el("set-ais-endpoint");
  if (aisInput) aisInput.value = getConfiguredAisEndpoint() || "";

  // Audio tab
  _setCheck("set-audio-enabled", isAudioEnabled());
  _setCheck("set-ambient", _settingsPrefs.ambientAudio);
  _setCheck("set-ui-sfx", _settingsPrefs.uiSfx);
  _setCheck("set-notify-sfx", _settingsPrefs.notifySfx);

  // Advanced tab
  _setCheck("set-gpu-hints", _settingsPrefs.gpuHints);
  _setCheck("set-smooth-scroll", _settingsPrefs.smoothScroll);
}

function _setCheck(id, val) {
  const cb = document.getElementById(id);
  if (cb) cb.checked = !!val;
}

function _setRange(id, val, display) {
  const sl = document.getElementById(id);
  if (sl) sl.value = val;
  const vEl = document.getElementById(id + "-val");
  if (vEl) vEl.textContent = display ?? String(val);
}

function _wireSettingsPanel(overlay) {
  const el = (id) => document.getElementById(id);

  // Close
  el("settings-close")?.addEventListener("click", closeSettings);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeSettings();
  });

  // Tab switching
  overlay.querySelectorAll("[data-settings-tab]").forEach(tab => {
    tab.addEventListener("click", () => {
      overlay.querySelectorAll(".settings-tab").forEach(t => t.classList.remove("active"));
      overlay.querySelectorAll(".settings-section").forEach(s => s.classList.remove("active"));
      tab.classList.add("active");
      overlay.querySelector(`[data-settings-section="${tab.dataset.settingsTab}"]`)?.classList.add("active");
      sfx.click();
    });
  });

  // ── Display toggles ──
  el("set-declutter")?.addEventListener("change", (e) => {
    state.declutter = e.target.checked;
    applyDeclutterMode();
  });
  el("set-compact")?.addEventListener("change", (e) => {
    state.compact = e.target.checked;
    applyDensityMode();
  });
  el("set-ultra-dark")?.addEventListener("change", (e) => {
    _ultraDark = e.target.checked;
    document.body.classList.toggle("ultra-dark", _ultraDark);
  });
  el("set-cinema")?.addEventListener("change", () => {
    toggleCinemaMode();
    _syncSettingsUI();
  });
  el("set-scanlines")?.addEventListener("change", (e) => {
    _settingsPrefs.scanlines = e.target.checked;
    const scanEl = document.getElementById("scanline-overlay");
    if (scanEl) scanEl.style.display = e.target.checked ? "" : "none";
    _saveSettingsPrefs();
  });

  // ── FX ──
  el("set-fx-mode")?.addEventListener("change", (e) => {
    state.fxMode = e.target.value;
    saveJson(STORAGE_KEYS.fxMode, state.fxMode);
    applyFxMode(state.fxMode);
    renderFxButtons();
  });
  el("set-fx-intensity")?.addEventListener("input", (e) => {
    state.fxIntensity = Number(e.target.value);
    el("set-fx-intensity-val").textContent = e.target.value;
    applyFxIntensity();
    if (elements.fxIntensity) elements.fxIntensity.value = e.target.value;
  });
  el("set-fx-glow")?.addEventListener("input", (e) => {
    state.fxGlow = Number(e.target.value);
    el("set-fx-glow-val").textContent = e.target.value;
    applyGlow();
    if (elements.fxGlow) elements.fxGlow.value = e.target.value;
  });

  // ── Globe tab ──
  el("set-spin")?.addEventListener("change", (e) => {
    state.spinning = e.target.checked;
    elements.btnSpin?.classList.toggle("active", state.spinning);
    state.spinning ? sfx.toggleOn() : sfx.toggleOff();
  });
  el("set-tilt")?.addEventListener("change", (e) => {
    state.tiltMode = e.target.checked;
    elements.btnTilt?.classList.toggle("active", state.tiltMode);
    viewer.camera.flyTo({
      destination: viewer.camera.positionWC,
      orientation: { heading: viewer.camera.heading, pitch: state.tiltMode ? Cesium.Math.toRadians(-38) : Cesium.Math.toRadians(-90), roll: 0 },
      duration: 0.8
    });
  });
  el("set-globe-grid")?.addEventListener("change", () => {
    toggleGlobeGrid();
    _syncSettingsUI();
  });
  el("set-console-frame")?.addEventListener("change", (e) => {
    _settingsPrefs.consoleFrame = e.target.checked;
    const cf = document.getElementById("console-frame");
    if (cf) cf.style.display = e.target.checked ? "" : "none";
    _saveSettingsPrefs();
  });
  el("set-compass")?.addEventListener("change", (e) => {
    _settingsPrefs.compass = e.target.checked;
    const cr = document.getElementById("compass-rose");
    if (cr) cr.style.display = e.target.checked ? "" : "none";
    _saveSettingsPrefs();
  });
  el("set-reticle")?.addEventListener("change", (e) => {
    _settingsPrefs.reticle = e.target.checked;
    const re = document.getElementById("center-reticle");
    if (re) re.style.display = e.target.checked ? "" : "none";
    _saveSettingsPrefs();
  });
  el("set-footer")?.addEventListener("change", (e) => {
    _settingsPrefs.footer = e.target.checked;
    const ft = document.getElementById("hud-bottom");
    if (ft) ft.style.display = e.target.checked ? "" : "none";
    _saveSettingsPrefs();
  });
  el("set-summary-panel")?.addEventListener("change", (e) => {
    _settingsPrefs.summaryPanel = e.target.checked;
    const sp = document.getElementById("floating-summary");
    if (sp) sp.style.display = e.target.checked ? "" : "none";
    _saveSettingsPrefs();
  });

  // ── Data tab ──
  el("set-refresh-interval")?.addEventListener("input", (e) => {
    state.refreshIntervalSec = Number(e.target.value);
    el("set-refresh-interval-val").textContent = `${e.target.value}s`;
    if (elements.refreshInterval) elements.refreshInterval.value = e.target.value;
    if (elements.refreshIntervalVal) elements.refreshIntervalVal.textContent = `${state.refreshIntervalSec}s`;
    scheduleRefresh();
  });
  el("set-news-toasts")?.addEventListener("change", (e) => {
    _settingsPrefs.newsToasts = e.target.checked;
    _saveSettingsPrefs();
  });
  el("set-news-autorotate")?.addEventListener("change", (e) => {
    _settingsPrefs.newsAutoRotate = e.target.checked;
    if (e.target.checked && state.newsOpen) startNewsCategoryRotation();
    else stopNewsCategoryRotation();
    _saveSettingsPrefs();
  });

  el("set-ais-save")?.addEventListener("click", () => {
    const val = el("set-ais-endpoint")?.value?.trim();
    if (val) { setConfiguredAisEndpoint(val); showToast("AIS endpoint saved", "info"); }
  });
  el("set-ais-clear")?.addEventListener("click", () => {
    setConfiguredAisEndpoint("");
    if (el("set-ais-endpoint")) el("set-ais-endpoint").value = "";
    showToast("AIS endpoint cleared", "info");
  });
  el("set-ais-test")?.addEventListener("click", async () => {
    showToast("Testing AIS endpoint…", "info");
    const result = await testAisEndpoint();
    showToast(typeof result === "string" ? result : "AIS test complete", "info");
  });

  el("set-save-bookmark")?.addEventListener("click", () => {
    saveCurrentBookmark();
    showToast("Bookmark saved", "info");
  });
  el("set-clear-bookmarks")?.addEventListener("click", () => {
    state.bookmarks = state.bookmarks.filter(b => b.system);
    saveJson(STORAGE_KEYS.bookmarks, state.bookmarks);
    renderBookmarks();
    showToast("Custom bookmarks cleared", "info");
  });

  // ── Audio tab ──
  el("set-audio-enabled")?.addEventListener("change", (e) => {
    setAudioEnabled(e.target.checked);
    syncAudioIcon();
  });
  el("set-ambient")?.addEventListener("change", (e) => {
    _settingsPrefs.ambientAudio = e.target.checked;
    if (e.target.checked && isAudioEnabled()) sfx.startAmbient();
    else sfx.stopAmbient();
    _saveSettingsPrefs();
  });
  el("set-ui-sfx")?.addEventListener("change", (e) => {
    _settingsPrefs.uiSfx = e.target.checked;
    _saveSettingsPrefs();
  });
  el("set-notify-sfx")?.addEventListener("change", (e) => {
    _settingsPrefs.notifySfx = e.target.checked;
    _saveSettingsPrefs();
  });

  // ── Advanced tab ──
  el("set-gpu-hints")?.addEventListener("change", (e) => {
    _settingsPrefs.gpuHints = e.target.checked;
    document.body.classList.toggle("no-gpu-hints", !e.target.checked);
    _saveSettingsPrefs();
  });
  el("set-smooth-scroll")?.addEventListener("change", (e) => {
    _settingsPrefs.smoothScroll = e.target.checked;
    document.documentElement.style.scrollBehavior = e.target.checked ? "smooth" : "auto";
    _saveSettingsPrefs();
  });
  el("set-classbar")?.addEventListener("change", (e) => {
    _settingsPrefs.classificationBar = e.target.checked;
    const bar = document.getElementById("classification-bar");
    if (bar) bar.style.display = e.target.checked ? "" : "none";
    _saveSettingsPrefs();
  });
  el("set-fps-counter")?.addEventListener("change", (e) => {
    _settingsPrefs.fpsCounter = e.target.checked;
    const fps = document.getElementById("fps-display");
    if (fps) fps.style.display = e.target.checked ? "" : "none";
    _saveSettingsPrefs();
  });
  el("set-uptime-counter")?.addEventListener("change", (e) => {
    _settingsPrefs.uptimeCounter = e.target.checked;
    const uptime = document.getElementById("session-uptime-wrap");
    if (uptime) uptime.style.display = e.target.checked ? "" : "none";
    _saveSettingsPrefs();
  });
  el("set-save-layout")?.addEventListener("click", () => {
    saveCurrentLayout();
    showToast("Layout saved", "info");
  });
  el("set-clear-layouts")?.addEventListener("click", () => {
    state.savedLayouts = [];
    saveJson(UI_STORAGE_KEYS.layouts, state.savedLayouts);
    renderSavedLayouts();
    showToast("Layouts cleared", "info");
  });
  el("set-reset-panels")?.addEventListener("click", () => {
    const fresh = createDefaultPanelState();
    state.panelState = fresh;
    savePanelState();
    applyStoredPanelState();
    showToast("Panel positions reset", "info");
  });
  el("set-reset-all")?.addEventListener("click", () => {
    if (!confirm("Reset ALL settings to defaults? The page will reload.")) return;
    Object.values(STORAGE_KEYS).forEach(k => { try { localStorage.removeItem(k); } catch { /* */ } });
    Object.values(UI_STORAGE_KEYS).forEach(k => { try { localStorage.removeItem(k); } catch { /* */ } });
    try { localStorage.removeItem("panopticon-earth-settings-prefs"); } catch { /* */ }
    try { localStorage.removeItem("panopticon-earth-audio-enabled"); } catch { /* */ }
    window.location.reload();
  });
  el("set-export-config")?.addEventListener("click", () => {
    const config = {
      exportedAt: new Date().toISOString(),
      settingsPrefs: { ..._settingsPrefs },
      state: {
        fxMode: state.fxMode,
        basemapId: state.basemapId,
        declutter: state.declutter,
        compact: state.compact,
        refreshIntervalSec: state.refreshIntervalSec,
        fxIntensity: state.fxIntensity,
        fxGlow: state.fxGlow,
        layers: { ...state.layers },
      },
    };
    const json = JSON.stringify(config, null, 2);
    navigator.clipboard.writeText(json).then(() => {
      showToast("Settings exported to clipboard", "success");
    }).catch(() => {
      showToast("Clipboard unavailable — see console", "warning");
      console.log("[Settings Export]\n" + json);
    });
  });
}

const _SETTINGS_PREFS_KEY = "panopticon-earth-settings-prefs";
function _saveSettingsPrefs() {
  try { localStorage.setItem(_SETTINGS_PREFS_KEY, JSON.stringify(_settingsPrefs)); } catch { /* */ }
}
function _loadSettingsPrefs() {
  try {
    const raw = localStorage.getItem(_SETTINGS_PREFS_KEY);
    if (raw) Object.assign(_settingsPrefs, JSON.parse(raw));
  } catch { /* */ }
}
_loadSettingsPrefs();

// ─────────────────────────────────────────────────────────────────────────────
// PINCH-TO-ZOOM HINT — Shows once on mobile touch devices
// ─────────────────────────────────────────────────────────────────────────────
function showPinchHint() {
  const HINT_KEY = "panopticon-earth-pinch-hint-seen";
  try { if (localStorage.getItem(HINT_KEY)) return; } catch { /* */ }
  if (!("ontouchstart" in window)) return;
  const hint = document.createElement("div");
  hint.className = "pinch-hint";
  hint.innerHTML = `
    <span class="pinch-hint-icon">👆👆</span>
    <span>Pinch to zoom · Drag to rotate</span>
  `;
  document.body.appendChild(hint);
  try { localStorage.setItem(HINT_KEY, "1"); } catch { /* */ }
  setTimeout(() => hint.remove(), 5000);
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENT COUNT CHIP — Pulse when events are active
// ─────────────────────────────────────────────────────────────────────────────
const _origUpdateEventCount = updateEventCount;
// Wrap existing updateEventCount to add .has-events class
(function patchEventCountChip() {
  const original = updateEventCount;
  // Already monkey-patched above; override directly
})();

function updateEventCountChip() {
  const el = document.getElementById("hud-event-count");
  if (!el) return;
  const n = dynamic.eventVisuals.length;
  el.textContent = n > 0 ? `${n} events` : "— events";
  el.classList.toggle("has-events", n > 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// IMPROVED THREAT LEVEL — Factor in live news pool size + geo events
// ─────────────────────────────────────────────────────────────────────────────
function updateThreatLevelEnhanced() {
  if (!elements.threatSegments) return;
  const segs = elements.threatSegments.querySelectorAll(".threat-seg");
  const activeIncidentCount = dynamic.incidents.filter(({ entity }) => entity.show).length;
  const activeZoneCount = dynamic.zones.filter(({ entity }) => entity.show).length;
  const burstCount = dynamic.eventVisuals.length;
  const newsPoolSize = state.newsTickerPool?.length ?? 0;
  const geoEventCount = dynamic.eventVisuals.filter(v => v.geoSpawned).length;

  // Weighted formula: incidents are critical, news volume raises awareness, geo events add intensity
  const level = Math.min(10, Math.max(1, Math.round(
    activeIncidentCount * 1.6 +
    activeZoneCount * 0.7 +
    burstCount * 0.12 +
    newsPoolSize * 0.08 +
    geoEventCount * 0.15
  )));
  const prevLevel = state._prevThreatLevel ?? 0;

  segs.forEach((seg, i) => {
    seg.classList.remove("active", "low", "med", "high", "crit");
    if (i < level) {
      seg.classList.add("active");
      if (i < 3) seg.classList.add("low");
      else if (i < 6) seg.classList.add("med");
      else if (i < 8) seg.classList.add("high");
      else seg.classList.add("crit");
    }
  });
  if (level >= 8 && prevLevel < 8) {
    sfx.alert();
    flashTabTitle("CRITICAL ALERT — God's Third Eye");
    // Text-to-speech announcement for critical threat
    if (window.speechSynthesis && isAudioEnabled()) {
      const msg = new SpeechSynthesisUtterance(`Warning. Threat level elevated to ${level}. Critical alert.`);
      msg.rate = 0.9;
      msg.pitch = 0.8;
      msg.volume = 0.6;
      window.speechSynthesis.speak(msg);
    }
  }
  state._prevThreatLevel = level;
  if (elements.threatValue) {
    elements.threatValue.textContent = String(level);
    elements.threatValue.style.color =
      level <= 3 ? "var(--threat-low)" :
      level <= 6 ? "var(--threat-med)" :
      level <= 8 ? "var(--threat-high)" : "var(--threat-crit)";
  }
  // Tint the classification bar based on threat level
  const classBar = document.getElementById("classification-bar");
  if (classBar) {
    classBar.classList.remove("threat-elevated", "threat-critical");
    if (level >= 8) classBar.classList.add("threat-critical");
    else if (level >= 6) classBar.classList.add("threat-elevated");
  }
  document.body.classList.toggle("threat-critical-glow", level >= 8);

  // Camera shake on new critical threshold
  const wasCritical = state._lastThreatCritical || false;
  const isCritical = level >= 8;
  if (isCritical && !wasCritical) {
    document.body.classList.add("camera-shake");
    setTimeout(() => document.body.classList.remove("camera-shake"), 600);
  }
  state._lastThreatCritical = isCritical;

  // Tint atmosphere based on threat level
  if (viewer.scene.globe.enableLighting !== undefined) {
    const atmo = viewer.scene.atmosphere;
    if (atmo) {
      if (level >= 8) {
        atmo.hueShift = -0.05; // slight red tint
        atmo.saturationShift = 0.1;
      } else if (level >= 6) {
        atmo.hueShift = -0.02;
        atmo.saturationShift = 0.05;
      } else {
        atmo.hueShift = 0;
        atmo.saturationShift = 0;
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LIVE UTC CLOCK — updates every second in the footer
// ─────────────────────────────────────────────────────────────────────────────
function initUtcClock() {
  const el = document.getElementById("live-utc-clock");
  if (!el) return;

  const ZONES = [
    { label: "UTC",    tz: "UTC" },
    { label: "EST",    tz: "America/New_York" },
    { label: "PST",    tz: "America/Los_Angeles" },
    { label: "CET",    tz: "Europe/Paris" },
    { label: "MSK",    tz: "Europe/Moscow" },
    { label: "JST",    tz: "Asia/Tokyo" },
    { label: "CST",    tz: "Asia/Shanghai" },
    { label: "IST",    tz: "Asia/Kolkata" },
    { label: "AEST",   tz: "Australia/Sydney" },
  ];
  let zoneIdx = 0;

  function tick() {
    const now = new Date();
    const zone = ZONES[zoneIdx];
    try {
      const fmt = new Intl.DateTimeFormat("en-GB", {
        timeZone: zone.tz,
        hour: "2-digit", minute: "2-digit", second: "2-digit",
        hour12: false
      });
      el.textContent = `${fmt.format(now)} ${zone.label}`;
    } catch {
      const h = String(now.getUTCHours()).padStart(2, "0");
      const m = String(now.getUTCMinutes()).padStart(2, "0");
      const s = String(now.getUTCSeconds()).padStart(2, "0");
      el.textContent = `${h}:${m}:${s} UTC`;
    }
  }
  tick();
  setInterval(tick, 1000);

  // Click to cycle through time zones
  el.style.cursor = "pointer";
  el.title = "Click to cycle time zones";
  el.addEventListener("click", () => {
    zoneIdx = (zoneIdx + 1) % ZONES.length;
    tick();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// REGION ACTIVITY HALOS — colored circles around high-activity regions
// ─────────────────────────────────────────────────────────────────────────────
const _regionHalos = [];

function updateRegionHalos() {
  // Remove old halos
  for (const h of _regionHalos) viewer.entities.remove(h);
  _regionHalos.length = 0;

  // Group events by rough region (10° grid cells)
  const grid = new Map();
  for (const ev of dynamic.eventVisuals) {
    if (ev.lng == null || ev.lat == null) continue;
    const key = `${Math.round(ev.lat / 10) * 10},${Math.round(ev.lng / 10) * 10}`;
    if (!grid.has(key)) grid.set(key, { lat: 0, lng: 0, count: 0 });
    const cell = grid.get(key);
    cell.lat += ev.lat;
    cell.lng += ev.lng;
    cell.count++;
  }

  for (const [, cell] of grid) {
    if (cell.count < 2) continue;
    const avgLat = cell.lat / cell.count;
    const avgLng = cell.lng / cell.count;
    const intensity = Math.min(cell.count / 5, 1);
    const radius = 300000 + intensity * 500000;
    const color = intensity > 0.6
      ? Cesium.Color.fromCssColorString("#ff3366").withAlpha(0.08 + intensity * 0.06)
      : Cesium.Color.fromCssColorString("#f59e0b").withAlpha(0.06 + intensity * 0.04);

    const halo = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(avgLng, avgLat),
      ellipse: {
        semiMinorAxis: radius,
        semiMajorAxis: radius,
        height: 200,
        material: color,
        outline: true,
        outlineColor: color.withAlpha(color.alpha * 2),
        outlineWidth: 1
      },
      properties: {
        layerId: "incidents",
        entityType: "region-halo",
        label: `Activity cluster (${cell.count} events)`,
        description: `Region hotspot: ${cell.count} active events`
      }
    });
    _regionHalos.push(halo);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ANIMATED THROUGHPUT BARS — make them bounce based on actual throughput
// ─────────────────────────────────────────────────────────────────────────────
function animateThroughputBars() {
  const bars = document.querySelectorAll("#throughput-bars .throughput-bar");
  if (!bars.length) return;
  const throughput = _throughputBytes || 0;
  const normalized = Math.min(throughput / 2000, 1); // normalize to 0-1 range

  bars.forEach((bar, i) => {
    const base = 3 + Math.random() * 4;
    const boost = normalized * (6 + Math.random() * 6);
    bar.style.height = `${Math.round(base + boost)}px`;
    bar.style.transition = "height 0.4s ease";
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// TOAST SYSTEM — all notifications routed through a single container
// ─────────────────────────────────────────────────────────────────────────────
function _getToastContainer() {
  let c = document.getElementById("toast-container");
  if (!c) {
    c = document.createElement("div");
    c.id = "toast-container";
    c.className = "toast-container";
    c.setAttribute("aria-live", "polite");
    document.body.appendChild(c);
  }
  return c;
}

function showToast(message, type = "info") {
  const toast = document.createElement("div");
  toast.className = `event-toast toast-${type}`;
  const icon = type === "success" ? "✓"
    : type === "error"   ? "✗"
    : type === "warning" ? "⚠"
    : "ℹ";
  toast.innerHTML = `<span class="toast-icon">${icon}</span><span class="toast-text">${escapeHtml(message)}</span><button class="toast-close" type="button" title="Dismiss" aria-label="Dismiss">✕</button>`;
  _getToastContainer().appendChild(toast);
  let dismissed = false;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    toast.classList.remove("toast-enter");
    toast.classList.add("toast-exit");
    setTimeout(() => toast.remove(), 350);
  };
  toast.querySelector(".toast-close").addEventListener("click", dismiss);
  if (type === "success") sfx.success?.();
  else if (type === "error") sfx.alert?.();
  else sfx.notify();
  requestAnimationFrame(() => toast.classList.add("toast-enter"));
  setTimeout(dismiss, type === "error" ? 4000 : 2800);
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENT TOAST NOTIFICATIONS — slide-in toasts when new events spawn
// ─────────────────────────────────────────────────────────────────────────────
const _toastQueue = [];

function showEventToast(title, country) {
  if (!_settingsPrefs.newsToasts) return;
  _toastQueue.push({ title, country });
  processToastQueue();
}

let _activeToasts = [];
const MAX_TOASTS = 3;

function processToastQueue() {
  if (!_toastQueue.length) return;
  if (_activeToasts.length >= MAX_TOASTS) return;

  const { title, country } = _toastQueue.shift();

  const toast = document.createElement("div");
  toast.className = "event-toast";
  const countryTag = country ? `<span class="toast-country">${country.toUpperCase()}</span>` : "";
  toast.innerHTML = `<span class="toast-icon">⚡</span><span class="toast-text">${escapeHtml(title.slice(0, 68))}${title.length > 68 ? "…" : ""}</span>${countryTag}<button class="toast-close" type="button" title="Dismiss" aria-label="Dismiss">✕</button>`;
  _getToastContainer().appendChild(toast);
  _activeToasts.push(toast);

  let dismissed = false;
  const dismissEventToast = () => {
    if (dismissed) return;
    dismissed = true;
    toast.classList.remove("toast-enter");
    toast.classList.add("toast-exit");
    setTimeout(() => {
      toast.remove();
      _activeToasts = _activeToasts.filter(t => t !== toast);
      processToastQueue();
    }, 350);
  };
  toast.querySelector(".toast-close").addEventListener("click", dismissEventToast);

  sfx.notify();
  requestAnimationFrame(() => toast.classList.add("toast-enter"));
  setTimeout(dismissEventToast, 3200);

  if (_toastQueue.length && _activeToasts.length < MAX_TOASTS) {
    setTimeout(() => processToastQueue(), 180);
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// SESSION STATS — track and display operational session metrics
// ─────────────────────────────────────────────────────────────────────────────

function updateEventHistoryTrail(lng, lat) {
  _eventHistoryPositions.push(Cesium.Cartesian3.fromDegrees(lng, lat, 3000));
  if (_eventHistoryPositions.length > _EVENT_HISTORY_MAX) {
    _eventHistoryPositions.shift();
  }
  if (_eventHistoryPositions.length < 2) return;

  if (_eventHistoryEntity) {
    try { viewer.entities.remove(_eventHistoryEntity); } catch (e) {}
  }
  _eventHistoryEntity = viewer.entities.add({
    polyline: {
      positions: [..._eventHistoryPositions],
      width: 1.0,
      material: new Cesium.PolylineDashMaterialProperty({
        color: Cesium.Color.fromCssColorString("#00e5ff").withAlpha(0.25),
        dashLength: 18,
        dashPattern: 0xFF00
      }),
      arcType: Cesium.ArcType.GEODESIC,
      clampToGround: false
    }
  });
}

function updateSessionStats(country) {
  state.sessionStats.eventsSpawned++;
  if (country) state.sessionStats.countriesSeen.add(country.toLowerCase());
}

function getSessionSummary() {
  const elapsed = Date.now() - state.sessionStats.sessionStart;
  const mins = Math.floor(elapsed / 60000);
  return {
    duration: mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`,
    eventsSpawned: state.sessionStats.eventsSpawned,
    countriesSeen: state.sessionStats.countriesSeen.size,
    articlesIngested: state.newsTickerPool?.length ?? 0
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SCANLINE OVERLAY — subtle CRT-style scan lines for surveillance aesthetic
// ─────────────────────────────────────────────────────────────────────────────
function initScanlineOverlay() {
  if (document.getElementById("scanline-overlay")) return;
  const overlay = document.createElement("div");
  overlay.id = "scanline-overlay";
  overlay.className = "scanline-overlay";
  document.body.appendChild(overlay);
}

// ─────────────────────────────────────────────────────────────────────────────
// CAMERA POSITION INDICATOR — show current lat/lng/altitude in header
// ─────────────────────────────────────────────────────────────────────────────
function initCameraPositionHud() {
  const el = document.getElementById("camera-position-hud");
  const zoomEl = document.getElementById("hud-zoom-level");
  const reticle = document.getElementById("center-reticle");
  if (!el) return;

  let _lastCoords = "";

  function update() {
    const cam = viewer.camera.positionCartographic;
    if (!cam) return;
    const lat = Cesium.Math.toDegrees(cam.latitude).toFixed(1);
    const lng = Cesium.Math.toDegrees(cam.longitude).toFixed(1);
    const alt = cam.height;
    const altStr = alt > 1000000
      ? `${(alt / 1000000).toFixed(1)}M m`
      : alt > 1000
        ? `${(alt / 1000).toFixed(0)}K m`
        : `${Math.round(alt)} m`;
    _lastCoords = `${lat}, ${lng}`;
    el.textContent = `${lat}° ${lng}° · ${altStr}`;

    // Zoom level label
    if (zoomEl) {
      let level;
      if (alt > 12000000) level = "ORBITAL";
      else if (alt > 5000000) level = "GLOBAL";
      else if (alt > 2000000) level = "CONTINENTAL";
      else if (alt > 500000) level = "REGIONAL";
      else if (alt > 100000) level = "TACTICAL";
      else level = "GROUND";
      zoomEl.textContent = level;
    }

    // Hide reticle at far orbital distances
    if (reticle) {
      reticle.style.opacity = alt > 18000000 ? "0" : "";
    }
  }
  viewer.camera.changed.addEventListener(update);
  update();

  // Click to copy coordinates
  el.style.cursor = "pointer";
  el.title = "Click to copy coordinates";
  el.addEventListener("click", () => {
    if (!_lastCoords) return;
    navigator.clipboard?.writeText(_lastCoords).then(() => {
      showEventToast(`Copied: ${_lastCoords}`, "SYSTEM");
    }).catch(() => {});
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// ARROW KEY CAMERA NUDGE — fine-tune camera position with arrow keys
// ─────────────────────────────────────────────────────────────────────────────
function initArrowKeyNudge() {
  window.addEventListener("keydown", event => {
    const target = event.target;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;

    const nudgeAmount = event.shiftKey ? 0.01 : 0.002;
    let heading = 0, pitch = 0;

    switch (event.key) {
      case "ArrowLeft":  heading = -nudgeAmount; break;
      case "ArrowRight": heading = nudgeAmount; break;
      case "ArrowUp":    pitch = nudgeAmount; break;
      case "ArrowDown":  pitch = -nudgeAmount; break;
      default: return;
    }

    event.preventDefault();
    pausePassiveSpin(5000);
    viewer.camera.rotateLeft(heading);
    viewer.camera.rotateUp(pitch);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SELECTION RING — highlight the selected entity with a pulsing ring
// ─────────────────────────────────────────────────────────────────────────────
let _selectionRingEntity = null;
function showSelectionRing(entity) {
  hideSelectionRing();
  if (!entity?.position || !viewer) return;
  try {
    const pos = entity.position.getValue(viewer.clock.currentTime);
    if (!pos) return;
    const cg = Cesium.Cartographic.fromCartesian(pos);
    const lng = Cesium.Math.toDegrees(cg.longitude);
    const lat = Cesium.Math.toDegrees(cg.latitude);
    let step = 0;
    const ring = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lng, lat),
      ellipse: {
        semiMajorAxis: new Cesium.CallbackProperty(() => {
          return 50000 + Math.sin(step * 0.08) * 15000;
        }, false),
        semiMinorAxis: new Cesium.CallbackProperty(() => {
          return 50000 + Math.sin(step * 0.08) * 15000;
        }, false),
        material: Cesium.Color.CYAN.withAlpha(0.0),
        outline: true,
        outlineColor: new Cesium.CallbackProperty(() => {
          step++;
          const alpha = 0.3 + Math.sin(step * 0.06) * 0.15;
          return Cesium.Color.CYAN.withAlpha(alpha);
        }, false),
        outlineWidth: 2,
        height: 0,
      },
    });
    _selectionRingEntity = ring;
  } catch { /* */ }
}

function hideSelectionRing() {
  if (_selectionRingEntity && viewer) {
    try { viewer.entities.remove(_selectionRingEntity); } catch { /* */ }
    _selectionRingEntity = null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GLOBE CONTEXT MENU — Right-click actions on the globe
// ─────────────────────────────────────────────────────────────────────────────
let _ctxMenu = null;
function showGlobeContextMenu(x, y, entity, lat, lng) {
  hideGlobeContextMenu();
  const menu = document.createElement("div");
  menu.className = "globe-ctx-menu";
  const items = [];

  if (lat !== null && lng !== null) {
    items.push({ label: `📍 ${lat.toFixed(2)}°, ${lng.toFixed(2)}°`, disabled: true });
    items.push({ label: "🔎 Fly here", action: () => {
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(lng, lat, 1500000),
        duration: 1.5
      });
    }});
    items.push({ label: "📋 Copy coordinates", action: () => {
      navigator.clipboard?.writeText(`${lat.toFixed(4)}, ${lng.toFixed(4)}`);
      showEventToast("Coordinates copied", "SYSTEM");
    }});
  }

  if (entity) {
    const info = getEntityInfo(entity);
    if (info) {
      items.push({ label: `📊 Intel: ${info.label}`, action: () => openIntelSheet(entity) });
    }
    if (entity.position) {
      items.push({ label: "🎯 Track entity", action: () => {
        viewer.trackedEntity = entity;
        state.trackedEntity = entity;
      }});
    }
  }

  items.push({ label: "📸 Screenshot", action: () => captureGlobeScreenshot() });
  items.push({ label: "🏠 Fly home", action: () => navFlyHome() });

  items.forEach(item => {
    const el = document.createElement("div");
    el.className = "globe-ctx-item" + (item.disabled ? " disabled" : "");
    el.textContent = item.label;
    if (item.action) {
      el.addEventListener("click", () => { hideGlobeContextMenu(); item.action(); });
    }
    menu.appendChild(el);
  });

  // Position menu within viewport
  menu.style.left = `${Math.min(x, window.innerWidth - 220)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - items.length * 34 - 20)}px`;
  document.body.appendChild(menu);
  _ctxMenu = menu;

  // Close on next click anywhere
  setTimeout(() => {
    document.addEventListener("click", hideGlobeContextMenu, { once: true });
    document.addEventListener("contextmenu", function suppress(e) {
      if (_ctxMenu) { e.preventDefault(); hideGlobeContextMenu(); }
      document.removeEventListener("contextmenu", suppress);
    });
  }, 50);
}

function hideGlobeContextMenu() {
  if (_ctxMenu) { _ctxMenu.remove(); _ctxMenu = null; }
}

// ─────────────────────────────────────────────────────────────────────────────
// GLOBE SCREENSHOT — Captures the Cesium canvas + overlays
// ─────────────────────────────────────────────────────────────────────────────
function captureGlobeScreenshot() {
  if (!viewer) return;
  viewer.render(); // force a fresh frame
  const canvas = viewer.scene.canvas;
  try {
    const dataUrl = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = dataUrl;
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    a.download = `gods-eye-${ts}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } catch (err) {
    console.warn("Screenshot failed (CORS?):", err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BOOT: Wire up all enhancements
// ─────────────────────────────────────────────────────────────────────────────
initIdleAutoRotate();
showPinchHint();
initUtcClock();
initScanlineOverlay();

// Apply persisted settings prefs
(function applyBootSettingsPrefs() {
  if (!_settingsPrefs.scanlines) {
    const sl = document.getElementById("scanline-overlay");
    if (sl) sl.style.display = "none";
  }
  if (!_settingsPrefs.consoleFrame) {
    const cf = document.getElementById("console-frame");
    if (cf) cf.style.display = "none";
  }
  if (!_settingsPrefs.compass) {
    const cr = document.getElementById("compass-rose");
    if (cr) cr.style.display = "none";
  }
  if (!_settingsPrefs.reticle) {
    const re = document.getElementById("center-reticle");
    if (re) re.style.display = "none";
  }
  if (!_settingsPrefs.footer) {
    const ft = document.getElementById("hud-bottom");
    if (ft) ft.style.display = "none";
  }
  if (!_settingsPrefs.summaryPanel) {
    const sp = document.getElementById("floating-summary");
    if (sp) sp.style.display = "none";
  }
  if (!_settingsPrefs.classificationBar) {
    const bar = document.getElementById("classification-bar");
    if (bar) bar.style.display = "none";
  }
  if (!_settingsPrefs.fpsCounter) {
    const fps = document.getElementById("fps-display");
    if (fps) fps.style.display = "none";
  }
  if (!_settingsPrefs.uptimeCounter) {
    const uptime = document.getElementById("session-uptime-wrap");
    if (uptime) uptime.style.display = "none";
  }
})();

initCameraPositionHud();
initArrowKeyNudge();
initEventSparkline();
initFpsCounter();
initUptimeCounter();
initCompassRose();
initAmbientParticles();
setInterval(animateThroughputBars, 2000);

// Data age chip
setInterval(() => {
  const el = document.getElementById("hud-data-age");
  const sigEl = document.getElementById("hud-signal-strength");
  if (!el || !state._lastRefreshTime) return;
  const ago = Math.floor((Date.now() - state._lastRefreshTime) / 1000);
  if (ago < 60) el.textContent = `⏱ ${ago}s`;
  else el.textContent = `⏱ ${Math.floor(ago / 60)}m`;
  el.classList.toggle("stale", ago > 120);
  // Signal strength based on data freshness
  if (sigEl) {
    sigEl.classList.remove("sig-excellent", "sig-good", "sig-fair", "sig-poor");
    if (ago < 30) sigEl.classList.add("sig-excellent");
    else if (ago < 90) sigEl.classList.add("sig-good");
    else if (ago < 180) sigEl.classList.add("sig-fair");
    else sigEl.classList.add("sig-poor");
  }
}, 1000);
setInterval(updateRegionHalos, 15000);

// ─────────────────────────────────────────────────────────────────────────────
// EVENT SPARKLINE — tiny chart showing event frequency over last 5 minutes
// ─────────────────────────────────────────────────────────────────────────────
function initEventSparkline() {
  const canvas = document.getElementById("sparkline-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  // 30 buckets × 10s each = 5 minutes
  const buckets = new Array(30).fill(0);
  let bucketIdx = 0;

  // Track event spawns via the sessionStats counter
  let lastCount = state.sessionStats.eventsSpawned;

  setInterval(() => {
    const cur = state.sessionStats.eventsSpawned;
    buckets[bucketIdx % 30] = cur - lastCount;
    lastCount = cur;
    bucketIdx++;
    drawSparkline(ctx, canvas, buckets, bucketIdx);
  }, 10000);
}

function drawSparkline(ctx, canvas, buckets, idx) {
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const len = buckets.length;
  const max = Math.max(1, ...buckets);
  const barW = w / len;

  for (let i = 0; i < len; i++) {
    // Read from oldest to newest
    const bi = (idx + i) % len;
    const val = buckets[bi];
    const barH = (val / max) * (h - 2);
    const alpha = 0.3 + 0.7 * (i / len);
    ctx.fillStyle = val > 0
      ? `rgba(255, 77, 109, ${alpha})`
      : `rgba(126, 224, 255, ${alpha * 0.3})`;
    ctx.fillRect(i * barW, h - barH, barW - 1, barH);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FPS COUNTER — performance monitor in the HUD
// ─────────────────────────────────────────────────────────────────────────────
function initFpsCounter() {
  const fpsEl = document.getElementById("hud-fps");
  if (!fpsEl) return;
  let frames = 0;
  let lastTime = performance.now();

  function tick() {
    frames++;
    const now = performance.now();
    if (now - lastTime >= 1000) {
      const fps = Math.round(frames * 1000 / (now - lastTime));
      fpsEl.textContent = `${fps} fps`;
      fpsEl.classList.toggle("fps-low", fps < 30);
      frames = 0;
      lastTime = now;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// ─────────────────────────────────────────────────────────────────────────────
// SESSION UPTIME — live display of how long the dashboard has been running
// ─────────────────────────────────────────────────────────────────────────────
function initUptimeCounter() {
  const el = document.getElementById("session-uptime");
  if (!el) return;
  setInterval(() => {
    const elapsed = Date.now() - state.sessionStats.sessionStart;
    const secs = Math.floor(elapsed / 1000);
    const mins = Math.floor(secs / 60);
    const hrs  = Math.floor(mins / 60);
    if (hrs > 0) {
      el.textContent = `↑ ${hrs}h ${mins % 60}m`;
    } else if (mins > 0) {
      el.textContent = `↑ ${mins}m ${secs % 60}s`;
    } else {
      el.textContent = `↑ ${secs}s`;
    }
  }, 1000);
}

// ─────────────────────────────────────────────────────────────────────────────
// GLOBE GRID OVERLAY — toggleable lat/lon graticule
// ─────────────────────────────────────────────────────────────────────────────
let _gridLayer = null;
// ─────────────────────────────────────────────────────────────────────────────
// DISTANCE MEASUREMENT — Shift+click two points to measure great-circle distance
// ─────────────────────────────────────────────────────────────────────────────
let _measurePoint = null;
function handleMeasureClick(cartesian) {
  if (!cartesian) return;
  const cg = Cesium.Cartographic.fromCartesian(cartesian);
  const lat = Cesium.Math.toDegrees(cg.latitude);
  const lng = Cesium.Math.toDegrees(cg.longitude);

  if (!_measurePoint) {
    _measurePoint = { lat, lng, carto: cg };
    showToast(`📍 Point A: ${lat.toFixed(2)}°, ${lng.toFixed(2)}° — Shift+click another point`, "info");
  } else {
    const R = 6371; // km
    const dLat = cg.latitude - _measurePoint.carto.latitude;
    const dLng = cg.longitude - _measurePoint.carto.longitude;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(_measurePoint.carto.latitude) * Math.cos(cg.latitude) * Math.sin(dLng / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const dist = R * c;
    const distStr = dist > 1000 ? `${(dist / 1000).toFixed(1)}K km` : `${dist.toFixed(0)} km`;
    showToast(`📏 Distance: ${distStr} (${(dist * 0.539957).toFixed(0)} nmi)`, "info");
    _measurePoint = null;
  }
}

function toggleGlobeGrid() {
  if (_gridLayer) {
    viewer.imageryLayers.remove(_gridLayer);
    _gridLayer = null;
    showToast("Grid overlay OFF", "info");
  } else {
    _gridLayer = viewer.imageryLayers.addImageryProvider(
      new Cesium.GridImageryProvider()
    );
    _gridLayer.alpha = 0.15;
    showToast("Grid overlay ON", "info");
  }
}

function syncAudioIcon() {
  const audioBtn = document.getElementById("btn-audio-toggle");
  if (!audioBtn) return;
  const on = isAudioEnabled();
  audioBtn.textContent = on ? "🔊" : "🔇";
  audioBtn.classList.toggle("muted", !on);
}

function toggleAudioMute() {
  const enabled = isAudioEnabled();
  setAudioEnabled(!enabled);
  syncAudioIcon();
  showToast(enabled ? "Audio muted 🔇" : "Audio enabled 🔊", "info");
}

// ─────────────────────────────────────────────────────────────────────────────
// ENTITY PROXIMITY DETECTION — alert when two live events are within ~500 km
// ─────────────────────────────────────────────────────────────────────────────
const _proximityAlerted = new Set();

function _haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function checkEntityProximity() {
  const now = Cesium.JulianDate.now();
  const live = dynamic.eventVisuals.filter(v => v.lat != null && v.lng != null);
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i], b = live[j];
      const key = `${i}|${j}`;
      if (_proximityAlerted.has(key)) continue;
      const dist = _haversineKm(a.lat, a.lng, b.lat, b.lng);
      if (dist < 500) {
        _proximityAlerted.add(key);
        setTimeout(() => _proximityAlerted.delete(key), 60000);
        showToast(`⚠ Proximity alert: ${dist.toFixed(0)} km between events`, "warning");
        // Spawn a brief yellow ring at midpoint
        try {
          const midLat = (a.lat + b.lat) / 2, midLng = (a.lng + b.lng) / 2;
          const now = Cesium.JulianDate.now();
          const pRing = viewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(midLng, midLat, 0),
            ellipse: {
              semiMajorAxis: new Cesium.CallbackProperty(t => {
                const age = Cesium.JulianDate.secondsDifference(t, now);
                return Math.max(10000, 400000 * (1 - age / 4));
              }, false),
              semiMinorAxis: new Cesium.CallbackProperty(t => {
                const age = Cesium.JulianDate.secondsDifference(t, now);
                return Math.max(10000, 400000 * (1 - age / 4));
              }, false),
              height: 0,
              material: Cesium.Color.YELLOW.withAlpha(0.0),
              outline: true,
              outlineColor: Cesium.Color.YELLOW.withAlpha(0.7),
              outlineWidth: 2
            }
          });
          setTimeout(() => { try { viewer.entities.remove(pRing); } catch(e){} }, 4000);
        } catch(e) {}
      }
    }
  }
}
// setInterval(checkEntityProximity, 15000); // disabled — proximity alerts removed

// ─────────────────────────────────────────────────────────────────────────────
// RADAR BLIP — spawn a blip on the mini radar when events arrive
// ─────────────────────────────────────────────────────────────────────────────
function spawnRadarBlip() {
  const radar = document.querySelector(".radar-mini");
  if (!radar) return;
  const blip = document.createElement("div");
  blip.className = "radar-blip";
  const angle = Math.random() * Math.PI * 2;
  const dist = 4 + Math.random() * 8;
  blip.style.left = `${14 + Math.cos(angle) * dist - 2}px`;
  blip.style.top  = `${14 + Math.sin(angle) * dist - 2}px`;
  radar.appendChild(blip);
  setTimeout(() => blip.remove(), 2000);
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPASS ROSE — rotating compass that reflects camera heading
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// AMBIENT PARTICLES — floating motes for atmospheric depth
// ─────────────────────────────────────────────────────────────────────────────
function initAmbientParticles() {
  const canvas = document.getElementById("ambient-particles");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const PARTICLE_COUNT = 35;
  const particles = [];

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener("resize", resize);

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    particles.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: Math.random() * 1.2 + 0.3,
      dx: (Math.random() - 0.5) * 0.15,
      dy: (Math.random() - 0.5) * 0.1 - 0.05,
      alpha: Math.random() * 0.4 + 0.1,
    });
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of particles) {
      p.x += p.dx;
      p.y += p.dy;
      if (p.x < 0) p.x = canvas.width;
      if (p.x > canvas.width) p.x = 0;
      if (p.y < 0) p.y = canvas.height;
      if (p.y > canvas.height) p.y = 0;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(126, 224, 255, ${p.alpha})`;
      ctx.fill();
    }
    requestAnimationFrame(draw);
  }
  draw();
}

function initCompassRose() {
  const rose = document.getElementById("compass-rose");
  if (!rose) return;
  const svg = rose.querySelector("svg");
  if (!svg) return;

  function updateHeading() {
    const heading = Cesium.Math.toDegrees(viewer.camera.heading);
    svg.style.transform = `rotate(${-heading}deg)`;
  }
  viewer.camera.changed.addEventListener(updateHeading);
  updateHeading();

  // Click to reset north
  rose.addEventListener("click", () => {
    pausePassiveSpin(5000);
    viewer.camera.flyTo({
      destination: viewer.camera.positionWC,
      orientation: {
        heading: 0,
        pitch: viewer.camera.pitch,
        roll: 0
      },
      duration: 0.8
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SUPPORT WIDGET — live entity counter + periodic attention pulse + welcome toast
// ─────────────────────────────────────────────────────────────────────────────
function initSupportWidget() {
  const btn = document.getElementById("support-btn");
  const scEntities = document.getElementById("sc-entities");

  // Keep entity count fresh in the hover card
  function updateSupportEntityCount() {
    if (!scEntities) return;
    const count = viewer ? viewer.entities.values.length : 0;
    scEntities.textContent = count > 0 ? count.toLocaleString() : "—";
  }
  updateSupportEntityCount();
  setInterval(updateSupportEntityCount, 5000);

  // Periodic attention pulse — 90 s after load, then every 2.5 min
  if (btn) {
    setTimeout(() => {
      btn.classList.add("support-attention");
      btn.addEventListener("animationend", () => btn.classList.remove("support-attention"), { once: true });
      setInterval(() => {
        btn.classList.add("support-attention");
        btn.addEventListener("animationend", () => btn.classList.remove("support-attention"), { once: true });
      }, 150000); // every 2.5 min
    }, 90000); // first pulse after 1.5 min
  }

  // One-time welcome toast after 3 min — only if not suppressed
  const SUPPORT_TOAST_KEY = "panopticon-earth-support-toast-v1";
  if (!sessionStorage.getItem(SUPPORT_TOAST_KEY)) {
    sessionStorage.setItem(SUPPORT_TOAST_KEY, "1");
    setTimeout(() => {
      showToast("God's Third Eye is free & open-source — ☕ support keeps it running", "info");
    }, 180000); // 3 min
  }
}
// ─────────────────────────────────────────────────────────────────
// COUNTRY BORDERS + LABELS OVERLAY
// Loads Natural Earth 110m GeoJSON — draws subtle border polylines
// and country name labels that appear when zoomed below ~4,000 km alt.
// ─────────────────────────────────────────────────────────────────
let _countryDataSource  = null;
let _countryLabels      = [];
let _countryOverlayVisible = true;

const COUNTRY_GEOJSON_URL =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson";

// Country name → ISO3 lookup map, built when GeoJSON loads
const _countryIsoMap = {};

async function initCountryOverlay() {
  try {
    _countryDataSource = await Cesium.GeoJsonDataSource.load(COUNTRY_GEOJSON_URL, {
      stroke:      Cesium.Color.fromCssColorString("#7ee0ff").withAlpha(0.28),
      fill:        Cesium.Color.fromCssColorString("#7ee0ff").withAlpha(0.008), // near-invisible but pickable for hover
      strokeWidth: 1.0,
      clampToGround: true
    });
    viewer.dataSources.add(_countryDataSource);

    // Tag polygon entities for hover detection; extract name for fast lookup
    _countryDataSource.entities.values.forEach(entity => {
      if (entity.polygon) {
        entity._isCountryEntity = true;
        entity._countryName = entity.properties?.NAME?.getValue?.()
                           ?? entity.properties?.ADMIN?.getValue?.()
                           ?? "";
        entity._countryIso2 = entity.properties?.ISO_A2?.getValue?.() ?? "";
        entity._countryIso3 = entity.properties?.ADM0_A3?.getValue?.()
                           ?? entity.properties?.ISO_A3?.getValue?.()
                           ?? "";
        // Build lookup map for GDELT queries
        if (entity._countryName && entity._countryIso3) {
          _countryIsoMap[entity._countryName.toLowerCase()] = entity._countryIso3;
        }
      }
    });

    // Country name labels — only visible when zoomed to regional level
    const features = _countryDataSource.entities.values;
    features.forEach(entity => {
      const props = entity.properties;
      if (!props) return;
      const name  = props.NAME?.getValue?.()   ?? props.ADMIN?.getValue?.() ?? "";
      const labelX = props.LABEL_X?.getValue?.();
      const labelY = props.LABEL_Y?.getValue?.();
      if (!name || labelX == null || labelY == null) return;

      // Skip tiny territories with very short names that would clutter
      const pop = props.POP_EST?.getValue?.() ?? 0;
      if (pop > 0 && pop < 200000) return;

      const labelEntity = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(labelX, labelY, 1000),
        label: {
          text:             name.toUpperCase(),
          font:             '10px "Share Tech Mono", monospace',
          fillColor:        Cesium.Color.fromCssColorString("#7ee0ff").withAlpha(0.75),
          outlineColor:     Cesium.Color.fromCssColorString("#030a14").withAlpha(0.85),
          outlineWidth:     3,
          style:            Cesium.LabelStyle.FILL_AND_OUTLINE,
          showBackground:   false,
          horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
          verticalOrigin:   Cesium.VerticalOrigin.CENTER,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          // Only appear when camera is below ~4,200 km
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 4200000),
          // Fade in as you zoom in; fully readable below 1,500 km
          translucencyByDistance: new Cesium.NearFarScalar(800000, 1.0, 4200000, 0.0),
          // Scale down gracefully at distance
          scaleByDistance: new Cesium.NearFarScalar(400000, 1.0, 3500000, 0.55),
          pixelOffset: new Cesium.Cartesian2(0, 0)
        }
      });
      labelEntity._isCountryLabel = true;
      _countryLabels.push(labelEntity);
    });

    // Start invisible — borders on, labels respect distanceDisplayCondition automatically
    setCountryOverlayVisible(_countryOverlayVisible);
  } catch (err) {
    console.warn("[God's Third Eye] Country overlay failed to load:", err);
  }
}

function setCountryOverlayVisible(visible) {
  _countryOverlayVisible = visible;
  if (_countryDataSource) _countryDataSource.show = visible;
  _countryLabels.forEach(e => { e.show = visible; });
}

function toggleCountryOverlay(force) {
  const next = force !== undefined ? !!force : !_countryOverlayVisible;
  setCountryOverlayVisible(next);
}

// ══════════════════════════════════════════════════════════════════════════════
// ISS LIVE TRACKING — real-time orbital position, no API key required
// Source: wheretheiss.at/v1/satellites/25544 · updates every 5s
// ══════════════════════════════════════════════════════════════════════════════

let _issEntity      = null;
let _issTrailPositions = [];
let _issTrailEntity = null;
let _issTimer       = null;
let _issLastData    = null;

async function fetchISSPosition() {
  const resp = await fetch("https://api.wheretheiss.at/v1/satellites/25544",
    { signal: AbortSignal.timeout(6000) });
  if (!resp.ok) throw new Error("ISS fetch failed");
  return resp.json();
}

function initISSTracking() {
  if (!state.layers.iss) return;

  // Create entity with a SampledPositionProperty for smooth interpolation
  const sampledPos = new Cesium.SampledPositionProperty();
  sampledPos.setInterpolationOptions({
    interpolationDegree: 5,
    interpolationAlgorithm: Cesium.LagrangePolynomialApproximation
  });

  _issEntity = viewer.entities.add({
    id: "iss-live",
    position: sampledPos,
    point: {
      pixelSize: 9,
      color: Cesium.Color.fromCssColorString("#60f7bf"),
      outlineColor: Cesium.Color.WHITE.withAlpha(0.8),
      outlineWidth: 1.5,
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    },
    label: {
      text: "ISS",
      font: '11px "Share Tech Mono", monospace',
      fillColor: Cesium.Color.fromCssColorString("#60f7bf"),
      outlineColor: Cesium.Color.BLACK.withAlpha(0.7),
      outlineWidth: 2,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      showBackground: true,
      backgroundColor: Cesium.Color.fromCssColorString("rgba(4,10,18,0.72)"),
      backgroundPadding: new Cesium.Cartesian2(5, 3),
      horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
      pixelOffset: new Cesium.Cartesian2(10, -8),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      scaleByDistance: new Cesium.NearFarScalar(5e5, 1.0, 1.5e7, 0.5),
      translucencyByDistance: new Cesium.NearFarScalar(1e6, 1.0, 2e7, 0.0)
    },
    properties: {
      layerId: "iss",
      entityType: "satellite",
      label: "ISS — International Space Station",
      description: "Live orbital position — real-time tracking"
    }
  });
  _issEntity._pulseSeed = Math.random() * Math.PI * 2;

  const poll = async () => {
    if (!state.layers.iss) return;
    try {
      const d = await fetchISSPosition();
      _issLastData = d;
      const altM = (d.altitude ?? 408) * 1000;
      const pos  = Cesium.Cartesian3.fromDegrees(d.longitude, d.latitude, altM);
      const time = Cesium.JulianDate.fromDate(new Date(d.timestamp * 1000));
      sampledPos.addSample(time, pos);

      // Update label with live telemetry
      if (_issEntity?.label) {
        _issEntity.label.text = new Cesium.ConstantProperty(
          `ISS  ${d.latitude.toFixed(1)}°  ${d.longitude.toFixed(1)}°  ${Math.round(d.altitude)}km`
        );
      }

      // Trail — keep last 30 positions
      _issTrailPositions.push(pos);
      if (_issTrailPositions.length > 30) _issTrailPositions.shift();
      if (_issTrailEntity) viewer.entities.remove(_issTrailEntity);
      if (_issTrailPositions.length > 2) {
        _issTrailEntity = viewer.entities.add({
          polyline: {
            positions: [..._issTrailPositions],
            width: 1.2,
            material: Cesium.Color.fromCssColorString("#60f7bf").withAlpha(0.35),
            arcType: Cesium.ArcType.NONE
          },
          properties: { layerId: "iss", entityType: "trail" }
        });
      }
    } catch { /* silent — will retry */ }
    _issTimer = setTimeout(poll, 5000);
  };

  poll();
}

function destroyISSTracking() {
  if (_issTimer) clearTimeout(_issTimer);
  if (_issEntity)      { viewer.entities.remove(_issEntity);      _issEntity      = null; }
  if (_issTrailEntity) { viewer.entities.remove(_issTrailEntity); _issTrailEntity = null; }
  _issTrailPositions = [];
  _issLastData = null;
}

// ══════════════════════════════════════════════════════════════════════════════
// USGS SEISMIC LAYER — live earthquakes M2.5+ past 24h, no API key required
// Source: earthquake.usgs.gov · refreshes every 5 minutes
// ══════════════════════════════════════════════════════════════════════════════

let _seismicEntities   = [];
let _seismicTimer      = null;

function quakeMagStyle(mag) {
  if (mag >= 6.0) return { color: "#ff4d6d", size: 14, alpha: 0.95 };
  if (mag >= 5.0) return { color: "#ff9f43", size: 11, alpha: 0.9  };
  if (mag >= 4.0) return { color: "#ffbe5c", size: 8,  alpha: 0.85 };
  return            { color: "#ffd97a", size: 5,  alpha: 0.7  };
}

function clearSeismicEntities() {
  _seismicEntities.forEach(e => viewer.entities.remove(e));
  _seismicEntities = [];
}

async function loadSeismicData() {
  if (!state.layers.seismic) return;
  try {
    const resp = await fetch(
      "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson",
      { signal: AbortSignal.timeout(12000) }
    );
    if (!resp.ok) return;
    const geojson = await resp.json();
    clearSeismicEntities();

    (geojson.features ?? []).forEach(f => {
      const [lng, lat, depth] = f.geometry.coordinates;
      const { mag, place, time, url } = f.properties;
      if (mag == null || lat == null || lng == null) return;
      const style   = quakeMagStyle(mag);
      const timeAgo = formatGdeltDate(new Date(time).toISOString().replace(/[-:]/g, "").replace(".000","").replace("T","T").slice(0,15)+"Z");
      const label   = `M${mag.toFixed(1)} ${place?.split(", ").pop() ?? ""}`.trim();

      const entity = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(lng, lat, Math.max(0, -depth * 1000)),
        point: {
          pixelSize: style.size,
          color: Cesium.Color.fromCssColorString(style.color).withAlpha(style.alpha),
          outlineColor: Cesium.Color.WHITE.withAlpha(0.6),
          outlineWidth: 1,
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        },
        label: {
          text: label,
          font: '10px "Share Tech Mono", monospace',
          fillColor: Cesium.Color.fromCssColorString(style.color),
          outlineColor: Cesium.Color.BLACK.withAlpha(0.7),
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString("rgba(4,10,18,0.72)"),
          backgroundPadding: new Cesium.Cartesian2(4, 2),
          horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
          pixelOffset: new Cesium.Cartesian2(8, -6),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          scaleByDistance: new Cesium.NearFarScalar(3e5, 1.0, 6e6, 0.4),
          translucencyByDistance: new Cesium.NearFarScalar(5e5, 1.0, 8e6, 0.0)
        },
        properties: {
          layerId: "seismic",
          entityType: "seismic",
          label: `M${mag.toFixed(1)} — ${place}`,
          description: `Magnitude ${mag.toFixed(1)} · Depth ${Math.round(depth)}km · ${timeAgo}`,
          articleUrl: url ?? "",
          altitude: 0,
          synthetic: false
        }
      });
      entity._pulseSeed = Math.random() * Math.PI * 2;
      entity._basePixelSize = style.size;
      _seismicEntities.push(entity);
    });

    showToast(`Seismic layer: ${_seismicEntities.length} earthquakes loaded`, "info", 2500);
  } catch { /* silent */ }

  // Auto-refresh every 5 minutes
  if (_seismicTimer) clearTimeout(_seismicTimer);
  _seismicTimer = setTimeout(loadSeismicData, 5 * 60 * 1000);
}

function initLiveDataLayers() {
  // ISS
  if (state.layers.iss) initISSTracking();
  // Seismic
  if (state.layers.seismic) loadSeismicData();
}

// Hook layer toggles into ISS + seismic
const _origRefreshEntityVisibility = refreshEntityVisibility;

// ══════════════════════════════════════════════════════════════════════════════
// INTELLIGENCE BROADCAST — live YouTube channel overlay
// Uses YouTube's live_stream embed (no API key required).
// Triggered by high-relevance GDELT events or manually via /broadcast.
// ══════════════════════════════════════════════════════════════════════════════

const BROADCAST_CHANNELS = [
  { name: "Al Jazeera",  id: "UCNye-wNBqNL5ZzHSJdse7ug", topics: ["war","geopolitics","middle-east","maritime"] },
  { name: "Reuters",     id: "UCjA7GKp_yxbtw896DCpLHmQ", topics: ["war","geopolitics","intelligence","energy"] },
  { name: "BBC News",    id: "UC16niRr0-WeEETOKnajj7zQ", topics: ["geopolitics","intelligence","war"] },
  { name: "France 24",   id: "UCQfwfsi5VrQ8yKZ-UWmAEFg", topics: ["war","geopolitics","energy"] },
  { name: "DW News",     id: "UCknLrEdhRCp1aegoMqRaCZg", topics: ["geopolitics","energy","maritime"] },
  { name: "Sky News",    id: "UCoMdktPbSTixAyNGwb-UYkQ", topics: ["war","intelligence","geopolitics"] },
  { name: "UNTV",        id: "UCj7K0pFCFM3ckHGAPMnVAoA", topics: ["geopolitics","humanitarian","maritime"] },
  { name: "i24 News",    id: "UCBiHvDzZIf3O7ZW4OONK3kA", topics: ["war","middle-east","intelligence"] },
];

let _broadcastActive     = false;
let _broadcastChanIndex  = 0;
let _broadcastMuted      = true;
let _broadcastTimer      = null;
let _broadcastMinInterval = 10 * 60 * 1000; // 10 min default
let _broadcastEnabled    = true;
let _lastBroadcastAt     = 0;

function pickBroadcastChannel(article) {
  // Match article category to best-fit channel
  const cat = article?.category ?? "";
  const scored = BROADCAST_CHANNELS.map((ch, i) => ({
    i,
    score: ch.topics.includes(cat) ? 2 : (ch.topics.some(t => (article?.title ?? "").toLowerCase().includes(t)) ? 1 : 0)
  })).sort((a, b) => b.score - a.score);
  return scored[0].i;
}

function buildBroadcastIframeSrc(chanIndex, muted) {
  const ch = BROADCAST_CHANNELS[chanIndex];
  if (!ch) return "";
  const muteParam = muted ? "1" : "0";
  return `https://www.youtube.com/embed/live_stream?channel=${ch.id}&autoplay=1&mute=${muteParam}&controls=1&rel=0&modestbranding=1`;
}

function renderBroadcastChannelPills(activeIndex) {
  const container = document.getElementById("bc-chan-pills");
  if (!container) return;
  container.innerHTML = BROADCAST_CHANNELS.map((ch, i) => `
    <button class="bc-chan-pill ${i === activeIndex ? "active" : ""}" data-bc-chan="${i}" type="button">${ch.name}</button>
  `).join("");
  container.querySelectorAll("[data-bc-chan]").forEach(btn => {
    btn.addEventListener("click", () => switchBroadcastChannel(parseInt(btn.dataset.bcChan, 10)));
  });
}

function switchBroadcastChannel(index) {
  _broadcastChanIndex = ((index % BROADCAST_CHANNELS.length) + BROADCAST_CHANNELS.length) % BROADCAST_CHANNELS.length;
  const ch = BROADCAST_CHANNELS[_broadcastChanIndex];
  const iframe = document.getElementById("bc-iframe");
  const label  = document.getElementById("bc-channel-label");
  if (iframe) iframe.src = buildBroadcastIframeSrc(_broadcastChanIndex, _broadcastMuted);
  if (label)  label.textContent = ch.name.toUpperCase();
  renderBroadcastChannelPills(_broadcastChanIndex);
}

function showBroadcast(article) {
  if (!_broadcastEnabled) return;
  const now = Date.now();
  if (now - _lastBroadcastAt < _broadcastMinInterval) return;
  _lastBroadcastAt = now;
  _broadcastActive = true;

  const el = document.getElementById("broadcast-overlay");
  if (!el) return;

  // Pick best channel
  _broadcastChanIndex = pickBroadcastChannel(article);
  const ch = BROADCAST_CHANNELS[_broadcastChanIndex];

  // Set content
  const headlineEl = document.getElementById("bc-headline");
  const metaEl     = document.getElementById("bc-meta");
  const labelEl    = document.getElementById("bc-channel-label");
  const utcEl      = document.getElementById("bc-utc");
  const iframe     = document.getElementById("bc-iframe");

  if (headlineEl) headlineEl.textContent = article?.title ?? "Live global intelligence feed active";
  if (metaEl)     metaEl.textContent     = article?.domain ? `${article.domain} · ${article.time ?? "Now"}` : "";
  if (labelEl)    labelEl.textContent    = ch.name.toUpperCase();
  if (utcEl)      utcEl.textContent      = new Date().toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit",timeZone:"UTC"})+" UTC";
  if (iframe)     iframe.src             = buildBroadcastIframeSrc(_broadcastChanIndex, _broadcastMuted);

  renderBroadcastChannelPills(_broadcastChanIndex);

  // Animate in
  el.classList.remove("hidden");
  void el.offsetWidth;
  el.classList.add("visible");

  sfx.ping?.();
  showToast(`◉ Intelligence broadcast — ${ch.name}`, "info", 3000);
}

function dismissBroadcast() {
  const el = document.getElementById("broadcast-overlay");
  if (!el) return;
  el.classList.remove("visible");
  _broadcastActive = false;
  setTimeout(() => {
    el.classList.add("hidden");
    const iframe = document.getElementById("bc-iframe");
    if (iframe) iframe.src = ""; // stop video
  }, 450);
}

function maybeShowBroadcast() {
  if (!_broadcastEnabled || _broadcastActive) return;
  if (Date.now() - _lastBroadcastAt < _broadcastMinInterval) return;
  // Pick a random recent article from the ticker pool
  const pool = state.newsTickerPool ?? [];
  if (!pool.length) return;
  // Prefer high-scoring conflict articles
  const candidates = pool.filter(a => scoreArticleRelevance(a.title ?? "", "") > 20);
  const article = (candidates.length ? candidates : pool)[Math.floor(Math.random() * (candidates.length || pool.length))];
  showBroadcast(article);
}

function initBroadcastSystem() {
  // Close button
  document.getElementById("bc-close")?.addEventListener("click", dismissBroadcast);

  // Channel navigation
  document.getElementById("bc-prev-chan")?.addEventListener("click", () =>
    switchBroadcastChannel(_broadcastChanIndex - 1)
  );
  document.getElementById("bc-next-chan")?.addEventListener("click", () =>
    switchBroadcastChannel(_broadcastChanIndex + 1)
  );

  // Mute toggle
  document.getElementById("bc-mute-btn")?.addEventListener("click", () => {
    _broadcastMuted = !_broadcastMuted;
    const btn = document.getElementById("bc-mute-btn");
    if (btn) btn.textContent = _broadcastMuted ? "🔇" : "🔊";
    switchBroadcastChannel(_broadcastChanIndex); // reload iframe with new mute state
  });

  // Auto-trigger timer (every ~10-15 min of active session)
  const scheduleNextBroadcast = () => {
    if (_broadcastTimer) clearTimeout(_broadcastTimer);
    const jitter = Math.floor(Math.random() * 5 * 60 * 1000); // ±5 min jitter
    _broadcastTimer = setTimeout(() => {
      maybeShowBroadcast();
      scheduleNextBroadcast();
    }, _broadcastMinInterval + jitter);
  };
  setTimeout(scheduleNextBroadcast, _broadcastMinInterval);

  // Esc to dismiss
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && _broadcastActive) dismissBroadcast();
    if ((e.key === "b" || e.key === "B") && !e.ctrlKey && !e.altKey && !e.metaKey) {
      const active = document.activeElement;
      const isInput = active?.tagName === "INPUT" || active?.tagName === "TEXTAREA" || active?.isContentEditable;
      if (!isInput) {
        e.preventDefault();
        _broadcastActive ? dismissBroadcast() : maybeShowBroadcast();
      }
    }
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// SITUATION BRIEFING — cinematic post-boot panel, every session
// Shows live entity counts + top GDELT story + smart first-load camera
// ══════════════════════════════════════════════════════════════════════════════

const SIT_BRIEF_DURATION = 14000; // 14s auto-dismiss

async function fetchTopGdeltStory() {
  try {
    const resp = await fetch(
      "https://api.gdeltproject.org/api/v2/doc/doc?query=(conflict OR military OR attack OR crisis OR war)&mode=artlist&maxrecords=5&timespan=6h&sort=DateDesc&format=json",
      { signal: AbortSignal.timeout(8000) }
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    const arts = data?.articles?.filter(a => a.title?.length > 25 && a.url);
    if (!arts?.length) return null;
    const art = arts[0];
    let domain = art.domain ?? "";
    try { if (!domain) domain = new URL(art.url).hostname.replace(/^www\./, ""); } catch {}
    return { title: art.title, domain, url: art.url, time: formatGdeltDate(art.seendate) };
  } catch { return null; }
}

function dismissSituationBriefing() {
  const el = document.getElementById("situation-briefing");
  if (!el) return;
  el.classList.remove("visible");
  setTimeout(() => el.classList.add("hidden"), 600);
}

async function initSituationBriefing() {
  const el = document.getElementById("situation-briefing");
  if (!el) return;

  // Populate stats
  const aircraft  = dynamic.traffic.filter(e => {
    const lid = e.properties?.layerId?.getValue?.(viewer.clock.currentTime);
    return lid === "commercial" || lid === "military";
  }).length + dynamic.liveTraffic.length;
  const maritime  = dynamic.traffic.filter(e => e.properties?.layerId?.getValue?.(viewer.clock.currentTime) === "maritime").length;
  const satellites = dynamic.traffic.filter(e => e.properties?.layerId?.getValue?.(viewer.clock.currentTime) === "satellites").length;
  const incidents = dynamic.incidents.length;

  const statsEl = document.getElementById("sit-stats");
  if (statsEl) {
    statsEl.innerHTML = [
      { val: aircraft  || "—", label: "AIRCRAFT" },
      { val: maritime  || "—", label: "VESSELS" },
      { val: satellites || "—", label: "SATELLITES" },
      { val: incidents  || "—", label: "INCIDENTS" },
    ].map(s => `
      <div class="sit-stat-item">
        <span class="sit-stat-val">${s.val}</span>
        <span class="sit-stat-label">${s.label}</span>
      </div>`).join("");
  }

  // UTC clock
  const utcEl = document.getElementById("sit-utc");
  if (utcEl) utcEl.textContent = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";

  // Show panel
  el.classList.remove("hidden");
  void el.offsetWidth;
  setTimeout(() => el.classList.add("visible"), 50);

  // Animate countdown bar
  const fill = document.getElementById("sit-timer-fill");
  if (fill) {
    fill.style.transition = "none";
    fill.style.width = "100%";
    void fill.offsetWidth;
    fill.style.transition = `width ${SIT_BRIEF_DURATION}ms linear`;
    fill.style.width = "0%";
  }

  // Auto-dismiss
  const autoTimer = setTimeout(dismissSituationBriefing, SIT_BRIEF_DURATION);

  // Fetch top story async
  fetchTopGdeltStory().then(story => {
    const headlineEl = document.getElementById("sit-headline");
    const metaEl     = document.getElementById("sit-meta");
    if (headlineEl && story) {
      headlineEl.textContent = story.title;
      if (metaEl) metaEl.textContent = `${story.domain} · ${story.time}`;
    } else if (headlineEl) {
      headlineEl.textContent = "Global feeds active — all data layers online.";
    }
  });

  // First-visit: fly to most active region based on current incidents
  const isFirstVisit = !localStorage.getItem("ge-visited-v2");
  if (isFirstVisit) {
    localStorage.setItem("ge-visited-v2", "1");
    const hotspot = SCENARIO.incidents[Math.floor(Math.random() * SCENARIO.incidents.length)];
    if (hotspot) {
      setTimeout(() => {
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(
            hotspot.location.lng, hotspot.location.lat, 5500000
          ),
          orientation: { heading: 0.2, pitch: -1.1, roll: 0 },
          duration: 3.5,
          easingFunction: Cesium.EasingFunction.QUADRATIC_IN_OUT
        });
      }, 1500);
    }
  }

  // Buttons
  document.getElementById("sit-continue")?.addEventListener("click", () => {
    clearTimeout(autoTimer);
    dismissSituationBriefing();
  });
  document.getElementById("sit-skip")?.addEventListener("click", () => {
    clearTimeout(autoTimer);
    dismissSituationBriefing();
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// OPERATOR SYSTEM — callsign, session streak, shareable URL
// ══════════════════════════════════════════════════════════════════════════════

const OP_CALLSIGN_KEY = "ge-operator-callsign";
const OP_STREAK_KEY   = "ge-visit-streak";
const OP_LAST_KEY     = "ge-last-visit-date";

function getOperatorCallsign() { return localStorage.getItem(OP_CALLSIGN_KEY) || ""; }

function setOperatorCallsign(cs) {
  localStorage.setItem(OP_CALLSIGN_KEY, cs);
  updateClassificationBar(cs);
  updateCallsignChip(cs);
}

function updateClassificationBar(callsign) {
  const bar = document.getElementById("classification-bar");
  if (!bar) return;
  const base = "UNCLASSIFIED // OPEN SOURCE INTELLIGENCE // PANOPTICON-EARTH v2.0";
  bar.textContent = callsign
    ? `${base} // OPERATOR: ${callsign.toUpperCase()} // ALL FEEDS ACTIVE`
    : `${base} // ALL FEEDS ACTIVE`;
}

function updateCallsignChip(callsign) {
  const chip = document.getElementById("callsign-chip");
  if (!chip) return;
  if (callsign) {
    chip.textContent = `◈ ${callsign.toUpperCase()}`;
    chip.style.display = "";
    chip.onclick = () => openOperatorModal();
  } else {
    chip.style.display = "none";
  }
}

// ── Session streak ────────────────────────────────────────────────────────────
function updateSessionStreak() {
  const today     = new Date().toISOString().slice(0, 10);
  const lastVisit = localStorage.getItem(OP_LAST_KEY);
  let streak      = parseInt(localStorage.getItem(OP_STREAK_KEY) || "0", 10);

  if (lastVisit === today) {
    // Already visited today — streak unchanged
  } else if (lastVisit) {
    const diff = Math.round((new Date(today) - new Date(lastVisit)) / 86400000);
    streak = diff <= 1 ? streak + 1 : 1;
  } else {
    streak = 1;
  }

  localStorage.setItem(OP_LAST_KEY, today);
  localStorage.setItem(OP_STREAK_KEY, String(streak));

  // Show streak chip in HUD
  const chip = document.getElementById("streak-chip");
  if (chip && streak >= 2) {
    chip.textContent = `🔥 ${streak}d`;
    chip.title = `${streak}-day visit streak`;
    chip.style.display = "";
  }

  return streak;
}

// ── Shareable URL ─────────────────────────────────────────────────────────────
function encodeViewAsURL() {
  try {
    const cam = viewer.camera;
    const pos = cam.positionCartographic;
    const lat = Cesium.Math.toDegrees(pos.latitude).toFixed(4);
    const lng = Cesium.Math.toDegrees(pos.longitude).toFixed(4);
    const alt = Math.round(pos.height);
    const h   = Cesium.Math.toDegrees(cam.heading).toFixed(2);
    const p   = Cesium.Math.toDegrees(cam.pitch).toFixed(2);
    const hash = `#view=${lat},${lng},${alt},${h},${p}`;
    return window.location.href.split("#")[0] + hash;
  } catch { return window.location.href; }
}

function decodeViewFromURL() {
  try {
    const hash = window.location.hash;
    const match = hash.match(/#view=([\-\d.]+),([\-\d.]+),(\d+),([\-\d.]+),([\-\d.]+)/);
    if (!match) return null;
    return {
      lat: parseFloat(match[1]), lng: parseFloat(match[2]),
      alt: parseInt(match[3]),
      heading: Cesium.Math.toRadians(parseFloat(match[4])),
      pitch:   Cesium.Math.toRadians(parseFloat(match[5]))
    };
  } catch { return null; }
}

function applySharedView() {
  const view = decodeViewFromURL();
  if (!view) return;
  setTimeout(() => {
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(view.lng, view.lat, view.alt),
      orientation: { heading: view.heading, pitch: view.pitch, roll: 0 },
      duration: 2.0
    });
    showToast("Shared view loaded — welcome to God's Third Eye", "info", 4000);
  }, 3500); // wait for boot to finish
}

function copyShareLink() {
  const url = encodeViewAsURL();
  navigator.clipboard.writeText(url)
    .then(() => showToast("Share link copied to clipboard ⎘", "ok", 3000))
    .catch(() => {
      // Fallback for browsers without clipboard API
      const ta = document.createElement("textarea");
      ta.value = url; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      showToast("Share link copied ⎘", "ok", 3000);
    });
}

// ── Tab title alert on high-severity events ───────────────────────────────────
let _originalTitle = document.title;
let _titleAlertTimer = null;

function flashTabTitle(msg) {
  if (_titleAlertTimer) return; // already flashing
  let on = true;
  _titleAlertTimer = setInterval(() => {
    document.title = on ? `⚡ ${msg}` : _originalTitle;
    on = !on;
  }, 1200);
  // Stop after 30s
  setTimeout(() => {
    clearInterval(_titleAlertTimer);
    _titleAlertTimer = null;
    document.title = _originalTitle;
  }, 30000);
}

// ── Operator modal ────────────────────────────────────────────────────────────
function openOperatorModal() {
  const modal = document.getElementById("operator-modal");
  if (!modal) return;
  modal.classList.remove("hidden");

  // Pre-fill callsign if set
  const existing = getOperatorCallsign();
  const input    = document.getElementById("op-callsign-input");
  if (input && existing) input.value = existing;

  // Update entity count
  const entEl = document.getElementById("op-entities-count");
  if (entEl) entEl.textContent = viewer?.entities?.values?.length ?? "—";

  // Show streak
  const streak   = parseInt(localStorage.getItem(OP_STREAK_KEY) || "0", 10);
  const streakWrap = document.getElementById("op-streak-wrap");
  const streakLabel = document.getElementById("op-streak-label");
  if (streakWrap && streak >= 2) {
    streakWrap.style.display = "flex";
    if (streakLabel) streakLabel.textContent = `${streak}-day visit streak`;
  }

  // Live preview update
  if (input) {
    const updatePreview = () => {
      const bar = document.getElementById("op-preview-bar");
      const val = input.value.trim().toUpperCase() || "—";
      if (bar) bar.textContent = `UNCLASSIFIED // PANOPTICON-EARTH // OPERATOR: ${val}`;
    };
    input.addEventListener("input", updatePreview);
    updatePreview();
  }
}

function closeOperatorModal() {
  const modal = document.getElementById("operator-modal");
  if (modal) modal.classList.add("hidden");
}

function initOperatorSystem() {
  // Restore callsign on load
  const cs = getOperatorCallsign();
  updateClassificationBar(cs);
  updateCallsignChip(cs);
  updateSessionStreak();
  _originalTitle = document.title; // capture after boot title is set

  // Apply shared view from URL if present
  applySharedView();

  // Support button → open modal
  const supportBtn = document.getElementById("support-btn");
  if (supportBtn) supportBtn.addEventListener("click", openOperatorModal);

  // Callsign chip → open modal
  const csChip = document.getElementById("callsign-chip");
  if (csChip) csChip.addEventListener("click", openOperatorModal);

  // Modal close
  document.getElementById("op-modal-close")?.addEventListener("click", closeOperatorModal);
  document.getElementById("op-modal-backdrop")?.addEventListener("click", closeOperatorModal);

  // Save callsign
  document.getElementById("op-callsign-save")?.addEventListener("click", () => {
    const input = document.getElementById("op-callsign-input");
    const errorEl = document.getElementById("op-callsign-error");
    if (!input) return;
    const raw = input.value.trim().toUpperCase().replace(/[^A-Z0-9_\-]/g, "");
    if (raw.length < 3) {
      if (errorEl) errorEl.textContent = "Callsign must be at least 3 characters";
      return;
    }
    if (errorEl) errorEl.textContent = "";
    setOperatorCallsign(raw);
    showToast(`Callsign set: ${raw} — welcome to the network, operator`, "ok", 4000);
    closeOperatorModal();
  });

  // Coffee link tracking
  document.getElementById("op-coffee-link")?.addEventListener("click", () => {
    showToast("Thanks for supporting the mission ◈", "ok", 4000);
  });

  // Share view buttons (modal + HUD)
  document.getElementById("op-share-view-btn")?.addEventListener("click", copyShareLink);
  document.getElementById("btn-share")?.addEventListener("click", copyShareLink);

  // Esc closes modal
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") closeOperatorModal();
  });
}

initSupportWidget();

// ── Advanced settings: operator callsign ─────────────────────────────────
const setCallsignInput   = document.getElementById("set-callsign");
const setCallsignPreview = document.getElementById("set-callsign-preview");
if (setCallsignInput) {
  setCallsignInput.value = getOperatorCallsign();
  setCallsignInput.addEventListener("input", () => {
    const val = setCallsignInput.value.trim().toUpperCase().replace(/[^A-Z0-9_\-]/g,"");
    if (setCallsignPreview) setCallsignPreview.textContent = val ? `PANOPTICON-EARTH // OPERATOR: ${val}` : "";
  });
}
document.getElementById("set-callsign-save")?.addEventListener("click", () => {
  const raw = (setCallsignInput?.value ?? "").trim().toUpperCase().replace(/[^A-Z0-9_\-]/g,"");
  if (raw.length >= 3) { setOperatorCallsign(raw); showToast(`Callsign: ${raw}`, "ok", 2500); }
  else showToast("Callsign must be 3+ characters", "warning", 2500);
});
document.getElementById("set-callsign-clear")?.addEventListener("click", () => {
  setOperatorCallsign("");
  if (setCallsignInput)   setCallsignInput.value = "";
  if (setCallsignPreview) setCallsignPreview.textContent = "";
  showToast("Callsign cleared", "info", 2000);
});
document.getElementById("set-open-operator")?.addEventListener("click", () => { closeSettings(); openOperatorModal(); });
document.getElementById("set-copy-share")?.addEventListener("click", copyShareLink);

// ── Advanced settings: broadcast ─────────────────────────────────────────
document.getElementById("set-broadcast-enabled")?.addEventListener("change", e => { _broadcastEnabled = e.target.checked; });
document.getElementById("set-broadcast-mute")?.addEventListener("change",   e => { _broadcastMuted   = e.target.checked; });
const bcIntervalRange = document.getElementById("set-broadcast-interval");
const bcIntervalVal   = document.getElementById("set-broadcast-interval-val");
bcIntervalRange?.addEventListener("input", () => {
  const mins = parseInt(bcIntervalRange.value, 10);
  _broadcastMinInterval = mins * 60 * 1000;
  if (bcIntervalVal) bcIntervalVal.textContent = `${mins}m`;
});
document.getElementById("set-trigger-broadcast")?.addEventListener("click", () => {
  const art = (state.newsTickerPool ?? [])[Math.floor(Math.random() * (state.newsTickerPool?.length || 1))];
  _lastBroadcastAt = 0;
  showBroadcast(art ?? null);
  closeSettings();
});

// ── Advanced settings: session stats (refresh when tab opens) ─────────────
document.querySelectorAll("[data-settings-tab='advanced']").forEach(btn => {
  btn.addEventListener("click", () => {
    const s  = getSessionSummary?.() ?? {};
    const el = id => document.getElementById(id);
    if (el("stat-uptime"))    el("stat-uptime").textContent    = s.duration ?? "—";
    if (el("stat-articles"))  el("stat-articles").textContent  = s.articlesIngested ?? "—";
    if (el("stat-countries")) el("stat-countries").textContent = s.countriesSeen    ?? "—";
    if (el("stat-events"))    el("stat-events").textContent    = dynamic.eventVisuals.length;
    if (el("stat-streak"))    el("stat-streak").textContent    = `${localStorage.getItem("ge-visit-streak") ?? 1}d`;
    if (el("stat-entities"))  el("stat-entities").textContent  = viewer?.entities?.values?.length ?? "—";
  });
});