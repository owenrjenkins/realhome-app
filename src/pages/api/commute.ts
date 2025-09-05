import type { NextApiRequest, NextApiResponse } from "next";

const KEY = process.env.GOOGLE_MAPS_SERVER_KEY;
const DM_URL = "https://maps.googleapis.com/maps/api/distancematrix/json";

type LatLng = { lat: number; lng: number };

function isFiniteNum(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}
function okLatLng(lat?: number, lng?: number) {
  return isFiniteNum(lat) && isFiniteNum(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
}
// Loose UK bounds to avoid accidental US hits
function withinUK(lat: number, lng: number) {
  return lat >= 49 && lat <= 59.5 && lng >= -8.5 && lng <= 2.5;
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

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
    departure_time: "now",
    origins: `${origin.lat},${origin.lng}`,
    destinations: destStr,
  });

  let attempt = 0;
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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Method Not Allowed" });
    }
    if (!KEY) {
      return res.status(500).json({ error: "SERVER_KEY_MISSING" });
    }

    const { origin, mode = "driving", listings = [] } = req.body || {};
    if (!okLatLng(origin?.lat, origin?.lng)) {
      return res.status(400).json({ error: "missing_or_invalid_origin" });
    }

    // Clean inputs: valid IDs and UK-ish coords only
    type Clean = { id: string; lat: number; lng: number };
    const clean: Clean[] = (Array.isArray(listings) ? listings : [])
      .map((x: any) => ({
        id: String(x?.id ?? ""),
        lat: Number(x?.latitude),
        lng: Number(x?.longitude),
      }))
      .filter((x) => x.id && okLatLng(x.lat, x.lng) && withinUK(x.lat, x.lng));

    if (clean.length === 0) {
      return res.status(200).json({ durations: {} });
    }

    const CHUNK = 25; // Distance Matrix limit
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

    return res.status(200).json({ durations: durationsMins });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "commute_failed" });
  }
}
