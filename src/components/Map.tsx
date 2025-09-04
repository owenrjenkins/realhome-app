/* global google */
"use client";

import { useEffect, useRef } from "react";
import { Loader } from "@googlemaps/js-api-loader";

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
  listings = [],
  durations = {},
  onSelect,
}: {
  center: { lat: number; lng: number };
  listings?: Listing[];
  durations?: DurationMap;
  onSelect?: (l: Listing) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY as string | undefined;

  if (!key) {
    return (
      <div className="p-3 text-sm rounded-xl border bg-yellow-50 text-yellow-800">
        Missing <code>NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY</code>.
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
        fullscreenControl: true,
      });

      const info = new google.maps.InfoWindow();

      // Listing pins only
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
            <div style="min-width:210px">
              <div style="font-weight:600; margin-bottom:4px;">£${(L.price_gbp || 0).toLocaleString()}</div>
              <div style="font-size:12px; color:#444;">
                ${L.bedrooms} bed ${L.property_type}<br/>
                ${L.postcode}, ${L.city}
                ${commuteLine}
              </div>
            </div>
          `);
          info.open({ anchor: m, map });
          onSelect?.(L);
        });
      });
    });
  }, [key, center.lat, center.lng, listings.length, durations, onSelect]);

  return <div ref={ref} className="w-full h-[80vh] rounded-2xl border shadow-lg" />;
}
