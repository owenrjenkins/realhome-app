"use client";

import { useEffect, useMemo, useState } from "react";
import nextDynamic from "next/dynamic";
import LoadingSpinner from "@/components/LoadingSpinner";
import ErrorBanner from "@/components/ErrorBanner";
import Badge from "@/components/Badge";
import { loadListingsCsv, type MinimalListing } from "@/lib/loadCsv";
import NarrativePanel from "@/components/NarrativePanel";
import { lookupNearestArea } from "@/lib/areaCatalog";
import { buildNarrative, buildAreaBullets } from "@/lib/narrative";

// Load Map only on the client (prevents SSR/prerender errors)
const Map = nextDynamic(() => import("@/components/Map"), { ssr: false });

// ---------- geo helpers ----------
const UK_BBOX = { minLat: 49.0, maxLat: 59.5, minLng: -8.5, maxLng: 2.5 };
function isWithinUK(lat: number, lng: number) {
  return lat >= UK_BBOX.minLat && lat <= UK_BBOX.maxLat && lng >= UK_BBOX.minLng && lng <= UK_BBOX.maxLng;
}
function isSaneCoord(lat: number, lng: number) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
}
function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371, dLat = ((b.lat - a.lat) * Math.PI) / 180, dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s1 = Math.sin(dLat / 2), s2 = Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.sqrt(s1 * s1 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * s2 * s2));
}
function ensureId(L: any) {
  if (L.id) return String(L.id);
  const lat = Number(L.latitude ?? L.lat ?? 0).toFixed(5);
  const lng = Number(L.longitude ?? L.lng ?? 0).toFixed(5);
  const price = Number(L.price_gbp ?? 0);
  return `${lat},${lng},${price}`;
}

// ---------- parsing (robust) ----------
function parseCommuteFromText(text: string) {
  const s = (text || "").toLowerCase();

  // minutes: under/over/between or single “XX minutes”
  let minsFallback = 60;
  let minMins: number | undefined;
  let maxMins: number | undefined;

  const underM = s.match(/\bunder\s*(\d+)\s*(?:min|mins|minutes)\b/);
  if (underM) maxMins = Number(underM[1]);

  const overM = s.match(/\bover\s*(\d+)\s*(?:min|mins|minutes)\b/);
  if (overM) minMins = Number(overM[1]);

  const betweenM = s.match(/\bbetween\s*(\d+)\s*(?:and|to|-)\s*(\d+)\s*(?:min|mins|minutes)\b/);
  if (betweenM) {
    minMins = Number(betweenM[1]);
    maxMins = Number(betweenM[2]);
  }

  const plainM = s.match(/\b(\d+)\s*(?:min|mins|minutes)\b/);
  if (plainM && !minMins && !maxMins) minsFallback = Number(plainM[1]);

  // destination: support "to X by ..." and "from X by ..."
  const toMatch = text.match(/\bto\s+(.+?)(?:\s+by|\s*[,.;]|$)/i);
  const fromMatch = text.match(/\bfrom\s+(.+?)(?:\s+by|\s*[,.;]|$)/i);
  const dest = (toMatch?.[1] || fromMatch?.[1] || "City of London").trim();

  // mode
  let mode: "driving" | "transit" | "walking" | "bicycling" = "transit";
  if (/\bcar|drive|driving\b/.test(s)) mode = "driving";
  else if (/\bwalk|walking\b/.test(s)) mode = "walking";
  else if (/\b(bike|cycle|cycling)\b/.test(s)) mode = "bicycling";
  else if (/\b(train|bus|tube|tram|transit|public)\b/.test(s)) mode = "transit";

  return { minsFallback, minMins, maxMins, dest, mode };
}

function parseBudgetBeds(text: string) {
  const s = (text || "").toLowerCase();

  // Helpers
  const toNumber = (num: string, unit?: string) => {
    const n = Number(num);
    if (unit === "m") return Math.round(n * 1_000_000);
    if (unit === "k") return Math.round(n * 1_000);
    return Math.round(n);
  };

  let minBudget: number | undefined;
  let maxBudget: number | undefined;

  // Only treat a number as money if it’s prefixed with £ or suffixed with k/m,
  // and IGNORE numbers followed by "minutes".
  const UNDER_RE = /\bunder\s*£?\s*(\d+(?:\.\d+)?)\s*(k|m)?\b(?!\s*(?:min|mins|minutes))/i;
  const OVER_RE = /\bover\s*£?\s*(\d+(?:\.\d+)?)\s*(k|m)?\b(?!\s*(?:min|mins|minutes))/i;
  const BETWEEN_RE = /\bbetween\s*£?\s*(\d+(?:\.\d+)?)\s*(k|m)?\s*(?:and|to|-)\s*£?\s*(\d+(?:\.\d+)?)\s*(k|m)?\b(?!\s*(?:min|mins|minutes))/i;

  const mBetween = s.match(BETWEEN_RE);
  if (mBetween) {
    const a = toNumber(mBetween[1], mBetween[2] as any);
    const b = toNumber(mBetween[3], mBetween[4] as any);
    minBudget = Math.min(a, b);
    maxBudget = Math.max(a, b);
  } else {
    const mUnder = s.match(UNDER_RE);
    if (mUnder) maxBudget = toNumber(mUnder[1], mUnder[2] as any);
    const mOver = s.match(OVER_RE);
    if (mOver) minBudget = toNumber(mOver[1], mOver[2] as any);
  }

  // Beds
  const bm = s.match(/(\d+)\s*(?:bed|beds|bedroom|bedrooms)\b/i);
  const beds = bm ? Number(bm[1]) : undefined;

  return { minBudget, maxBudget, beds };
}

// ---------- types ----------
type ListingExt = MinimalListing & {
  id: string;
  latitude: number;
  longitude: number;
  price_gbp: number;
  _mins?: number; // commute mins
};

// ---------- component ----------
export default function HomeClient() {
  const [text, setText] = useState(
    "Under 60 minutes to London Bridge by public transport. 4 beds under £1m. Near a big park and supermarket."
  );

  const [destination, setDestination] = useState<{ lat: number; lng: number; name: string } | null>(null);
  const [listings, setListings] = useState<MinimalListing[] | null>(null);
  const [durations, setDurations] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg] = useState("");

  useEffect(() => {
    loadListingsCsv()
      .then((data) => setListings(data))
      .catch((err) => setErrMsg(`CSV load failed: ${err.message}`));
  }, []);

  const { minsFallback, minMins, maxMins, dest, mode } = useMemo(() => parseCommuteFromText(text), [text]);
  const { minBudget, maxBudget, beds } = useMemo(() => parseBudgetBeds(text), [text]);
  const targetMaxMins = maxMins ?? minsFallback;

  // Strict & near-miss buckets
  const { strict, nearMiss } = useMemo(() => {
    if (!listings || !destination) return { strict: [] as ListingExt[], nearMiss: [] as ListingExt[] };

    const radiusKm = 25;
    const strictArr: ListingExt[] = [];
    const nearArr: ListingExt[] = [];

    for (const raw of listings) {
      const latitude = Number((raw as any).latitude ?? (raw as any).lat);
      const longitude = Number((raw as any).longitude ?? (raw as any).lng);
      if (!isSaneCoord(latitude, longitude) || !isWithinUK(latitude, longitude)) continue;

      if (distanceKm(destination, { lat: latitude, lng: longitude }) > radiusKm) continue;

      const id = ensureId(raw);
      const price = Number((raw as any).price_gbp || 0);
      const commute = durations[id];
      const L: ListingExt = { ...(raw as any), id, latitude, longitude, price_gbp: price, _mins: commute };

      if (minBudget && price < minBudget) continue;
      if (maxBudget && price > maxBudget * 1.1) continue; // > +10% over = reject
      if (beds && (L as any).bedrooms < beds) continue;

      const timeOkStrict = typeof commute === "number" ? commute <= targetMaxMins : true;
      const timeOkNear   = typeof commute === "number" ? commute <= Math.round(targetMaxMins * 1.2) : true;
      const budgetOkStrict = !maxBudget || price <= maxBudget;
      const budgetOkNear   = !maxBudget || price <= maxBudget * 1.1;

      if (timeOkStrict && budgetOkStrict) strictArr.push(L);
      else if (timeOkNear && budgetOkNear) nearArr.push(L);
    }

    strictArr.sort((a, b) => (a._mins ?? 9e9) - (b._mins ?? 9e9) || a.price_gbp - b.price_gbp);
    nearArr.sort((a, b) => (a._mins ?? 9e9) - (b._mins ?? 9e9) || a.price_gbp - b.price_gbp);

    return { strict: strictArr.slice(0, 50), nearMiss: nearArr.slice(0, 50) };
  }, [listings, destination, durations, minsFallback, maxMins, minBudget, maxBudget, beds, targetMaxMins]);

  // Narrative aggregation by area (object-only to avoid iterator issues)
  const topAreas = useMemo(() => {
    type AreaAgg = { key: string; area: ReturnType<typeof lookupNearestArea> | null; count: number };
    const agg: Record<string, AreaAgg> = {};

    const up = (lat: number, lng: number) => {
      const area = lookupNearestArea(lat, lng) || null;
      const key = area ? area.key : "unknown";
      if (!agg[key]) agg[key] = { key, area, count: 0 };
      agg[key].count += 1;
    };

    for (const L of strict) up(L.latitude, L.longitude);
    if (Object.keys(agg).length < 3) for (const L of nearMiss) up(L.latitude, L.longitude);

    const arr = Object.keys(agg).map((k) => agg[k]);
    arr.sort((a, b) => b.count - a.count);
    return arr.map(({ area, count }) => ({ area, count }));
  }, [strict, nearMiss]);

  const narrativeText = useMemo(() => {
    try {
      return buildNarrative({
        destinationName: destination?.name || dest,
        mode,
        maxMins: targetMaxMins,
        strictCount: strict.length,
        nearMissCount: nearMiss.length,
        budget: { min: minBudget, max: maxBudget },
        beds,
        topAreas,
      });
    } catch (e) {
      console.error("Narrative build failed:", e);
      return "Here’s what we’re seeing based on your brief.";
    }
  }, [destination?.name, dest, mode, targetMaxMins, strict.length, nearMiss.length, minBudget, maxBudget, beds, topAreas]);

  const areaBullets = useMemo(() => {
    try {
      return buildAreaBullets(topAreas);
    } catch (e) {
      console.error("Area bullets build failed:", e);
      return [];
    }
  }, [topAreas]);

  // Build list for Map (strict only for now)
  const mapListings = useMemo(
    () =>
      strict.map((L) => ({
        id: L.id,
        latitude: L.latitude,
        longitude: L.longitude,
        price_gbp: L.price_gbp,
        bedrooms: (L as any).bedrooms,
        address_line: (L as any).address_line,
        postcode: L.postcode,
        city: L.city,
        commute_mins: L._mins,
      })),
    [strict]
  );

  async function runSearch() {
    setErrMsg("");
    setDurations({});
    setLoading(true);

    try {
      const { dest, mode } = parseCommuteFromText(text);
      // UK bias
      const destQuery = /,\s*(uk|united kingdom|great britain)/i.test(dest) ? dest : `${dest}, UK`;
      const g = await fetch("/api/geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: destQuery }),
      });
      if (!g.ok) {
        const gj = await g.json().catch(() => ({}));
        throw new Error(gj?.error || "Failed to geocode destination");
      }
      const gjson = await g.json();
      const anchor = { lat: gjson.lat, lng: gjson.lng, name: gjson.name || dest };
      setDestination(anchor);

      if (listings) {
        const radiusKm = 25;
        const nearby = listings
          .map((L: any) => ({
            ...L,
            id: ensureId(L),
            latitude: Number(L.latitude ?? L.lat),
            longitude: Number(L.longitude ?? L.lng),
          }))
          .filter(
            (L) =>
              isSaneCoord(L.latitude, L.longitude) &&
              isWithinUK(L.latitude, L.longitude) &&
              distanceKm(anchor, { lat: L.latitude, lng: L.longitude }) <= radiusKm
          );

        const cRes = await fetch("/api/commute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            origin: { lat: anchor.lat, lng: anchor.lng },
            mode,
            listings: nearby.slice(0, 200).map((L) => ({ id: L.id, latitude: L.latitude, longitude: L.longitude })),
          }),
        });
        if (cRes.ok) {
          const cj = await cRes.json();
          setDurations(cj.durations || {});
        }
      }
    } catch (e: any) {
      setErrMsg(e?.message || "Search failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-pink-50">
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur border-b px-4 py-3 flex justify-between items-center">
        <h1 className="text-2xl font-bold text-indigo-600">🏡 RealHome</h1>
        {listings && <Badge>{listings.length.toLocaleString()} listings loaded</Badge>}
      </div>

      {errMsg && <ErrorBanner message={errMsg} />}

      <section className="p-6 space-y-4 max-w-5xl mx-auto">
        <textarea
          className="w-full rounded-xl border p-4 shadow-sm focus:ring focus:ring-indigo-300"
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder='Describe your ideal location… (e.g., “under 60 minutes to London Bridge by public transport, 4 beds under £1m, near a park and supermarket.”)'
        />
        <button
          onClick={runSearch}
          disabled={loading}
          className="px-5 py-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 shadow disabled:opacity-50"
        >
          {loading ? "Searching…" : "Find areas"}
        </button>
        {loading && <LoadingSpinner label="Checking commute & nearby amenities…" />}
      </section>

      {destination && (
        <div className="max-w-7xl mx-auto grid md:grid-cols-3 gap-6 p-6">
          {/* Narrative */}
          <div className="md:col-span-3">
            <NarrativePanel text={narrativeText} bullets={areaBullets} />
          </div>

          {/* Map */}
          <div className="md:col-span-2" style={{ minHeight: 560 }}>
            <Map origin={{ lat: destination.lat, lng: destination.lng }} mode={mode} listings={mapListings} height={560} />
          </div>

          {/* Best matches */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Best matches</h2>
            {strict.slice(0, 10).map((L) => (
              <div key={L.id} className="p-4 rounded-xl border bg-white shadow hover:shadow-md transition">
                <div className="font-semibold text-indigo-700">
                  £{(L.price_gbp || 0).toLocaleString()} · {L.bedrooms} bed {L.property_type}
                </div>
                <div className="text-xs text-gray-600 mt-0.5">
                  {L.postcode}, {L.city}
                  {typeof L._mins === "number" && <span> · Commute {L._mins} min</span>}
                </div>
              </div>
            ))}

            {nearMiss.length > 0 && (
              <div className="p-3 rounded-lg border bg-white/70">
                <div className="font-semibold mb-1">Near misses worth a look</div>
                <div className="text-xs text-gray-600 mb-2">
                  Slightly over time (+20%) or budget (+10%). Adjust filters if they look promising.
                </div>
                {nearMiss.slice(0, 6).map((L) => (
                  <div key={L.id} className="py-1 text-sm">
                    £{(L.price_gbp || 0).toLocaleString()} · {L.bedrooms} bed — {L.postcode}{" "}
                    {typeof L._mins === "number" ? `· ${L._mins} min` : ""}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
