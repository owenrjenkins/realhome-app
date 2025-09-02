import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    ok: !!process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY && !!process.env.GOOGLE_MAPS_SERVER_KEY,
    dataUrl: process.env.NEXT_PUBLIC_DATA_URL || null,
    time: new Date().toISOString()
  });
}

