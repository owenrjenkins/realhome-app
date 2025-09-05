// src/app/api/directions/route.ts
import { NextRequest, NextResponse } from "next/server";

const SERVER_KEY = process.env.GOOGLE_MAPS_SERVER_KEY!;
if (!SERVER_KEY) {
  console.warn("GOOGLE_MAPS_SERVER_KEY is missing");
}

type RouteStep =
  | {
      type: "TRANSIT";
      vehicle: string;
      line: string;
      headsign: string;
      num_stops: number;
      departure_stop: string;
      arrival_stop: string;
      duration_min: number;
    }
  | {
      type: "WALK" | "DRIVE";
      instruction?: string;
      distance_m?: number;
      duration_min: number;
    };

type DirectionsResp = {
  duration_min: number;
  steps: RouteStep[];
  error?: string;
};

export async function POST(req: NextRequest) {
  try {
    const { origin, destination, mode } = await req.json();
    if (!origin || !destination) {
      return NextResponse.json<DirectionsResp>({ error: "Missing coords" }, { status: 400 });
    }
    const travelMode =
      mode === "walking" ? "walking" : mode === "bicycling" ? "bicycling" : mode === "driving" ? "driving" : "transit";

    const url = new URL("https://maps.googleapis.com/maps/api/directions/json");
    url.searchParams.set("origin", `${origin.lat},${origin.lng}`);
    url.searchParams.set("destination", `${destination.lat},${destination.lng}`);
    url.searchParams.set("mode", travelMode);
    url.searchParams.set("region", "gb");
    url.searchParams.set("key", SERVER_KEY);

    const resp = await fetch(url.toString(), { cache: "no-store" });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      throw new Error(`Directions error ${resp.status}: ${txt}`);
    }
    const j = await resp.json();

    if (j.status !== "OK" || !j.routes?.[0]?.legs?.[0]) {
      return NextResponse.json<DirectionsResp>({ error: j.status || "No route" }, { status: 400 });
    }

    const leg = j.routes[0].legs[0];
    const duration_min = Math.round((leg.duration?.value || 0) / 60);

    const steps: RouteStep[] = (leg.steps || []).map((s: any) => {
      if (s.travel_mode === "TRANSIT" && s.transit_details) {
        const td = s.transit_details;
        return {
          type: "TRANSIT",
          vehicle: td.line?.vehicle?.name || "Transit",
          line: td.line?.short_name || td.line?.name || "",
          headsign: td.headsign || "",
          num_stops: td.num_stops || 0,
          departure_stop: td.departure_stop?.name || "",
          arrival_stop: td.arrival_stop?.name || "",
          duration_min: Math.round((s.duration?.value || 0) / 60),
        };
      } else if (s.travel_mode === "WALKING") {
        return {
          type: "WALK",
          instruction: s.html_instructions?.replace(/<[^>]+>/g, ""),
          distance_m: s.distance?.value,
          duration_min: Math.round((s.duration?.value || 0) / 60),
        };
      } else {
        return {
          type: "DRIVE",
          instruction: s.html_instructions?.replace(/<[^>]+>/g, ""),
          distance_m: s.distance?.value,
          duration_min: Math.round((s.duration?.value || 0) / 60),
        };
      }
    });

    return NextResponse.json<DirectionsResp>({ duration_min, steps });
  } catch (e: any) {
    return NextResponse.json<DirectionsResp>({ error: e?.message || "Directions failed" }, { status: 500 });
  }
}
