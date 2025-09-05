import { NextResponse } from "next/server";

const API_KEY = process.env.GOOGLE_MAPS_SERVER_KEY as string;

type NearbyResult = {
  name: string;
  distance_m: number;
};

function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const aa =
    s1 * s1 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * s2 * s2;
  return 2 * R * Math.asin(Math.sqrt(aa));
}

async function findOneType(lat: number, lng: number, type: "park" | "supermarket"): Promise<NearbyResult | null> {
  const url = new URL("https://maps.googleapis.com/maps/api/place/nearbysearch/json");
  url.searchParams.set("location", `${lat},${lng}`);
  url.searchParams.set("radius", "1500"); // ~1.5km
  url.searchParams.set("type", type);
  url.searchParams.set("key", API_KEY);

  const res = await fetch(url.toString());
  if (!res.ok) return null;
  const data = await res.json();

  const items = (data?.results || []).filter((r: any) => Array.isArray(r.types) && r.types.includes(type));
  if (!items.length) return null;

  // Prefer higher rating, then closer
  items.sort((a: any, b: any) => {
    const ra = a.rating ?? 0, rb = b.rating ?? 0;
    if (rb !== ra) return rb - ra;
    const da = haversineMeters({ lat, lng }, { lat: a.geometry.location.lat, lng: a.geometry.location.lng });
    const db = haversineMeters({ lat, lng }, { lat: b.geometry.location.lat, lng: b.geometry.location.lng });
    return da - db;
  });

  const top = items[0];
  return {
    name: top.name,
    distance_m: Math.round(
      haversineMeters({ lat, lng }, { lat: top.geometry.location.lat, lng: top.geometry.location.lng })
    ),
  };
}

export async function POST(req: Request) {
  try {
    if (!API_KEY) {
      return NextResponse.json({ error: "Server Places key is missing" }, { status: 500 });
    }
    const body = await req.json();
    const lat = Number(body?.lat);
    const lng = Number(body?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return NextResponse.json({ error: "Invalid coordinates" }, { status: 400 });
    }

    const [park, supermarket] = await Promise.all([
      findOneType(lat, lng, "park"),
      findOneType(lat, lng, "supermarket"),
    ]);

    return NextResponse.json({
      park: park || null,
      supermarket: supermarket || null,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Nearby failed" }, { status: 500 });
  }
}
