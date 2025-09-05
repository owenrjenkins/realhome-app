// Minimal API for RealHome
// - Loads a CSV of properties
// - Filters by price/beds
// - Pre-filters by crow-fly radius from origin (based on mode speed & max minutes)
// - Verifies travel time with Google Distance Matrix
// - Returns only properties with travelSeconds <= maxMins
//
// ENV (server/.env):
//   PORT=5179
//   GOOGLE_MAPS_SERVER_KEY=xxxx
//   PROPERTIES_CSV_PATH=/absolute/path/to/properties.csv
//
// Start:  node server/index.js

require("dotenv").config();
const express = require("express");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { parse } = require("csv-parse/sync");
const LRU = require("lru-cache");

const app = express();
app.use(express.json({ limit: "2mb" }));

// -----------------------------
// Config
// -----------------------------
const PORT = Number(process.env.PORT || 5179);
const GOOGLE_KEY = process.env.GOOGLE_MAPS_SERVER_KEY;
const CSV_PATH = process.env.PROPERTIES_CSV_PATH;

if (!GOOGLE_KEY) {
  console.warn("[WARN] GOOGLE_MAPS_SERVER_KEY is missing. Distance Matrix calls will fail.");
}
if (!CSV_PATH) {
  console.warn("[WARN] PROPERTIES_CSV_PATH is missing. No properties will be loaded.");
}

// Conservative speeds (km/h) used for crow-fly radius prefilter
const SPEED_KMH = {
  driving: 50,
  transit: 30,
  walking: 5,
  bicycling: 15,
};

// Distance Matrix batching size (destinations per request)
const DM_BATCH = 25; // safe & within common API constraints

// LRU cache for origin|dest|mode -> seconds
const dmCache = new LRU({
  max: 50_000,
  ttl: 1000 * 60 * 60, // 1 hour
});

// -----------------------------
// Utilities
// -----------------------------
function toNum(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : NaN;
}

function haversineKm(a, b) {
  const R = 6371; // km
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const sinDlat = Math.sin(dLat / 2);
  const sinDlng = Math.sin(dLng / 2);
  const x =
    sinDlat * sinDlat + Math.cos(la1) * Math.cos(la2) * sinDlng * sinDlng;
  const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  return R * c;
}

function isValidLatLng(lat, lng) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

// -----------------------------
// CSV load (sync at startup)
// -----------------------------
let PROPS = [];
try {
  if (CSV_PATH && fs.existsSync(CSV_PATH)) {
    const raw = fs.readFileSync(CSV_PATH, "utf8");
    const rows = parse(raw, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    // Expected columns (case-insensitive best-effort):
    // id,address,postcode,price,bedrooms,lat,lng (or lon/longitude)
    PROPS = rows
      .map((r, i) => {
        const id = (r.id ?? String(i + 1)).toString();
        const address = (r.address ?? "").toString();
        const postcode = (r.postcode ?? r.post_code ?? "").toString();
        const price = toNum(r.price ?? r.Price);
        const bedrooms = toNum(r.bedrooms ?? r.beds ?? r.Bedrooms);
        const lat = toNum(r.lat ?? r.latitude ?? r.Latitude);
        const lng =
          toNum(r.lng ?? r.lon ?? r.longitude ?? r.Longitude);

        if (!Number.isFinite(price) || !Number.isFinite(bedrooms)) return null;
        if (!isValidLatLng(lat, lng)) return null;

        return { id, address, postcode, price, bedrooms, lat, lng };
      })
      .filter(Boolean);

    console.log(`[INIT] Loaded ${PROPS.length.toLocaleString()} properties from CSV`);
  } else {
    console.warn("[WARN] CSV not found, PROPS is empty.");
  }
} catch (e) {
  console.error("[ERROR] Failed to load CSV:", e);
  PROPS = [];
}

// -----------------------------
// Distance Matrix - batched, cached
// -----------------------------
async function getDurationsSeconds(origin, dests, mode) {
  // dests: [{lat,lng}]
  // returns: (Array<number|undefined>) aligned to dests
  const out = new Array(dests.length).fill(undefined);

  for (let i = 0; i < dests.length; i += DM_BATCH) {
    const slice = dests.slice(i, i + DM_BATCH);
    const needIdx = [];
    const needDests = [];

    // Use cache first
    slice.forEach((d, idx) => {
      const key = `${origin.lat.toFixed(6)},${origin.lng.toFixed(
        6
      )}|${d.lat.toFixed(6)},${d.lng.toFixed(6)}|${mode}`;
      const cached = dmCache.get(key);
      if (cached != null) {
        out[i + idx] = cached;
      } else {
        needIdx.push(idx);
        needDests.push(d);
      }
    });

    if (needDests.length === 0) continue;

    const url = "https://maps.googleapis.com/maps/api/distancematrix/json";
    const destStr = needDests.map((d) => `${d.lat},${d.lng}`).join("|");

    let attempt = 0;
    while (true) {
      try {
        const resp = await axios.get(url, {
          params: {
            key: GOOGLE_KEY,
            mode,
            units: "metric",
            departure_time: "now",
            origins: `${origin.lat},${origin.lng}`,
            destinations: destStr,
          },
          timeout: 10000,
        });

        if (resp?.data?.rows?.[0]?.elements?.length) {
          resp.data.rows[0].elements.forEach((el, j) => {
            const dest = needDests[j];
            const globalIdx = i + needIdx[j];
            if (el.status === "OK" && el.duration?.value != null) {
              const secs = Number(el.duration.value);
              out[globalIdx] = secs;

              // cache it
              const key = `${origin.lat.toFixed(6)},${origin.lng.toFixed(
                6
              )}|${dest.lat.toFixed(6)},${dest.lng.toFixed(6)}|${mode}`;
              dmCache.set(key, secs);
            } else {
              out[globalIdx] = undefined;
            }
          });
        }
        break; // success -> break retry loop
      } catch (err) {
        // simple backoff for transient errors
        attempt++;
        if (attempt >= 3) {
          console.warn("[DM] failed after retries:", err?.message ?? err);
          // leave undefineds in 'out' for these
          break;
        }
        await new Promise((r) => setTimeout(r, 300 * attempt));
      }
    }
  }

  return out;
}

// -----------------------------
// API route
// -----------------------------
app.post("/api/properties/travel-filter", async (req, res) => {
  try {
    const { origin, mode, maxMins, filters, maxCandidates } = req.body || {};
    if (!origin || !isValidLatLng(Number(origin.lat), Number(origin.lng))) {
      return res.status(400).json({ error: "origin.lat/lng required" });
    }

    const travelMode =
      mode === "walking" ||
      mode === "bicycling" ||
      mode === "transit" ||
      mode === "driving"
        ? mode
        : "driving";

    const maxSecs = (Number(maxMins) || 45) * 60;

    // 1) Static filters
    const f = filters || {};
    let base = PROPS;
    if (f.priceMin != null) base = base.filter((p) => p.price >= Number(f.priceMin));
    if (f.priceMax != null) base = base.filter((p) => p.price <= Number(f.priceMax));
    if (f.bedroomsMin != null) base = base.filter((p) => p.bedrooms >= Number(f.bedroomsMin));
    if (f.bedroomsMax != null) base = base.filter((p) => p.bedrooms <= Number(f.bedroomsMax));

    // 2) Radius pre-filter (crow-fly) based on conservative speed
    const speed = SPEED_KMH[travelMode] || SPEED_KMH.driving;
    const radiusKm = Math.max(1, (speed * maxSecs) / 3600); // km
    const pre = base.filter(
      (p) => haversineKm(origin, { lat: p.lat, lng: p.lng }) <= radiusKm
    );

    // 3) Cap candidates to nearest N by crow-fly (tunable)
    const MAX_CANDIDATES_DEFAULT = 2000;
    const MAX_CANDIDATES_HARD_CAP = 10000;
    const requestedMax = Number(
      maxCandidates ?? req.query.maxCandidates ?? MAX_CANDIDATES_DEFAULT
    );
    const MAX_CANDIDATES = Math.min(
      Math.max(200, requestedMax || MAX_CANDIDATES_DEFAULT),
      MAX_CANDIDATES_HARD_CAP
    );

    let candidates = pre;
    if (pre.length > MAX_CANDIDATES) {
      candidates = pre
        .map((p) => ({
          p,
          d: haversineKm(origin, { lat: p.lat, lng: p.lng }),
        }))
        .sort((a, b) => a.d - b.d)
        .slice(0, MAX_CANDIDATES)
        .map((x) => x.p);
    }

    // 4) Verify with Distance Matrix
    const dests = candidates.map((c) => ({ lat: c.lat, lng: c.lng }));
    const secs = await getDurationsSeconds(
      { lat: Number(origin.lat), lng: Number(origin.lng) },
      dests,
      travelMode
    );

    const passed = [];
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const dur = secs[i];
      if (dur != null && dur <= maxSecs) {
        passed.push({ ...c, travelSeconds: dur });
      }
    }

    return res.json({
      total: PROPS.length,
      considered: candidates.length,
      matched: passed.length,
      items: passed,
    });
  } catch (e) {
    console.error("[ERROR] /api/properties/travel-filter:", e);
    return res.status(500).json({ error: "server_error" });
  }
});

// -----------------------------
// Start server
// -----------------------------
app.listen(PORT, () =>
  console.log(`API listening on http://localhost:${PORT}`)
);
