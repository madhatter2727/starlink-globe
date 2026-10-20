// Fetch a fresh CelesTrak snapshot into public/data/starlink.json.
// Usage: node scripts/snapshot.mjs [--soft] [--from file.json]
// --soft: keep the existing snapshot if the fetch fails (used during builds).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { compact, fetchCelestrak } from '../api/_compact.js';

const out = new URL('../public/data/starlink.json', import.meta.url);
const args = process.argv.slice(2);
const soft = args.includes('--soft');
const fromIdx = args.indexOf('--from');

try {
  // Respect CelesTrak's rate guidance: skip if the snapshot is < 2h old.
  const prev = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : null;
  if (fromIdx < 0 && prev && Date.now() - Date.parse(prev.fetchedAt) < 2 * 3600e3) {
    console.log('snapshot is fresh (<2h), skipping fetch');
    process.exit(0);
  }
  const records = fromIdx >= 0
    ? JSON.parse(readFileSync(args[fromIdx + 1], 'utf8'))
    : await fetchCelestrak();
  const data = compact(records, 'snapshot');
  writeFileSync(out, JSON.stringify(data));
  console.log(`snapshot: ${data.count} satellites`);
} catch (err) {
  if (soft && existsSync(out)) {
    console.warn('snapshot fetch failed, keeping existing:', err.message);
  } else {
    console.error(err);
    process.exit(1);
  }
}
