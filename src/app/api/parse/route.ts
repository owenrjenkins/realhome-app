import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const { text } = await req.json();
  const t = (text || "").toLowerCase();

  // area
  const areaMatch = t.match(/in\s+([a-z0-9 .,'-]+?)(?:\.|,|$)/i);
  const areaCenter = areaMatch ? areaMatch[1].trim() : "London, UK";

  // budget
  let maxBudget: number | undefined;
  const bud = t.match(/(?:budget|under|max)\s*£?\s*([\d,.]+)\s*(m|k)?/i);
  if (bud) {
    const base = Number(bud[1].replace(/[,£\s]/g,""));
    const unit = (bud[2]||"").toLowerCase();
    maxBudget = unit === "m" ? base * 1_000_000 : unit === "k" ? base * 1_000 : base;
  }

  // beds
  const bm = t.match(/(\d+)\s*(?:bed|beds|bedroom|bedrooms)/);
  const beds = bm ? Number(bm[1]) : undefined;

  // commute
  const commute = { address: "City of London", mode: "transit", maxMins: 45 };

  return NextResponse.json({ areaCenter, maxBudget, beds, commutes: [commute] });
}

