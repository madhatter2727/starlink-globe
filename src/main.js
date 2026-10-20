import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { gstime, sunPos, jday } from 'satellite.js';
import { createEarth, createStars } from './earth.js';
import { createSatPoints } from './satellites.js';
import { loadStarlink } from './data.js';
import './style.css';

// ---------- scene ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.01, 500);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.enablePan = false;
controls.minDistance = 1.25;
controls.maxDistance = 14;
controls.rotateSpeed = 0.5;
controls.zoomSpeed = 0.8;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.25;
controls.addEventListener('start', () => (controls.autoRotate = false));

const sunDir = new THREE.Vector3(1, 0, 0);
const { group: earthGroup, earth } = createEarth(sunDir);
scene.add(earthGroup, createStars());

// ---------- time ----------
const clock = { base: Date.now(), real: performance.now(), speed: 1 };
const simNow = () => clock.base + (performance.now() - clock.real) * clock.speed;

function updateSunAndEarth(t) {
  const d = new Date(t);
  const jd = jday(d);
  const s = sunPos(jd).rsun;
  sunDir.set(s.x, s.z, -s.y).normalize();
  earth.rotation.y = gstime(d);
}

// ---------- satellites ----------
let sats = null;      // { points, pos, col, size }
let state = null;     // last worker result
let meta = [];        // per-sat info
const worker = new Worker(new URL('./propagator.worker.js', import.meta.url), { type: 'module' });

function requestStep() {
  const lead = state ? state.ms * clock.speed : 0;
  worker.postMessage({ type: 'step', t: simNow() + lead });
}

worker.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'ready') requestStep();
  else if (m.type === 'state') {
    state = m;
    if (!window.__firstState) { window.__firstState = true; document.getElementById('loading').classList.add('done'); }
    requestStep();
  }
};

async function init() {
  const data = await loadStarlink();
  const fi = Object.fromEntries(data.fields.map((f, i) => [f, i]));
  meta = data.rows.map((r) => ({ name: r[fi.OBJECT_NAME], id: r[fi.OBJECT_ID], norad: r[fi.NORAD_CAT_ID] }));
  sats = createSatPoints(meta.length);
  sats.col.fill(0);
  for (let i = 0; i < meta.length; i++) sats.col.set([0.78, 0.88, 1.0], i * 3);
  scene.add(sats.points);
  worker.postMessage({ type: 'init', fields: data.fields, rows: data.rows });
  window.__data = { source: data.source, count: meta.length };
}

function updateSatPositions(t) {
  if (!sats || !state) return;
  const dt = (t - state.t) / 1000;
  const { pos, vel, alt } = state;
  const out = sats.pos;
  for (let i = 0, n = alt.length; i < n; i++) {
    const k = i * 3;
    if (alt[i] < 0) { out[k] = out[k + 1] = out[k + 2] = 0; continue; }
    out[k] = pos[k] + vel[k] * dt;
    out[k + 1] = pos[k + 1] + vel[k + 1] * dt;
    out[k + 2] = pos[k + 2] + vel[k + 2] * dt;
  }
  sats.geometry.attributes.position.needsUpdate = true;
}

// ---------- camera start: show the terminator ----------
updateSunAndEarth(simNow());
{
  const dir = sunDir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -0.9);
  dir.y = 0.35; dir.normalize();
  camera.position.copy(dir.multiplyScalar(innerWidth < 700 ? 5.2 : 3.7));
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
  renderer.render(scene, camera);
});

init().catch((err) => {
  console.error(err);
  document.getElementById('loading').textContent = 'Could not load satellite data';
});

// Lightweight hook for automated checks.
window.__debug = () => ({ valid: state?.valid ?? 0, workerMs: state?.ms, first: sats ? Array.from(sats.pos.slice(0, 6)) : null, source: window.__data?.source });
