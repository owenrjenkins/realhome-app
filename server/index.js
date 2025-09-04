// server/index.js
require('dotenv').config();
const express = require('express');
const fs = require('fs');
const csv = require('csv-parse/sync');
const axios = require('axios');
const LRU = require('lru-cache');
const app = express();

app.use(express.json({ limit: '2mb' }));

const PORT = process.env.PORT || 5179;
const GOOGLE_KEY = process.env.GOOGLE_MAPS_SERVER_KEY;
const CSV_PATH = process.env.PROPERTIES_CSV_PATH;

// --- Load properties into memory ---
let PROPS = [];
(function loadCSV() {
  if (!CSV_PATH) throw new Error('PROPERTIES_CSV_PATH missing');
  const buf = fs.readFileSync(CSV_PATH);
  const rows = csv.parse(buf, { columns: true, skip_empty_lines: true });
  PROPS = rows
    .map(r => ({
      id: r.id,
      address: r.address,
      postcode: r.postcode,
      price: Number(r.price),
      bedrooms: Number(r.bedrooms),
      lat: Number(r.latitude),
      lng: Number(r.longitude),
    }))
    .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  console.log(`Loaded ${PROPS.length} properties`);
})();

// --- Small utils ---
const toRad = d => (d * Math.PI) / 180;
function haversineKm(a, b) {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s1 = Math.sin(dLat / 2) ** 2;
  const s2 = Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s1 + s2));
}

// Conservative average speeds for radius pre-filter
const SPEED_KMH = { driving: 45, transit: 30, bicycling: 15, walking: 5 };

// LRU cache for distance-matrix elements (~50k unique pairs)
const dmCache = new LRU({
  max: 50000,
  ttl: 1000 * 60 * 30, // 30 minutes
});

// --- Distance Matrix in safe batches with backoff ---
async function getDurationsSeconds(origin, destinations, mode = 'driving') {
  // Batch to 25 dests per request, 1 origin -> N dests keeps elements low
  const BATCH = 25;
  const out = new Array(destinations.length).fill(null);

  for (let i = 0; i < destinations.length; i += BATCH) {
    const slice = destinations.slice(i, i + BATCH);

    // Check cache first
    const uncachedIdx = [];
    const paramsList = [];
    slice.forEach((d, idx) => {
      const key = `${origin.lat.toFixed(6)},${origin.lng.toFixed(6)}|${d.lat.toFixed(6)},${d.lng.toFixed(6)}|${mode}`;
      const cached = dmCache.get(key);
      if (cached != null) {
        out[i + idx] = cached;
      } else {
        uncachedIdx.push(idx);
        paramsList.push(d);
      }
    });

    if (paramsList.length === 0) continue;

    // Build destinations string
    const destStr = paramsList.map(d => `${d.lat},${d.lng}`).join('|');

    // Exponential backoff loop on rate limit
    let attempt = 0;
    // departure_time=now helps traffic estimates for driving/transit
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json`;
    while (true) {
      try {
        const resp = await axios.get(url, {
          params: {
            key: GOOGLE_KEY,
            mode,
            units: 'metric',
            departure_time: 'now',
            origins: `${origin.lat},${origin.lng}`,
            destinations: destStr,
          },
          timeout: 10000,
        });
        if (resp.data.status !== 'OK') {
          if (resp.data.status === 'OVER_QUERY_LIMIT' || resp.status === 429) {
            throw new Error('RATE_LIMIT');
          }
          throw new Error(`DM_API_ERROR:${resp.data.status}`);
        }
        const row = resp.data.rows[0];
        if (!row || !row.elements) throw new Error('DM_NO_ROWS');

        row.elements.forEach((el, idx) => {
          const absIdx = i + uncachedIdx[idx];
          if (el.status === 'OK') {
            const seconds = el.duration.value; // duration_in_traffic if you want, with trafficModel
            out[absIdx] = seconds;
            // Write cache
            const dest = paramsList[idx];
            const key = `${origin.lat.toFixed(6)},${origin.lng.toFixed(6)}|${dest.lat.toFixed(6)},${dest.lng.toFixed(6)}|${mode}`;
            dmCache.set(key, seconds);
          } else {
            out[absIdx] = null;
          }
        });
        break; // success for this batch
      } catch (e) {
        if (e.message === 'RATE_LIMIT' || (e.response && e.response.status === 429)) {
          attempt += 1;
          const backoffMs = Math.min(15000, 500 * 2 ** attempt);
          await new Promise(r => setTimeout(r, backoffMs));
          continue;
        }
        // Hard error, mark as nulls and continue
        uncachedIdx.forEach(idx => { out[i + idx] = null; });
        break;
      }
    }
  }
  return out;
}

// --- POST /api/properties/travel-filter ---
// Body: { origin:{lat,lng}, mode, maxMins, filters:{...}, chunkSize?: number }
app.post('/api/properties/travel-filter', async (req, res) => {
  try {
    const { origin, mode = 'driving', maxMins = 45, filters = {}, chunkSize = 400 } = req.body || {};
    if (!origin || !Number.isFinite(origin.lat) || !Number.isFinite(origin.lng)) {
      return res.status(400).json({ error: 'origin.lat/lng required' });
    }
    const maxSecs = maxMins * 60;

    // 1) static filter pass
    let base = PROPS;
    if (filters.priceMin != null) base = base.filter(p => p.price >= Number(filters.priceMin));
    if (filters.priceMax != null) base = base.filter(p => p.price <= Number(filters.priceMax));
    if (filters.bedroomsMin != null) base = base.filter(p => p.bedrooms >= Number(filters.bedroomsMin));
    if (filters.bedroomsMax != null) base = base.filter(p => p.bedrooms <= Number(filters.bedroomsMax));

    // 2) radius pre-filter using conservative speed
    const speed = SPEED_KMH[mode] || SPEED_KMH.driving;
    const radiusKm = Math.max(1, (speed * maxMins) / 60); // never less than 1 km
    const pre = base.filter(p => haversineKm(origin, { lat: p.lat, lng: p.lng }) <= radiusKm);

    // If very large, cap to nearest N by crow-fly distance to keep UX snappy
    const MAX_CANDIDATES = 4000;
    let candidates = pre;
    if (pre.length > MAX_CANDIDATES) {
      candidates = pre
        .map(p => ({ p, d: haversineKm(origin, { lat: p.lat, lng: p.lng }) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, MAX_CANDIDATES)
        .map(x => x.p);
    }

    // 3) process in chunks to stream partial results
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.write('{"chunks":['); // begin streaming JSON array of chunks
    let firstChunk = true;

    for (let i = 0; i < candidates.length; i += chunkSize) {
      const slice = candidates.slice(i, i + chunkSize);
      const dests = slice.map(s => ({ lat: s.lat, lng: s.lng }));
      const secs = await getDurationsSeconds(origin, dests, mode);
      const passed = [];
      for (let j = 0; j < slice.length; j++) {
        const dur = secs[j];
        if (dur != null && dur <= maxSecs) {
          passed.push({ ...slice[j], travelSeconds: dur });
        }
      }
      if (!firstChunk) res.write(',');
      res.write(JSON.stringify(passed));
      firstChunk = false;
      // Flush between chunks
      await new Promise(r => setTimeout(r, 0));
    }

    res.write(']}'); // end chunks array and object
    res.end();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server_error' });
  }
});

app.listen(PORT, () => console.log(`API on http://localhost:${PORT}`));
