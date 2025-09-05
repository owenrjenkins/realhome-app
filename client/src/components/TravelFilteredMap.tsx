import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GoogleMap,
  LoadScript,
  Marker,
  InfoWindow,
  DirectionsRenderer,
} from "@react-google-maps/api";
import { useTravelFilteredProperties } from "../hooks/useTravelFilteredProperties";

type LatLng = { lat: number; lng: number };
type TravelMode = "driving" | "transit" | "walking" | "bicycling";

type Filters = {
  priceMin?: number;
  priceMax?: number;
  bedroomsMin?: number;
  bedroomsMax?: number;
};

type NearbyHit = { meters: number; name?: string };

type Props = {
  initialOrigin?: LatLng;
  mode?: TravelMode;
  maxMins?: number;
  filters?: Filters;
};

export default function TravelFilteredMap({
  initialOrigin = { lat: 51.5074, lng: -0.1278 }, // central London fallback
  mode = "transit",
  maxMins = 45,
  filters = {},
}: Props) {
  // -------------------------
  // State & data
  // -------------------------
  const [origin, setOrigin] = useState<LatLng>(initialOrigin);
  const [currentMode, setCurrentMode] = useState<TravelMode>(mode);
  const [currentMax, setCurrentMax] = useState<number>(maxMins);

  // Fetch verified properties from API (server verifies travel time via Distance Matrix)
  const { props: properties, loading, meta } = useTravelFilteredProperties(
    origin,
    currentMode,
    currentMax,
    filters
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(
    () => properties.find((p) => p.id === selectedId) || null,
    [properties, selectedId]
  );

  const [route, setRoute] = useState<google.maps.DirectionsResult | null>(null);

  const center = useMemo(() => origin, [origin]);
  const gmApiKey = import.meta.env.VITE_MAPS_JS_KEY as string;

  const mapRef = useRef<google.maps.Map | null>(null);
  const onLoad = useCallback((map: google.maps.Map) => {
    mapRef.current = map;
  }, []);
  const onUnmount = useCallback(() => {
    mapRef.current = null;
  }, []);

  // -------------------------
  // Map options
  // -------------------------
  const mapOptions: google.maps.MapOptions = {
    disableDefaultUI: false,
    clickableIcons: false,
    gestureHandling: "greedy",
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: true,
  };

  const travelModeToGoogle = (m: TravelMode): google.maps.TravelMode => {
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

  // -------------------------
  // Directions (polyline) — hardened with timeout
  // -------------------------
  async function handleShowRoute() {
    if (!selected || !mapRef.current) return;
    try {
      const svc = new google.maps.DirectionsService();
      const req: google.maps.DirectionsRequest = {
        origin: new google.maps.LatLng(origin.lat, origin.lng),
        destination: new google.maps.LatLng(selected.lat, selected.lng),
        travelMode: travelModeToGoogle(currentMode),
      };
      const res = await Promise.race([
        svc.route(req),
        new Promise<google.maps.DirectionsResult>((_, reject) =>
          setTimeout(() => reject(new Error("directions_timeout")), 8000)
        ),
      ]);
      setRoute(res);
    } catch {
      // Keep the verified minutes from server; just skip drawing the polyline on failure
      setRoute(null);
    }
  }
  function handleClearRoute() {
    setRoute(null);
  }

  // -------------------------
  // Nearby (Places) with timeout
  // -------------------------
  const NEARBY_PARK_MAX_M = 1200;
  const NEARBY_SHOP_MAX_M = 1200;
  const [nearby, setNearby] = useState<{ park?: NearbyHit; supermarket?: NearbyHit }>({});

  async function nearbyOnceWithTimeout(
    map: google.maps.Map,
    origin: LatLng,
    type: google.maps.places.PlaceType,
    radius = 1500,
    timeoutMs = 6000
  ): Promise<NearbyHit | undefined> {
    const svc = new google.maps.places.PlacesService(map);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(undefined), timeoutMs);
      svc.nearbySearch(
        { location: origin as google.maps.LatLngLiteral, radius, type },
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
              resolve({ meters, name: r.name });
              return;
            }
          }
          resolve(undefined);
        }
      );
    });
  }

  // Fetch nearby on selection
  useEffect(() => {
    setNearby({});
    if (!selected || !mapRef.current) return;
    const map = mapRef.current;
    const o = { lat: selected.lat, lng: selected.lng };
    nearbyOnceWithTimeout(map, o, "park", 1500, 6000).then((hit) => {
      if (hit) setNearby((prev) => ({ ...prev, park: hit }));
    });
    nearbyOnceWithTimeout(map, o, "supermarket", 1500, 6000).then((hit) => {
      if (hit) setNearby((prev) => ({ ...prev, supermarket: hit }));
    });
  }, [selected?.id]);

  // -------------------------
  // Map interactions
  // -------------------------
  const onMapClick = useCallback((e: google.maps.MapMouseEvent) => {
    if (!e.latLng) return;
    const lat = e.latLng.lat();
    const lng = e.latLng.lng();
    setOrigin({ lat, lng });
    setSelectedId(null);
    setRoute(null);
  }, []);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      {/* Control panel */}
      <div
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          zIndex: 10,
          background: "rgba(255,255,255,0.95)",
          padding: "8px 10px",
          borderRadius: 12,
          boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
          display: "flex",
          gap: 12,
          alignItems: "center",
        }}
      >
        <label>
          Mode{" "}
          <select
            value={currentMode}
            onChange={(e) => {
              setCurrentMode(e.target.value as TravelMode);
              setRoute(null);
            }}
          >
            <option value="driving">Driving</option>
            <option value="transit">Transit</option>
            <option value="walking">Walking</option>
            <option value="bicycling">Bicycling</option>
          </select>
        </label>
        <label>
          Max mins{" "}
          <input
            type="number"
            min={1}
            value={currentMax}
            onChange={(e) => {
              setCurrentMax(Number(e.target.value));
              setRoute(null);
            }}
            style={{ width: 60 }}
          />
        </label>
        <span style={{ opacity: 0.8 }}>
          {loading ? "Filtering…" : `${meta?.matched?.toLocaleString() ?? 0} matches`}
        </span>
        {selected && (
          <>
            <button onClick={handleShowRoute}>Show route</button>
            <button onClick={handleClearRoute}>Clear route</button>
          </>
        )}
      </div>

      <LoadScript
        googleMapsApiKey={gmApiKey}
        libraries={["places", "geometry"]}
      >
        <GoogleMap
          onLoad={onLoad}
          onUnmount={onUnmount}
          center={center}
          zoom={11}
          mapContainerStyle={{ width: "100%", height: "100%" }}
          options={mapOptions}
          onClick={onMapClick}
        >
          {/* Origin marker (draggable) */}
          <Marker
            position={{ lat: origin.lat, lng: origin.lng }}
            draggable
            onDragEnd={(e) => {
              if (!e.latLng) return;
              const lat = e.latLng.lat();
              const lng = e.latLng.lng();
              setOrigin({ lat, lng });
              setSelectedId(null);
              setRoute(null);
            }}
            label="●"
          />

          {/* Verified property pins */}
          {properties.map((p) => (
            <Marker
              key={p.id}
              position={{ lat: p.lat, lng: p.lng }}
              onClick={() => setSelectedId(p.id)}
              title={`${p.address} • £${Math.round(p.price).toLocaleString()} • ${p.bedrooms} bed • ${Math.round(
                (p.travelSeconds ?? 0) / 60
              )} min`}
            />
          ))}

          {/* Pop-up */}
          {selected && (
            <InfoWindow
              position={{ lat: selected.lat, lng: selected.lng }}
              onCloseClick={() => setSelectedId(null)}
            >
              <div style={{ minWidth: 260 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{selected.address}</div>
                <div>Postcode: {selected.postcode}</div>
                <div>£{Math.round(selected.price).toLocaleString()} • {selected.bedrooms} bed</div>
                <div>Travel time: {Math.round((selected.travelSeconds ?? 0) / 60)} min ({currentMode})</div>

                <div style={{ marginTop: 8, fontWeight: 600 }}>Why this matches</div>
                <ul style={{ margin: 0, paddingLeft: 16 }}>
                  {/* Price */}
                  {typeof filters?.priceMin === "number" && (
                    <li>
                      Price ≥ £{Math.round(filters.priceMin).toLocaleString()} —{" "}
                      {selected.price >= (filters.priceMin ?? 0) ? "✓" : "✗"} (this is £
                      {Math.round(selected.price).toLocaleString()})
                    </li>
                  )}
                  {typeof filters?.priceMax === "number" && (
                    <li>
                      Price ≤ £{Math.round(filters.priceMax).toLocaleString()} —{" "}
                      {selected.price <= (filters.priceMax ?? Infinity) ? "✓" : "✗"} (this is £
                      {Math.round(selected.price).toLocaleString()})
                    </li>
                  )}

                  {/* Beds */}
                  {typeof filters?.bedroomsMin === "number" && (
                    <li>
                      Beds ≥ {filters.bedroomsMin} —{" "}
                      {selected.bedrooms >= (filters.bedroomsMin ?? 0) ? "✓" : "✗"} (this is {selected.bedrooms})
                    </li>
                  )}
                  {typeof filters?.bedroomsMax === "number" && (
                    <li>
                      Beds ≤ {filters.bedroomsMax} —{" "}
                      {selected.bedrooms <= (filters.bedroomsMax ?? Infinity) ? "✓" : "✗"} (this is {selected.bedrooms})
                    </li>
                  )}

                  {/* Commute */}
                  <li>
                    Commute ≤ {currentMax} min —{" "}
                    {Math.round((selected.travelSeconds ?? 0) / 60) <= currentMax ? "✓" : "✗"} (this is{" "}
                    {Math.round((selected.travelSeconds ?? 0) / 60)} min by {currentMode})
                  </li>

                  {/* Nearby (populates when available) */}
                  {nearby.park && (
                    <li>
                      Park ≤ {NEARBY_PARK_MAX_M} m — {nearby.park.meters <= NEARBY_PARK_MAX_M ? "✓" : "✗"} (nearest{" "}
                      {nearby.park.name} at {Math.round(nearby.park.meters)} m)
                    </li>
                  )}
                  {nearby.supermarket && (
                    <li>
                      Supermarket ≤ {NEARBY_SHOP_MAX_M} m —{" "}
                      {nearby.supermarket.meters <= NEARBY_SHOP_MAX_M ? "✓" : "✗"} (nearest {nearby.supermarket.name} at{" "}
                      {Math.round(nearby.supermarket.meters)} m)
                    </li>
                  )}
                </ul>
              </div>
            </InfoWindow>
          )}

          {/* Route polyline */}
          {route && <DirectionsRenderer directions={route} options={{ suppressMarkers: true }} />}
        </GoogleMap>
      </LoadScript>
    </div>
  );
}
