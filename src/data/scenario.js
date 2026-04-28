// ─── Global incident pool ─────────────────────────────────────────────────────
// 30+ real-world geopolitical hotspots. cycleIncidentPool() in main.js picks a
// random subset every 20-30 minutes and repositions the live Cesium entities.
export const INCIDENT_POOL = [
  {
    id: "pool-ukraine-front",
    label: "Ukraine Front",
    description: "Active conflict along the eastern front; artillery exchanges and drone activity reported.",
    sourceLabel: "UA conflict monitor",
    sourceUrl: "https://reliefweb.int/",
    tags: ["conflict", "europe", "artillery"],
    location: { lng: 37.8, lat: 48.0 }
  },
  {
    id: "pool-gaza-strip",
    label: "Gaza Operations",
    description: "Ongoing military operations; humanitarian corridors under pressure.",
    sourceLabel: "OCHA situation report",
    sourceUrl: "https://reliefweb.int/",
    tags: ["conflict", "middle-east", "urban"],
    location: { lng: 34.4, lat: 31.5 }
  },
  {
    id: "pool-red-sea",
    label: "Red Sea Interdiction",
    description: "Missile and drone interdiction activity affecting commercial shipping lanes.",
    sourceLabel: "Maritime security brief",
    sourceUrl: "https://reliefweb.int/",
    tags: ["maritime", "middle-east", "interdiction"],
    location: { lng: 43.5, lat: 15.2 }
  },
  {
    id: "pool-taiwan-strait",
    label: "Taiwan Strait",
    description: "Elevated PLA naval and air activity; median line incursions tracked.",
    sourceLabel: "Indo-Pacific watch",
    sourceUrl: "https://opensky-network.org/",
    tags: ["military", "pacific", "naval"],
    location: { lng: 120.5, lat: 24.5 }
  },
  {
    id: "pool-south-china-sea",
    label: "South China Sea",
    description: "Contested maritime features; coast guard and naval presence elevated.",
    sourceLabel: "SCS monitor",
    sourceUrl: "https://opensky-network.org/",
    tags: ["maritime", "pacific", "territorial"],
    location: { lng: 114.2, lat: 15.8 }
  },
  {
    id: "pool-korean-dmz",
    label: "Korean DMZ",
    description: "Cross-border balloon launches and signal activity detected along the DMZ.",
    sourceLabel: "Korean peninsula watch",
    sourceUrl: "https://reliefweb.int/",
    tags: ["military", "pacific", "signals"],
    location: { lng: 127.5, lat: 38.0 }
  },
  {
    id: "pool-sudan-conflict",
    label: "Sudan RSF Zone",
    description: "RSF-SAF engagements reported in Khartoum and North Darfur; civilian displacement ongoing.",
    sourceLabel: "ACLED Africa monitor",
    sourceUrl: "https://reliefweb.int/",
    tags: ["conflict", "africa", "displacement"],
    location: { lng: 32.5, lat: 15.6 }
  },
  {
    id: "pool-sahel-mali",
    label: "Sahel Corridor",
    description: "Armed group activity across the tri-border zone; MINUSMA withdrawal aftermath.",
    sourceLabel: "Sahel security desk",
    sourceUrl: "https://reliefweb.int/",
    tags: ["conflict", "africa", "insurgency"],
    location: { lng: -1.5, lat: 15.0 }
  },
  {
    id: "pool-somalia-horn",
    label: "Horn of Africa",
    description: "Al-Shabaab pressure on coastal towns; naval piracy risk elevated in GOA.",
    sourceLabel: "EUNAVFOR brief",
    sourceUrl: "https://reliefweb.int/",
    tags: ["maritime", "africa", "piracy"],
    location: { lng: 45.3, lat: 5.2 }
  },
  {
    id: "pool-kashmir-loc",
    label: "Kashmir LoC",
    description: "Cross-LoC firing incidents; air defence assets repositioned.",
    sourceLabel: "South Asia watch",
    sourceUrl: "https://reliefweb.int/",
    tags: ["conflict", "asia", "border"],
    location: { lng: 74.5, lat: 34.1 }
  },
  {
    id: "pool-myanmar",
    label: "Myanmar Theater",
    description: "Resistance offensives in Sagaing and Shan State; air strikes reported.",
    sourceLabel: "ISP Myanmar monitor",
    sourceUrl: "https://reliefweb.int/",
    tags: ["conflict", "asia", "air-strikes"],
    location: { lng: 96.0, lat: 21.5 }
  },
  {
    id: "pool-syria-northeast",
    label: "NE Syria",
    description: "IS resurgence activity in Deir ez-Zor; SDF counter-operations ongoing.",
    sourceLabel: "Syria conflict tracker",
    sourceUrl: "https://reliefweb.int/",
    tags: ["conflict", "middle-east", "insurgency"],
    location: { lng: 40.1, lat: 35.2 }
  },
  {
    id: "pool-libya-south",
    label: "Libya Fissure Line",
    description: "Armed faction movements south of Sirte; oil export disruption risk.",
    sourceLabel: "UNSMIL monitor",
    sourceUrl: "https://reliefweb.int/",
    tags: ["conflict", "africa", "energy"],
    location: { lng: 16.5, lat: 29.0 }
  },
  {
    id: "pool-drc-east",
    label: "DRC Eastern Front",
    description: "M23 and allied group advances near Goma; MONUSCO posture under review.",
    sourceLabel: "ACLED DRC brief",
    sourceUrl: "https://reliefweb.int/",
    tags: ["conflict", "africa", "displacement"],
    location: { lng: 29.2, lat: -1.7 }
  },
  {
    id: "pool-mozambique",
    label: "Cabo Delgado",
    description: "ISCAP insurgent activity in northern Mozambique; LNG facility security elevated.",
    sourceLabel: "Cabo Delgado monitor",
    sourceUrl: "https://reliefweb.int/",
    tags: ["conflict", "africa", "energy"],
    location: { lng: 40.5, lat: -12.3 }
  },
  {
    id: "pool-iran-drone",
    label: "Iran Drone Corridor",
    description: "Shahed-series drone activity tracked across the Iran-Iraq-Gulf corridor.",
    sourceLabel: "CENTCOM press",
    sourceUrl: "https://reliefweb.int/",
    tags: ["military", "middle-east", "drone"],
    location: { lng: 51.5, lat: 32.0 }
  },
  {
    id: "pool-armenia-az",
    label: "Armenia Border",
    description: "Post-Karabakh demarcation tensions; border incidents under observation.",
    sourceLabel: "Caucasus watch",
    sourceUrl: "https://reliefweb.int/",
    tags: ["conflict", "caucasus", "border"],
    location: { lng: 46.4, lat: 40.2 }
  },
  {
    id: "pool-moldova-trans",
    label: "Transnistria Watch",
    description: "Heightened monitoring of the Transnistrian security zone amid regional spillover risk.",
    sourceLabel: "OSCE mission brief",
    sourceUrl: "https://reliefweb.int/",
    tags: ["military", "europe", "frozen-conflict"],
    location: { lng: 29.4, lat: 47.0 }
  },
  {
    id: "pool-baltic-kalinin",
    label: "Kaliningrad Corridor",
    description: "NATO air policing missions intensified; A2AD posture monitoring active.",
    sourceLabel: "Baltic security brief",
    sourceUrl: "https://opensky-network.org/",
    tags: ["military", "europe", "nato"],
    location: { lng: 20.5, lat: 54.7 }
  },
  {
    id: "pool-belarusian-border",
    label: "Belarus Pressure Zone",
    description: "Irregular migration pressure on EU border; Wagnerlinked activity tracked.",
    sourceLabel: "EU border monitor",
    sourceUrl: "https://reliefweb.int/",
    tags: ["military", "europe", "hybrid"],
    location: { lng: 24.5, lat: 53.8 }
  },
  {
    id: "pool-venezuela-border",
    label: "Venezuela-Guyana",
    description: "Essequibo territorial dispute escalating; troop mobilisation observed.",
    sourceLabel: "LatAm security watch",
    sourceUrl: "https://reliefweb.int/",
    tags: ["territorial", "latin-america", "border"],
    location: { lng: -62.0, lat: 6.5 }
  },
  {
    id: "pool-haiti",
    label: "Haiti Gang Control",
    description: "Gang coalition controls significant Port-au-Prince territory; CARICOM mission active.",
    sourceLabel: "BINUH situation report",
    sourceUrl: "https://reliefweb.int/",
    tags: ["conflict", "caribbean", "urban"],
    location: { lng: -72.3, lat: 18.5 }
  },
  {
    id: "pool-mexico-cartel",
    label: "Mexico Cartel Zone",
    description: "Armed cartel confrontations in Sinaloa and Chihuahua; military operations reported.",
    sourceLabel: "InSight Crime monitor",
    sourceUrl: "https://reliefweb.int/",
    tags: ["conflict", "latin-america", "cartel"],
    location: { lng: -107.0, lat: 25.5 }
  },
  {
    id: "pool-ethiopia",
    label: "Ethiopia Amhara",
    description: "Amhara Fano militia clashes with federal forces; humanitarian access restricted.",
    sourceLabel: "ACLED Ethiopia desk",
    sourceUrl: "https://reliefweb.int/",
    tags: ["conflict", "africa", "displacement"],
    location: { lng: 38.5, lat: 11.5 }
  },
  {
    id: "pool-pak-afghan",
    label: "Pak-Afghan Border",
    description: "TTP cross-border incursions; Pakistani military response operations underway.",
    sourceLabel: "South Asia security brief",
    sourceUrl: "https://reliefweb.int/",
    tags: ["conflict", "asia", "border"],
    location: { lng: 70.5, lat: 33.8 }
  },
  {
    id: "pool-gulf-aden",
    label: "Gulf of Aden",
    description: "Commercial vessel interdictions and naval escorts active in the Gulf of Aden corridor.",
    sourceLabel: "IMB piracy report",
    sourceUrl: "https://reliefweb.int/",
    tags: ["maritime", "middle-east", "piracy"],
    location: { lng: 50.0, lat: 12.5 }
  },
  {
    id: "pool-caf",
    label: "Central African Rep.",
    description: "Wagner-successor forces and CPC rebels active near the Sudanese border.",
    sourceLabel: "MINUSCA monitor",
    sourceUrl: "https://reliefweb.int/",
    tags: ["conflict", "africa", "proxy"],
    location: { lng: 20.0, lat: 6.5 }
  },
  {
    id: "pool-north-sea-infra",
    label: "North Sea Infrastructure",
    description: "Subsea pipeline and cable monitoring elevated following Baltic incidents.",
    sourceLabel: "NATO infra watch",
    sourceUrl: "https://www.first.org/",
    tags: ["infrastructure", "europe", "maritime"],
    location: { lng: 5.0, lat: 57.5 }
  },
  {
    id: "pool-spratly",
    label: "Spratly Islands",
    description: "Philippines and PRC coast guard standoffs at contested features.",
    sourceLabel: "Asia Maritime Transparency",
    sourceUrl: "https://opensky-network.org/",
    tags: ["maritime", "pacific", "territorial"],
    location: { lng: 114.5, lat: 10.5 }
  },
  {
    id: "pool-niger-coup",
    label: "Niger Transition Zone",
    description: "Post-coup junta consolidation; ECOWAS standby force on elevated readiness.",
    sourceLabel: "West Africa desk",
    sourceUrl: "https://reliefweb.int/",
    tags: ["political", "africa", "coup"],
    location: { lng: 13.5, lat: 17.5 }
  }
];

export const STORAGE_KEYS = {
  bookmarks: "panopticon-earth-bookmarks",
  layers: "panopticon-earth-layers",
  basemap: "panopticon-earth-basemap",
  fxMode: "panopticon-earth-fx-mode"
};

export const BASEMAPS = [
  {
    id: "satellite",
    label: "Satellite",
    type: "url",
    url: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    credit: "Esri World Imagery"
  },
  {
    id: "streets",
    label: "Streets",
    type: "osm",
    url: "https://tile.openstreetmap.org/",
    credit: "OpenStreetMap"
  },
  {
    id: "dark",
    label: "Dark",
    type: "url",
    url: "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    credit: "Esri Dark Gray"
  },
  {
    id: "terrain",
    label: "Terrain",
    type: "url",
    url: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
    credit: "Esri Topographic"
  }
];

export const FX_MODES = [
  { id: "normal", label: "Normal" },
  { id: "nightvision", label: "NV" },
  { id: "thermal", label: "Thermal" },
  { id: "crt", label: "CRT" },
  { id: "warroom", label: "WAR ROOM" }
];

export const LAYERS = [
  { id: "commercial", label: "Commercial Flights", description: "Civilian global air traffic", color: "#7ee0ff", enabled: true },
  { id: "military", label: "Military Flights", description: "Patrol, ISR, tanker, and AWACS tracks", color: "#ffbe5c", enabled: true },
  { id: "satellites", label: "Satellites", description: "Orbital passes with path trails", color: "#af9dff", enabled: true },
  { id: "maritime", label: "Maritime", description: "Tankers, cargo, and shipping lanes", color: "#60f7bf", enabled: true },
  { id: "incidents", label: "Incident Nodes", description: "Strikes, blackouts, and pressure points", color: "#ff6d8d", enabled: true },
  { id: "zones", label: "Jamming / Closures", description: "Active disruption and exclusion zones", color: "#ffc0cb", enabled: true },
  { id: "location", label: "My Location", description: "IP-based position marker (opt-in)", color: "#00ff88", enabled: false },
  { id: "borders", label: "Country Borders", description: "Border outlines + country labels when zoomed in", color: "#7ee0ff", enabled: true },
  { id: "seismic", label: "Seismic Activity", description: "Live USGS earthquakes M2.5+ past 24h", color: "#ffbe5c", enabled: true },
  { id: "iss",     label: "ISS Live Track",   description: "International Space Station real-time orbital position", color: "#60f7bf", enabled: true }
];

export const DEFAULT_BOOKMARKS = [
  {
    id: "bookmark-gulf",
    label: "Gulf",
    destination: { lng: 53.6, lat: 25.8, height: 2200000, heading: 0.2, pitch: -0.85, roll: 0 }
  },
  {
    id: "bookmark-europe",
    label: "Europe",
    destination: { lng: 10.3, lat: 48.2, height: 5200000, heading: 0.15, pitch: -1.05, roll: 0 }
  },
  {
    id: "bookmark-pacific",
    label: "Pacific",
    destination: { lng: 142.1, lat: 29.1, height: 7800000, heading: 0.45, pitch: -1.15, roll: 0 }
  }
];

export const SCENARIO = {
  title: "Panopticon Earth",
  subtitle: "A globe-first monitoring workspace for replaying traffic, orbits, incidents, and closures.",
  durationMinutes: 120,
  initialView: {
    lng: 34,
    lat: 24,
    height: 18500000,
    heading: 0.25,
    pitch: -1.2,
    roll: 0
  },
  alerts: [
    {
      id: "alert-gulf",
      region: "GULF",
      title: "Gulf GPS Disruption Active",
      summary: "Persistent GPS jamming in the Gulf corridor affecting commercial and military aviation.",
      sourceLabel: "OpenSky + Regional NOTAM Watch",
      sourceUrl: "https://opensky-network.org/",
      updates: [
        {
          title: "Gulf GPS Disruption Active",
          summary: "Persistent GPS jamming in the Gulf corridor affecting commercial and military aviation.",
          sourceLabel: "OpenSky + Regional NOTAM Watch",
          sourceUrl: "https://opensky-network.org/",
          publishedAt: "Updated moments ago"
        },
        {
          title: "Signal Interference Pattern Shifted East",
          summary: "Interference footprint drifts eastward, pushing additional route planning advisories.",
          sourceLabel: "Flight planning monitor",
          sourceUrl: "https://opensky-network.org/",
          publishedAt: "Update +11 min"
        },
        {
          title: "Corridor Stability Partial Recovery",
          summary: "Outer edges of the disruption field show partial stabilization while core remains volatile.",
          sourceLabel: "Aviation operations brief",
          sourceUrl: "https://opensky-network.org/",
          publishedAt: "Update +24 min"
        }
      ],
      tags: ["jamming", "gulf", "aviation"],
      location: { lng: 53.8, lat: 29.9 }
    },
    {
      id: "alert-orbital",
      region: "ORBIT",
      title: "Imaging Satellites Over AOI",
      summary: "Multiple EO and SAR platforms are currently crossing the Middle East area of interest.",
      sourceLabel: "Public orbital tracks",
      sourceUrl: "https://www.n2yo.com/",
      updates: [
        {
          title: "Imaging Satellites Over AOI",
          summary: "Multiple EO and SAR platforms are currently crossing the Middle East area of interest.",
          sourceLabel: "Public orbital tracks",
          sourceUrl: "https://www.n2yo.com/",
          publishedAt: "Updated moments ago"
        },
        {
          title: "Revisit Window Tightened",
          summary: "Revisit gaps narrowed as additional imaging passes align over the monitored corridor.",
          sourceLabel: "Orbital timing brief",
          sourceUrl: "https://www.n2yo.com/",
          publishedAt: "Update +8 min"
        },
        {
          title: "SAR Coverage Lead Established",
          summary: "SAR platforms now provide the lead pass before EO handoff in the primary area.",
          sourceLabel: "Orbital coordination feed",
          sourceUrl: "https://www.n2yo.com/",
          publishedAt: "Update +21 min"
        }
      ],
      tags: ["satellite", "aoi", "imagery"],
      location: { lng: 54.1, lat: 33.5 }
    },
    {
      id: "alert-routes",
      region: "CIVIL AIR",
      title: "Rerouting In Progress",
      summary: "Commercial routes are diverting around the most congested and disrupted corridors.",
      sourceLabel: "Civil traffic model",
      sourceUrl: "https://opensky-network.org/",
      updates: [
        {
          title: "Rerouting In Progress",
          summary: "Commercial routes are diverting around the most congested and disrupted corridors.",
          sourceLabel: "Civil traffic model",
          sourceUrl: "https://opensky-network.org/",
          publishedAt: "Updated moments ago"
        },
        {
          title: "Westbound Diversions Increase",
          summary: "Additional westbound long-haul flights have shifted to lower-risk corridors.",
          sourceLabel: "Route anomaly monitor",
          sourceUrl: "https://opensky-network.org/",
          publishedAt: "Update +10 min"
        },
        {
          title: "Holding Patterns Compressed",
          summary: "Queue compression observed near handoff sectors as alternate paths stabilize.",
          sourceLabel: "Civil operations board",
          sourceUrl: "https://opensky-network.org/",
          publishedAt: "Update +19 min"
        }
      ],
      tags: ["commercial", "reroute"],
      location: { lng: 49.8, lat: 27.2 }
    },
    {
      id: "alert-closures",
      region: "AIRSPACE",
      title: "Regional Closures Extended",
      summary: "Airspace closure zones have expanded west and south; chokepoint restrictions ongoing.",
      sourceLabel: "Airspace advisories",
      sourceUrl: "https://www.icao.int/",
      updates: [
        {
          title: "Regional Closures Extended",
          summary: "Airspace closure zones have expanded west and south; chokepoint restrictions ongoing.",
          sourceLabel: "Airspace advisories",
          sourceUrl: "https://www.icao.int/",
          publishedAt: "Updated moments ago"
        },
        {
          title: "Restriction Perimeter Broadened",
          summary: "Closure perimeter broadened to include secondary approach lanes.",
          sourceLabel: "Sector NOTAM digest",
          sourceUrl: "https://www.icao.int/",
          publishedAt: "Update +14 min"
        },
        {
          title: "Maritime Chokepoint Controls Persist",
          summary: "Transit controls remain in effect with staggered movement windows.",
          sourceLabel: "Route safety bulletin",
          sourceUrl: "https://www.icao.int/",
          publishedAt: "Update +29 min"
        }
      ],
      tags: ["closure", "cascade", "shipping"],
      location: { lng: 46.1, lat: 28.8 }
    },
    {
      id: "alert-pacific",
      region: "PACIFIC",
      title: "Pacific Posture Elevated",
      summary: "Military aviation and ISR monitoring activity increased over the western Pacific.",
      sourceLabel: "Regional surveillance brief",
      sourceUrl: "https://opensky-network.org/",
      updates: [
        {
          title: "Pacific Posture Elevated",
          summary: "Military aviation and ISR monitoring activity increased over the western Pacific.",
          sourceLabel: "Regional surveillance brief",
          sourceUrl: "https://opensky-network.org/",
          publishedAt: "Updated moments ago"
        },
        {
          title: "ISR Orbit Density Up",
          summary: "Additional ISR arcs now overlap priority shipping lanes and nearby patrol sectors.",
          sourceLabel: "Pacific watch desk",
          sourceUrl: "https://opensky-network.org/",
          publishedAt: "Update +9 min"
        },
        {
          title: "Patrol Pattern Realigned",
          summary: "Patrol vectors are realigned to reduce overlap while maintaining wide-area coverage.",
          sourceLabel: "Ops posture memo",
          sourceUrl: "https://opensky-network.org/",
          publishedAt: "Update +23 min"
        }
      ],
      tags: ["pacific", "military", "orbit"],
      location: { lng: 139.2, lat: 29.6 }
    },
    {
      id: "alert-comms",
      region: "SIGNAL",
      title: "Signal Integrity Monitoring",
      summary: "Continuous monitoring of global communications infrastructure for degradation and anomalies.",
      sourceLabel: "Signal integrity monitor",
      sourceUrl: "https://www.first.org/",
      updates: [
        {
          title: "Signal Integrity Monitoring",
          summary: "Continuous monitoring of global communications infrastructure for degradation and anomalies.",
          sourceLabel: "Signal integrity monitor",
          sourceUrl: "https://www.first.org/",
          publishedAt: "Updated moments ago"
        },
        {
          title: "Undersea Cable Traffic Nominal",
          summary: "Major undersea cable routes report stable throughput with no latency anomalies.",
          sourceLabel: "Cable health monitor",
          sourceUrl: "https://www.first.org/",
          publishedAt: "Update +12 min"
        },
        {
          title: "Regional Node Variance Detected",
          summary: "Minor variance in regional relay nodes under observation; no degradation confirmed.",
          sourceLabel: "Network continuity brief",
          sourceUrl: "https://www.first.org/",
          publishedAt: "Update +27 min"
        }
      ],
      tags: ["signals", "infrastructure"],
      location: { lng: 35.0, lat: 31.5 }
    }
  ],
  flights: {
    commercial: [
      {
        id: "com-thy631",
        label: "THY631",
        description: "Long-haul civilian track pressing through the edge of the Gulf corridor.",
        altitude: 11200,
        positions: [
          { minute: 0, lng: 55.2, lat: 25.1 },
          { minute: 24, lng: 56.1, lat: 28.7 },
          { minute: 48, lng: 53.8, lat: 31.9 },
          { minute: 74, lng: 46.1, lat: 35.8 },
          { minute: 98, lng: 36.2, lat: 39.1 },
          { minute: 120, lng: 28.7, lat: 41 }
        ]
      },
      {
        id: "com-vir354",
        label: "VIR354",
        description: "Civilian route that visibly bends around the disruption field.",
        altitude: 10900,
        positions: [
          { minute: 0, lng: 55.4, lat: 25.7 },
          { minute: 22, lng: 54.8, lat: 28.4 },
          { minute: 44, lng: 50.9, lat: 29.6 },
          { minute: 70, lng: 43.1, lat: 26.4 },
          { minute: 97, lng: 36.7, lat: 23.4 },
          { minute: 120, lng: 31.1, lat: 21.2 }
        ]
      },
      {
        id: "com-qtr908",
        label: "QTR908",
        description: "Wide-body passenger track turning west after closure wave onset.",
        altitude: 11100,
        positions: [
          { minute: 0, lng: 50.4, lat: 24.3 },
          { minute: 18, lng: 52.1, lat: 25.6 },
          { minute: 36, lng: 53.1, lat: 27.5 },
          { minute: 60, lng: 49.3, lat: 26.4 },
          { minute: 84, lng: 43.6, lat: 24.1 },
          { minute: 120, lng: 36.4, lat: 21.8 }
        ]
      },
      {
        id: "com-lha700",
        label: "LHA700",
        description: "High-latitude Europe-to-Asia traffic segment.",
        altitude: 11400,
        positions: [
          { minute: 0, lng: 8.6, lat: 50.2 },
          { minute: 24, lng: 18.1, lat: 53.4 },
          { minute: 48, lng: 31.6, lat: 55.2 },
          { minute: 72, lng: 47.9, lat: 54.1 },
          { minute: 96, lng: 66.8, lat: 50.7 },
          { minute: 120, lng: 84.1, lat: 46.9 }
        ]
      },
      {
        id: "com-jal44",
        label: "JAL44",
        description: "Transpacific commercial line crossing into the western Pacific watch area.",
        altitude: 11350,
        positions: [
          { minute: 0, lng: 166.8, lat: 35.2 },
          { minute: 26, lng: 176.5, lat: 37.9 },
          { minute: 52, lng: -171.3, lat: 39.8 },
          { minute: 78, lng: -160.6, lat: 39.2 },
          { minute: 102, lng: -148.7, lat: 37.1 },
          { minute: 120, lng: -138.9, lat: 35.4 }
        ]
      },
      {
        id: "com-sia318",
        label: "SIA318",
        description: "Singapore-Europe lane threading through the Indian Ocean to the Mediterranean.",
        altitude: 11050,
        positions: [
          { minute: 0, lng: 103.9, lat: 1.2 },
          { minute: 24, lng: 85.1, lat: 10.5 },
          { minute: 48, lng: 63.6, lat: 20.3 },
          { minute: 72, lng: 43.2, lat: 28.4 },
          { minute: 96, lng: 21.4, lat: 35.8 },
          { minute: 120, lng: 2.3, lat: 44.1 }
        ]
      }
    ],
    military: [
      {
        id: "mil-isr22",
        label: "ISR22",
        description: "Persistent intelligence, surveillance, and reconnaissance orbit over the Gulf theater.",
        altitude: 9600,
        positions: [
          { minute: 0, lng: 43.8, lat: 29.2 },
          { minute: 28, lng: 46.2, lat: 31.6 },
          { minute: 56, lng: 50.4, lat: 33.3 },
          { minute: 84, lng: 47.6, lat: 32.5 },
          { minute: 120, lng: 43.9, lat: 30.8 }
        ]
      },
      {
        id: "mil-awacs5",
        label: "AWACS5",
        description: "Wide-area early warning orbit supporting the theater edge.",
        altitude: 10100,
        positions: [
          { minute: 0, lng: 45.6, lat: 26.1 },
          { minute: 24, lng: 47.1, lat: 26.8 },
          { minute: 48, lng: 48.3, lat: 27.2 },
          { minute: 72, lng: 47.5, lat: 26.8 },
          { minute: 96, lng: 46.4, lat: 26.3 },
          { minute: 120, lng: 45.5, lat: 26 }
        ]
      },
      {
        id: "mil-tnk14",
        label: "TNK14",
        description: "Support tanker loitering outside the densest disruption area.",
        altitude: 9400,
        positions: [
          { minute: 0, lng: 45, lat: 27.9 },
          { minute: 20, lng: 46.9, lat: 28.7 },
          { minute: 40, lng: 48.2, lat: 29.3 },
          { minute: 70, lng: 49.1, lat: 29.6 },
          { minute: 95, lng: 46.4, lat: 29.1 },
          { minute: 120, lng: 43.7, lat: 28.5 }
        ]
      },
      {
        id: "mil-pacpatrol",
        label: "PAC-PATROL",
        description: "Western Pacific military patrol orbit to broaden the globe narrative.",
        altitude: 9800,
        positions: [
          { minute: 0, lng: 132.5, lat: 25.8 },
          { minute: 24, lng: 135.7, lat: 27.3 },
          { minute: 48, lng: 139.2, lat: 29.1 },
          { minute: 72, lng: 142.8, lat: 30.4 },
          { minute: 96, lng: 139.1, lat: 29.7 },
          { minute: 120, lng: 134.6, lat: 27.4 }
        ]
      }
    ]
  },
  satellites: [
    {
      id: "sat-wv-legion",
      label: "WV Legion",
      description: "Commercial EO satellite with pre- and post-event collection windows.",
      altitude: 610000,
      positions: [
        { minute: 0, lng: 12, lat: 4 },
        { minute: 20, lng: 34, lat: 21 },
        { minute: 40, lng: 56, lat: 35 },
        { minute: 60, lng: 82, lat: 49 },
        { minute: 90, lng: 116, lat: 58 },
        { minute: 120, lng: 146, lat: 63 }
      ]
    },
    {
      id: "sat-capella7",
      label: "Capella-7",
      description: "Synthetic aperture radar platform crossing the AOI during the strike window.",
      altitude: 590000,
      positions: [
        { minute: 0, lng: 96, lat: 60 },
        { minute: 20, lng: 74, lat: 44 },
        { minute: 40, lng: 55, lat: 31 },
        { minute: 60, lng: 26, lat: 18 },
        { minute: 90, lng: -12, lat: -3 },
        { minute: 120, lng: -38, lat: -17 }
      ]
    },
    {
      id: "sat-persona3",
      label: "Persona-3",
      description: "Military imaging satellite with multiple revisits through the theater.",
      altitude: 635000,
      positions: [
        { minute: 0, lng: -92, lat: 66 },
        { minute: 24, lng: -40, lat: 53 },
        { minute: 48, lng: 4, lat: 42 },
        { minute: 72, lng: 50, lat: 31 },
        { minute: 96, lng: 95, lat: 20 },
        { minute: 120, lng: 136, lat: 11 }
      ]
    },
    {
      id: "sat-topaz234",
      label: "Topaz 234",
      description: "Military radar platform with a direct zero-hour overpass.",
      altitude: 670000,
      positions: [
        { minute: 0, lng: -118, lat: 1 },
        { minute: 24, lng: -60, lat: 18 },
        { minute: 48, lng: 2, lat: 26 },
        { minute: 72, lng: 58, lat: 34 },
        { minute: 96, lng: 103, lat: 47 },
        { minute: 120, lng: 145, lat: 58 }
      ]
    }
  ],
  maritime: [
    {
      id: "sea-meridian",
      label: "Meridian LNG",
      description: "LNG tanker edging through the Strait as restrictions tighten.",
      altitude: 0,
      positions: [
        { minute: 0, lng: 55.7, lat: 26.8 },
        { minute: 24, lng: 56.1, lat: 26.5 },
        { minute: 48, lng: 56.3, lat: 26.3 },
        { minute: 72, lng: 56.7, lat: 26.1 },
        { minute: 96, lng: 57.2, lat: 25.9 },
        { minute: 120, lng: 57.6, lat: 25.7 }
      ]
    },
    {
      id: "sea-atlas",
      label: "Atlas Tanker",
      description: "Oil tanker reversing course as the chokepoint risk climbs.",
      altitude: 0,
      positions: [
        { minute: 0, lng: 56.4, lat: 25.9 },
        { minute: 24, lng: 55.9, lat: 25.8 },
        { minute: 48, lng: 55.2, lat: 25.7 },
        { minute: 72, lng: 54.2, lat: 25.5 },
        { minute: 96, lng: 53.4, lat: 25.2 },
        { minute: 120, lng: 52.9, lat: 25.1 }
      ]
    },
    {
      id: "sea-suez-cargo",
      label: "Suez Cargo",
      description: "East Mediterranean cargo flow for globe-scale maritime motion.",
      altitude: 0,
      positions: [
        { minute: 0, lng: 31.1, lat: 30.1 },
        { minute: 24, lng: 32.6, lat: 29.1 },
        { minute: 48, lng: 34.2, lat: 27.6 },
        { minute: 72, lng: 35.8, lat: 26.4 },
        { minute: 96, lng: 37.6, lat: 25.2 },
        { minute: 120, lng: 39.1, lat: 24.1 }
      ]
    },
    {
      id: "sea-pacific-container",
      label: "Pacific Container",
      description: "Container ship holding course across the western Pacific trade lane.",
      altitude: 0,
      positions: [
        { minute: 0, lng: 136.2, lat: 31.8 },
        { minute: 24, lng: 139.1, lat: 31.4 },
        { minute: 48, lng: 142.6, lat: 31.1 },
        { minute: 72, lng: 146.4, lat: 30.8 },
        { minute: 96, lng: 149.2, lat: 30.5 },
        { minute: 120, lng: 152.4, lat: 30.2 }
      ]
    }
  ],
  // Populated dynamically at boot from INCIDENT_POOL — never hardcode fixtures here.
  incidents: [],
  zones: [
    {
      id: "zone-gulf-jam",
      label: "Gulf GPS Disruption",
      kind: "rectangle",
      color: "#ff6d8d",
      fill: 0.16,
      coordinates: { west: 49.1, south: 28.2, east: 55.6, north: 33.8 }
    },
    {
      id: "zone-gulf-closure",
      label: "Regional Closure Wave",
      kind: "polygon",
      color: "#ffffff",
      fill: 0.08,
      coordinates: [
        [44.7, 38.5],
        [60.8, 38.9],
        [61.7, 24.6],
        [46.1, 24.1]
      ]
    },
    {
      id: "zone-pacific-watch",
      label: "Pacific Watch Box",
      kind: "rectangle",
      color: "#7ee0ff",
      fill: 0.08,
      coordinates: { west: 133.5, south: 24.4, east: 147.8, north: 33.6 }
    }
  ]
};
