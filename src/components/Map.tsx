"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GoogleMap,
  LoadScript,
  Marker,
  InfoWindow,
  DirectionsRenderer,
} from "@react-google-maps/api";

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
  commute_mins?: number; // optional: minutes you already computed
};

type Props = {
  origin: LatLng;                         // where you’re commuting to
  mode?: "driving" | "transit" | "walking" | "bicycling";
  listings: Listing[];                    // full list you’re showing on the right
  height?: number | string;               // map height (default 520)
};

export default function Map({
  origin,
  mode = "driving",
  listings,
  height = 520,
}: Props) {
  // --- env / guards ---
  const apiKey = (process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY || "").trim();
  if (!apiKey) {
    return (
      <div style={{ padding: 12, height, borderRadius: 12, border: "1px solid #e5e7eb" }}>
        <b>Map can’t load:</b> missing <code>NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY</code>.
      </div>
    );
  }

  // --- state ---
  const [selectedId, setSelectedId] = useState<string | number | null>(null);
  const [route, setRoute] = useState<google.maps.DirectionsResult | null>(null);
  const [nearby, setNearby] = useState<{ park?: string; supermarket?: string; error?: string }>({});
  const [pinsCount, setPinsCount] = useState(0);

  const selected = useMemo(
    () => listings.find((l) => l.id === selectedId) || null,
    [listings, selectedId]
  );

  // keep render sane for very large lists
  const pins = useMemo(() => {
    const clean = listings.filter(
      (l) =>
        Number.isFinite(l.latitude) &&
        Number.isFinite(l.longitude) &&
        Math.abs(l.latitude) <= 90 &&
        Math.abs(l.longitude) <= 180
    );
    return clean.slice(0, 2000); // cap to 2k markers
  }, [listings]);

  useEffect(() => setPinsCount(pins.length), [pins.length]);

  // --- map refs / options ---
  const mapRef = useRef<google.maps.Map | null>(null);
  const onLoad = useCallback((map: google.maps.Map) => {
    mapRef.current = map;
  }, []);
  const onUnmount = useCallback(() => {
    mapRef.current = null;
  }, []);
  const onMapClick = useCallback((e: google.maps.MapMouseEvent) => {
    // close any open info window when clicking elsewhere
    if (!e.placeId) setSelectedId(null);
  }, []);

  const options: google.maps.MapOptions = {
    disableDefaultUI: false,
    clickableIcons: false,
    zoomControl: true,
    streetViewControl: false,
    mapTypeControl: false,
    gestureHandling: "greedy",
    minZoom: 5,
  };

  const center = useMemo(() => origin, [origin]);

  // --- helpers ---
  const travelModeToGoogle = (m: Props["mode"]): google.maps.TravelMode => {
    switch (m) {
      case "walking":
        return google.maps.TravelMode.WALKING;
      case "bicycling":
        return google.maps.TravelMode.BICYCLING;
      case "transit":
        return google.maps.TravelMode.TRANSIT;
      default:
        return google.maps.TravelMode.DRIVING;
    }
  };

  // Fetch route + nearby when a marker is opened.
  useEffect(() => {
    (async () => {
      if (!selected || !mapRef.current) {
        setRoute(null);
        setNearby({});
        return;
      }

      // Route (Directions API) — optional; ignore if API not enabled
      try {
        const svc = new google.maps.DirectionsService();
        const res = await svc.route({
          origin: new google.maps.LatLng(origin.lat, origin.lng),
          destination: new google.maps.LatLng(selected.latitude, selected.longitude),
          travelMode: travelModeToGoogle(mode),
        });
        setRoute(res);
      } catch (e) {
        // harmless if Directions isn’t enabled
        setRoute(null);
      }

      // Nearby (Places API) — park + supermarket within ~1km
      try {
        const svc = new google.maps.places.PlacesService(mapRef.current);
        const pos = new google.maps.LatLng(selected.latitude, selected.longitude);

        const findOne = (type: google.maps.places.PlaceType) =>
          new Promise<string | undefined>((resolve) => {
            svc.nearbySearch(
              { location: pos, radius: 1200, type },
              (results, status) => {
                if (status !== google.maps.places.PlacesServiceStatus.OK || !results?.length) {
                  resolve(undefined);
                } else {
                  resolve(results[0].name);
                }
              }
            );
          });

        const [p, s] = await Promise.all([findOne("park"), findOne("supermarket")]);
        setNearby({ park: p, supermarket: s });
      } catch (e: any) {
        setNearby({ error: "places_api_disabled" });
      }
    })();
  }, [selected?.id, origin.lat, origin.lng, mode]);

  return (
    <div style={{ width: "100%", height, position: "relative" }}>
      {/* status pill */}
      <div
        style={{
          position: "absolute",
          top: 8,
          left: 8,
          zIndex: 5,
          background: "rgba(255,255,255,0.95)",
          padding: "6px 10px",
          borderRadius: 12,
          boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
          fontSize: 12,
        }}
      >
        Rendering {pinsCount.toLocaleString()} pins
      </div>

      <LoadScript
        googleMapsApiKey={apiKey}
        libraries={["places"]} // enable Places for Nearby; remove if you don’t want Nearby
      >
        <GoogleMap
          onLoad={onLoad}
          onUnmount={onUnmount}
          onClick={onMapClick}
          center={center}
          zoom={11}
          mapContainerStyle={{ width: "100%", height: "100%" }}
          options={options}
        >
          {/* Origin marker */}
          <Marker position={origin} label="●" />

          {/* Property pins */}
          {pins.map((p) => (
            <Marker
              key={String(p.id)}
              position={{ lat: p.latitude, lng: p.longitude }}
              onClick={() => setSelectedId(p.id)}
              title={`${p.address_line ?? p.postcode ?? ""} • £${Math.round(p.price_gbp ?? 0).toLocaleString()} • ${p.bedrooms ?? "?"} bed`}
            />
          ))}

          {/* Info window */}
          {selected && (
            <InfoWindow
              position={{ lat: selected.latitude, lng: selected.longitude }}
              onCloseClick={() => setSelectedId(null)}
            >
              <div style={{ minWidth: 240 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                  {selected.address_line ?? selected.postcode ?? "Listing"}
                </div>
                <div>
                  £{Math.round(selected.price_gbp ?? 0).toLocaleString()} •{" "}
                  {selected.bedrooms ?? "?"} bed
                </div>
                {typeof selected.commute_mins === "number" && (
                  <div>Commute: {selected.commute_mins} min ({mode})</div>
                )}

                <div style={{ marginTop: 8 }}>
                  <div style={{ fontWeight: 600 }}>Nearby</div>
                  <div>
                    Park:{" "}
                    {nearby.error
                      ? "n/a"
                      : nearby.park ?? "searching…"}
                  </div>
                  <div>
                    Supermarket:{" "}
                    {nearby.error
                      ? "n/a"
                      : nearby.supermarket ?? "searching…"}
                  </div>
                </div>

                <div style={{ marginTop: 8, fontWeight: 600 }}>Route</div>
                {!route ? <div>fetching route…</div> : <div>{route.routes?.[0]?.summary || "route ready"}</div>}
              </div>
            </InfoWindow>
          )}

          {/* Route polyline */}
          {route && (
            <DirectionsRenderer
              directions={route}
              options={{ suppressMarkers: true }}
            />
          )}
        </GoogleMap>
      </LoadScript>
    </div>
  );
}
