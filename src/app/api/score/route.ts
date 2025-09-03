import { NextResponse } from "next/server";

const BASE = "https://maps.googleapis.com";
const KEY = process.env.GOOGLE_MAPS_SERVER_KEY!;

async function geocode(address: string) {
  const u = `${BASE}/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${KEY}`;
  const r = await fetch(u);
  const j = await r.json();
  if (!j.results?.length) throw new Error("geocode_failed");
  return j.results[0].geometry.location as { lat:number; lng:number };
}

async function distMatrix(origin:{lat:number;lng:number}, dests:{lat:number;lng:number}[], mode:"walking"|"bicycling"|"driving"|"transit") {
  const o = `${origin.lat},${origin.lng}`;
  const d = dests.map(d=>`${d.lat},${d.lng}`).join("|");
  const u = `${BASE}/maps/api/distancematrix/json?key=${KEY}&mode=${mode}&departure_time=now&units=metric&origins=${o}&destinations=${d}`;
  const r = await fetch(u);
  return r.json();
}

function decay(minutes:number, threshold:number){ 
  if (minutes<=threshold) return 1; 
  const over=minutes-threshold; 
  return Math.max(0, Math.exp(-over/15)); 
}

export async function POST(req: Request) {
  try {
    const { parsed } = await req.json();
    const area = parsed?.areaCenter || "London, UK";
    const center = await geocode(area);

    // modest grid (quota-friendly)
    const tiles: {lat:number;lng:number}[] = [];
    for (let i=-2;i<=2;i++){
      for (let j=-2;j<=2;j++){
        tiles.push({ lat: center.lat + i*0.01, lng: center.lng + j*0.015 });
      }
    }

    const commute = parsed?.commutes?.[0] || { address: "City of London", mode: "transit", maxMins: 45 };
    const dest = await geocode(commute.address);

    const results = [];
    for (const t of tiles) {
      const dm = await distMatrix(t, [dest], (commute.mode as "walking"|"bicycling"|"driving"|"transit") || "transit");
      const sec = dm?.rows?.[0]?.elements?.[0]?.duration_in_traffic?.value ?? dm?.rows?.[0]?.elements?.[0]?.duration?.value ?? null;
      const mins = sec ? sec/60 : 9999;
      const commuteScore = decay(mins, commute.maxMins);
      const amenityStub = 0.5;
      const score = Math.max(0, Math.min(1, 0.6*commuteScore + 0.4*amenityStub));
      results.push({ ...t, score, parts: { commute: commuteScore, amenity: amenityStub, vibe: 0 } });
    }

    results.sort((a,b)=> b.score - a.score);
    return NextResponse.json({ center, results, dest });
  } catch (e: unknown) {
    const error = e as Error;
    return NextResponse.json({ error: error?.message || "score_failed" }, { status: 500 });
  }
}

