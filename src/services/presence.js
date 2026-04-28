/**
 * presence.js — Client-side presence manager for God's Eye.
 *
 * Connects to the presence WebSocket server and:
 *  • Periodically sends the local operator's camera position
 *  • Receives peer positions and exposes them for rendering on the globe
 *
 * Usage:
 *   import { initPresence, getPresencePeers, setPresenceName } from "./services/presence.js";
 *   initPresence(viewer);          // call once after Cesium viewer is ready
 *   setPresenceName("Aden");       // optional — set operator display name
 *   getPresencePeers();            // returns Map<id, { name, lng, lat, alt, heading, color }>
 */

const DEFAULT_WS_URL = "ws://localhost:4175";
const SEND_INTERVAL_MS = 2000;
const RECONNECT_DELAY_MS = 5000;

let _ws = null;
let _myId = null;
let _viewer = null;
let _sendTimer = null;
let _reconnectTimer = null;
let _desiredName = null;
let _connected = false;

/** @type {Map<string, { name: string, lng: number, lat: number, alt: number, heading: number, color: string, lastSeen: number }>} */
const _peers = new Map();

/** Callbacks registered via onPeersChanged */
const _listeners = [];

function wsUrl() {
  // Allow the URL to be overridden via localStorage for deployment flexibility
  try {
    const custom = localStorage.getItem("panopticon-earth-presence-url");
    if (custom) return custom;
  } catch { /* */ }
  return DEFAULT_WS_URL;
}

function connect() {
  if (_ws) return;
  try {
    _ws = new WebSocket(wsUrl());
  } catch {
    scheduleReconnect();
    return;
  }

  _ws.onopen = () => {
    _connected = true;
    if (_desiredName) {
      send({ type: "join", name: _desiredName });
    }
  };

  _ws.onmessage = (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }

    switch (msg.type) {
      case "welcome":
        _myId = msg.id;
        syncPeers(msg.peers);
        break;

      case "peers":
        syncPeers(msg.peers);
        break;

      case "join":
        // A new peer connected — will get full state on next "peers" broadcast
        break;

      case "leave":
        _peers.delete(msg.id);
        notifyListeners();
        break;

      case "pong":
        break;

      default:
        break;
    }
  };

  _ws.onclose = () => {
    cleanup();
    scheduleReconnect();
  };

  _ws.onerror = () => {
    cleanup();
    scheduleReconnect();
  };
}

function cleanup() {
  _ws = null;
  _connected = false;
}

function scheduleReconnect() {
  if (_reconnectTimer) return;
  _reconnectTimer = window.setTimeout(() => {
    _reconnectTimer = null;
    connect();
  }, RECONNECT_DELAY_MS);
}

function send(data) {
  if (!_ws || _ws.readyState !== WebSocket.OPEN) return;
  try { _ws.send(JSON.stringify(data)); } catch { /* */ }
}

function syncPeers(peerMap) {
  _peers.clear();
  for (const [id, data] of Object.entries(peerMap)) {
    if (id === _myId) continue; // exclude self
    _peers.set(id, data);
  }
  notifyListeners();
}

function sendCameraUpdate() {
  if (!_viewer || !_connected) return;
  try {
    const carto = Cesium.Cartographic.fromCartesian(_viewer.camera.positionWC);
    send({
      type: "update",
      lng: Cesium.Math.toDegrees(carto.longitude),
      lat: Cesium.Math.toDegrees(carto.latitude),
      alt: carto.height,
      heading: Cesium.Math.toDegrees(_viewer.camera.heading)
    });
  } catch { /* camera might not be ready */ }
}

function notifyListeners() {
  for (const fn of _listeners) {
    try { fn(_peers); } catch { /* */ }
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Initialise presence and begin sending camera updates.
 * @param {Cesium.Viewer} viewer
 */
export function initPresence(viewer) {
  _viewer = viewer;
  connect();
  if (_sendTimer) window.clearInterval(_sendTimer);
  _sendTimer = window.setInterval(sendCameraUpdate, SEND_INTERVAL_MS);
}

/**
 * Set the local operator's display name.
 * @param {string} name
 */
export function setPresenceName(name) {
  _desiredName = typeof name === "string" ? name.slice(0, 32) : null;
  if (_connected && _desiredName) {
    send({ type: "join", name: _desiredName });
  }
}

/**
 * Get the current peer map (excludes self).
 * @returns {Map<string, { name: string, lng: number, lat: number, alt: number, heading: number, color: string }>}
 */
export function getPresencePeers() {
  return _peers;
}

/**
 * Register a callback that fires whenever the peer list changes.
 * @param {(peers: Map) => void} fn
 */
export function onPeersChanged(fn) {
  if (typeof fn === "function") _listeners.push(fn);
}

/**
 * Check whether the client is currently connected.
 * @returns {boolean}
 */
export function isPresenceConnected() {
  return _connected;
}

/**
 * Get the local operator's assigned ID.
 * @returns {string|null}
 */
export function getMyPresenceId() {
  return _myId;
}
