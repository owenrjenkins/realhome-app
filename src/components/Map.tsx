"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader } from "@googlemaps/js-api-loader";

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
};

export type MapController = { focusOn: (id: string) => void };

export default function Map({
  center,
  listings,
  durations,
  onSelect,
  onReady,
}: {
  center: LatLng | null;
  listings: Listing[];
  durations: Record<string, number>;
  onSelect: (l: Listing) => void;
  onReady?: (ctl: MapController) => void;
}) {
  const mapDivRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<Record<string, google.maps.Marker>>({});
  const infoRef = useRef<google.maps.InfoWindow | null>(null);

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

  const safeCenter = useMemo<LatLng | null>(() => {
    return isValidLatLng(center) ? center : null;
  }, [center]);

  const safeListings = useMemo(() => {
    return (listings || []).filter(
      (L) =>
        Number.isFinite(L.latitude) &&
        Number.isFinite(L.longitude) &&
        Math.abs(L.latitude) <= 90 &&
        Math.abs(L.longitude) <= 180
    );
  }, [listings]);

  // ---- load Google Maps once ----
  useEffect(() => {
    setLoadErr("");

    if (!mapDivRef.current) return;
    if (!safeCenter) return; // wait until we have a valid center

    // If map already created, just recentre and continue
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
      .then(() => {
        // Construct map
        mapRef.current = new google.maps.Map(mapDivRef.current as HTMLDivElement, {
          center: safeCenter,
          zoom: 12,
          mapTypeControl: false,
          fullscreenControl: false,
          streetViewControl: false,
        });
        infoRef.current = new google.maps.InfoWindow();

        // hand controller to parent
        onReady?.({
          focusOn: (id: string) => {
            const mk = markersRef.current[id];
            if (mk && mapRef.current) {
              mapRef.current.panTo(mk.getPosition()!);
              mapRef.current.setZoom(Math.max(mapRef.current.getZoom() ?? 12, 14));
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
    if (!mapRef.current) return;

    // clear markers that are no longer present
    const keep: Record<string, true> = {};
    for (const L of safeListings) keep[L.id] = true;
    for (const id of Object.keys(markersRef.current)) {
      if (!keep[id]) {
        markersRef.current[id].setMap(null);
        delete markersRef.current[id];
      }
    }

    // add & update markers
    for (const L of safeListings) {
      const pos = { lat: Number(L.latitude), lng: Number(L.longitude) } as LatLng;
      if (!isValidLatLng(pos)) continue;

      let marker = markersRef.current[L.id];
      if (!marker) {
        marker = new google.maps.Marker({
          position: pos,
          map: mapRef.current!,
          title: `${L.bedrooms} bed ${L.property_type} · £${(L.price_gbp || 0).toLocaleString()}`,
        });
        marker.addListener("click", () => {
          onSelect(L);
          // simple info window
          const commute =
            typeof L._mins === "number"
              ? ` · Commute ${L._mins} min`
              : durations[L.id]
              ? ` · Commute ${durations[L.id]} min`
              : "";
          const html = `
            <div style="font-size:12px;line-height:1.4;">
              <div><strong>£${(L.price_gbp || 0).toLocaleString()}</strong> · ${
            L.bedrooms
          } bed ${L.property_type}</div>
              <div>${L.postcode || ""} ${L.city ? ", " + L.city : ""}${commute}</div>
            </div>`;
          infoRef.current?.setContent(html);
          infoRef.current?.open({ map: mapRef.current!, anchor: marker });
        });
        markersRef.current[L.id] = marker;
      } else {
        // update position & title if changed
        const curr = marker.getPosition();
        if (!curr || curr.lat() !== pos.lat || curr.lng() !== pos.lng) {
          marker.setPosition(pos);
        }
        marker.setTitle(
          `${L.bedrooms} bed ${L.property_type} · £${(L.price_gbp || 0).toLocaleString()}`
        );
      }
    }
  }, [safeListings, durations, onSelect]);

  // ---- keep center in sync (after map is created) ----
  useEffect(() => {
    if (mapRef.current && safeCenter) {
      mapRef.current.setCenter(safeCenter);
    }
  }, [safeCenter]);

  // ---- UI ----
  if (!safeCenter) {
    // Don’t blow up – show a friendly note instead of throwing
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
      // in case CSS fails somewhere, minimum height
      style={{ minHeight: 400 }}
    />
  );
}
