import { NextResponse } from "next/server";

const BASE = "https://maps.googleapis.com/maps/api/distancematrix/json";
const KEY = process.env.GOOGLE_MAPS_SERVER_KEY!;

/**
 * POST /api/commute
 * Body: {
 *   origin: { lat, lng },      // destination/work coordinates
 *   mode: "transit"|"driving"|"walking"|"bicycling",
 *   listings: [{ id, latitude, longitude }]
 * }
 * Returns: { durations: { [listingId]: minutes } }
 */
export async function POST(req: Request) {
  try {
    const { origin, mode = "transit", listings = [] } = await req.json();
    if (!origin?.lat || !origin?.lng) throw new Error("missing_origin");
    if (!Array.isArray(listings) || listings.length === 0) {
      return NextResponse.json({ durations: {} });
    }

    const chunkSize = 25; // Distance Matrix standard tier limit
    const chunks: any[][] = [];
    for (let i = 0; i < listings.length; i += chunkSize) {
      chunks.push(listings.slice(i, i + chunkSize));
    }

    const durations: Record<string, number> = {};

    for (const chunk of chunks) {
      const dests = chunk.map((l) => `${l.latitude},${l.longitude}`).join("|");
      const url =
        `${BASE}?key=${KEY}` +
        `&mode=${encodeURIComponent(mode)}` +
        `&units=metric&departure_time=now` +
        `&origins=${encodeURIComponent(`${origin.lat},${origin.lng}`)}` +
        `&destinations=${encodeURIComponent(dests)}`;

      const res = await fetch(url);
      const j = await res.json();

      const row = j?.rows?.[0]?.elements || [];
      row.forEach((el: any, idx: number) => {
        const sec = el?.duration?.value ?? el?.duration_in_traffic?.value ?? null;
        const mins = sec ? Math.round(sec / 60) : null;
        const id = chunk[idx].id;
        if (mins !== null && id) durations[id] = mins;
      });
    }

    return NextResponse.json({ durations });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "commute_failed" }, { status: 500 });
  }
}
