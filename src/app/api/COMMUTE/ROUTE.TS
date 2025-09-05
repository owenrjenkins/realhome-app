import { NextResponse } from "next/server";

const BASE = "https://maps.googleapis.com/maps/api/distancematrix/json";
const KEY = process.env.GOOGLE_MAPS_SERVER_KEY;

type LatLng = { lat: number; lng: number };

function okLatLng(lat?: number, lng?: number) {
  return typeof lat === "number" && typeof lng === "number" && isFinite(lat) && isFinite(lng) &&
         Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
}
function withinUK(lat: number, lng: number) {
  return lat >= 49 && lat <= 59.5 && lng >= -8.5 && lng <= 2.5;
}

/**
 * POST /api/commute
 * Body: {
 *   origin: { lat, lng },      // destination/work coordinates
 *   mode?: "transit"|"driving"|"walking"|"bicycling",
 *   listings: [{ id, latitude, longitude }]
 * }
 * Returns: { durations: { [listingId]: minutes } }
 */
export async function POST(req: Request) {
  try {
    if (!KEY) throw new Error("SERVER_KEY_MISSING");
    const { origin, mode = "transit", listings = [] } = await req.json();

    if (!okLatLng(origin?.lat, origin?.lng)) {
      return NextResponse.json({ error: "missing_or_invalid_origin" }, { status: 400 });
    }

    // Sanitize input listings
    const clean = (Array.isArray(listings) ? listings : [])
      .map((x: any) => ({ id: String(x.id ?? ""), lat: Number(x.latitude), lng: Number(x.longitude) }))
      .filter((x) => x.id && okLatLng(x.lat, x.lng) && withinUK(x.lat, x.lng));

    if (clean.length === 0) {
      return NextResponse.json({ durations: {} });
    }

    // Distance Matrix: 1 origin to N destinations, 25 per call
    const chunkSize = 25;
    const durations: Record<string, number> = {};

    for (let i = 0; i < clean.length; i += chunkSize) {
      const chunk = clean.slice(i, i + chunkSize);
      const destStr = chunk.map((d) => `${d.lat},${d.lng}`).join("|");

      const params = new URLSearchParams({
        key: KEY,
        mode,
        units: "metric",
        // Better results for driving/transit:
        departure_time: "now",
        origins: `${origin.lat},${origin.lng}`,
        destinations: destStr,
      });

      let attempt = 0;
      while (true) {
        const resp = await fetch(`${BASE}?${params.toString()}`, { method: "GET", cache: "no-store" });
        const j = await resp.json();

        if (!resp.ok || j.status === "OVER_QUERY_LIMIT" || j.status === "REQUEST_DENIED") {
          if (attempt < 2) {
            attempt++;
            await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
            continue;
          }
          break; // give up on this chunk gracefully
        }

        const row = j?.rows?.[0]?.elements || [];
        row.forEach((el: any, idx: number) => {
          const sec = el?.duration_in_traffic?.value ?? el?.duration?.value ?? null;
          const mins = sec ? Math.round(sec / 60) : null;
          const id = chunk[idx].id;
          if (mins !== null && id) durations[id] = mins;
        });

        break;
      }
    }

    return NextResponse.json({ durations });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "commute_failed" }, { status: 500 });
  }
}
