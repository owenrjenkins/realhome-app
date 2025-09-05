"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Script from "next/script";

type LatLng = { lat: number; lng: number };

export type Listing = {
  id: string | number;
  latitude: number;
  longitude: number;
  price_gbp?: number;
  bedrooms?: number;
  address_line?: string;
  postcode?: string;
  city?: string;
  commute_mins?: number;
};

type Props = {
  origin: LatLng;                         // destination/work
  mode?: "driving" | "transit" | "walking" | "bicycling";
  listings: Listing[];                    // all (we’ll cap shown pins)
  height?: number | string;               // map height
};

export default function Map({ origin, mode = "driving", listings, height = 560 }: Props) {
  const apiKey = (process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY || "").trim();
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Google objects we create (kept in refs so they survive re-renders)
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const infoRef = useRef<google.maps.InfoWindow | null>(null);
  const dirSvcRef = useRef<google.maps.DirectionsService | null>(null);
  const dirRendererRef = useRef<google.maps.DirectionsRenderer | null>(null);
  const placesSvcRef = useRef<google.maps.places.PlacesService | null>(null);

  const [scriptReady, setScriptReady] = useState(false);
  const [pinsCount, setPinsCount] = useState(0);

  // Defensive: don’t try to render if there’s no key
  if (!apiKey) {
    return (
      <div style={{ padding: 12, height, borderRadius: 12, border: "1px solid #e5e7eb" }}>
        <b>Map can’t load:</b> missing <code>NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY</code>.
      </div>
    );
  }

  // Keep a clean, capped list of pins (avoid NaNs, keep performance)
  const pins = useMemo(() => {
    const clean = listings.filter(
      (l) =>
        Number.isFinite(l.latitude) &&
        Number.isFinite(l.longitude) &&
        Math.abs(l.latitude) <= 90 &&
        Math.abs(l.longitude) <= 180
    );
    return clean.slice(0, 2000);
  }, [listings]);

  useEffect(() => setPinsCount(pins.length), [pins.length]);

  // Initialize the map once the script has loaded
  useEffect(() => {
    if (!scriptReady) return;
    if (!containerRef.current) return;

    // Create the map only once
    if (!mapRef.current) {
      mapRef.current = new google.maps.Map(containerRef.current, {
        center: origin,
        zoom: 11,
        clickableIcons: false,
        streetViewControl: false,
        mapTypeControl: false,
        zoomControl: true,
        gestureHandling: "greedy",
      });
      infoRef.current = new google.maps.InfoWindow();
      dirSvcRef.current = new google.maps.DirectionsService();
      dirRendererRef.current = new google.maps.DirectionsRenderer({ suppressMarkers: true });
      dirRendererRef.current.setMap(mapRef.current);
      placesSvcRef.current = new google.maps.places.PlacesService(mapRef.current);
    } else {
      // Re-center when origin changes
      mapRef.current.setCenter(origin);
    }
  }, [scriptReady, origin.lat, origin.lng]);

  // Render/update markers whenever pins change
  useEffect(() => {
    if (!mapRef.current) return;

    // Clear old markers
    for (const m of markersRef.current) m.setMap(null);
    markersRef.current = [];

    const map = mapRef.current;

    pins.forEach((p) => {
      const marker = new google.maps.Marker({
        map,
        position: { lat: p.latitude, lng: p.longitude },
        title: `${p.address_line ?? p.postcode ?? ""}`,
      });

      marker.addListener("click", () => {
        // Build initial content
        const price = Number(p.price_gbp ?? 0);
        const commute = typeof p.commute_mins === "number" ? `${p.commute_mins} min` : "n/a";
        let content = `
          <div style="min-width:240px">
            <div style="font-weight:600;margin-bottom:4px">${escapeHtml(p.address_line ?? p.postcode ?? "Listing")}</div>
            <div>£${Math.round(price).toLocaleString()} • ${p.bedrooms ?? "?"} bed</div>
            <div>Commute: ${commute} (${mode})</div>
            <div style="margin-top:8px;font-weight:600">Nearby</div>
            <div>Park: <span id="nearby-park">searching…</span></div>
            <div>Supermarket: <span id="nearby-supermarket">searching…</span></div>
            <div style="margin-top:8px;font-weight:600">Route</div>
            <div id="route-status">fetching route…</div>
          </div>
        `;
        infoRef.current!.setContent(content);
        infoRef.current!.open(map, marker);

        // Kick off route + nearby in parallel
        drawRoute({ lat: p.latitude, lng: p.longitude });
        fetchNearby({ lat: p.latitude, lng: p.longitude });
      });

      markersRef.current.push(marker);
    });
  }, [pins, mode]);

  // Draw a route polyline (Directions API). Fails soft if disabled.
  async function drawRoute(dest: LatLng) {
    const map = mapRef.current;
    const svc = dirSvcRef.current;
    const renderer = dirRendererRef.current;
    if (!map || !svc || !renderer) return;

    try {
      const res = await svc.route({
        origin: new google.maps.LatLng(origin.lat, origin.lng),
        destination: new google.maps.LatLng(dest.lat, dest.lng),
        travelMode:
          mode === "transit"
            ? google.maps.TravelMode.TRANSIT
            : mode === "walking"
            ? google.maps.TravelMode.WALKING
            : mode === "bicycling"
            ? google.maps.TravelMode.BICYCLING
            : google.maps.TravelMode.DRIVING,
      });
      renderer.setDirections(res);
      replaceInInfo("route-status", res.routes?.[0]?.summary || "route ready");
    } catch {
      replaceInInfo("route-status", "route unavailable");
    }
  }

  // Find one nearby park and supermarket using Places
  async function fetchNearby(pos: LatLng) {
    const svc = placesSvcRef.current;
    const map = mapRef.current;
    if (!svc || !map) {
      replaceInInfo("nearby-park", "n/a");
      replaceInInfo("nearby-supermarket", "n/a");
      return;
    }

    const findOne = (type: google.maps.places.PlaceType) =>
      new Promise<string | undefined>((resolve) => {
        svc.nearbySearch(
          { location: new google.maps.LatLng(pos.lat, pos.lng), radius: 1200, type },
          (results, status) => {
            if (status !== google.maps.places.PlacesServiceStatus.OK || !results?.length) {
              resolve(undefined);
            } else {
              resolve(results[0].name);
            }
          }
        );
      });

    try {
      const [park, supermarket] = await Promise.all([findOne("park"), findOne("supermarket")]);
      replaceInInfo("nearby-park", park ?? "none found");
      replaceInInfo("nearby-supermarket", supermarket ?? "none found");
    } catch {
      replaceInInfo("nearby-park", "n/a");
      replaceInInfo("nearby-supermarket", "n/a");
    }
  }

  // Helper: update placeholder spans inside the current InfoWindow content
  function replaceInInfo(spanId: string, text: string) {
    // InfoWindow content lives in the DOM; we can target by ID
    const iw = document.querySelector(`#${spanId}`);
    if (iw) iw.textContent = text;
  }

  return (
    <div style={{ width: "100%", height, position: "relative" }}>
      {/* Tiny status pill */}
      <div
        style={{
          position: "absolute",
          top: 8,
          left: 8,
          zIndex: 2,
          background: "rgba(255,255,255,0.95)",
          padding: "6px 10px",
          borderRadius: 12,
          boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
          fontSize: 12,
        }}
      >
        Rendering {pinsCount.toLocaleString()} pins
      </div>

      {/* The map goes here */}
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: "100%",
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          background: "#f8fafc",
        }}
      />

      {/* Load Google Maps JS once; add Places for “Nearby” */}
      <Script
        id="google-maps"
        src={`https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&v=weekly`}
        strategy="afterInteractive"
        onLoad={() => setScriptReady(true)}
      />
    </div>
  );
}

// Simple HTML escaper for InfoWindow content
function escapeHtml(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
