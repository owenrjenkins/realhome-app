import { NextResponse } from "next/server";

const KEY = process.env.GOOGLE_MAPS_SERVER_KEY!;

/**
 * POST /api/nearby
 * Body: { lat: number, lng: number, radius?: number }
 * Returns: {
 *   park?: { name: string, distance_m: number },
 *   supermarket?: { name: string, distance_m: number }
 * }
 */
export async function POST(req: Request) {
  try {
    const { lat, lng, radius = 1200 } = await req.json();
    if (typeof lat !== "number" || typeof lng !== "number") throw new Error("missing_lat_lng");

    async function topPlace(type: string) {
      const url =
        "https://maps.googleapis.com/maps/api/place/nearbysearch/json?key=" +
        KEY +
        `&location=${lat},${lng}&radius=${radius}&type=${encodeURIComponent(type)}`;
      const res = await fetch(url);
      const j = await res.json();
      const item = j?.results?.[0];
      if (!item) return undefined;

      // Distance Matrix to get walking distance/time is overkill for now; use straight-line distance
      function haversine(lat1: number, lng1: number, lat2: number, lng2: number) {
        const R = 6371000;
        const dLat = ((lat2 - lat1) * Math.PI) / 180;
        const dLng = ((lng2 - lng1) * Math.PI) / 180;
        const a =
          Math.sin(dLat / 2) ** 2 +
          Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
        return 2 * R * Math.asin(Math.sqrt(a));
      }

      const p = item.geometry?.location;
      const dist = p ? Math.round(haversine(lat, lng, p.lat, p.lng)) : undefined;

      return { name: item.name, distance_m: dist };
    }

    const [park, supermarket] = await Promise.all([topPlace("park"), topPlace("supermarket")]);

    return NextResponse.json({ park, supermarket });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "nearby_failed" }, { status: 500 });
  }
}
