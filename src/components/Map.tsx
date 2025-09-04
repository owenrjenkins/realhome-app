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

type MapController = {
  focusOn: (id: string) => void;
};

export default function Map({
  center,
  listings = [],
  durations = {},
  onSelect,
  onReady,
}: {
  center: { lat: number; lng: number };
  listings?: Listing[];
  durations?: DurationMap;
  onSelect?: (l: Listing) => void;
  onReady?: (ctl: MapController) => void; // let parent pan to markers
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
      const markers = new Map<string, google.maps.Marker>();

      function openFor(L: Listing) {
        const m = markers.get(L.id);
        if (!m) return;
        const commute = durations[L.id];
        const commuteLine =
          typeof commute === "number" ? `<div style="margin-top:4px;">Commute: ${commute} min</div>` : "";
        info.setContent(`
          <div style="min-width:220px">
            <div style="font-weight:700; margin-bottom:4px; font-size:14px;">£${(L.price_gbp || 0).toLocaleString()}</div>
            <div style="font-size:12px; color:#444;">
              ${L.bedrooms} bed ${L.property_type}<br/>
              ${L.postcode}, ${L.city}
              ${commuteLine}
            </div>
          </div>
        `);
        info.open({ anchor: m, map });
      }

      // Listing pins only
      listings.slice(0, 300).forEach((L) => {
        const m = new google.maps.Marker({
          map,
          position: { lat: L.latitude, lng: L.longitude },
          title: `${L.bedrooms} bed ${L.property_type}`,
        });
        markers.set(L.id, m);
        m.addListener("click", () => {
          openFor(L);
          onSelect?.(L);
        });
      });

      // expose controller to parent
      onReady?.({
        focusOn: (id: string) => {
          const m = markers.get(id);
          if (!m) return;
          map.panTo(m.getPosition()!);
          map.setZoom(Math.max(map.getZoom() || 12, 14));
          const L = listings.find((x) => x.id === id);
          if (L) openFor(L);
        },
      });
    });
  }, [key, center.lat, center.lng, listings, durations, onSelect, onReady]);

  return <div ref={ref} className="w-full h-[80vh] rounded-2xl border shadow-lg bg-white" />;
}
