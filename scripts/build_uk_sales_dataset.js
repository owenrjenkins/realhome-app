/**
 * Build 20,000 synthetic UK SALES listings with:
 * - Real outward postcodes (e.g., EC1A, W1A, SW1, M1, G1, EH1, CF10, BT1, LS1, etc.)
 * - Valid full postcodes (regex-valid UK format)
 * - Lat/Lng near each outward code centroid (small random jitter)
 * - Prices distributed by region with bedroom/type adjustments
 * - Bedrooms 1–5, Types: flat, terraced, semi-detached, detached
 *
 * Output: public/data/realhome_listings_uk_sales_20k.csv
 *
 * This runs in Vercel’s build via `prebuild` (no local setup needed).
 */

const fs = require("fs");
const path = require("path");

// --------- Helpers ----------
const UK_BBOX = { minLat: 49.0, maxLat: 59.5, minLng: -8.5, maxLng: 2.5 };
function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }
function randRange(a, b) { return a + Math.random() * (b - a); }
function randNormal() { let s = 0; for (let i = 0; i < 6; i++) s += Math.random(); return s - 3; }
function jitterDegKm(km) { return km / 111; }

const UK_POSTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i;
const UNIT_LETTERS = "ABCDEFGHJKMNPRSTUVWXYZ";
function randomUnit() {
  const a = UNIT_LETTERS[Math.floor(Math.random() * UNIT_LETTERS.length)];
  const b = UNIT_LETTERS[Math.floor(Math.random() * UNIT_LETTERS.length)];
  return `${a}${b}`;
}
function buildFullPostcode(outward) {
  const sector = String(1 + Math.floor(Math.random() * 9));
  return `${outward} ${sector}${randomUnit()}`.replace(/\s+/, " ");
}

// --------- Outward-code seeds (coverage across UK) ----------
const SEEDS = [
  // London
  { outward: "EC1A", city: "London", lat: 51.5202, lng: -0.0979, region: "London" },
  { outward: "E1",   city: "London", lat: 51.5163, lng: -0.0589, region: "London" },
  { outward: "W1A",  city: "London", lat: 51.5145, lng: -0.1461, region: "London" },
  { outward: "NW1",  city: "London", lat: 51.5347, lng: -0.1440, region: "London" },
  { outward: "SW1",  city: "London", lat: 51.4975, lng: -0.1372, region: "London" },
  { outward: "SE1",  city: "London", lat: 51.5045, lng: -0.0900, region: "London" },
  { outward: "N1",   city: "London", lat: 51.5373, lng: -0.1033, region: "London" },

  // South East
  { outward: "OX1", city: "Oxford", lat: 51.7506, lng: -1.2577, region: "South East" },
  { outward: "RG1", city: "Reading", lat: 51.4550, lng: -0.9691, region: "South East" },
  { outward: "GU1", city: "Guildford", lat: 51.2362, lng: -0.5704, region: "South East" },
  { outward: "BN1", city: "Brighton", lat: 50.8284, lng: -0.1407, region: "South East" },
  { outward: "SO14", city: "Southampton", lat: 50.9078, lng: -1.4033, region: "South East" },

  // South West
  { outward: "BS1", city: "Bristol", lat: 51.4523, lng: -2.5910, region: "South West" },
  { outward: "BA1", city: "Bath", lat: 51.3814, lng: -2.3575, region: "South West" },
  { outward: "TR1", city: "Truro", lat: 50.2632, lng: -5.0510, region: "South West" },
  { outward: "PL1", city: "Plymouth", lat: 50.3713, lng: -4.1427, region: "South West" },

  // East of England
  { outward: "CB1", city: "Cambridge", lat: 52.1943, lng: 0.1319, region: "East" },
  { outward: "NR1", city: "Norwich", lat: 52.6230, lng: 1.2970, region: "East" },
  { outward: "IP1", city: "Ipswich", lat: 52.0617, lng: 1.1555, region: "East" },
  { outward: "CM1", city: "Chelmsford", lat: 51.7360, lng: 0.4790, region: "East" },

  // East Midlands
  { outward: "NG1", city: "Nottingham", lat: 52.9548, lng: -1.1568, region: "East Midlands" },
  { outward: "LE1", city: "Leicester", lat: 52.6369, lng: -1.1398, region: "East Midlands" },
  { outward: "DE1", city: "Derby", lat: 52.9225, lng: -1.4746, region: "East Midlands" },

  // West Midlands
  { outward: "B1",  city: "Birmingham", lat: 52.4797, lng: -1.9027, region: "West Midlands" },
  { outward: "CV1", city: "Coventry", lat: 52.4068, lng: -1.5197, region: "West Midlands" },
  { outward: "DY1", city: "Dudley", lat: 52.5123, lng: -2.0810, region: "West Midlands" },
  { outward: "WV1", city: "Wolverhampton", lat: 52.5870, lng: -2.1288, region: "West Midlands" },

  // North West
  { outward: "M1",  city: "Manchester", lat: 53.4794, lng: -2.2453, region: "North West" },
  { outward: "L1",  city: "Liverpool", lat: 53.4047, lng: -2.9856, region: "North West" },
  { outward: "CH1", city: "Chester", lat: 53.1913, lng: -2.8958, region: "North West" },
  { outward: "FY1", city: "Blackpool", lat: 53.8175, lng: -3.0500, region: "North West" },

  // Yorkshire & Humber
  { outward: "LS1", city: "Leeds", lat: 53.7976, lng: -1.5434, region: "Yorkshire" },
  { outward: "S1",  city: "Sheffield", lat: 53.3807, lng: -1.4703, region: "Yorkshire" },
  { outward: "HU1", city: "Hull", lat: 53.7438, lng: -0.3350, region: "Yorkshire" },
  { outward: "YO1", city: "York", lat: 53.9590, lng: -1.0815, region: "Yorkshire" },

  // North East
  { outward: "NE1", city: "Newcastle upon Tyne", lat: 54.9733, lng: -1.6139, region: "North East" },
  { outward: "SR1", city: "Sunderland", lat: 54.9069, lng: -1.3822, region: "North East" },
  { outward: "DH1", city: "Durham", lat: 54.7753, lng: -1.5849, region: "North East" },
  { outward: "TS1", city: "Middlesbrough", lat: 54.5762, lng: -1.2348, region: "North East" },

  // Wales
  { outward: "CF10", city: "Cardiff", lat: 51.4816, lng: -3.1791, region: "Wales" },
  { outward: "SA1",  city: "Swansea", lat: 51.6208, lng: -3.9432, region: "Wales" },
  { outward: "LL11", city: "Wrexham", lat: 53.0463, lng: -2.9925, region: "Wales" },

  // Scotland
  { outward: "G1",  city: "Glasgow", lat: 55.8609, lng: -4.2514, region: "Scotland" },
  { outward: "EH1", city: "Edinburgh", lat: 55.9510, lng: -3.1875, region: "Scotland" },
  { outward: "AB10", city: "Aberdeen", lat: 57.1350, lng: -2.1173, region: "Scotland" },
  { outward: "DD1", city: "Dundee", lat: 56.4637, lng: -2.9700, region: "Scotland" },
  { outward: "IV1", city: "Inverness", lat: 57.4778, lng: -4.2247, region: "Scotland" },

  // Northern Ireland
  { outward: "BT1", city: "Belfast", lat: 54.6000, lng: -5.9300, region: "Northern Ireland" },
  { outward: "BT7", city: "Belfast", lat: 54.5842, lng: -5.9250, region: "Northern Ireland" },
  { outward: "BT48", city: "Derry / Londonderry", lat: 55.0068, lng: -7.3183, region: "Northern Ireland" },
];

const REGION_PRICE = {
  "London": 650_000,
  "South East": 450_000,
  "South West": 350_000,
  "East": 350_000,
  "East Midlands": 280_000,
  "West Midlands": 300_000,
  "North West": 250_000,
  "Yorkshire": 260_000,
  "North East": 220_000,
  "Wales": 230_000,
  "Scotland": 240_000,
  "Northern Ireland": 200_000,
};

function sampleBedrooms() {
  const r = Math.random();
  if (r < 0.14) return 1;
  if (r < 0.45) return 2;
  if (r < 0.80) return 3;
  if (r < 0.95) return 4;
  return 5;
}
function sampleType() {
  const r = Math.random();
  if (r < 0.38) return "flat";
  if (r < 0.62) return "terraced";
  if (r < 0.84) return "semi-detached";
  return "detached";
}
function samplePrice(region, beds, type) {
  const base = REGION_PRICE[region] || 300_000;
  const sigma = 0.35;
  const z = randNormal();
  let p = base * Math.exp(sigma * z);
  const bedMul = {1: 0.75, 2: 0.9, 3: 1.0, 4: 1.25, 5: 1.55}[beds] || 1.0;
  const typeMul = { "flat": 0.9, "terraced": 1.0, "semi-detached": 1.15, "detached": 1.45 }[type] || 1.0;
  p *= bedMul * typeMul;
  p = clamp(p, 80_000, 2_500_000);
  return Math.round(p);
}

function buildOne() {
  const seed = SEEDS[Math.floor(Math.random() * SEEDS.length)];
  const d = jitterDegKm(randRange(0.1, 3.0));
  const theta = Math.random() * Math.PI * 2;
  let lat = seed.lat + d * Math.cos(theta);
  let lng = seed.lng + d * Math.sin(theta);
  lat = clamp(lat, UK_BBOX.minLat, UK_BBOX.maxLat);
  lng = clamp(lng, UK_BBOX.minLng, UK_BBOX.maxLng);

  const postcode = buildFullPostcode(seed.outward);
  if (!UK_POSTCODE_RE.test(postcode)) return null;

  const bedrooms = sampleBedrooms();
  const property_type = sampleType();
  const price_gbp = samplePrice(seed.region, bedrooms, property_type);

  return { price_gbp, bedrooms, property_type, postcode, city: seed.city, latitude: lat, longitude: lng };
}

function buildMany(n) {
  const out = [];
  while (out.length < n) {
    const row = buildOne();
    if (row) out.push(row);
  }
  return out;
}

function main() {
  const N = 20000;
  const rows = buildMany(N);

  const dest = path.join(process.cwd(), "public", "data");
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  const file = path.join(dest, "realhome_listings_uk_sales_20k.csv");

  const header = "price_gbp,bedrooms,property_type,postcode,city,latitude,longitude\n";
  const csv = header + rows.map(r => [
    r.price_gbp, r.bedrooms, r.property_type, `"${r.postcode}"`, `"${r.city}"`,
    r.latitude.toFixed(6), r.longitude.toFixed(6)
  ].join(",")).join("\n");

  fs.writeFileSync(file, csv);
  console.log(`✅ Wrote ${rows.length} rows → ${file}`);
}

if (require.main === module) main();
