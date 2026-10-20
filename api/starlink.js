// Proxies and caches CelesTrak's Starlink GP data.
// The CDN caches for 2 hours (CelesTrak updates GP data about that often and asks
// clients not to refetch more frequently), plus a warm in-memory copy per instance.
import { compact, fetchCelestrak } from './_compact.js';

const TWO_HOURS = 2 * 60 * 60 * 1000;
let cache = null; // { body, at }

export default async function handler(req, res) {
  try {
    if (!cache || Date.now() - cache.at > TWO_HOURS) {
      const data = compact(await fetchCelestrak(), 'celestrak-live');
      cache = { body: JSON.stringify(data), at: Date.now() };
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=900, s-maxage=7200, stale-while-revalidate=86400');
    res.status(200).send(cache.body);
  } catch (err) {
    if (cache) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=600');
      return res.status(200).send(cache.body);
    }
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: String(err.message || err) });
  }
}
