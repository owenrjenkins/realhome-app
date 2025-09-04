import { NextResponse } from "next/server";

const KEY = process.env.GOOGLE_MAPS_SERVER_KEY!;

/**
 * POST /api/geocode
 * Body: { query: string }
 * Returns: { lat, lng, name }
 *
 * UK-biased geocoding: restricts to country:GB and also appends "UK" if user
 * hasn't specified a country. Fixes "Manchester (US)" issues.
 */
export async function POST(req: Request) {
  try {
    const { query } = await req.json();
    if (!query || typeof query !== "string") throw new Error("missing_query");

    const q = /\b(uk|united kingdom|gb|great britain)\b/i.test(query) ? query : `${query}, UK`;

    const params = new URLSearchParams({
      address: q,
      key: KEY,
      region: "GB",                 // bias results to GB
      components: "country:GB",     // restrict to GB
    });

    const url = `https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`;
    const res = await fetch(url);
    const j = await res.json();

    const item = j?.results?.[0];
    const loc = item?.geometry?.location;
    if (!loc) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const name =
      item?.address_components?.find((c: any) => c.types?.includes("locality"))?.long_name ||
      item?.formatted_address ||
      query;

    return NextResponse.json({ lat: loc.lat, lng: loc.lng, name });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "geocode_failed" }, { status: 500 });
  }
}
