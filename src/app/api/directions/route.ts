import { NextResponse } from "next/server";

const KEY = process.env.GOOGLE_MAPS_SERVER_KEY!;

/**
 * POST /api/directions
 * Body: {
 *   origin: { lat: number, lng: number },        // listing coords
 *   destination: { lat: number, lng: number },   // named place coords
 *   mode?: "transit" | "driving" | "walking" | "bicycling"  (default "transit")
 * }
 *
 * Returns:
 * {
 *   duration_min: number,
 *   steps: Array<
 *     | { type: "WALK", distance_m: number, duration_min: number, instruction: string }
 *     | { type: "TRANSIT", line: string, vehicle: string, headsign: string, num_stops: number,
 *         departure_stop: string, arrival_stop: string }
 *   >
 * }
 */
export async function POST(req: Request) {
  try {
    const { origin, destination, mode = "transit" } = await req.json();
    if (!origin?.lat || !origin?.lng || !destination?.lat || !destination?.lng) {
      return NextResponse.json({ error: "missing_origin_or_destination" }, { status: 400 });
    }

    const params = new URLSearchParams({
      key: KEY,
      mode,
      origin: `${origin.lat},${origin.lng}`,
      destination: `${destination.lat},${destination.lng}`,
      departure_time: "now", // better for transit
    });

    const url = `https://maps.googleapis.com/maps/api/directions/json?${params.toString()}`;
    const res = await fetch(url);
    const json = await res.json();

    const route = json?.routes?.[0];
    const leg = route?.legs?.[0];
    if (!leg) {
      return NextResponse.json({ error: "no_route" }, { status: 404 });
    }

    const duration_min = Math.round((leg.duration_in_traffic?.value ?? leg.duration?.value ?? 0) / 60);

    const steps = (leg.steps || []).map((s: any) => {
      const smode = s.travel_mode;
      if (smode === "WALKING") {
        return {
          type: "WALK" as const,
          distance_m: s.distance?.value ?? 0,
          duration_min: Math.round((s.duration?.value ?? 0) / 60),
          instruction: s.html_instructions?.replace(/<[^>]+>/g, "") || "Walk",
        };
      }
      if (smode === "TRANSIT") {
        const det = s.transit_details || {};
        const line = det.line?.short_name || det.line?.name || "Transit";
        const vehicle = det.line?.vehicle?.name || det.line?.vehicle?.type || "Transit";
        const headsign = det.headsign || "";
        const num_stops = det.num_stops ?? 0;
        return {
          type: "TRANSIT" as const,
          line,
          vehicle,
          headsign,
          num_stops,
          departure_stop: det.departure_stop?.name || "",
          arrival_stop: det.arrival_stop?.name || "",
        };
      }
      // driving/bicycling fallback
      return {
        type: "WALK" as const,
        distance_m: s.distance?.value ?? 0,
        duration_min: Math.round((s.duration?.value ?? 0) / 60),
        instruction: s.html_instructions?.replace(/<[^>]+>/g, "") || smode,
      };
    });

    return NextResponse.json({ duration_min, steps });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "directions_failed" }, { status: 500 });
  }
}
