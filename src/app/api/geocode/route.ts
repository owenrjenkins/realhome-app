import { NextResponse } from "next/server";

const KEY = process.env.GOOGLE_MAPS_SERVER_KEY;

/**
 * POST /api/geocode
 * Body: { query: string }
 * Returns: { lat, lng, name }
 *
 * Strong UK bias:
 * - Adds ", UK" if the user didn’t specify a country
 * - Uses components=country:GB and region=uk
 */
export async function POST(req: Request) {
  try {
    if (!KEY) throw new Error("SERVER_KEY_MISSING");
    const { query } = await req.json();
    if (!query || typeof query !== "string") {
      return NextResponse.json({ error: "missing_query" }, { status: 400 });
    }

    // Normalise and bias to the UK
    const trimmed = query.trim();
    const hasCountry = /,\s*uk|,\s*united kingdom|,\s*great britain/i.test(trimmed);
    const q = hasCountry ? trimmed : `${trimmed}, UK`;

    const params = new URLSearchParams({
      address: q,
      components: "country:GB",
      region: "uk",
      key: KEY,
    });

    const url = `https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`;
    const res = await fetch(url, { method: "GET", cache: "no-store" });
    const j = await res.json();

    if (!res.ok || j.status === "REQUEST_DENIED") {
      const msg = j.error_message || "geocode_denied";
      return NextResponse.json({ error: msg }, { status: 502 });
    }
    if (j.status !== "OK" || !Array.isArray(j.results) || j.results.length === 0) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const item = j.results[0];
    const loc = item?.geometry?.location;
    if (!loc || typeof loc.lat !== "number" || typeof loc.lng !== "number") {
      return NextResponse.json({ error: "invalid_location" }, { status: 502 });
    }

    const name =
      item?.address_components?.find((c: any) => c.types?.includes("locality"))?.long_name ||
      item?.formatted_address ||
      q;

    return NextResponse.json({ lat: loc.lat, lng: loc.lng, name });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "geocode_failed" }, { status: 500 });
  }
}
