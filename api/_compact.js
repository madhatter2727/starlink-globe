// Shared by the snapshot script and the /api/starlink proxy.
export const CELESTRAK_URL =
  'https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=json';

export const FIELDS = [
  'OBJECT_NAME', 'OBJECT_ID', 'EPOCH', 'MEAN_MOTION', 'ECCENTRICITY',
  'INCLINATION', 'RA_OF_ASC_NODE', 'ARG_OF_PERICENTER', 'MEAN_ANOMALY',
  'NORAD_CAT_ID', 'BSTAR', 'MEAN_MOTION_DOT', 'MEAN_MOTION_DDOT',
];

// Turn CelesTrak's OMM JSON into a compact {fields, rows} table (~3x smaller).
export function compact(records, source) {
  if (!Array.isArray(records) || records.length < 100) {
    throw new Error('Unexpected CelesTrak response');
  }
  return {
    source,
    fetchedAt: new Date().toISOString(),
    count: records.length,
    fields: FIELDS,
    rows: records.map((r) => FIELDS.map((f) => r[f])),
  };
}

export async function fetchCelestrak() {
  const res = await fetch(CELESTRAK_URL, {
    headers: { 'User-Agent': 'starlink-globe (github.com/madhatter2727/starlink-globe)' },
  });
  if (!res.ok) throw new Error(`CelesTrak HTTP ${res.status}`);
  const text = await res.text();
  // CelesTrak answers with a plain-text notice when asked too often.
  if (!text.trim().startsWith('[')) throw new Error('CelesTrak: ' + text.slice(0, 120));
  return JSON.parse(text);
}
