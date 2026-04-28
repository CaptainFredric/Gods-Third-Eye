/**
 * God's Eye — Dynamic Audio Engine
 *
 * Synthesized audio via Web Audio API.  No external files required.
 * Every sound is generated procedurally: ambient hum, sonar ping,
 * mechanical click, zoom whoosh, and alert klaxon.
 *
 * Usage:
 *   import { initAudioEngine, sfx } from "./services/audio-engine.js";
 *   initAudioEngine();          // call once after first user gesture
 *   sfx.ping();                 // sonar chirp
 *   sfx.click();                // mechanical click
 *   sfx.zoom();                 // rising whoosh
 *   sfx.alert();                // distant alarm
 *   sfx.type();                 // terminal keystroke
 *   sfx.startAmbient();         // begin looping ambient hum
 *   sfx.stopAmbient();          // fade ambient out
 */

const STORAGE_KEY = "panopticon-earth-audio-enabled";

let ctx = null;
let masterGain = null;
let ambientNodes = null;
let _enabled = false;
let _ready = false;

function getEnabled() {
  try { return localStorage.getItem(STORAGE_KEY) !== "0"; } catch { return true; }
}

function setEnabled(v) {
  _enabled = v;
  try { localStorage.setItem(STORAGE_KEY, v ? "1" : "0"); } catch { /* */ }
  if (masterGain) masterGain.gain.setTargetAtTime(v ? 1 : 0, ctx.currentTime, 0.08);
}

function initAudioEngine() {
  if (_ready) return;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = ctx.createGain();
    masterGain.connect(ctx.destination);
    _enabled = getEnabled();
    masterGain.gain.value = _enabled ? 1 : 0;
    _ready = true;
  } catch {
    _ready = false;
  }
}

function ensureCtx() {
  if (!_ready) initAudioEngine();
  if (ctx?.state === "suspended") ctx.resume().catch(() => {});
  return _ready && _enabled;
}

// ── Ambient Hum ──────────────────────────────────────────────────────────

function startAmbient() {
  if (!ensureCtx() || ambientNodes) return;
  const now = ctx.currentTime;
  // Deep bass drone
  const osc1 = ctx.createOscillator();
  osc1.type = "sine";
  osc1.frequency.value = 42;
  const g1 = ctx.createGain();
  g1.gain.value = 0;
  g1.gain.linearRampToValueAtTime(0.06, now + 3);
  osc1.connect(g1).connect(masterGain);
  osc1.start(now);

  // Sub-harmonic rumble
  const osc2 = ctx.createOscillator();
  osc2.type = "triangle";
  osc2.frequency.value = 28;
  const g2 = ctx.createGain();
  g2.gain.value = 0;
  g2.gain.linearRampToValueAtTime(0.03, now + 4);
  osc2.connect(g2).connect(masterGain);
  osc2.start(now);

  // Slow LFO for subtle pulsation
  const lfo = ctx.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = 0.12;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 4;
  lfo.connect(lfoGain).connect(osc1.frequency);
  lfo.start(now);

  ambientNodes = { osc1, osc2, lfo, g1, g2, lfoGain };
}

function stopAmbient() {
  if (!ambientNodes || !ctx) return;
  const now = ctx.currentTime;
  ambientNodes.g1.gain.linearRampToValueAtTime(0, now + 1.5);
  ambientNodes.g2.gain.linearRampToValueAtTime(0, now + 1.5);
  setTimeout(() => {
    try {
      ambientNodes.osc1.stop();
      ambientNodes.osc2.stop();
      ambientNodes.lfo.stop();
    } catch { /* */ }
    ambientNodes = null;
  }, 2000);
}

// ── Sonar Ping ───────────────────────────────────────────────────────────

function ping() {
  if (!ensureCtx()) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(1800, now);
  osc.frequency.exponentialRampToValueAtTime(3200, now + 0.06);
  osc.frequency.exponentialRampToValueAtTime(1200, now + 0.18);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.12, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
  osc.connect(g).connect(masterGain);
  osc.start(now);
  osc.stop(now + 0.4);
}

// ── Mechanical Click ─────────────────────────────────────────────────────

function click() {
  if (!ensureCtx()) return;
  const now = ctx.currentTime;
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.04), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (data.length * 0.08));
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;

  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 3500;
  bp.Q.value = 2.2;

  const g = ctx.createGain();
  g.gain.setValueAtTime(0.18, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

  src.connect(bp).connect(g).connect(masterGain);
  src.start(now);
}

// ── Zoom Whoosh ──────────────────────────────────────────────────────────

function zoom() {
  if (!ensureCtx()) return;
  const now = ctx.currentTime;
  const dur = 1.2;

  // Noise-based whoosh
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;

  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(200, now);
  lp.frequency.exponentialRampToValueAtTime(4000, now + dur * 0.55);
  lp.frequency.exponentialRampToValueAtTime(300, now + dur);

  const g = ctx.createGain();
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(0.08, now + dur * 0.35);
  g.gain.linearRampToValueAtTime(0, now + dur);

  src.connect(lp).connect(g).connect(masterGain);
  src.start(now);
  src.stop(now + dur + 0.1);

  // Tonal rise
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(120, now);
  osc.frequency.exponentialRampToValueAtTime(800, now + dur * 0.6);
  osc.frequency.exponentialRampToValueAtTime(200, now + dur);
  const gOsc = ctx.createGain();
  gOsc.gain.setValueAtTime(0, now);
  gOsc.gain.linearRampToValueAtTime(0.025, now + dur * 0.4);
  gOsc.gain.linearRampToValueAtTime(0, now + dur);
  osc.connect(gOsc).connect(masterGain);
  osc.start(now);
  osc.stop(now + dur + 0.1);
}

// ── Alert Klaxon ─────────────────────────────────────────────────────────

function alert() {
  if (!ensureCtx()) return;
  const now = ctx.currentTime;

  for (let i = 0; i < 3; i++) {
    const t = now + i * 0.28;
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.setValueAtTime(480, t);
    osc.frequency.setValueAtTime(380, t + 0.12);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.06, t + 0.02);
    g.gain.linearRampToValueAtTime(0.04, t + 0.12);
    g.gain.linearRampToValueAtTime(0, t + 0.24);

    // Muffle it to sound distant
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 900;

    osc.connect(g).connect(lp).connect(masterGain);
    osc.start(t);
    osc.stop(t + 0.26);
  }
}

// ── Terminal Keystroke ────────────────────────────────────────────────────

function typeKey() {
  if (!ensureCtx()) return;
  const now = ctx.currentTime;
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.015), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (data.length * 0.15));
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;

  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 2000;

  const g = ctx.createGain();
  g.gain.setValueAtTime(0.1, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.025);

  src.connect(hp).connect(g).connect(masterGain);
  src.start(now);
}

// ── Panel Open — soft ascending chime ────────────────────────────────────

function panelOpen() {
  if (!ensureCtx()) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(600, now);
  osc.frequency.exponentialRampToValueAtTime(1200, now + 0.12);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.06, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
  osc.connect(g).connect(masterGain);
  osc.start(now);
  osc.stop(now + 0.2);
}

// ── Panel Close — soft descending tone ───────────────────────────────────

function panelClose() {
  if (!ensureCtx()) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(1000, now);
  osc.frequency.exponentialRampToValueAtTime(500, now + 0.12);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.05, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
  osc.connect(g).connect(masterGain);
  osc.start(now);
  osc.stop(now + 0.18);
}

// ── Toggle On — quick bright blip ────────────────────────────────────────

function toggleOn() {
  if (!ensureCtx()) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(880, now);
  osc.frequency.exponentialRampToValueAtTime(1320, now + 0.05);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.07, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
  osc.connect(g).connect(masterGain);
  osc.start(now);
  osc.stop(now + 0.1);
}

// ── Toggle Off — quick dim blip ──────────────────────────────────────────

function toggleOff() {
  if (!ensureCtx()) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(880, now);
  osc.frequency.exponentialRampToValueAtTime(550, now + 0.05);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.06, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
  osc.connect(g).connect(masterGain);
  osc.start(now);
  osc.stop(now + 0.1);
}

// ── Notify — soft two-tone chime for toasts ──────────────────────────────

function notify() {
  if (!ensureCtx()) return;
  const now = ctx.currentTime;
  [0, 0.08].forEach((offset, i) => {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = i === 0 ? 1047 : 1319;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.05, now + offset);
    g.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.12);
    osc.connect(g).connect(masterGain);
    osc.start(now + offset);
    osc.stop(now + offset + 0.14);
  });
}

// ── Success — pleasant ascending triad ───────────────────────────────────

function success() {
  if (!ensureCtx()) return;
  const now = ctx.currentTime;
  [523, 659, 784].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now + i * 0.07);
    g.gain.linearRampToValueAtTime(0.05, now + i * 0.07 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.07 + 0.18);
    osc.connect(g).connect(masterGain);
    osc.start(now + i * 0.07);
    osc.stop(now + i * 0.07 + 0.2);
  });
}

// ── Zoom Tick — subtle tick for scroll-wheel zoom ────────────────────────

let _lastZoomTick = 0;
function zoomTick() {
  if (!ensureCtx()) return;
  const now = performance.now();
  if (now - _lastZoomTick < 120) return; // throttle: max ~8 per second
  _lastZoomTick = now;
  const t = ctx.currentTime;
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.02), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (data.length * 0.12));
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 2800;
  bp.Q.value = 1.5;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.04, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
  src.connect(bp).connect(g).connect(masterGain);
  src.start(t);
}

// ── Public API ───────────────────────────────────────────────────────────

export const sfx = {
  ping,
  click,
  zoom,
  alert,
  type: typeKey,
  panelOpen,
  panelClose,
  toggleOn,
  toggleOff,
  notify,
  success,
  zoomTick,
  startAmbient: startAmbient,
  stopAmbient: stopAmbient
};

export { initAudioEngine, setEnabled as setAudioEnabled, getEnabled as isAudioEnabled };
