import { NextResponse } from "next/server";

/**
 * POST /api/commute
 * Body:
 * {
 *   origin: { lat: number; lng: number },               // required (work/destination)
 *   mode?: "driving"|"transit"|"walking"|"bicycling",   // default "driving"
 *   listings: Array<{ id: string|number; latitude: number; longitude: number }>
 * }
 *
 * Response:
 * {
 *   durations: { [id: string]: number }   // minutes, only for listings that succeeded
 * }
 *
 * Notes:
 * - Uses GOOGLE_MAPS_SERVER_KEY (set it in Vercel env).
 * - Batches Distance Matrix requests (25 destinations per call).
 * - Validates UK-ish coordinates and skips bad rows so one dud doesn’t kill the call.
 */

const KEY = process.env.GOOGLE_MAPS_SERVER_KEY;
const DM_URL = "https://maps.googleapis.com/maps/api/distancematrix/json";

// --- Helpers ---------------------------------------------------------------

type LatLng = { lat: number; lng: number };

function isFiniteNum(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}
function okLatLng(lat?: number, lng?: number): lat is number {
  return isFiniteNum(lat) && isFiniteNum(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
}
/** Loose UK bounding box (avoid US “Manchester” problems downstream) */
function withinUK(lat: number, lng: number) {
  return lat >= 49 && lat <= 59.5 && lng >= -8.5 && lng <= 2.5;
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Calls Distance Matrix for one origin → many destinations (<=25 per call).
 * Returns seconds for each destination in order, or null when not available.
 */
async function getBatchDurations(
  origin: LatLng,
  dests: LatLng[],
  mode: "driving" | "transit" | "walking" | "bicycling"
): Promise<(number | null)[]> {
  const out = new Array<number | null>(dests.length).fill(null);
  if (!dests.length) return out;

  const destStr = dests.map((d) => `${d.lat},${d.lng}`).join("|");

  const params = new URLSearchParams({
    key: KEY as string,
    mode,
    units: "metric",
    departure_time: "now", // better estimates for driving/transit
    origins: `${origin.lat},${origin.lng}`,
    destinations: destStr,
  });

  // Gentle retry for transient rate limits
  let attempt = 0;
  // Max 3 attempts: ~0.4s, 0.8s, 1.6s
  while (attempt < 3) {
    const resp = await fetch(`${DM_URL}?${params.toString()}`, { method: "GET", cache: "no-store" });
    const data = await resp.json().catch(() => ({}));

    if (!resp.ok || data?.status === "OVER_QUERY_LIMIT" || data?.status === "REQUEST_DENIED") {
      attempt += 1;
      if (attempt >= 3) break;
      await sleep(400 * 2 ** (attempt - 1));
      continue;
    }

    const row = data?.rows?.[0]?.elements;
    if (!Array.isArray(row)) break;

    row.forEach((el: any, i: number) => {
      const sec = el?.duration_in_traffic?.value ?? el?.duration?.value ?? null;
      out[i] = typeof sec === "number" ? sec : null;
    });

    break;
  }

  return out;
}

// --- Route -----------------------------------------------------------------

export async function POST(req: Request) {
  try {
    if (!KEY) {
      return NextResponse.json({ error: "SERVER_KEY_MISSING" }, { status: 500 });
    }

    const body = await req.json().catch(() => ({}));
    const origin = body?.origin as LatLng | undefined;
    const mode = (body?.mode ??
      "driving") as "driving" | "transit" | "walking" | "bicycling";
    const listings = Array.isArray(body?.listings) ? body.listings : [];

    if (!origin || !okLatLng(origin.lat, origin.lng)) {
      return NextResponse.json({ error: "missing_or_invalid_origin" }, { status: 400 });
    }

    // Clean + validate inputs; keep only UK-ish, valid coords
    type Clean = { id: string; lat: number; lng: number };
    const clean: Clean[] = listings
      .map((x: any) => ({
        id: String(x?.id ?? ""),
        lat: Number(x?.latitude),
        lng: Number(x?.longitude),
      }))
      .filter((x) => x.id && okLatLng(x.lat, x.lng) && withinUK(x.lat, x.lng));

    if (clean.length === 0) {
      return NextResponse.json({ durations: {} });
    }

    // Batch at 25 destinations per call (Distance Matrix limit)
    const CHUNK = 25;
    const durationsMins: Record<string, number> = {};

    for (let i = 0; i < clean.length; i += CHUNK) {
      const chunk = clean.slice(i, i + CHUNK);
      const dests = chunk.map((c) => ({ lat: c.lat, lng: c.lng }));
      const secs = await getBatchDurations(origin, dests, mode);

      secs.forEach((s, idx) => {
        if (typeof s === "number") {
          durationsMins[chunk[idx].id] = Math.round(s / 60);
        }
      });
    }

    return NextResponse.json({ durations: durationsMins });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "commute_failed" }, { status: 500 });
  }
}

// Explicitly reject non-POST to avoid 405 confusion during debugging
export async function GET() {
  return NextResponse.json({ error: "Method Not Allowed" }, { status: 405 });
}
