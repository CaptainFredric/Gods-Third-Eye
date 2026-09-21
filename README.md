# ◈ God's Third Eye — Panopticon Earth

**A real-time 3D global intelligence command center built primarily in the browser, with an optional live relay for restricted feeds.**

> Track aircraft, satellites, maritime routes, and geopolitical incidents on an interactive CesiumJS globe, with an optional relay for live feed recovery.

🔗 **[Live Demo →](https://captainfredric.github.io/Gods-Third-Eye/)**

---

## What Is This?

God's Third Eye (codename **Panopticon Earth**) is a globe-first geospatial intelligence dashboard that fuses live open-source data feeds into a single HUD-style command interface. It was designed to demonstrate what a modern OSINT monitoring tool could look like if it ran mostly client-side, while still allowing an optional relay when browser or CORS limits block upstream live feeds.

The project started as a 2D replay console and was rebuilt from scratch into a live-focused **CesiumJS + Vite** application with six simultaneous data layers, draggable glass panels, real-time feed indicators, and a cinematic boot sequence.

## Key Features

| Category | Highlights |
| --- | --- |
| **3D Globe** | Fully interactive CesiumJS Earth with drag, zoom, tilt, spin, and cinematic camera presets |
| **Live Feeds** | Real-time ADS-B aircraft tracking (OpenSky Network), GDELT news intelligence, optional relay-backed recovery for restricted feeds, and simulated AIS maritime data |
| **Six Data Layers** | Commercial flights, military traffic, orbital satellites, maritime routes, incident zones, and jamming/closure areas — each independently togglable |
| **HUD Interface** | Military-inspired heads-up display with classification bar, threat-level indicator, throughput meters, signal health dots, and sparkline metrics |
| **Glass Panel System** | Draggable, minimizable, closable frosted-glass panels with layout persistence via localStorage |
| **Search & Navigation** | Geocoding search (OpenStreetMap Nominatim) with keyboard navigation, camera bookmarks, system presets, and saved views |
| **News Intelligence** | Live categorized news briefing panel (War, Geopolitics, Intelligence, Energy, Maritime) powered by GDELT 2.0 DOC API with auto-rotation and translation support |
| **Entity Inspection** | Click any track to see telemetry, assessment, and timeline in a full Intel Sheet overlay |
| **Operations Desk** | One-click hotspot jumps, random track selection, alert tours, and brief-focus summaries |
| **Visual Modes & Tuning** | Multiple FX modes, glow/intensity sliders, and basemap switching (Satellite, Streets, Dark, Terrain) |
| **Responsive Design** | Full mobile layout with drawer-based navigation, sticky header, and touch-optimized controls |
| **Boot Sequence** | Cinematic animated boot overlay with hex logo, progress bar, and operator name prompt |

## Tech Stack

| Layer | Technology |
| --- | --- |
| **3D Engine** | [CesiumJS 1.124.0](https://cesium.com/) — WebGL globe rendering, entity management, camera control |
| **Build Tool** | [Vite 6.x](https://vitejs.dev/) + [vite-plugin-cesium](https://github.com/nshen/vite-plugin-cesium) |
| **Language** | Vanilla JavaScript (ES modules, zero frameworks) |
| **Styling** | CSS custom properties, backdrop-filter glass effects, CSS animations, responsive breakpoints |
| **Fonts** | [Rajdhani](https://fonts.google.com/specimen/Rajdhani) (UI) + [Share Tech Mono](https://fonts.google.com/specimen/Share+Tech+Mono) (monospace) |
| **Data Sources** | OpenSky Network (ADS-B), GDELT 2.0 DOC API (news), OpenStreetMap Nominatim (geocoding) |
| **Deployment** | GitHub Actions → GitHub Pages (auto-deploy on push to `main`) |

## Architecture

```text
index.html                  ← Vite app shell, full HUD layout (~550 lines)
src/
  main.js                   ← Cesium viewer, all UI logic, entity engine (~4,500 lines)
  data/
    scenario.js             ← Modeled flights, satellites, vessels, zones, events, presets
  services/
    live-feeds.js           ← OpenSky ADS-B + AIS feed adapters
    news-feeds.js           ← GDELT 2.0 DOC API client, 5 categories
    live-relay.js           ← Optional relay URL handling + browser fallback logic
  styles/
    index.css               ← Full HUD styling, glass panels, FX, responsive (~4,600 lines)
styles.css                  ← Cesium widget overrides
server/
  live-proxy.js             ← Optional local relay for ADS-B, GDELT, and ISS telemetry
vite.config.js              ← Vite + Cesium plugin configuration
.github/workflows/
  deploy-pages.yml          ← CI/CD: build & publish to GitHub Pages
```

## Run Locally

```bash
# Install dependencies
npm install

# Start dev server (hot reload)
npm run dev
# → http://localhost:5173

# Optional: run the live relay for OpenSky/GDELT recovery
npm run relay
# then open http://localhost:5173/?relay=local

# Or boot both local services together
npm run stack
# → relay on http://127.0.0.1:4180 and app on http://127.0.0.1:5173

# Optional: test the hosted same-origin relay path locally
# Vite proxies /api/live -> http://127.0.0.1:4180 by default
# open http://localhost:5173/?relay=/api/live

# Production build + preview
npm run build
npm run preview
# → http://localhost:4173
```

## How It Works

1. **Boot** — The cinematic overlay plays while Cesium loads the 3D globe and populates all six data layers from `scenario.js`.
2. **Live Refresh** — Every 90 seconds (configurable), the app fetches real ADS-B aircraft positions from OpenSky and news articles from GDELT. When browser restrictions block those upstream calls, an optional relay can be enabled to recover the live path. Signal health indicators update in real time.
3. **Interaction** — Click any entity on the globe to select it. Open the Intel Sheet for full telemetry. Use the Operations Desk for guided exploration or let the alert tour cycle through hotspots.
4. **Persistence** — Panel positions, layer states, camera bookmarks, saved layouts, and operator name are stored in `localStorage` and restored on reload.

## Deployment

This repo auto-deploys via GitHub Actions. Push to `main` and the workflow builds the Vite app and publishes `dist/` to GitHub Pages.

**Live URL:** [`https://captainfredric.github.io/Gods-Third-Eye/`](https://captainfredric.github.io/Gods-Third-Eye/)

To enable: **Settings → Pages → Source → GitHub Actions**.

## Hosted Relay

If you can place the relay behind the same host as the app, point the client at `/api/live` instead of a localhost URL.

```bash
# Client default relay base
VITE_LIVE_RELAY_URL=/api/live

# Dev-only proxy target consumed by vite.config.js
GTE_DEV_LIVE_RELAY_TARGET=http://127.0.0.1:4180
```

In local dev, the Vite server proxies `/api/live` to the relay target above. In hosted environments, route `/api/live/*` to the Node relay with your platform proxy or reverse proxy.

## Roadmap

- Swap modeled scenario data for live or historical ingest pipelines
- Add sensor heatmaps and denser real-world traffic layers
- Expand cinematic camera paths and saved scenario playlists
- Integrate real AIS maritime tracking where practical
- Weather overlay layer (wind, precipitation, storm tracking)

## Built By

**Aden Cisneros** · [GitHub](https://github.com/CaptainFredric) · [LinkedIn](https://www.linkedin.com/in/aden-cisneros/)

Built with CesiumJS, Vite, and vanilla JavaScript. No frameworks, and only an optional relay when upstream browser limits require it.
