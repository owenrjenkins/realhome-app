"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import LoadingSpinner from "@/components/LoadingSpinner";
import ErrorBanner from "@/components/ErrorBanner";
import Badge from "@/components/Badge";
import { loadListingsCsv, type MinimalListing } from "@/lib/loadCsv";

const Map = dynamic(() => import("@/components/Map"), { ssr: false });

type ListingExt = MinimalListing & {
  id: string;
  latitude: number;
  longitude: number;
  price_gbp: number;
  _mins?: number;
};

// ---------- geo helpers ----------
const UK_BBOX = { minLat: 49.0, maxLat: 59.5, minLng: -8.5, maxLng: 2.5 };
function isWithinUK(lat: number, lng: number) {
  return lat >= UK_BBOX.minLat && lat <= UK_BBOX.maxLat && lng >= UK_BBOX.minLng && lng <= UK_BBOX.maxLng;
}
function isSaneCoord(lat: number, lng: number) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
}
function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const aa = s1 * s1 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * s2 * s2;
  return 2 * R * Math.asin(Math.sqrt(aa));
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
  const t = (text || "").toLowerCase();

  // numeric range
  let minsFallback = 45;
  let minMins: number | undefined;
  let maxMins: number | undefined;

  const under = t.match(/under\s*(\d+)\s*(?:min|mins|minutes)?/);
  if (under) maxMins = Number(under[1]);

  const over = t.match(/over\s*(\d+)\s*(?:min|mins|minutes)?/);
  if (over) minMins = Number(over[1]);

  const between = t.match(/between\s*(\d+)\s*(?:and|to|-)\s*(\d+)\s*(?:min|mins|minutes)?/);
  if (between) {
    minMins = Number(between[1]);
    maxMins = Number(between[2]);
  }

  const plain = t.match(/(\d+)\s*(?:min|mins|minutes)/);
  if (plain && !minMins && !maxMins) minsFallback = Number(plain[1]);

  const destMatch = text.match(/to\s+(.+?)(?:\s+by|\s*[,.;]|$)/i);
  const dest = destMatch?.[1]?.trim() || "City of London";

  let mode: "driving" | "transit" | "walking" | "bicycling" = "transit";
  if (/car|drive|driving/.test(t)) mode = "driving";
  else if (/walk/.test(t)) mode = "walking";
  else if (/bike|cycle/.test(t)) mode = "bicycling";
  else if (/train|bus|transit/.test(t)) mode = "transit";

  return { minsFallback, minMins, maxMins, dest, mode };
}

function parseBudgetBeds(text: string) {
  const t = (text || "").toLowerCase().replace(/[,£]/g, "").replace(/\s+/g, " ");
  let minBudget: number | undefined;
  let maxBudget: number | undefined;

  const under = t.match(/under\s*(\d+)(k|m)?/);
  if (under) {
    const n = Number(under[1]);
    maxBudget = under[2] === "m" ? n * 1_000_000 : under[2] === "k" ? n * 1_000 : n;
  }
  const over = t.match(/over\s*(\d+)(k|m)?/);
  if (over) {
    const n = Number(over[1]);
    minBudget = over[2] === "m" ? n * 1_000_000 : over[2] === "k" ? n * 1_000 : n;
  }
  const between = t.match(/between\s*(\d+)(k|m)?\s*(?:and|to|-)\s*(\d+)(k|m)?/);
  if (between) {
    const a = Number(between[1]) * (between[2] === "m" ? 1_000_000 : between[2] === "k" ? 1_000 : 1);
    const b = Number(between[3]) * (between[4] === "m" ? 1_000_000 : between[4] === "k" ? 1_000 : 1);
    minBudget = Math.min(a, b);
    maxBudget = Math.max(a, b);
  }

  const bm = t.match(/(\d+)\s*(?:bed|beds|bedroom|bedrooms)/i);
  const beds = bm ? Number(bm[1]) : undefined;

  return { minBudget, maxBudget, beds };
}

// ---------- component ----------
export default function Page() {
  const [text, setText] = useState(
    "Quiet street near a big park, cafés and a good supermarket, under 45 minutes to central Manchester by car. 3 beds between £400,000 and £800,000."
  );

  const [destination, setDestination] = useState<{ lat: number; lng: number; name: string } | null>(null);
  const [listings, setListings] = useState<MinimalListing[] | null>(null);
  const [durations, setDurations] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg] = useState("");

  // detail drawer
  const [selected, setSelected] = useState<ListingExt | null>(null);
  const [nearby, setNearby] = useState<{ park?: { name: string; distance_m: number }; supermarket?: { name: string; distance_m: number } } | null>(null);
  const [route, setRoute] = useState<{ duration_min: number; steps: any[] } | null>(null);

  // map controller
  const mapCtlRef = useRef<{ focusOn: (id: string) => void } | null>(null);

  useEffect(() => {
    loadListingsCsv()
      .then((data) => setListings(data))
      .catch((err) => setErrMsg(`CSV load failed: ${err.message}`));
  }, []);

  const filteredListings = useMemo(() => {
    if (!listings || !destination) return [];
    const { minBudget, maxBudget, beds } = parseBudgetBeds(text);
    const { minsFallback, minMins, maxMins } = parseCommuteFromText(text);
    const radiusKm = 25;

    const arr = listings
      .map((L: any) => {
        const latitude = Number(L.latitude ?? L.lat);
        const longitude = Number(L.longitude ?? L.lng);
        const id = ensureId(L);
        const commute = durations[id];
        return { ...(L as any), id, latitude, longitude, price_gbp: Number(L.price_gbp || 0), _mins: commute } as ListingExt;
      })
      .filter((L) => {
        if (!isSaneCoord(L.latitude, L.longitude)) return false;
        if (!isWithinUK(L.latitude, L.longitude)) return false;
        const near = distanceKm(destination, { lat: L.latitude, lng: L.longitude }) <= radiusKm;
        if (!near) return false;

        const price = L.price_gbp || 0;
        if (minBudget && price < minBudget) return false;
        if (maxBudget && price > maxBudget) return false;
        if (beds && (L as any).bedrooms < beds) return false;

        if (typeof L._mins === "number") {
          if (minMins && L._mins < minMins) return false;
          if (maxMins && L._mins > maxMins) return false;
          if (!minMins && !maxMins && L._mins > minsFallback) return false;
        }
        return true;
      })
      .sort((a, b) => (a._mins ?? 9999) - (b._mins ?? 9999));

    return arr.slice(0, 10); // ← top 10 only
  }, [listings, destination, text, durations]);

  async function runSearch() {
    setErrMsg("");
    setLoading(true);
    setDurations({});
    setSelected(null);
    setNearby(null);
    setRoute(null);

    try {
      const { dest, mode } = parseCommuteFromText(text);

      // UK-biased geocode
      const g = await fetch("/api/geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: dest }),
      });
      if (!g.ok) throw new Error("Failed to geocode destination");
      const gjson = await g.json();
      const anchor = { lat: gjson.lat, lng: gjson.lng, name: gjson.name || dest };
      setDestination(anchor);

      // Commute durations for candidates near the anchor
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
            origin: { lat: anchor.lat, lng: anchor.lng }, // destination/work
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

  // open details: Nearby + Directions
  async function openDetails(L: ListingExt) {
    setSelected(L);
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
        const { mode } = parseCommuteFromText(text);
        const d = await fetch("/api/directions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            origin: { lat: L.latitude, lng: L.longitude },         // home
            destination: { lat: destination.lat, lng: destination.lng }, // work / POI
            mode,
          }),
        });
        if (d.ok) setRoute(await d.json());
      }
    } catch {}
  }

  function focusPin(L: ListingExt) {
    mapCtlRef.current?.focusOn(L.id);
    openDetails(L);
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
          placeholder="Describe your ideal location… (e.g., “under 45 minutes to central Manchester by car, 3 beds between £400k and £800k, near a big park and supermarket.”)"
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
        <div className="max-w-7xl mx-auto px-6 pb-8 text-sm text-gray-700">
          Destination: <span className="font-medium">{destination.name}</span>
        </div>
      )}

      {destination && (
        <section className="grid md:grid-cols-3 gap-6 max-w-7xl mx-auto p-6">
          <div className="md:col-span-2">
            <Map
              center={{ lat: destination.lat, lng: destination.lng }}
              listings={filteredListings}
              durations={durations}
              onSelect={(l) => openDetails(l as ListingExt)}
              onReady={(ctl) => (mapCtlRef.current = ctl)}
            />
          </div>

          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Top 10 listings</h2>
            {filteredListings.map((L) => (
              <div key={L.id} className="group p-4 rounded-xl border bg-white shadow hover:shadow-md transition">
                <button
                  onClick={() => focusPin(L)}
                  className="font-semibold text-indigo-700 group-hover:underline"
                  title="Show on map"
                >
                  £{(L.price_gbp || 0).toLocaleString()}
                </button>{" "}
                · {L.bedrooms} bed {L.property_type}
                <div className="text-xs text-gray-600 mt-0.5">
                  {L.postcode}, {L.city}
                  {typeof L._mins === "number" && <span> · Commute {L._mins} min</span>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Details drawer with WHY + Nearby + Route basics */}
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
                    {nearby?.park ? (
                      <>
                        {nearby.park.name} ({nearby.park.distance_m} m)
                      </>
                    ) : (
                      "searching…"
                    )}
                  </li>
                  <li>
                    Supermarket:{" "}
                    {nearby?.supermarket ? (
                      <>
                        {nearby.supermarket.name} ({nearby.supermarket.distance_m} m)
                      </>
                    ) : (
                      "searching…"
                    )}
                  </li>
                </ul>
              </div>

              {/* Why this matches */}
              <div className="mt-3">
                <div className="font-medium">Why this matches</div>
                <ul className="list-disc list-inside text-gray-700">
                  {(() => {
                    const { minsFallback, minMins, maxMins } = parseCommuteFromText(text);
                    const commuteRule = minMins || maxMins ? `${minMins ? `≥${minMins}` : ""}${minMins && maxMins ? " & " : ""}${maxMins ? `≤${maxMins}` : ""} min` : `≤ ${minsFallback} min`;
                    return (
                      <>
                        {typeof selected._mins === "number" && (
                          <li>
                            Commute {commuteRule} ({selected._mins} min)
                          </li>
                        )}
                        <li>Bedrooms: {selected.bedrooms} (meets your minimum)</li>
                        <li>Within your budget (see price)</li>
                        <li>Close to a park & supermarket (see Nearby)</li>
                      </>
                    );
                  })()}
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
