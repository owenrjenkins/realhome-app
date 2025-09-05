"use client";

import { useEffect, useMemo, useState } from "react";
import nextDynamic from "next/dynamic";
import LoadingSpinner from "@/components/LoadingSpinner";
import ErrorBanner from "@/components/ErrorBanner";
import Badge from "@/components/Badge";
import { loadListingsCsv, type MinimalListing } from "@/lib/loadCsv";
import NarrativePanel from "@/components/NarrativePanel";
import { buildNarrative, buildAreaBullets } from "@/lib/narrative";
import type { MapListing } from "@/components/Map";

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
  const R = 6371,
    dLat = ((b.lat - a.lat) * Math.PI) / 180,
    dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s1 = Math.sin(dLat / 2),
    s2 = Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.sqrt(s1 * s1 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * s2 * s2));
}
function ensureId(L: any) {
  if (L.id) return String(L.id);
  const lat = Number(L.latitude ?? L.lat ?? 0).toFixed(5);
  const lng = Number(L.longitude ?? L.lng ?? 0).toFixed(5);
  const price = Number(L.price_gbp ?? 0);
  return `${lat},${lng},${price}`;
}

// ---------- parsing ----------
function parseCommuteFromText(text: string) {
  const s = (text || "").toLowerCase();

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

  // destination: support both “to X by …” and “from X by …”
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

  const toNumber = (num: string, unit?: string) => {
    const n = Number(num);
    if (unit === "m") return Math.round(n * 1_000_000);
    if (unit === "k") return Math.round(n * 1_000);
    return Math.round(n);
  };

  let minBudget: number | undefined;
  let maxBudget: number | undefined;

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

  const bm = s.match(/(\d+)\s*(?:bed|beds|bedroom|bedrooms)\b/i);
  const beds = bm ? Number(bm[1]) : undefined;

  return { minBudget, maxBudget, beds };
}

// ---------- helpers for narrative areas ----------
function outwardOf(postcode?: string) {
  if (!postcode) return "";
  const token = postcode.trim().toUpperCase().split(/\s+/)[0]; // "SE1", "N1", "CR0"
  return token || "";
}
function outwardToName(outward: string) {
  // Minimal mapping; expand as needed
  if (/^SE/i.test(outward)) return "South East London";
  if (/^SW/i.test(outward)) return "South West London";
  if (/^EC/i.test(outward)) return "City/EC";
  if (/^WC/i.test(outward)) return "Westminster/WC";
  if (/^N/i.test(outward)) return "North London";
  if (/^NW/i.test(outward)) return "North West London";
  if (/^E/i.test(outward)) return "East London";
  if (/^W/i.test(outward)) return "West London";
  if (/^BR/i.test(outward)) return "Bromley";
  if (/^CR/i.test(outward)) return "Croydon";
  if (/^EN/i.test(outward)) return "Enfield";
  if (/^IG/i.test(outward)) return "Ilford";
  if (/^KT/i.test(outward)) return "Kingston";
  if (/^RM/i.test(outward)) return "Romford";
  if (/^SM/i.test(outward)) return "Sutton";
  if (/^TW/i.test(outward)) return "Twickenham";
  if (/^UB/i.test(outward)) return "Uxbridge";
  return outward; // fallback to the outward code itself
}

// ---------- types ----------
type ListingExt = MinimalListing & {
  id: string;
  latitude: number;
  longitude: number;
  price_gbp: number;
  _mins?: number;
};

// ---------- component ----------
export default function HomeClient() {
  const [text, setText] = useState(
    "Under 60 minutes to London Bridge by public transport. 4 beds under £1.5m. Near a big park and supermarket."
  );

  const [destination, setDestination] = useState<{ lat: number; lng: number; name: string } | null>(null);
  const [listings, setListings] = useState<MinimalListing[] | null>(null);
  const [durations, setDurations] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg] = useState("");

  // details drawer
  const [selected, setSelected] = useState<ListingExt | null>(null);
  const [nearby, setNearby] = useState<{ park?: { name: string; distance_m: number }; supermarket?: { name: string; distance_m: number } } | null>(null);
  const [route, setRoute] = useState<{ duration_min: number; steps: any[] } | null>(null);

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
      if (maxBudget && price > maxBudget * 1.1) continue;
      if (beds && (L as any).bedrooms < beds) continue;

      const timeOkStrict = typeof commute === "number" ? commute <= targetMaxMins : true;
      const timeOkNear = typeof commute === "number" ? commute <= Math.round(targetMaxMins * 1.2) : true;
      const budgetOkStrict = !maxBudget || price <= maxBudget;
      const budgetOkNear = !maxBudget || price <= maxBudget * 1.1;

      if (timeOkStrict && budgetOkStrict) strictArr.push(L);
      else if (timeOkNear && budgetOkNear) nearArr.push(L);
    }

    strictArr.sort((a, b) => (a._mins ?? 9e9) - (b._mins ?? 9e9) || a.price_gbp - b.price_gbp);
    nearArr.sort((a, b) => (a._mins ?? 9e9) - (b._mins ?? 9e9) || a.price_gbp - b.price_gbp);

    return { strict: strictArr.slice(0, 50), nearMiss: nearArr.slice(0, 50) };
  }, [listings, destination, durations, minsFallback, maxMins, minBudget, maxBudget, beds, targetMaxMins]);

  // Narrative aggregation by *actual* postcode outward code
  const topAreas = useMemo(() => {
    const counts: Record<string, number> = {};
    const count = (pc?: string) => {
      const out = outwardOf(pc);
      if (!out) return;
      counts[out] = (counts[out] ?? 0) + 1;
    };
    for (const L of strict) count(L.postcode);
    if (Object.keys(counts).length < 3) for (const L of nearMiss) count(L.postcode);

    const arr = Object.entries(counts)
      .map(([out, n]) => ({ outward: out, name: outwardToName(out), count: n }))
      .sort((a, b) => b.count - a.count);

    return arr;
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
    } catch {
      return "Here’s what we’re seeing based on your brief.";
    }
  }, [destination?.name, dest, mode, targetMaxMins, strict.length, nearMiss.length, minBudget, maxBudget, beds, topAreas]);

  const areaBullets = useMemo(() => buildAreaBullets(topAreas), [topAreas]);

  const mapListings: MapListing[] = useMemo(
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
    setSelected(null);
    setNearby(null);
    setRoute(null);
    setLoading(true);

    try {
      const { dest, mode } = parseCommuteFromText(text);
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
            listings: nearby.slice(0, 300).map((L) => ({ id: L.id, latitude: L.latitude, longitude: L.longitude })),
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

  // Pin → fetch Nearby + Directions and show drawer
  async function openDetails(L: MapListing) {
    const ext = strict.find((s) => s.id === L.id) || (nearMiss.find((s) => s.id === L.id) as any);
    if (ext) setSelected(ext as ListingExt);

    setNearby(null);
    setRoute(null);

    try {
      const n = await fetch("/api/nearby", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat: L.latitude, lng: L.longitude }),
      });
      if (n.ok) setNearby(await n.json());
    } catch {}

    try {
      if (destination) {
        const d = await fetch("/api/directions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            origin: { lat: L.latitude, lng: L.longitude }, // home
            destination: { lat: destination.lat, lng: destination.lng }, // work
            mode,
          }),
        });
        if (d.ok) setRoute(await d.json());
      }
    } catch {}
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
          placeholder='Describe your ideal location… (e.g., “under 60 minutes to London Bridge by public transport, 4 beds under £1.5m, near a park and supermarket.”)'
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
          <div className="md:col-span-3">
            <NarrativePanel text={narrativeText} bullets={areaBullets} />
          </div>

          <div className="md:col-span-2" style={{ minHeight: 560 }}>
            <Map
              origin={{ lat: destination.lat, lng: destination.lng }}
              mode={mode}
              listings={mapListings}
              height={560}
              onSelect={openDetails} // <-- wire pin → details
            />
          </div>

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
          </div>
        </div>
      )}

      {/* Details drawer */}
      {selected && (
        <div className="fixed inset-0 bg-black/40 flex items-end md:items-center justify-center z-50" onClick={() => setSelected(null)}>
          <div className="bg-white w-full md:max-w-xl rounded-t-2xl md:rounded-2xl p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Listing details</h3>
              <button className="text-sm px-3 py-1 rounded-lg border" onClick={() => setSelected(null)}>Close</button>
            </div>

            <div className="text-sm">
              <div className="font-medium">
                £{(selected.price_gbp || 0).toLocaleString()} · {selected.bedrooms} bed {selected.property_type}
              </div>
              <div className="text-gray-600">
                {selected.postcode}, {selected.city}
                {typeof selected._mins === "number" && destination && (
                  <span> · Commute to <strong>{destination.name}</strong>: {selected._mins} min</span>
                )}
              </div>

              {/* Nearby */}
              <div className="mt-3">
                <div className="font-medium">Nearby</div>
                <ul className="list-disc list-inside text-gray-700">
                  <li>
                    Park:{" "}
                    {nearby?.park ? `${nearby.park.name} (${nearby.park.distance_m} m)` : "searching…"}
                  </li>
                  <li>
                    Supermarket:{" "}
                    {nearby?.supermarket ? `${nearby.supermarket.name} (${nearby.supermarket.distance_m} m)` : "searching…"}
                  </li>
                </ul>
              </div>

              {/* Route basics */}
              <div className="mt-3">
                <div className="font-medium">Route basics</div>
                {!route && <div className="text-gray-600">fetching route…</div>}
                {route && (
                  <div className="space-y-2 text-gray-800">
                    <div>Total: <span className="font-medium">{route.duration_min} min</span></div>
                    <ol className="list-decimal list-inside space-y-1">
                      {route.steps.map((s: any, i: number) =>
                        s.type === "TRANSIT" ? (
                          <li key={i}>
                            {s.vehicle} — {s.line} towards {s.headsign} · {s.num_stops} stops
                            <div className="text-xs text-gray-600">
                              {s.departure_stop} → {s.arrival_stop}
                            </div>
                          </li>
                        ) : (
                          <li key={i}>
                            Walk/Drive — {s.duration_min} min ({Math.round((s.distance_m || 0) / 100) / 10} km)
                            {s.instruction ? <span className="text-xs text-gray-600"> · {s.instruction}</span> : null}
                          </li>
                        )
                      )}
                    </ol>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
