// Load Starlink GP data: our cached proxy first, then CelesTrak directly
// (it allows CORS), then the snapshot bundled at build time.
import { FIELDS } from '../api/_compact.js';

const LS_KEY = 'starlink-gp-v1';
const TWO_HOURS = 2 * 3600e3;

function fromRecords(records, source) {
  return { source, fetchedAt: new Date().toISOString(), fields: FIELDS, rows: records.map((r) => FIELDS.map((f) => r[f])) };
}

async function getJSON(url, ms = 12000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function valid(d) {
  return d && Array.isArray(d.rows) && d.rows.length > 100 && Array.isArray(d.fields);
}

export async function loadStarlink() {
  // 1. Our own Vercel function (cached for 2h at the edge).
  try {
    const d = await getJSON('/api/starlink');
    if (valid(d)) return { ...d, source: 'live' };
  } catch (e) { console.info('proxy unavailable, trying CelesTrak directly'); }

  // 2. CelesTrak directly, at most once per 2h per browser.
  try {
    const cached = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (valid(cached) && Date.now() - Date.parse(cached.fetchedAt) < TWO_HOURS) {
      return { ...cached, source: 'live' };
    }
    const recs = await getJSON('https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=json');
    if (Array.isArray(recs) && recs.length > 100) {
      const d = fromRecords(recs, 'live');
      try { localStorage.setItem(LS_KEY, JSON.stringify(d)); } catch {}
      return d;
    }
  } catch (e) { console.info('CelesTrak unavailable, using bundled snapshot'); }

  // 3. Snapshot bundled with the site.
  const d = await getJSON('/data/starlink.json', 30000);
  return { ...d, source: 'snapshot' };
}
