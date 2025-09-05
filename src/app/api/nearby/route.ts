// src/app/api/nearby/route.ts
import { NextRequest, NextResponse } from "next/server";

const SERVER_KEY = process.env.GOOGLE_MAPS_SERVER_KEY!;
if (!SERVER_KEY) {
  console.warn("GOOGLE_MAPS_SERVER_KEY is missing");
}

type NearbyResp = {
  park?: { name: string; distance_m: number };
  supermarket?: { name: string; distance_m: number };
  error?: string;
};

function haversine(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371e3;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Use Places API v1 (recommended HTTP endpoint)
async function findPlaceNearby(
  lat: number,
  lng: number,
  includedTypes: string[],
  fieldMask: string
) {
  const url = "https://places.googleapis.com/v1/places:searchNearby";
  const body = {
    locationBias: {
      circle: { center: { latitude: lat, longitude: lng }, radius: 2000 }, // 2km
    },
    includedTypes,
    maxResultCount: 1,
    rankPreference: "DISTANCE",
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "X-Goog-Api-Key": SERVER_KEY!,
      "X-Goog-FieldMask": fieldMask,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const msg = await resp.text().catch(() => "");
    throw new Error(`Places error ${resp.status}: ${msg}`);
  }
  return resp.json();
}

export async function POST(req: NextRequest) {
  try {
    const { lat, lng } = await req.json();
    if (typeof lat !== "number" || typeof lng !== "number") {
      return NextResponse.json<NearbyResp>({ error: "Invalid coordinates" }, { status: 400 });
    }
    if (!SERVER_KEY) {
      return NextResponse.json<NearbyResp>({ error: "Server key not configured" }, { status: 500 });
    }

    // Park
    let park: NearbyResp["park"] | undefined;
    try {
      const jp = await findPlaceNearby(
        lat,
        lng,
        ["park"],
        "places.displayName,places.location"
      );
      const p = jp.places?.[0];
      if (p?.location?.latitude && p?.location?.longitude) {
        park = {
          name: p.displayName?.text || "Park",
          distance_m: Math.round(haversine(lat, lng, p.location.latitude, p.location.longitude)),
        };
      }
    } catch (e) {
      // swallow; we'll just omit park
      console.warn("Nearby park failed:", e);
    }

    // Supermarket / grocery
    let supermarket: NearbyResp["supermarket"] | undefined;
    try {
      const js = await findPlaceNearby(
        lat,
        lng,
        ["supermarket", "grocery_store"],
        "places.displayName,places.location"
      );
      const s = js.places?.[0];
      if (s?.location?.latitude && s?.location?.longitude) {
        supermarket = {
          name: s.displayName?.text || "Supermarket",
          distance_m: Math.round(haversine(lat, lng, s.location.latitude, s.location.longitude)),
        };
      }
    } catch (e) {
      console.warn("Nearby supermarket failed:", e);
    }

    return NextResponse.json<NearbyResp>({ park, supermarket });
  } catch (e: any) {
    return NextResponse.json<NearbyResp>({ error: e?.message || "Nearby failed" }, { status: 500 });
  }
}
