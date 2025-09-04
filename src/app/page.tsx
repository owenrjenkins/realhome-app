"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import LoadingSpinner from "@/components/LoadingSpinner";
import ErrorBanner from "@/components/ErrorBanner";
import Badge from "@/components/Badge";
import { loadListingsCsv, type MinimalListing } from "@/lib/loadCsv";

const Map = dynamic(() => import("@/components/Map"), { ssr: false });

type Tile = {
  lat: number;
  lng: number;
  score: number;
  parts?: { commute: number; amenity: number; vibe: number };
};

type Commute = {
  address: string;
  mode: "walking" | "bicycling" | "driving" | "transit";
  maxMins: number;
};

// -------------------- helpers --------------------

function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371; // km
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const aa = s1 * s1 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * s2 * s2;
  return 2 * R * Math.asin(Math.sqrt(aa));
}

// parse "between 400k and 800k", "400k-800k", "budget 800k", and "3 beds"
function parseClientPrefs(input: string) {
  const t = (input || "").toLowerCase().replace(/[,£]/g, "").replace(/\s+/g, " ");

  let minBudget: number | undefined;
  let maxBudget: number | undefined;

  // between X and Y
  let m = t.match(/between\s*([\d.]+)\s*(m|k)?\s*(?:and|to|-)\s*([\d.]+)\s*(m|k)?/i);
  if (m) {
    const a = Number(m[1]),
      au = (m[2] || "").toLowerCase();
    const b = Number(m[3]),
      bu = (m[4] || "").toLowerCase();
    const A = au === "m" ? a * 1_000_000 : au === "k" ? a * 1_000 : a;
    const B = bu === "m" ? b * 1_000_000 : bu === "k" ? b * 1_000 : b;
    minBudget = Math.min(A, B);
    maxBudget = Math.max(A, B);
  }

  // X-Y
  if (!maxBudget) {
    m = t.match(/(\d+(?:\.\d+)?)\s*(m|k)?\s*-\s*(\d+(?:\.\d+)?)\s*(m|k)?/i);
    if (m) {
      const a = Number(m[1]),
        au = (m[2] || "").toLowerCase();
      const b = Number(m[3]),
        bu = (m[4] || "").toLowerCase();
      const A = au === "m" ? a * 1_000_000 : au === "k" ? a * 1_000 : a;
      const B = bu === "m" ? b * 1_000_000 : bu === "k" ? b * 1_000 : b;
      minBudget = Math.min(A, B);
      maxBudget = Math.max(A, B);
    }
  }

  // single max
  if (!maxBudget) {
    m = t.match(/(?:budget|under|max)\s*(\d+(?:\.\d+)?)\s*(m|k)?/i);
    if (m) {
      const base = Number(m[1]),
        u = (m[2] || "").toLowerCase();
      maxBudget = u === "m" ? base * 1_000_000 : u === "k" ? base * 1_000 : base;
    }
  }

  // beds
  const bm = t.match(/(\d+)\s*(?:bed|beds|bedroom|bedrooms)/i);
  const beds = bm ? Number(bm[1]) : undefined;

  return { minBudget, maxBudget, beds };
}

// -------------------- page --------------------

export default function Page() {
  const [text, setText] = useState(
    "Quiet street near a big park, cafés and a good supermarket, within 45 minutes to City of London by transit. 3 beds between £400,000 and £800,000."
  );

  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [listings, setListings] = useState<MinimalListing[] | null>(null);
  const [durations, setDurations] = useState<Record<string, number>>({});
  const [parsed, setParsed] = useState<any>(null);

  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg] = useState("");

  // load CSV once
  useEffect(() => {
    loadListingsCsv()
      .then((data) => setListings(data))
      .catch((err) => setErrMsg(`CSV load failed: ${err.message}`));
  }, []);

  // commute-aware, budget/beds-aware listing filter
  const filteredListings = useMemo(() => {
    if (!listings || !center) return [];
    const { minBudget, maxBudget, beds } = parseClientPrefs(text);
    const radiusKm = 25;

    return listings.filter((L) => {
      const near = distanceKm(center, { lat: L.latitude, lng: L.longitude }) <= radiusKm;

      const price = L.price_gbp || 0;
      const okMin = typeof minBudget === "number" ? price >= minBudget : true;
      const okMax = typeof maxBudget === "number" ? price <= maxBudget : true;
      const okBeds = typeof beds === "number" ? (L.bedrooms || 0) >= beds : true;

      const mins = durations[L.id];
      const maxMins = parsed?.commutes?.[0]?.maxMins ?? 45;
      const okCommute = typeof mins === "number" ? mins <= maxMins : true; // don't hide before durations arrive

      return near && okMin && okMax && okBeds && okCommute;
    });
  }, [listings, center, text, durations, parsed]);

  async function runSearch() {
    setErrMsg("");
    setLoading(true);
    try {
      // 1) parse the prompt on the server
      const parsedRes = await fetch("/api/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!parsedRes.ok) throw new Error(`Parse error (${parsedRes.status})`);
      const parsedJson = await parsedRes.json();
      setParsed(parsedJson);

      // 2) score tiles + get search center
      const scoreRes = await fetch("/api/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parsed: parsedJson }),
      });
      if (!scoreRes.ok) {
        const j = await scoreRes.json().catch(() => ({}));
        throw new Error(j?.error || `Score error (${scoreRes.status})`);
      }
      const json = await scoreRes.json();
      setCenter(json.center);
      setTiles(json.results || []);

      // 3) get commute minutes for nearby candidate listings (quota-friendly)
      if (listings && json.center) {
        const radiusKm = 25;
        const nearby = listings.filter(
          (L) => distanceKm(json.center, { lat: L.latitude, lng: L.longitude }) <= radiusKm
        );
        const body = {
          origin: json.center,
          mode: parsedJson?.commutes?.[0]?.mode || "transit",
          listings: nearby.slice(0, 200), // cap calls
        };

        const cRes = await fetch("/api/commute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (cRes.ok) {
          const cj = await cRes.json();
          setDurations(cj.durations || {});
        }
      }
    } catch (e: any) {
      setErrMsg(e?.message || "Something went wrong while scoring. Please try again.");
    } finally {
      setLoading(false);
    }
  }

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
          placeholder="e.g., In Manchester, 30 min to Piccadilly by transit, near a big park and cafés, quiet at night, 3 beds, between £400k and £800k."
        />
        <button
          onClick={runSearch}
          disabled={loading}
          className="rounded-xl px-4 py-2 bg-black text-white disabled:opacity-60"
        >
          {loading ? "Finding areas…" : "Find areas"}
        </button>
        {loading && <LoadingSpinner label="Scoring candidate areas & checking commute…" />}
      </div>

      {center && (
        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <Map
              center={center}
              tiles={tiles.slice(0, 140)}
              listings={filteredListings.slice(0, 300)}
              durations={durations}
            />
          </div>

          <div className="space-y-3">
            <h2 className="text-lg font-medium">Top matches</h2>
            <ol className="space-y-2">
              {tiles.slice(0, 12).map((r, i) => (
                <li key={i} className="rounded-xl border p-3">
                  <div className="font-medium">Score {(r.score * 100).toFixed(0)}%</div>
                  {r.parts && (
                    <div className="text-xs text-gray-600">
                      Commute {(r.parts.commute * 100).toFixed(0)}% · Amenities {(r.parts.amenity * 100).toFixed(0)}%
                    </div>
                  )}
                  <div className="text-xs text-gray-600">
                    Lat {r.lat.toFixed(4)}, Lng {r.lng.toFixed(4)}
                  </div>
                </li>
              ))}
            </ol>

            <div className="pt-4">
              <h2 className="text-lg font-medium">
                Matching listings <span className="text-sm text-gray-500">({filteredListings.length})</span>
              </h2>
              <ul className="divide-y rounded-xl border">
                {filteredListings.slice(0, 8).map((L) => (
                  <li key={L.id} className="p-3 text-sm">
                    <div className="font-medium">£{(L.price_gbp || 0).toLocaleString()}</div>
                    <div className="text-gray-600">
                      {L.bedrooms} bed {L.property_type} — {L.postcode}, {L.city}
                      {typeof durations[L.id] === "number" && (
                        <span className="ml-2">· Commute {durations[L.id]} min</span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
