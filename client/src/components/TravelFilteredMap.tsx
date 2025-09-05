import { useCallback, useMemo, useRef, useState } from "react";
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

type Props = {
  initialOrigin?: LatLng;
  mode?: TravelMode;
  maxMins?: number;
  filters?: {
    priceMin?: number;
    priceMax?: number;
    bedroomsMin?: number;
    bedroomsMax?: number;
  };
};

export default function TravelFilteredMap({
  initialOrigin = { lat: 51.5074, lng: -0.1278 }, // London
  mode = "driving",
  maxMins = 45,
  filters = {},
}: Props) {
  const [origin, setOrigin] = useState<LatLng>(initialOrigin);
  const [currentMode, setCurrentMode] = useState<TravelMode>(mode);
  const [currentMax, setCurrentMax] = useState<number>(maxMins);
  const { props: properties, loading, meta } = useTravelFilteredProperties(
    origin,
    currentMode,
    currentMax,
    filters
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [route, setRoute] = useState<google.maps.DirectionsResult | null>(null);

  const gmApiKey = import.meta.env.VITE_MAPS_JS_KEY as string;
  const center = useMemo(() => origin, [origin]);

  const mapRef = useRef<google.maps.Map | null>(null);
  const onLoad = useCallback((map: google.maps.Map) => {
    mapRef.current = map;
  }, []);
  const onUnmount = useCallback(() => {
    mapRef.current = null;
  }, []);

  const mapOptions: google.maps.MapOptions = {
    disableDefaultUI: false,
    clickableIcons: false,
    streetViewControl: false,
    mapTypeControl: false,
    zoomControl: true,
    gestureHandling: "greedy",
    minZoom: 5,
  };

  const onMapClick = useCallback((e: google.maps.MapMouseEvent) => {
    if (e.latLng) {
      setOrigin({ lat: e.latLng.lat(), lng: e.latLng.lng() });
      setRoute(null); // clear any route when origin changes
    }
  }, []);

  const selected = useMemo(
    () => properties.find((p) => p.id === selectedId) || null,
    [properties, selectedId]
  );

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

  async function handleShowRoute() {
    if (!selected || !mapRef.current) return;
    const svc = new google.maps.DirectionsService();
    const req: google.maps.DirectionsRequest = {
      origin: new google.maps.LatLng(origin.lat, origin.lng),
      destination: new google.maps.LatLng(selected.lat, selected.lng),
      travelMode: travelModeToGoogle(currentMode),
      // For transit, you can add transitOptions if needed
      // transitOptions: { modes: [google.maps.TransitMode.SUBWAY, ...] }
      // drivingOptions: { departureTime: new Date() }
    };
    const res = await svc.route(req);
    setRoute(res);
  }

  function handleClearRoute() {
    setRoute(null);
  }

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
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
          gap: 8,
          alignItems: "center",
          fontSize: 12,
        }}
      >
        <label>
          Mode{" "}
          <select
            value={currentMode}
            onChange={(e) => {
              setCurrentMode(e.target.value as any);
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
        {route && (
          <button onClick={handleClearRoute} style={{ marginLeft: 8 }}>
            Clear route
          </button>
        )}
      </div>

      <LoadScript
        googleMapsApiKey={gmApiKey}
        libraries={[] /* no Places needed for this MVP */}
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
            position={origin}
            draggable
            onDragEnd={(e) => {
              if (e.latLng) {
                setOrigin({ lat: e.latLng.lat(), lng: e.latLng.lng() });
                setRoute(null);
              }
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
              <div style={{ minWidth: 220 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{selected.address}</div>
                <div>Postcode: {selected.postcode}</div>
                <div>£{Math.round(selected.price).toLocaleString()} • {selected.bedrooms} bed</div>
                <div>
                  Travel time: {Math.round((selected.travelSeconds ?? 0) / 60)} min ({currentMode})
                </div>
                <div style={{ marginTop: 8 }}>
                  <button onClick={handleShowRoute}>Show route</button>
                </div>
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
