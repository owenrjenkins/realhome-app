"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader } from "@googlemaps/js-api-loader";

// We import markerclusterer dynamically after the Maps JS is ready.
type MarkerClustererCtor = new (opts: { markers?: google.maps.Marker[]; map?: google.maps.Map }) => {
  addMarker: (m: google.maps.Marker) => void;
  clearMarkers: () => void;
};

type LatLng = { lat: number; lng: number };

type Listing = {
  id: string;
  latitude: number;
  longitude: number;
  price_gbp: number;
  bedrooms: number;
  property_type: string;
  postcode?: string;
  city?: string;
  _mins?: number;
  _isStrong?: boolean; // precomputed upstream
};

export type MapController = { focusOn: (id: string) => void };

export default function Map({
  center,
  listings,
  durations,
  maxPins = 200,
  onSelect,
  onReady,
}: {
  center: LatLng | null;
  listings: Listing[];
  durations: Record<string, number>;
  maxPins?: number;
  onSelect: (l: Listing) => void;
  onReady?: (ctl: MapController) => void;
}) {
  const mapDivRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<Record<string, google.maps.Marker>>({});
  const infoRef = useRef<google.maps.InfoWindow | null>(null);
  const clustererRef = useRef<any>(null);

  const [loadErr, setLoadErr] = useState<string>("");

  // ---- helpers ----
  function isValidLatLng(v: any): v is LatLng {
    return (
      v &&
      typeof v === "object" &&
      Number.isFinite(v.lat) &&
      Number.isFinite(v.lng) &&
      Math.abs(v.lat) <= 90 &&
      Math.abs(v.lng) <= 180
    );
  }
  const safeCenter = useMemo<LatLng | null>(() => (isValidLatLng(center) ? center : null), [center]);

  // keep many pins but drop junk + cap to maxPins
  const safeListings = useMemo(() => {
    const arr = (listings || []).filter(
      (L) =>
        Number.isFinite(L.latitude) &&
        Number.isFinite(L.longitude) &&
        Math.abs(L.latitude) <= 90 &&
        Math.abs(L.longitude) <= 180
    );
    return arr.slice(0, Math.max(1, maxPins));
  }, [listings, maxPins]);

  // simple svg marker icons
  const iconFor = (strong: boolean): google.maps.Icon => {
    const fill = strong ? "#16a34a" : "#6b7280"; // green / gray
    return {
      path: "M12 2C7.58 2 4 5.58 4 10c0 5.25 6.48 11.29 7.2 11.95a1 1 0 0 0 1.33 0C13.52 21.29 20 15.25 20 10c0-4.42-3.58-8-8-8z",
      fillColor: fill,
      fillOpacity: 1,
      strokeWeight: 1,
      strokeColor: "#ffffff",
      scale: 1.2,
      anchor: new google.maps.Point(12, 22),
    } as any;
  };

  // ---- load Google Maps once ----
  useEffect(() => {
    setLoadErr("");
    if (!mapDivRef.current) return;
    if (!safeCenter) return;

    if (mapRef.current) {
      mapRef.current.setCenter(safeCenter);
      return;
    }

    const apiKey =
      process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
      process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY;

    if (!apiKey) {
      setLoadErr("Missing NEXT_PUBLIC_GOOGLE_MAPS_API_KEY");
      return;
    }

    const loader = new Loader({
      apiKey,
      version: "weekly",
      libraries: ["places"],
    });

    loader
      .load()
      .then(async () => {
        mapRef.current = new google.maps.Map(mapDivRef.current as HTMLDivElement, {
          center: safeCenter,
          zoom: 11,
          mapTypeControl: false,
          fullscreenControl: false,
          streetViewControl: false,
        });
        infoRef.current = new google.maps.InfoWindow();

        // Dynamic import clusterer once maps is loaded
        const mod = (await import("@googlemaps/markerclusterer")) as any;
        const MC = (mod.MarkerClusterer || mod.default) as MarkerClustererCtor;
        clustererRef.current = new MC({ map: mapRef.current });

        onReady?.({
          focusOn: (id: string) => {
            const mk = markersRef.current[id];
            if (mk && mapRef.current) {
              mapRef.current.panTo(mk.getPosition()!);
              mapRef.current.setZoom(Math.max(mapRef.current.getZoom() ?? 11, 14));
              google.maps.event.trigger(mk, "click", {});
            }
          },
        });
      })
      .catch((e) => {
        console.error(e);
        setLoadErr("Failed to load Google Maps");
      });
  }, [safeCenter, onReady]);

  // ---- draw / update markers whenever listings change ----
  useEffect(() => {
    if (!mapRef.current || !clustererRef.current) return;

    // clear stale markers
    const keep: Record<string, true> = {};
    for (const L of safeListings) keep[L.id] = true;
    for (const id of Object.keys(markersRef.current)) {
      if (!keep[id]) {
        markersRef.current[id].setMap(null);
        delete markersRef.current[id];
      }
    }
    // reset clusterer
    clustererRef.current.clearMarkers();

    // add & update
    for (const L of safeListings) {
      const pos: LatLng = { lat: Number(L.latitude), lng: Number(L.longitude) };
      if (!isValidLatLng(pos)) continue;

      const strong = !!L._isStrong;

      let marker = markersRef.current[L.id];
      if (!marker) {
        marker = new google.maps.Marker({
          position: pos,
          title: `${L.bedrooms} bed ${L.property_type} · £${(L.price_gbp || 0).toLocaleString()}`,
          icon: iconFor(strong),
        });
        marker.addListener("click", () => {
          onSelect(L);
          const mins =
            typeof L._mins === "number"
              ? L._mins
              : Number.isFinite(durations[L.id])
              ? durations[L.id]
              : undefined;
          const commute = mins != null ? ` · Commute ${mins} min` : "";
          const html = `
            <div style="font-size:12px;line-height:1.4;">
              <div><strong>£${(L.price_gbp || 0).toLocaleString()}</strong> · ${
            L.bedrooms
          } bed ${L.property_type}</div>
              <div>${L.postcode || ""}${L.city ? ", " + L.city : ""}${commute}</div>
            </div>`;
          infoRef.current?.setContent(html);
          infoRef.current?.open({ map: mapRef.current!, anchor: marker });
        });
        markersRef.current[L.id] = marker;
      } else {
        marker.setPosition(pos);
        marker.setTitle(
          `${L.bedrooms} bed ${L.property_type} · £${(L.price_gbp || 0).toLocaleString()}`
        );
        marker.setIcon(iconFor(strong));
      }

      clustererRef.current.addMarker(marker);
    }
  }, [safeListings, durations, onSelect]);

  // keep center in sync
  useEffect(() => {
    if (mapRef.current && safeCenter) mapRef.current.setCenter(safeCenter);
  }, [safeCenter]);

  // ---- UI ----
  if (!safeCenter) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
        Waiting for a valid map center…
      </div>
    );
  }
  if (loadErr) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
        {loadErr}
      </div>
    );
  }

  return (
    <div
      ref={mapDivRef}
      className="w-full h-[520px] rounded-xl border bg-gray-50"
      style={{ minHeight: 400 }}
    />
  );
}
