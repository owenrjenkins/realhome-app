"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader } from "@googlemaps/js-api-loader";

// We import markerclusterer dynamically after the Maps JS is ready.
type MarkerClustererCtor = new (opts: { markers?: google.maps.Marker[]; map?: google.maps.Map }) => {
  addMarker: (m: google.maps.Marker) => void;
  addMarkers?: (m: google.maps.Marker[]) => void;
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
  _mins?: number;      // precomputed minutes (optional)
  _isStrong?: boolean; // precomputed upstream
};

export type MapController = { focusOn: (id: string) => void };

type Filters = {
  priceMin?: number;
  priceMax?: number;
  bedroomsMin?: number;
  bedroomsMax?: number;
};

export default function Map({
  center,
  listings,
  durations,
  // keep prop but ignore it by default to avoid caps
  maxPins, // eslint-disable-line @typescript-eslint/no-unused-vars
  onSelect,
  onReady,
  // optional extras
  filters,
  amenityQueryText,
  mode = "transit",
  maxMins = 45,
}: {
  center: LatLng | null;
  listings: Listing[];
  durations: Record<string, number>;
  maxPins?: number;
  onSelect: (l: Listing) => void;
  onReady?: (ctl: MapController) => void;
  filters?: Filters;
  amenityQueryText?: string;
  mode?: "driving" | "transit" | "walking" | "bicycling";
  maxMins?: number;
}) {
  const mapDivRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<Record<string, google.maps.Marker>>({});
  const infoRef = useRef<google.maps.InfoWindow | null>(null);
  const clustererRef = useRef<InstanceType<MarkerClustererCtor> | null>(null);
  const directionsRendererRef = useRef<google.maps.DirectionsRenderer | null>(null);

  const [loadErr, setLoadErr] = useState<string>("");
  const [nearby, setNearby] = useState<Record<google.maps.places.PlaceType, { meters: number; name?: string } | undefined>>({});

  // ---------- helpers ----------
  const isValidLatLng = (v: any): v is LatLng =>
    v && typeof v === "object" && Number.isFinite(v.lat) && Number.isFinite(v.lng) && Math.abs(v.lat) <= 90 && Math.abs(v.lng) <= 180;

  const safeCenter = useMemo<LatLng | null>(() => (isValidLatLng(center) ? center : null), [center]);

  // keep ALL valid pins (no slicing)
  const safeListings = useMemo(() => {
    return (listings || []).filter(
      (L) =>
        Number.isFinite(L.latitude) &&
        Number.isFinite(L.longitude) &&
        Math.abs(L.latitude) <= 90 &&
        Math.abs(L.longitude) <= 180
    );
  }, [listings]);

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

  const travelModeToGoogle = (m: "driving" | "transit" | "walking" | "bicycling"): google.maps.TravelMode => {
    switch (m) {
      case "walking": return google.maps.TravelMode.WALKING;
      case "bicycling": return google.maps.TravelMode.BICYCLING;
      case "transit": return google.maps.TravelMode.TRANSIT;
      default: return google.maps.TravelMode.DRIVING;
    }
  };

  // ---------- amenity parsing ----------
  const AMENITY_KEYWORDS: Record<string, google.maps.places.PlaceType[]> = {
    "nursery": ["school"], "primary school": ["school"], "secondary school": ["school"], "school": ["school"], "university": ["university"],
    "gp": ["doctor"], "doctor": ["doctor"], "hospital": ["hospital"], "pharmacy": ["pharmacy"], "chemist": ["pharmacy"], "dentist": ["dentist"], "vet": ["veterinary_care"],
    "park": ["park"], "playground": ["park"], "dog park": ["park"],
    "tube": ["subway_station"], "underground": ["subway_station"], "train": ["train_station"], "rail": ["train_station"], "dlr": ["light_rail_station"],
    "tram": ["light_rail_station"], "bus": ["bus_station"], "coach": ["bus_station"], "ferry": ["ferry_terminal"], "airport": ["airport"],
    "supermarket": ["supermarket"], "grocery": ["supermarket"], "bakery": ["bakery"], "butcher": ["store"], "greengrocer": ["store"],
    "convenience": ["convenience_store"], "post office": ["post_office"], "parcel": ["post_office"], "atm": ["atm"], "bank": ["bank"],
    "coffee": ["cafe"], "cafe": ["cafe"], "coffee shop": ["cafe"], "restaurant": ["restaurant"], "pub": ["bar"], "wine bar": ["bar"], "bar": ["bar"],
    "gym": ["gym"], "swimming": ["gym"], "tennis": ["stadium"], "climbing": ["gym"],
    "library": ["library"], "cinema": ["movie_theater"], "theatre": ["movie_theater"], "bookshop": ["book_store"], "museum": ["museum"], "gallery": ["art_gallery"],
    "ev charger": ["electric_vehicle_charging_station"], "charging": ["electric_vehicle_charging_station"],
    "parking": ["parking"], "car park": ["parking"], "petrol": ["gas_station"], "fuel": ["gas_station"],
    "coworking": ["point_of_interest"], "postbox": ["post_office"],
  };

  const DEFAULT_AMENITY_THRESHOLDS: Partial<Record<google.maps.places.PlaceType, number>> = {
    park: 1200, supermarket: 1200, school: 1500, university: 2500, doctor: 1500, hospital: 3000, pharmacy: 1200, dentist: 1500, veterinary_care: 2000,
    subway_station: 1200, train_station: 2000, light_rail_station: 2000, bus_station: 600, ferry_terminal: 3000, airport: 15000,
    bakery: 800, convenience_store: 600, post_office: 1200, atm: 400, bank: 1200,
    cafe: 600, restaurant: 800, bar: 800,
    gym: 1200, stadium: 2500, movie_theater: 2000, library: 1500, book_store: 1500, museum: 3000, art_gallery: 3000,
    electric_vehicle_charging_station: 1200, parking: 800, gas_station: 1500, point_of_interest: 2000,
  };

  const requestedAmenityTypes = useMemo(() => {
    if (!amenityQueryText) return [];
    const lc = amenityQueryText.toLowerCase();
    const out: google.maps.places.PlaceType[] = [];
    for (const [key, types] of Object.entries(AMENITY_KEYWORDS)) {
      if (lc.includes(key)) types.forEach((t) => { if (!out.includes(t)) out.push(t); });
    }
    return out;
  }, [amenityQueryText]);

  // ---------- load Google Maps once ----------
  useEffect(() => {
    setLoadErr("");
    if (!mapDivRef.current || !safeCenter) return;

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
      libraries: ["places", "geometry"], // Nearby + geometry distances
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

        // Directions renderer for polylines
        directionsRendererRef.current = new google.maps.DirectionsRenderer({
          suppressMarkers: true,
          preserveViewport: true,
        });
        directionsRendererRef.current.setMap(mapRef.current);

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

  // ---------- build InfoWindow HTML (with evidence) ----------
  function buildInfoHTML(L: Listing) {
    const mins = Number.isFinite(durations[L.id]) ? durations[L.id] : (typeof L._mins === "number" ? L._mins : undefined);
    const commuteLine =
      mins != null
        ? `<li>Commute ≤ ${maxMins} min — ${Math.round(mins) <= maxMins ? "✓" : "✗"} (this is ${Math.round(mins)} min by ${mode})</li>`
        : `<li>Commute time: n/a</li>`;

    const priceLines = [
      typeof filters?.priceMin === "number"
        ? `<li>Price ≥ £${Math.round(filters!.priceMin!).toLocaleString()} — ${L.price_gbp >= (filters!.priceMin! ?? 0) ? "✓" : "✗"} (this is £${Math.round(L.price_gbp).toLocaleString()})</li>`
        : "",
      typeof filters?.priceMax === "number"
        ? `<li>Price ≤ £${Math.round(filters!.priceMax!).toLocaleString()} — ${L.price_gbp <= (filters!.priceMax! ?? Infinity) ? "✓" : "✗"} (this is £${Math.round(L.price_gbp).toLocaleString()})</li>`
        : "",
    ].join("");

    const bedLines = [
      typeof filters?.bedroomsMin === "number"
        ? `<li>Beds ≥ ${filters!.bedroomsMin} — ${L.bedrooms >= (filters!.bedroomsMin! ?? 0) ? "✓" : "✗"} (this is ${L.bedrooms})</li>`
        : "",
      typeof filters?.bedroomsMax === "number"
        ? `<li>Beds ≤ ${filters!.bedroomsMax} — ${L.bedrooms <= (filters!.bedroomsMax! ?? Infinity) ? "✓" : "✗"} (this is ${L.bedrooms})</li>`
        : "",
    ].join("");

    const amenityLines =
      requestedAmenityTypes.length > 0
        ? requestedAmenityTypes
            .map((type) => {
              const hit = nearby[type];
              const limit = DEFAULT_AMENITY_THRESHOLDS[type] ?? 1500;
              if (hit) {
                const pass = hit.meters <= limit ? "✓" : "✗";
                const name = hit.name ? ` ${hit.name}` : " place";
                return `<li>${type.replaceAll("_", " ")} ≤ ${limit} m — ${pass} (nearest${name} at ${Math.round(hit.meters)} m)</li>`;
              }
              return `<li>${type.replaceAll("_", " ")} — searching…</li>`;
            })
            .join("")
        : "";

    return `
      <div style="font-size:12px;line-height:1.4;min-width:280px;">
        <div style="font-weight:600;margin-bottom:2px;">£${(L.price_gbp || 0).toLocaleString()} • ${L.bedrooms} bed ${L.property_type}</div>
        <div>${L.postcode || ""}${L.city ? ", " + L.city : ""}</div>
        <div style="margin-top:8px;font-weight:600;">Why this matches</div>
        <ul style="margin:0;padding-left:16px;">
          ${priceLines}
          ${bedLines}
          ${commuteLine}
          ${amenityLines}
        </ul>
      </div>
    `;
  }

  // ---------- Directions (polyline) with timeout + fallbacks ----------
  function drawRoute(from: LatLng | null, to: LatLng, preferred: "driving" | "transit" | "walking" | "bicycling") {
    if (!mapRef.current || !directionsRendererRef.current || !from) return;

    const svc = new google.maps.DirectionsService();
    const tryModes: google.maps.TravelMode[] = Array.from(
      new Set<google.maps.TravelMode>([
        travelModeToGoogle(preferred),
        google.maps.TravelMode.DRIVING,
        google.maps.TravelMode.WALKING,
      ])
    );

    (async () => {
      for (const m of tryModes) {
        const req: google.maps.DirectionsRequest = {
          origin: new google.maps.LatLng(from.lat, from.lng),
          destination: new google.maps.LatLng(to.lat, to.lng),
          travelMode: m,
          ...(m === google.maps.TravelMode.TRANSIT ? { transitOptions: { departureTime: new Date() } } : {}),
        };

        const { res, status } = await new Promise<{res?: google.maps.DirectionsResult; status: google.maps.DirectionsStatus}>((resolve) => {
          let timedOut = false;
          const t = setTimeout(() => { timedOut = true; resolve({ status: google.maps.DirectionsStatus.INVALID_REQUEST }); }, 9000);
          svc.route(req, (r, s) => { if (!timedOut) { clearTimeout(t); resolve({ res: r || undefined, status: s }); } });
        });

        // Log real status so config issues (REQUEST_DENIED) are visible
        console.warn("[Directions] status:", status, "mode:", m);

        if (status === google.maps.DirectionsStatus.OK && res?.routes?.length) {
          directionsRendererRef.current!.setDirections(res);
          return;
        }
      }
      directionsRendererRef.current!.setDirections({ routes: [] } as any);
    })();
  }

  // ---------- Nearby (requested categories only) ----------
  async function fetchNearbyFor(L: Listing) {
    if (!mapRef.current || requestedAmenityTypes.length === 0) return;
    setNearby({}); // reset
    const svc = new google.maps.places.PlacesService(mapRef.current);
    const origin = { lat: L.latitude, lng: L.longitude };

    const tasks = requestedAmenityTypes.map(
      (type) =>
        new Promise<void>((resolve) => {
          const timer = setTimeout(() => resolve(), 6000);
          svc.nearbySearch(
            { location: origin as any, radius: 1500, type },
            (results, status) => {
              clearTimeout(timer);
              if (status === google.maps.places.PlacesServiceStatus.OK && results?.[0]) {
                const r = results[0];
                const meters = r.geometry?.location
                  ? google.maps.geometry.spherical.computeDistanceBetween(
                      new google.maps.LatLng(origin.lat, origin.lng),
                      r.geometry.location
                    )
                  : undefined;
                if (typeof meters === "number") {
                  setNearby((prev) => ({ ...prev, [type]: { meters, name: r.name } }));
                }
              }
              resolve();
            }
          );
        })
    );

    await Promise.all(tasks);
    // refresh info window if still open on same marker
    const mk = markersRef.current[L.id];
    if (mk && infoRef.current?.get("anchor") === mk) {
      infoRef.current.setContent(buildInfoHTML(L));
    }
  }

  // ---------- draw / update markers ----------
  useEffect(() => {
    if (!mapRef.current || !clustererRef.current) return;

    // remove stale
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

    const newMarkers: google.maps.Marker[] = [];

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

          // Info window (amenities may still say "searching…" initially)
          infoRef.current?.setContent(buildInfoHTML(L));
          infoRef.current?.open({ map: mapRef.current!, anchor: marker! });

          // Nearby (only if requested)
          if (requestedAmenityTypes.length > 0) {
            fetchNearbyFor(L).catch(() => {});
          }

          // Route polyline: from map center (origin) -> listing position
          if (safeCenter) {
            drawRoute(safeCenter, pos, mode);
          }
        });

        markersRef.current[L.id] = marker;
      } else {
        marker.setPosition(pos);
        marker.setTitle(`${L.bedrooms} bed ${L.property_type} · £${(L.price_gbp || 0).toLocaleString()}`);
        marker.setIcon(iconFor(strong));
      }

      newMarkers.push(marker);
    }

    if ("addMarkers" in (clustererRef.current as any) && typeof clustererRef.current!.addMarkers === "function") {
      clustererRef.current!.addMarkers!(newMarkers);
    } else {
      newMarkers.forEach((m) => clustererRef.current!.addMarker(m));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeListings, durations, onSelect, requestedAmenityTypes.length, mode, safeCenter?.lat, safeCenter?.lng]);

  // keep center in sync & clear polyline when origin changes
  useEffect(() => {
    if (mapRef.current && safeCenter) mapRef.current.setCenter(safeCenter);
    if (directionsRendererRef.current) directionsRendererRef.current.setDirections({ routes: [] } as any);
  }, [safeCenter?.lat, safeCenter?.lng]);

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
      style={{ minHeight: 400, position: "relative" }}
    >
      {/* DEBUG HUD — remove for prod */}
      <div
        style={{
          position: "absolute",
          bottom: 12,
          left: 12,
          zIndex: 20,
          background: "rgba(0,0,0,0.75)",
          color: "#fff",
          padding: "8px 10px",
          borderRadius: 8,
          fontSize: 12,
          lineHeight: 1.4,
          pointerEvents: "none",
        }}
      >
        <div><strong>Debug</strong></div>
        <div>pins rendered: {safeListings.length}</div>
        <div>amenities requested: {requestedAmenityTypes.join(", ") || "none"}</div>
        <div>nearby found: {
          Object.keys(nearby).length
            ? Object.entries(nearby).map(([k,v]) => `${k}:${v?.meters ? Math.round(v.meters)+"m" : "—"}`).join(" | ")
            : "none"
        }</div>
      </div>
    </div>
  );
}
