/* global google */
"use client";

import { useEffect, useRef } from "react";
import { Loader } from "@googlemaps/js-api-loader";

type Tile = { lat: number; lng: number; score: number };
type Listing = {
  id: string;
  latitude: number;
  longitude: number;
  price_gbp: number;
  bedrooms: number;
  property_type: string;
  postcode: string;
  city: string;
};
type DurationMap = Record<string, number>;

export default function Map({
  center,
  tiles = [],
  listings = [],
  durations = {},
}: {
  center: { lat: number; lng: number };
  tiles?: Tile[];
  listings?: Listing[];
  durations?: DurationMap;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY as string | undefined;

  if (!key) {
    return (
      <div className="p-3 text-sm rounded-xl border bg-yellow-50 text-yellow-800">
        Missing <code>NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY</code>. Add it in Vercel → Settings → Environment Variables, then redeploy.
      </div>
    );
  }

  useEffect(() => {
    const loader = new Loader({ apiKey: key, version: "weekly" });
    loader.load().then(() => {
      const map = new google.maps.Map(ref.current as HTMLDivElement, {
        center,
        zoom: 12,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
      });

      const info = new google.maps.InfoWindow();

      // Heat bubbles via scalable SVG symbol (simple and reliable)
      tiles.slice(0, 140).forEach((t) => {
        const size = Math.max(10, Math.round(t.score * 36));
        const color = t.score > 0.7 ? "#2ecc71" : t.score > 0.5 ? "#f1c40f" : "#e67e22";
        const svg = {
          path: "M 0 0 m -1, 0 a 1,1 0 1,0 2,0 a 1,1 0 1,0 -2,0",
          fillColor: color,
          fillOpacity: 0.55,
          scale: size,
          strokeWeight: 0.8,
          strokeColor: "rgba(0,0,0,0.15)",
        } as google.maps.Symbol;

        new google.maps.Marker({
          map,
          position: { lat: t.lat, lng: t.lng },
          icon: svg,
          clickable: false,
        });
      });

      // Listing pins (clickable)
      listings.slice(0, 300).forEach((L) => {
        const m = new google.maps.Marker({
          map,
          position: { lat: L.latitude, lng: L.longitude },
          title: `${L.bedrooms} bed ${L.property_type}`,
        });
        m.addListener("click", () => {
          const commute = durations[L.id];
          const commuteLine =
            typeof commute === "number"
              ? `<div style="margin-top:4px;">Commute: ${commute} min</div>`
              : "";
          info.setContent(`
            <div style="min-width:200px">
              <div style="font-weight:600; margin-bottom:4px;">£${(L.price_gbp || 0).toLocaleString()}</div>
              <div style="font-size:12px; color:#444;">
                ${L.bedrooms} bed ${L.property_type}<br/>
                ${L.postcode}, ${L.city}
                ${commuteLine}
              </div>
            </div>
          `);
          info.open({ anchor: m, map });
        });
      });
    });
  }, [key, center.lat, center.lng, tiles.length, listings.length, durations]);

  return <div ref={ref} className="w-full h-[520px] rounded-2xl border" />;
}
