import { NextResponse } from "next/server";

const BASE = "https://maps.googleapis.com/maps/api/distancematrix/json";
const KEY = process.env.GOOGLE_MAPS_SERVER_KEY!;

// Google allows up to 25 destinations per request on the standard tier.
// We'll chunk to be safe and return a map id -> minutes.
export async function POST(req: Request) {
  try {
    const { origin, mode = "transit", listings = [] } = await req.json();
    if (!origin?.lat || !origin?.lng) throw new Error("missing_origin");
    if (!Array.isArray(listings) || listings.length === 0) {
      return NextResponse.json({ durations: {} });
    }

    const chunks: any[][] = [];
    const size = 25;
    for (let i = 0; i < listings.length; i += size) {
      chunks.push(listings.slice(i, i + size));
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
        const sec =
          el?.duration_in_traffic?.value ??
          el?.duration?.value ??
          null;
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
