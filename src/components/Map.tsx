"use client";

import { useEffect, useRef, useState } from "react";
import { Loader } from "@googlemaps/js-api-loader";

type LatLng = { lat: number; lng: number };

type MapListing = {
  id: string;
  latitude: number;
  longitude: number;
  price_gbp: number;
  bedrooms?: number;
  address_line?: string;
  postcode?: string;
  city?: string;
  commute_mins?: number;
};

type Props = {
  origin: LatLng; // the destination/work anchor we centered on
  mode: "driving" | "transit" | "walking" | "bicycling";
  listings: MapListing[]; // already filtered “strict” list
  height?: number;
};

export default function Map({ origin, mode, listings, height = 560 }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const infoRef = useRef<google.maps.InfoWindow | null>(null);
  const [err, setErr] = useState<string>("");

  useEffect(() => {
    let isCancelled = false;

    async function init() {
      try {
        const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
        if (!apiKey) {
          setErr("Missing NEXT_PUBLIC_GOOGLE_MAPS_API_KEY");
          return;
        }

        const loader = new Loader({
          apiKey,
          version: "weekly",
          libraries: ["places"],
        });

        await loader.load();

        if (isCancelled) return;

        // Initialize map once
        if (!mapRef.current && containerRef.current) {
          mapRef.current = new google.maps.Map(containerRef.current, {
            center: origin,
            zoom: 10,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false,
          });

          infoRef.current = new google.maps.InfoWindow();
        }

        // Center the map on origin each search
        if (mapRef.current) {
          mapRef.current.setCenter(origin);
        }

        // Clear old markers
        markersRef.current.forEach((m) => m.setMap(null));
        markersRef.current = [];

        // Add origin marker (work/POI)
        if (mapRef.current) {
          const o = new google.maps.Marker({
            position: origin,
            map: mapRef.current,
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: 7,
              fillColor: "#2563eb", // indigo-600
              fillOpacity: 1,
              strokeColor: "#ffffff",
              strokeWeight: 2,
            },
            title: "Destination anchor",
          });
          markersRef.current.push(o);
        }

        // Add listing markers
        if (mapRef.current && infoRef.current) {
          const bounds = new google.maps.LatLngBounds();
          bounds.extend(origin);

          listings.forEach((L) => {
            const pos = { lat: L.latitude, lng: L.longitude };
            const marker = new google.maps.Marker({
              position: pos,
              map: mapRef.current!,
              title: `£${(L.price_gbp || 0).toLocaleString()} — ${L.postcode ?? ""}`,
            });

            marker.addListener("click", () => {
              const commuteText =
                typeof L.commute_mins === "number" ? `${L.commute_mins} min ${mode}` : "Commute pending";
              const html = `
                <div style="font: 13px system-ui, -apple-system, Segoe UI, Roboto, Arial">
                  <div style="font-weight:600;margin-bottom:2px">£${(L.price_gbp || 0).toLocaleString()} · ${
                L.bedrooms ?? "?"} bed</div>
                  <div style="color:#374151">${(L.address_line ?? "").toString()} ${L.postcode ?? ""} ${L.city ?? ""}</div>
                  <div style="margin-top:4px;color:#111827"><strong>Commute:</strong> ${commuteText}</div>
                </div>
              `;
              infoRef.current!.setContent(html);
              infoRef.current!.open({ map: mapRef.current!, anchor: marker });
            });

            markersRef.current.push(marker);
            bounds.extend(pos);
          });

          // Fit bounds (keep a sensible zoom)
          if (listings.length > 0) {
            mapRef.current.fitBounds(bounds);
            // optional: prevent over-zooming on tight clusters
            const listener = google.maps.event.addListenerOnce(mapRef.current, "bounds_changed", () => {
              if (mapRef.current!.getZoom()! > 13) mapRef.current!.setZoom(13);
              google.maps.event.removeListener(listener);
            });
          }
        }
      } catch (e: any) {
        console.error(e);
        setErr(e?.message || "Map failed to load");
      }
    }

    init();
    return () => {
      isCancelled = true;
    };
  }, [origin, mode, listings]);

  return (
    <div className="w-full">
      {err && (
        <div className="mb-2 rounded-lg border border-red-200 bg-red-50 text-red-700 px-3 py-2 text-sm">
          {err}
        </div>
      )}
      <div ref={containerRef} style={{ width: "100%", height }} />
    </div>
  );
}
