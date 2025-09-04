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

// parse budget (range or max) and beds from free text
function parseBudgetBeds(input: string) {
  const t = (input || "").toLowerCase().replace(/[,£]/g, "").replace(/\s+/g, " ");
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

// naive commute minutes parser from text (fallback when /api/parse doesn't supply)
function parseMaxMinsFromText(input: string) {
  const m = (input || "").toLowerCase().match(/(\d+)\s*(?:min|mins|minutes)/);
  return m ? Number(m[1]) : undefined;
}

// Make sure every listing has a stable id; if missing, build one.
function ensureId(L: any) {
  if (L.id) return String(L.id);
  const lat = Number(L.latitude ?? L.lat ?? 0).toFixed(5);
  const lng = Number(L.longitude ?? L.lng ?? 0).toFixed(5);
  const price = Number(L.price_gbp ?? 0);
  return `${lat},${lng},${price}`;
}

// -------------------- page --------------------

export default function Page() {
  const [text, setText] = useState(
    "Quiet street near a big park, cafés and a good supermarket, within 45 minutes to City of London by transit. 3 beds between £400,000 and £800,000."
  );

  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [listings, setListings] = useState<MinimalListing[] | null>(null);

  // commute minutes per listing id
  const [durations, setDurations] = useState<Record<string, number>>({});
  // keep parsed request (if server returns details)
  const [parsed, setParsed] = useState<any>(null);

  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg] = useState("");

  // 1) load CSV once
  useEffect(() => {
    loadListingsCsv()
      .then((data) => setListings(data))
      .catch((err) => setErrMsg(`CSV load failed: ${err.message}`));
  }, []);

  // 2) compute filtered & scored listings (budget/beds + commute + proximity)
  const filteredListings = useMemo(() => {
    if (!listings || !center) return [];
    const { minBudget, maxBudget, beds } = parseBudgetBeds(text);
    const radiusKm = 25;
    const maxMins = parsed?.commutes?.[0]?.maxMins ?? parseMaxMinsFromText(text) ?? 45;

    return listings
      .map((L: any) => {
        const latitude = Number((L as any).latitude ?? (L as any).lat);
        const longitude = Number((L as any).longitude ?? (L as any).lng);
        const id = ensureId(L);

        const near = distanceKm(center, { lat: latitude, lng: longitude }) <= radiusKm;

        const price = Number((L as any).price_gbp) || 0;
        const okMin = typeof minBudget === "number" ? price >= minBudget : true;
        const okMax = typeof maxBudget === "number" ? price <= maxBudget : true;
        const okBeds = typeof beds === "number" ? Number((L as any).bedrooms || 0) >= beds : true;

        const mins = durations[id];
        const okCommute = typeof mins === "number" ? mins <= maxMins : true;

        // score for ordering in the list (simple heuristic)
        const score = (okCommute ? 1 : 0) + (okBeds ? 0.5 : 0) + (okMax && okMin ? 0.5 : 0);

        return {
          ...L,
          id,
          latitude,
          longitude,
          price_gbp: price,
          _mins: mins as number | undefined,
          _score: score,
        };
      })
      .filter((L: any) => {
        if (!L || Number.isNaN(L.latitude) || Number.isNaN(L.longitude)) return false;
        const near = distanceKm(center, { lat: L.latitude, lng: L.longitude }) <= 25;
        const price = L.price_gbp;
        const { minBudget, maxBudget, beds } = parseBudgetBeds(text);
        const okMin = typeof minBudget === "number" ? price >= minBudget : true;
        const okMax = typeof maxBudget === "number" ? price <= maxBudget : true;
        const okBeds = typeof beds === "number" ? (L.bedrooms || 0) >= beds : true;
        const maxMins = parsed?.commutes?.[0]?.maxMins ?? parseMaxMinsFromText(text) ?? 45;
        const okCommute = typeof L._mins === "number" ? L._mins <= maxMins : true;
        return near && okMin && okMax && okBeds && okCommute;
      })
      .sort((a: any, b: any) => {
        // Prefer lower commute minutes then lower price
        const am = typeof a._mins === "number" ? a._mins : 9999;
        const bm = typeof b._mins === "number" ? b._mins : 9999;
        if (am !== bm) return am - bm;
        return (a.price_gbp || 0) - (b.price_gbp || 0);
      });
  }, [listings, center, text, durations, parsed]);

  // 3) main search: parse → score tiles → fetch commute minutes for nearby candidates
  async function runSearch() {
    setErrMsg("");
    setLoading(true);
    setDurations({}); // reset between searches

    try {
      // Parse prompt (server)
      const parsedRes = await fetch("/api/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!parsedRes.ok) throw new Error(`Parse error (${parsedRes.status})`);
      const parsedJson = await parsedRes.json();
      setParsed(parsedJson);

      // Score tiles + get center
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

      // Commute durations for nearby candidates (quota friendly)
      if (listings && json.center) {
        const radiusKm = 25;
        const nearby = listings
          .map((L: any) => ({
            ...L,
            id: ensureId(L),
            latitude: Number((L as any).latitude ?? (L as any).lat),
            longitude: Number((L as any).longitude ?? (L as any).lng),
          }))
          .filter(
            (L) =>
              !Number.isNaN(L.latitude) &&
              !Number.isNaN(L.longitude) &&
              distanceKm(json.center, { lat: L.latitude, lng: L.longitude }) <= radiusKm
          );

        const body = {
          origin: json.center,
          mode: parsedJson?.commutes?.[0]?.mode || "transit",
          listings: nearby.slice(0, 200).map((L) => ({ id: L.id, latitude: L.latitude, longitude: L.longitude })),
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
            <h2 className="text-lg font-medium">Top listings</h2>
            <ol className="space-y-2">
              {filteredListings.slice(0, 12).map((L: any) => (
                <li key={L.id} className="rounded-xl border p-3">
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
    </main>
  );
}
