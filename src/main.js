import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { gstime, sunPos, jday, json2satrec, propagate, eciToGeodetic, degreesLat, degreesLong } from 'satellite.js';
import { createEarth, createStars } from './earth.js';
import { createSatPoints } from './satellites.js';
import { loadStarlink } from './data.js';
import './style.css';

const $ = (id) => document.getElementById(id);
const R_EARTH = 6371;
const NEWEST_LAUNCHES = 6;
const COLOR_BASE = [0.74, 0.84, 1.0];
const COLOR_FRESH = [1.0, 0.66, 0.24];
const COLOR_SEL = [0.3, 1.0, 0.76];

// ---------- scene ----------
const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.01, 500);
const controls = new OrbitControls(camera, canvas);
Object.assign(controls, {
  enableDamping: true, dampingFactor: 0.06, enablePan: false,
  minDistance: 1.2, maxDistance: 14, rotateSpeed: 0.5, zoomSpeed: 0.8,
  autoRotate: true, autoRotateSpeed: 0.25,
});
controls.addEventListener('start', () => { controls.autoRotate = false; $('hint')?.classList.add('gone'); });

const sunDir = new THREE.Vector3(1, 0, 0);
const { group: earthGroup, earth } = createEarth(sunDir);
scene.add(earthGroup, createStars());

// ---------- time ----------
const clock = { base: Date.now(), real: performance.now(), speed: 1 };
const simNow = () => clock.base + (performance.now() - clock.real) * clock.speed;
function setSpeed(speed, resetToNow = false) {
  clock.base = resetToNow ? Date.now() : simNow();
  clock.real = performance.now();
  clock.speed = speed;
  document.querySelectorAll('.speeds button').forEach((b) => b.classList.toggle('on', +b.dataset.speed === speed));
}
document.querySelectorAll('.speeds button').forEach((b) => b.addEventListener('click', () => setSpeed(+b.dataset.speed)));
$('now').addEventListener('click', () => setSpeed(1, true));

function updateSunAndEarth(t) {
  const d = new Date(t);
  const s = sunPos(jday(d)).rsun;
  sunDir.set(s.x, s.z, -s.y).normalize();
  earth.rotation.y = gstime(d);
}

// ---------- satellites ----------
let sats = null;
let state = null;
let data = null;
let meta = [];
const worker = new Worker(new URL('./propagator.worker.js', import.meta.url), { type: 'module' });
const requestStep = () => worker.postMessage({ type: 'step', t: simNow() + (state ? state.ms * clock.speed : 0) });

worker.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'ready') requestStep();
  else if (m.type === 'state') {
    if (!state) $('loading').classList.add('done');
    state = m;
    requestStep();
  }
};

function launchKey(id) { return (id || '').slice(0, 8); } // "2026-187B" -> "2026-187"

async function init() {
  data = await loadStarlink();
  const fi = Object.fromEntries(data.fields.map((f, i) => [f, i]));
  data.fi = fi;
  meta = data.rows.map((r) => ({
    name: r[fi.OBJECT_NAME], id: r[fi.OBJECT_ID], norad: r[fi.NORAD_CAT_ID],
    inc: r[fi.INCLINATION], period: 1440 / r[fi.MEAN_MOTION], launch: launchKey(r[fi.OBJECT_ID]),
  }));

  // Newest launch groups by international designator (year-launch number).
  const keys = [...new Set(meta.map((m) => m.launch))].filter((k) => /^\d{4}-\d{3}$/.test(k)).sort().reverse();
  const fresh = new Set(keys.slice(0, NEWEST_LAUNCHES));
  sats = createSatPoints(meta.length);
  let nFresh = 0;
  meta.forEach((m, i) => {
    m.fresh = fresh.has(m.launch);
    if (m.fresh) nFresh++;
    sats.col.set(m.fresh ? COLOR_FRESH : COLOR_BASE, i * 3);
    sats.size[i] = m.fresh ? 1.7 : 1;
  });
  sats.baseSize = sats.size.slice();
  scene.add(sats.points);
  $('fresh-label').textContent = `Newest ${fresh.size} launches`;
  $('n-fresh').textContent = nFresh.toLocaleString('en-US');
  $('n-base').textContent = (meta.length - nFresh).toLocaleString('en-US');
  const age = data.fetchedAt ? Math.max(0, Math.round((Date.now() - Date.parse(data.fetchedAt)) / 3600e3)) : null;
  $('dataline').textContent = data.source === 'snapshot'
    ? `Snapshot data${age != null ? ` · ${age}h old` : ''}`
    : 'Live CelesTrak data';
  worker.postMessage({ type: 'init', fields: data.fields, rows: data.rows });
}

function updateSatPositions(t) {
  if (!sats || !state) return;
  const dt = (t - state.t) / 1000;
  const { pos, vel, alt } = state;
  const out = sats.pos;
  for (let i = 0, n = alt.length; i < n; i++) {
    const k = i * 3;
    if (alt[i] < 0) { out[k] = out[k + 1] = out[k + 2] = 0; continue; } // hidden inside Earth
    out[k] = pos[k] + vel[k] * dt;
    out[k + 1] = pos[k + 1] + vel[k + 1] * dt;
    out[k + 2] = pos[k + 2] + vel[k + 2] * dt;
  }
  sats.geometry.attributes.position.needsUpdate = true;
}

// ---------- picking ----------
const vp = new THREE.Matrix4();
function pick(cx, cy, radiusPx) {
  if (!sats || !state) return -1;
  vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const e = vp.elements, p = sats.pos, w = innerWidth, h = innerHeight;
  const C = camera.position, cc = C.lengthSq() - 1;
  let best = -1, bestD = radiusPx * radiusPx;
  for (let i = 0, n = state.alt.length; i < n; i++) {
    if (state.alt[i] < 0) continue;
    const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
    const cw = e[3] * x + e[7] * y + e[11] * z + e[15];
    if (cw <= 0) continue;
    const sx = ((e[0] * x + e[4] * y + e[8] * z + e[12]) / cw * 0.5 + 0.5) * w;
    const sy = (0.5 - (e[1] * x + e[5] * y + e[9] * z + e[13]) / cw * 0.5) * h;
    const d2 = (sx - cx) ** 2 + (sy - cy) ** 2;
    if (d2 >= bestD) continue;
    // Skip satellites hidden behind the Earth (ray-sphere test).
    const dx = x - C.x, dy = y - C.y, dz = z - C.z, len = Math.hypot(dx, dy, dz);
    const b = (C.x * dx + C.y * dy + C.z * dz) / len, disc = b * b - cc;
    if (disc > 0 && -b - Math.sqrt(disc) > 0 && -b - Math.sqrt(disc) < len) continue;
    best = i; bestD = d2;
  }
  return best;
}

let hovered = -1, selected = -1, selRec = null;
const pointer = { x: 0, y: 0, moved: false, down: null, mouse: false };
canvas.addEventListener('pointermove', (e) => {
  pointer.x = e.clientX; pointer.y = e.clientY; pointer.moved = true; pointer.mouse = e.pointerType === 'mouse';
});
canvas.addEventListener('pointerleave', () => setHover(-1));
canvas.addEventListener('pointerdown', (e) => (pointer.down = { x: e.clientX, y: e.clientY }));
canvas.addEventListener('pointerup', (e) => {
  if (!pointer.down) return;
  const moved = Math.hypot(e.clientX - pointer.down.x, e.clientY - pointer.down.y);
  pointer.down = null;
  if (moved > 6) return;
  select(pick(e.clientX, e.clientY, e.pointerType === 'mouse' ? 14 : 26));
});
$('close').addEventListener('click', () => select(-1));
addEventListener('keydown', (e) => e.key === 'Escape' && select(-1));

function paint(i) {
  if (i < 0) return;
  const m = meta[i];
  const isSel = i === selected, isHov = i === hovered;
  sats.col.set(isSel ? COLOR_SEL : isHov ? [1, 1, 1] : m.fresh ? COLOR_FRESH : COLOR_BASE, i * 3);
  sats.size[i] = isSel ? 4 : isHov ? 3.2 : sats.baseSize[i];
  sats.geometry.attributes.color.needsUpdate = true;
  sats.geometry.attributes.size.needsUpdate = true;
}

function setHover(i) {
  if (i === hovered) return;
  const prev = hovered; hovered = i;
  paint(prev); paint(i);
  canvas.style.cursor = i >= 0 ? 'pointer' : '';
  $('tip').hidden = i < 0 || i === selected;
  if (i >= 0) $('tip').textContent = meta[i].name;
}

function select(i) {
  const prev = selected; selected = i;
  paint(prev); paint(i);
  document.body.classList.toggle('has-info', i >= 0);
  $('info').hidden = i < 0;
  trail.visible = i >= 0;
  selRec = null;
  if (i < 0) return;
  const row = data.rows[i], o = {};
  data.fields.forEach((f, k) => (o[f] = row[k]));
  selRec = json2satrec(o);
  const m = meta[i];
  const kick = $('i-launch');
  kick.textContent = m.fresh ? `New launch · ${m.launch}` : `Launch ${m.launch}`;
  kick.classList.toggle('fresh', m.fresh);
  $('i-name').textContent = m.name;
  $('i-sub').textContent = `NORAD ${m.norad} · COSPAR ${m.id}`;
  $('i-inc').textContent = `${m.inc.toFixed(1)}°`;
  $('i-period').textContent = `${m.period.toFixed(1)} min`;
  $('tip').hidden = true;
  trailT = -Infinity;
  updateInfo(simNow(), true);
}

// ---------- orbit trail for the selected satellite ----------
const TRAIL_N = 360;
const trailGeo = new THREE.BufferGeometry();
trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_N * 3), 3));
const trailCol = new Float32Array(TRAIL_N * 3);
for (let k = 0; k < TRAIL_N; k++) {
  const a = Math.pow(k / (TRAIL_N - 1), 1.6);
  trailCol.set([COLOR_SEL[0] * a, COLOR_SEL[1] * a, COLOR_SEL[2] * a], k * 3);
}
trailGeo.setAttribute('color', new THREE.BufferAttribute(trailCol, 3));
const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
trail.frustumCulled = false;
trail.visible = false;
scene.add(trail);
let trailT = -Infinity;

function updateTrail(t) {
  if (!selRec) return;
  const periodMs = meta[selected].period * 60000;
  if (Math.abs(t - trailT) < periodMs / TRAIL_N) return;
  trailT = t;
  const arr = trailGeo.attributes.position.array;
  for (let k = 0; k < TRAIL_N; k++) {
    const pv = propagate(selRec, new Date(t - periodMs * (1 - k / (TRAIL_N - 1))));
    const p = pv && pv.position;
    if (!p) continue;
    arr[k * 3] = p.x / R_EARTH; arr[k * 3 + 1] = p.z / R_EARTH; arr[k * 3 + 2] = -p.y / R_EARTH;
  }
  trailGeo.attributes.position.needsUpdate = true;
}

let lastInfo = 0;
function updateInfo(t, force) {
  if (!selRec || (!force && performance.now() - lastInfo < 150)) return;
  lastInfo = performance.now();
  const d = new Date(t);
  const pv = propagate(selRec, d);
  if (!pv) return;
  const g = eciToGeodetic(pv.position, gstime(d));
  const v = pv.velocity;
  $('i-alt').textContent = `${Math.round(g.height).toLocaleString('en-US')} km`;
  $('i-speed').textContent = `${Math.round(Math.hypot(v.x, v.y, v.z) * 3600).toLocaleString('en-US')} km/h`;
  const lat = degreesLat(g.latitude), lon = degreesLong(g.longitude);
  $('i-latlon').textContent = `${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(2)}° ${lon >= 0 ? 'E' : 'W'}`;
}

// ---------- HUD ----------
let lastHud = 0;
const pad = (n) => String(n).padStart(2, '0');
function updateHud(t) {
  if (performance.now() - lastHud < 250) return;
  lastHud = performance.now();
  const d = new Date(t);
  $('clock').textContent = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}  ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
  if (state) $('count').textContent = state.valid.toLocaleString('en-US');
}

// ---------- camera start: frame the day/night terminator ----------
updateSunAndEarth(simNow());
{
  const dir = sunDir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -1.15);
  dir.y = 0.32; dir.normalize();
  camera.position.copy(dir.multiplyScalar(innerWidth < 760 ? 5.4 : 3.6));
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

renderer.setAnimationLoop(() => {
  const t = simNow();
  updateSunAndEarth(t);
  updateSatPositions(t);
  controls.update();
  if (pointer.mouse && pointer.moved && !pointer.down) {
    pointer.moved = false;
    setHover(pick(pointer.x, pointer.y, 12));
    if (hovered >= 0) { $('tip').style.left = pointer.x + 'px'; $('tip').style.top = pointer.y + 'px'; }
  }
  updateTrail(t);
  updateInfo(t);
  updateHud(t);
  renderer.render(scene, camera);
});

init().catch((err) => {
  console.error(err);
  $('loading').textContent = 'Could not load satellite data';
});

// Hooks for automated checks.
window.__debug = () => ({ valid: state?.valid ?? 0, workerMs: state?.ms, first: sats ? Array.from(sats.pos.slice(0, 6)) : null, source: data?.source });
window.__selectBest = () => {
  // pick the on-screen satellite nearest the screen center-right
  const i = pick(innerWidth * 0.5, innerHeight * 0.45, 400);
  select(i);
  return i >= 0 ? meta[i].name : null;
};
window.__selectFresh = () => {
  for (let r = 60; r < 900; r += 60) {
    for (let a = 0; a < 6.28; a += 0.4) {
      const i = pick(innerWidth / 2 + Math.cos(a) * r, innerHeight / 2 + Math.sin(a) * r, 20);
      if (i >= 0 && meta[i].fresh) { select(i); return meta[i].name; }
    }
  }
  return null;
};
