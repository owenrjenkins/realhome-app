// Minimal API: verifies pins by travel time before returning
require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parse/sync');
const axios = require('axios');
const LRU = require('lru-cache');

const app = express();
app.use(express.json({ limit: '2mb' }));

const PORT = process.env.PORT || 5179;
const GOOGLE_KEY = process.env.GOOGLE_MAPS_SERVER_KEY;
const CSV_PATH = process.env.PROPERTIES_CSV_PATH;

if (!GOOGLE_KEY) {
  console.error('GOOGLE_MAPS_SERVER_KEY missing in server/.env');
  process.exit(1);
}
if (!CSV_PATH) {
  console.error('PROPERTIES_CSV_PATH missing in server/.env');
  process.exit(1);
}

// --- Load properties into memory ---
let PROPS = [];
(function loadCSV() {
  const fullPath = path.isAbsolute(CSV_PATH) ? CSV_PATH : path.join(__dirname, CSV_PATH);
  if (!fs.existsSync(fullPath)) {
    console.error(`CSV not found at: ${fullPath}`);
    process.exit(1);
  }
  const buf = fs.readFileSync(fullPath);
  const rows = csv.parse(buf, { columns: true, skip_empty_lines: true });
  PROPS = rows
    .map(r => ({
      id: String(r.id ?? '').trim() || `${r.latitude},${r.longitude}`,
      address: String(r.address ?? '').trim(),
      postcode: String(r.postcode ?? '').trim(),
      price: Number(r.price),
      bedrooms: Number(r.bedrooms),
      lat: Number(r.latitude),
      lng: Number(r.longitude)
    }))
    .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  console.log(`Loaded ${PROPS.length} properties from CSV`);
})();

// --- Utils ---
const toRad = d => (d * Math.PI) / 180;
function haversineKm(a, b) {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s1 = Math.sin(dLat / 2) ** 2;
  const s2 = Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s1 + s2));
}
const SPEED_KMH = { driving: 45, transit: 30, bicycling: 15, walking: 5 };

// Cache Distance Matrix results
const dmCache = new LRU({ max: 50000, ttl: 1000 * 60 * 30 }); // 30 minutes

async function getDurationsSeconds(origin, destinations, mode = 'driving') {
  // Batch size of 25 dests per request
  const BATCH = 25;
  const out = new Array(destinations.length).fill(null);

  for (let i = 0; i < destinations.length; i += BATCH) {
    const slice = destinations.slice(i, i + BATCH);

    // Fill from cache
    const needIdx = [];
    const needDests = [];
    slice.forEach((d, idx) => {
      const key = `${origin.lat.toFixed(6)},${origin.lng.toFixed(6)}|${d.lat.toFixed(6)},${d.lng.toFixed(6)}|${mode}`;
      const cached = dmCache.get(key);
      if (cached != null) {
        out[i + idx] = cached;
      } else {
        needIdx.push(idx);
        needDests.push(d);
      }
    });

    if (needDests.length === 0) continue;

    const url = 'https://maps.googleapis.com/maps/api/distancematrix/json';
    const destStr = needDests.map(d => `${d.lat},${d.lng}`).join('|');

    // simple retry for rate limits
    let attempt = 0;
    while (true) {
      try {
        const resp = await axios.get(url, {
          params: {
            key: GOOGLE_KEY,
            mode,
            units: 'metric',
            departure_time: 'now',
            origins: `${origin.lat},${origin.lng}`,
            destinations: destStr
          },
          timeout: 10000,
          validateStatus: () => true
        });

        if (resp.data.status !== 'OK') {
          if (resp.data.status === 'OVER_QUERY_LIMIT' || resp.status === 429) {
            throw new Error('RATE_LIMIT');
          }
          // mark as nulls and move on
          needIdx.forEach(idx => { out[i + idx] = null; });
          break;
        }

        const row = resp.data.rows?.[0];
        if (!row?.elements) {
          needIdx.forEach(idx => { out[i + idx] = null; });
          break;
        }

        row.elements.forEach((el, j) => {
          const absIdx = i + needIdx[j];
          if (el.status === 'OK') {
            const seconds = el.duration.value;
            out[absIdx] = seconds;
            const dest = needDests[j];
            const key = `${origin.lat.toFixed(6)},${origin.lng.toFixed(6)}|${dest.lat.toFixed(6)},${dest.lng.toFixed(6)}|${mode}`;
            dmCache.set(key, seconds);
          } else {
            out[absIdx] = null;
          }
        });
        break; // done with this batch
      } catch (e) {
        if (e.message === 'RATE_LIMIT') {
          attempt += 1;
          const backoff = Math.min(12000, 600 * 2 ** attempt);
          await new Promise(r => setTimeout(r, backoff));
          continue;
        }
        // hard error, nulls for this batch
        needIdx.forEach(idx => { out[i + idx] = null; });
        break;
      }
    }
  }
  return out;
}

// POST /api/properties/travel-filter
// Body: { origin:{lat,lng}, mode, maxMins, filters:{priceMin,priceMax,bedroomsMin,bedroomsMax} }
app.post('/api/properties/travel-filter', async (req, res) => {
  try {
    const { origin, mode = 'driving', maxMins = 45, filters = {} } = req.body || {};
    if (!origin || !Number.isFinite(origin.lat) || !Number.isFinite(origin.lng)) {
      return res.status(400).json({ error: 'origin.lat/lng required' });
    }
    const maxSecs = (Number(maxMins) || 45) * 60;

    // 1) static filters
    let base = PROPS;
    if (filters.priceMin != null) base = base.filter(p => p.price >= Number(filters.priceMin));
    if (filters.priceMax != null) base = base.filter(p => p.price <= Number(filters.priceMax));
    if (filters.bedroomsMin != null) base = base.filter(p => p.bedrooms >= Number(filters.bedroomsMin));
    if (filters.bedroomsMax != null) base = base.filter(p => p.bedrooms <= Number(filters.bedroomsMax));

    // 2) radius pre-filter based on conservative speed
    const speed = SPEED_KMH[mode] || SPEED_KMH.driving;
    const radiusKm = Math.max(1, (speed * maxSecs) / 3600);
    const pre = base.filter(p => haversineKm(origin, { lat: p.lat, lng: p.lng }) <= radiusKm);

    // 3) cap candidates to nearest N by crow-fly, to keep latency sane
    const MAX_CANDIDATES = 1000;
    let candidates = pre;
    if (pre.length > MAX_CANDIDATES) {
      candidates = pre
        .map(p => ({ p, d: haversineKm(origin, { lat: p.lat, lng: p.lng }) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, MAX_CANDIDATES)
        .map(x => x.p);
    }

    // 4) batch Distance Matrix and keep those <= maxSecs
    const dests = candidates.map(c => ({ lat: c.lat, lng: c.lng }));
    const secs = await getDurationsSeconds(origin, dests, mode);
    const passed = [];
    for (let i = 0; i < candidates.length; i++) {
      const dur = secs[i];
      if (dur != null && dur <= maxSecs) {
        passed.push({ ...candidates[i], travelSeconds: dur });
      }
    }

    res.json({ total: PROPS.length, considered: candidates.length, matched: passed.length, items: passed });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server_error' });
  }
});

app.listen(PORT, () => console.log(`API on http://localhost:${PORT}`));
