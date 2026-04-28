/**
 * presence.js — Lightweight WebSocket presence server for God's Eye.
 *
 * Run:  node server/presence.js
 *
 * Each connected client sends periodic camera/cursor updates.
 * The server rebroadcasts the full presence map to all peers so every
 * client can render colored dots for other operators on the globe.
 *
 * Protocol (JSON over WebSocket):
 *
 *  Client → Server:
 *    { type: "join",   name: "Operator-3" }
 *    { type: "update", lng: 34.5, lat: 24.1, alt: 18500000, heading: 0.25 }
 *    { type: "ping" }
 *
 *  Server → Client:
 *    { type: "welcome", id: "<uuid>", peers: { ... } }
 *    { type: "peers",   peers: { "<id>": { name, lng, lat, alt, heading, color, lastSeen }, ... } }
 *    { type: "join",    id: "<uuid>", peer: { name, color } }
 *    { type: "leave",   id: "<uuid>" }
 *    { type: "pong" }
 */

import { WebSocketServer } from "ws";
import { randomUUID } from "node:crypto";

const PORT = parseInt(process.env.PRESENCE_PORT || "4175", 10);
const STALE_MS = 30_000; // prune after 30 s silence

const COLORS = [
  "#00d2ff", "#ff6d8d", "#7ee0ff", "#af9dff",
  "#ffbe5c", "#61f5c7", "#ff0040", "#c8ff00"
];
let colorIndex = 0;

/** @type {Map<string, { ws: WebSocket, id: string, name: string, lng: number, lat: number, alt: number, heading: number, color: string, lastSeen: number }>} */
const clients = new Map();

function nextColor() {
  const color = COLORS[colorIndex % COLORS.length];
  colorIndex += 1;
  return color;
}

function peersSnapshot() {
  const map = {};
  for (const [id, c] of clients) {
    map[id] = {
      name: c.name,
      lng: c.lng,
      lat: c.lat,
      alt: c.alt,
      heading: c.heading,
      color: c.color,
      lastSeen: c.lastSeen
    };
  }
  return map;
}

function broadcast(data, excludeId) {
  const msg = JSON.stringify(data);
  for (const [id, c] of clients) {
    if (id === excludeId) continue;
    try { c.ws.send(msg); } catch { /* ignore closed sockets */ }
  }
}

function pruneStale() {
  const now = Date.now();
  for (const [id, c] of clients) {
    if (now - c.lastSeen > STALE_MS) {
      c.ws.terminate();
      clients.delete(id);
      broadcast({ type: "leave", id });
    }
  }
}

const wss = new WebSocketServer({ port: PORT });

wss.on("listening", () => {
  console.log(`[Presence] WebSocket server listening on ws://localhost:${PORT}`);
});

wss.on("connection", (ws) => {
  const id = randomUUID();
  const client = {
    ws,
    id,
    name: `Operator-${clients.size + 1}`,
    lng: 0,
    lat: 0,
    alt: 18500000,
    heading: 0,
    color: nextColor(),
    lastSeen: Date.now()
  };
  clients.set(id, client);

  // Welcome with full peer list
  ws.send(JSON.stringify({ type: "welcome", id, peers: peersSnapshot() }));

  // Announce to existing peers
  broadcast({ type: "join", id, peer: { name: client.name, color: client.color } }, id);

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    client.lastSeen = Date.now();

    switch (msg.type) {
      case "join":
        if (typeof msg.name === "string" && msg.name.length > 0 && msg.name.length <= 32) {
          client.name = msg.name.slice(0, 32);
          broadcast({ type: "peers", peers: peersSnapshot() });
        }
        break;

      case "update":
        if (Number.isFinite(msg.lng)) client.lng = msg.lng;
        if (Number.isFinite(msg.lat)) client.lat = msg.lat;
        if (Number.isFinite(msg.alt)) client.alt = msg.alt;
        if (Number.isFinite(msg.heading)) client.heading = msg.heading;
        broadcast({ type: "peers", peers: peersSnapshot() });
        break;

      case "ping":
        try { ws.send(JSON.stringify({ type: "pong" })); } catch { /* */ }
        break;

      default:
        break;
    }
  });

  ws.on("close", () => {
    clients.delete(id);
    broadcast({ type: "leave", id });
  });

  ws.on("error", () => {
    clients.delete(id);
    broadcast({ type: "leave", id });
  });
});

// Periodic stale cleanup
setInterval(pruneStale, 10_000);
