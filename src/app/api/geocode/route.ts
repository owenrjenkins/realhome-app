import { NextResponse } from "next/server";

const KEY = process.env.GOOGLE_MAPS_SERVER_KEY!;

export async function POST(req: Request) {
  try {
    const { query } = await req.json();
    if (!query || typeof query !== "string") throw new Error("missing_query");

    // Use the Places Text Search API (good for stations/POIs) with fields=geometry only.
    const url =
      "https://maps.googleapis.com/maps/api/place/textsearch/json?query=" +
      encodeURIComponent(query) +
      "&key=" +
      KEY;

    const res = await fetch(url);
    const j = await res.json();

    const item = j?.results?.[0];
    const loc = item?.geometry?.location;
    if (!loc) return NextResponse.json({ error: "not_found" }, { status: 404 });

    return NextResponse.json({ lat: loc.lat, lng: loc.lng, name: item?.name || query });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "geocode_failed" }, { status: 500 });
  }
}
