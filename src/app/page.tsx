"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import LoadingSpinner from "@/components/LoadingSpinner";
import ErrorBanner from "@/components/ErrorBanner";
import Badge from "@/components/Badge";
import { loadListingsCsv, type MinimalListing } from "@/lib/loadCsv";

const Map = dynamic(() => import("@/components/Map"), { ssr: false });

type Tile = { lat: number; lng: number; score: number; parts?: { commute: number; amenity: number; vibe: number } };
type ListingExt = MinimalListing & { _mins?: number; id: string; latitude: number; longitude: number };

function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const aa = s1 * s1 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * s2 * s2;
  return 2 * R * Math.asin(Math.sqrt(aa));
}

function parseBudgetBeds(text: string) {
  const t = (text || "").toLowerCase().replace(/[,£]/g, "").replace(/\s+/g, " ");
  let minBudget: number | undefined;
  let maxBudget: number | undefined;

  let m = t.match(/between\s*([\d.]+)\s*(m|k)?\s*(?:and|to|-)\s*([\d.]+)\s*(m|k)?/i);
  if (m) {
    const a = Number(m[1]), au = (m[2] || "").toLowerCase();
    const b = Number(m[3]), bu = (m[4] || "").toLowerCase();
    const A = au === "m" ? a * 1_000_000 : au === "k" ? a * 1_000 : a;
    const B = bu === "m" ? b * 1_000_000 : bu === "k" ? b * 1_000 : b;
    minBudget = Math.min(A, B);
    maxBudget = Math.max(A, B);
  }
  if (!maxBudget) {
    m = t.match(/(\d+(?:\.\d+)?)\s*(m|k)?\s*-\s*(\d+(?:\.\d+)?)\s*(m|k)?/i);
    if (m) {
      const a = Number(m[1]), au = (m[2] || "").toLowerCase();
      const b = Number(m[3]), bu = (m[4] || "").toLowerCase();
      const A = au === "m" ? a * 1_000_000 : au === "k" ? a * 1_000 : a;
      const B = bu === "m" ? b * 1_000_000 : bu === "k" ? b * 1_000 : b;
      minBudget = Math.min(A, B);
      maxBudget = Math.max(A, B);
    }
  }
  if (!maxBudget) {
    m = t.match(/(?:budget|under|max)\s*(\d+(?:\.\d+)?)\s*(m|k)?/i);
    if (m) {
      const base = Number(m[1]), u = (m[2] || "").toLowerCase();
      maxBudget = u === "m" ? base * 1_000_000 : u === "k" ? base * 1_000 : base;
    }
  }
  const bm = t.match(/(\d+)\s*(?:bed|beds|bedroom|bedrooms)/i);
  const beds = bm ? Number(bm[1]) : undefined;
  return { minBudget, maxBudget, beds };
}

// fallback: parse minutes + destination name from text like "45 minutes to London Bridge Underground by transit"
function parseCommuteFromText(text: string) {
  const t = (text || "").toLowerCase();
  const mins = Number((t.match(/(\d+)\s*(?:min|mins|minutes)/) || [])[1]) || 45;
  // destination: take text between "to " and " by" if present
  const destMatch = text.match(/to\s+(.+?)(?:\s+by|\s*[,.;]|$)/i);
  const dest = destMatch?.[1]?.trim() || "City of London";
  // mode
  const mode = /walking/.test(t) ? "walking" : /bike|bicycl/.test(t) ? "bicycling" : /driv/.test(t) ? "driving" : "transit";
  return { mins, dest, mode };
}

// stable ID
function ensureId(L: any) {
  if (L.id) return String(L.id);
  const lat = Number(L.latitude ?? L.lat ?? 0).toFixed(5);
  const lng = Number(L.longitude ?? L.lng ?? 0).toFixed(5);
  const price = Number(L.price_gbp ?? 0);
  return `${lat},${lng},${price}`;
}

export default function Page() {
  const [text, setText] = useState(
    "Quiet street near a big park, cafés and a good supermarket, 45 minutes to London Bridge Underground by transit. 3 beds between £400,000 and £800,000."
  );

  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [listings, setListings] = useState<MinimalListing[] | null>(null);

  const [durations, setDurations] = useState<Record<string, number>>({});
  const [destination, setDestination] = useState<{ lat: number; lng: number; name: string } | null>(null);

  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg] = useState("");

  // detail panel state
  const [selected, setSelected] = useState<ListingExt | null>(null);
  const [nearby, setNearby] = useState<{ park?: { name: string; distance_m: number }; supermarket?: { name: string; distance_m: number } } | null>(null);

  useEffect(() => {
    loadListingsCsv()
      .then((data) => setListings(data))
      .catch((err) => setErrMsg(`CSV load failed: ${err.message}`));
  }, []);

  // filtered listings (budget/beds + commute + proximity to center)
  const filteredListings = useMemo(() => {
    if (!listings || !center) return [];
    const { minBudget, maxBudget, beds } = parseBudgetBeds(text);
    const radiusKm = 25;
    const maxMins = parseCommuteFromText(text).mins;

    return listings
      .map((L: any) => {
        const latitude = Number(L.latitude ?? L.lat);
        const longitude = Number(L.longitude ?? L.lng);
        const id = ensureId(L);
        const mins = durations[id];

        return {
          ...(L as any),
          id,
          latitude,
          longitude,
          price_gbp: Number(L.price_gbp || 0),
          _mins: mins as number | undefined,
        } as ListingExt;
      })
      .filter((L) => {
        if (!Number.isFinite(L.latitude) || !Number.isFinite(L.longitude)) return false;
        const near = distanceKm(center, { lat: L.latitude, lng: L.longitude }) <= radiusKm;
        const price = L.price_gbp || 0;
        const okMin = typeof minBudget === "number" ? price >= minBudget : true;
        const okMax = typeof maxBudget === "number" ? price <= maxBudget : true;
        const okBeds = typeof (L as any).bedrooms === "number" ? (L as any).bedrooms >= (parseBudgetBeds(text).beds ?? 0) : true;
        const okCommute = typeof L._mins === "number" ? L._mins <= maxMins : true; // don't hide before durations arrive
        return near && okMin && okMax && okBeds && okCommute;
      })
      .sort((a, b) => {
        const am = typeof a._mins === "number" ? a._mins : 9999;
        const bm = typeof b._mins === "number" ? b._mins : 9999;
        if (am !== bm) return am - bm;
        return (a.price_gbp || 0) - (b.price_gbp || 0);
      });
  }, [listings, center, text, durations]);

  async function runSearch() {
    setErrMsg("");
    setLoading(true);
    setDurations({});
    setSelected(null);
    setNearby(null);

    try {
      // 1) parse destination & mode from text (fallback method)
      const { dest, mode } = parseCommuteFromText(text);

      // 2) geocode destination to lat/lng
      const g = await fetch("/api/geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: dest }),
      });
      if (!g.ok) throw new Error("Failed to geocode destination");
      const gjson = await g.json();
      setDestination({ lat: gjson.lat, lng: gjson.lng, name: gjson.name || dest });

      // 3) score areas -> we still let the server decide an overall center to display (e.g., area centroid)
      const scoreRes = await fetch("/api/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parsed: { destination: { lat: gjson.lat, lng: gjson.lng, mode } } }),
      });
      if (!scoreRes.ok) {
        const j = await scoreRes.json().catch(() => ({}));
        throw new Error(j?.error || `Score error (${scoreRes.status})`);
      }
      const json = await scoreRes.json();
      setCenter(json.center);
      setTiles(json.results || []);

      // 4) batch commute minutes for nearby candidates (quota friendly)
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
              Number.isFinite(L.latitude) &&
              Number.isFinite(L.longitude) &&
              distanceKm(json.center, { lat: L.latitude, lng: L.longitude }) <= radiusKm
          );

        const cRes = await fetch("/api/commute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            origin: { lat: gjson.lat, lng: gjson.lng }, // destination/work
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

  // when a listing is clicked (on the map or in the list)
  async function openDetails(L: ListingExt) {
    setSelected(L);
    setNearby(null);
    try {
      const res = await fetch("/api/nearby", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat: L.latitude, lng: L.longitude }),
      });
      if (res.ok) setNearby(await res.json());
    } catch {}
  }

  const maxMinsText = parseCommuteFromText(text).mins;

  return (
    <main className="max-w-5xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold">RealHome</h1>
        <div className="flex items-center gap-2">
          {listings && <Badge>Listings loaded: {listings.length.toLocaleString()}</Badge>}
          <Badge>Tiles cap: {process.env.NEXT_PUBLIC_TILES_CAP || process.env.REALHOME_MAX_TILES || 140}</Badge>
        </div>
      </div>

      {errMsg && <ErrorBanner message={errMsg} />}

      <div className="space-y-3">
        <label className="block text-sm font-medium">Describe your ideal location</label>
        <textarea
          className="w-full rounded-xl border p-3"
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g., 45 minutes to London Bridge Underground by transit, 3 beds, between £400k and £800k, near a big park and supermarket."
        />
        <button onClick={runSearch} disabled={loading} className="rounded-xl px-4 py-2 bg-black text-white disabled:opacity-60">
          {loading ? "Finding areas…" : "Find areas"}
        </button>
        {loading && <LoadingSpinner label="Scoring areas & checking commute…" />}
      </div>

      {center && (
        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <Map
              center={center}
              tiles={tiles.slice(0, 140)}
              listings={filteredListings.slice(0, 300)}
              durations={durations}
              onSelect={(l) => openDetails(l as ListingExt)}
            />
          </div>

          <div className="space-y-3">
            <h2 className="text-lg font-medium">Top listings</h2>
            <ol className="space-y-2">
              {filteredListings.slice(0, 12).map((L) => (
                <li key={L.id} className="rounded-xl border p-3 hover:bg-gray-50 cursor-pointer" onClick={() => openDetails(L)}>
                  <div className="font-medium">
                    £{(L.price_gbp || 0).toLocaleString()} · {L.bedrooms} bed {L.property_type}
                  </div>
                  <div className="text-xs text-gray-600">
                    {L.postcode}, {L.city}
                    {typeof L._mins === "number" && <span> · Commute {L._mins} min</span>}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}

      {/* Details panel */}
      {selected && (
        <div className="fixed inset-0 bg-black/40 flex items-end md:items-center justify-center z-50" onClick={() => setSelected(null)}>
          <div className="bg-white w-full md:max-w-xl rounded-t-2xl md:rounded-2xl p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Listing details</h3>
              <button className="text-sm px-3 py-1 rounded-lg border" onClick={() => setSelected(null)}>
                Close
              </button>
            </div>
            <div className="text-sm">
              <div className="font-medium">
                £{(selected.price_gbp || 0).toLocaleString()} · {selected.bedrooms} bed {selected.property_type}
              </div>
              <div className="text-gray-600">
                {selected.postcode}, {selected.city}
                {typeof selected._mins === "number" && destination && (
                  <span>
                    {" "}
                    · Commute to <strong>{destination.name}</strong>: {selected._mins} min
                  </span>
                )}
              </div>

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

              <div className="mt-3">
                <div className="font-medium">Why this matches</div>
                <ul className="list-disc list-inside text-gray-700">
                  {typeof selected._mins === "number" && (
                    <li>
                      Commute ≤ {maxMinsText} min ({selected._mins} min)
                    </li>
                  )}
                  <li>
                    Bedrooms: {selected.bedrooms} (meets your minimum)
                  </li>
                  <li>Budget satisfied (price shown above)</li>
                  <li>Near park & supermarket (see Nearby)</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
