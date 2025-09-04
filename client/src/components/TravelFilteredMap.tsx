import { useCallback, useMemo, useState } from "react";
import { GoogleMap, LoadScript, Marker } from "@react-google-maps/api";
import { useTravelFilteredProperties } from "../hooks/useTravelFilteredProperties";

type LatLng = { lat: number; lng: number };

type Props = {
  initialOrigin?: LatLng;
  mode?: "driving" | "transit" | "walking" | "bicycling";
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
  filters = {}
}: Props) {
  const [origin, setOrigin] = useState<LatLng>(initialOrigin);
  const [currentMode, setCurrentMode] =
    useState<"driving" | "transit" | "walking" | "bicycling">(mode);
  const [currentMax, setCurrentMax] = useState<number>(maxMins);

  const { props: properties, loading, meta } = useTravelFilteredProperties(
    origin,
    currentMode,
    currentMax,
    filters
  );

  const gmApiKey = import.meta.env.VITE_MAPS_JS_KEY as string;
  const center = useMemo(() => origin, [origin]);

  const mapOptions: google.maps.MapOptions = {
    disableDefaultUI: false,
    clickableIcons: false,
    streetViewControl: false,
    mapTypeControl: false,
    zoomControl: true,
    gestureHandling: "greedy",
    minZoom: 5
  };

  const onMapClick = useCallback((e: google.maps.MapMouseEvent) => {
    if (e.latLng) setOrigin({ lat: e.latLng.lat(), lng: e.latLng.lng() });
  }, []);

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
          fontSize: 12
        }}
      >
        <label>
          Mode{" "}
          <select
            value={currentMode}
            onChange={(e) => setCurrentMode(e.target.value as any)}
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
            onChange={(e) => setCurrentMax(Number(e.target.value))}
            style={{ width: 60 }}
          />
        </label>
        <span style={{ opacity: 0.8 }}>
          {loading
            ? "Filtering…"
            : `${meta?.matched?.toLocaleString() ?? 0} matches`}
        </span>
      </div>

      <LoadScript googleMapsApiKey={gmApiKey} libraries={["places"]}>
        <GoogleMap
          center={center}
          zoom={11}
          mapContainerStyle={{ width: "100%", height: "100%" }}
          options={mapOptions}
          onClick={onMapClick}
        >
          {/* Origin */}
          <Marker
            position={origin}
            draggable
            onDragEnd={(e) => {
              if (e.latLng) setOrigin({ lat: e.latLng.lat(), lng: e.latLng.lng() });
            }}
            label="●"
          />

          {/* Only verified pins are shown */}
          {properties.map((p) => (
            <Marker
              key={p.id}
              position={{ lat: p.lat, lng: p.lng }}
              title={`${p.address} • £${Math.round(p.price).toLocaleString()} • ${p.bedrooms} bed • ${Math.round(
                (p.travelSeconds ?? 0) / 60
              )} min`}
            />
          ))}
        </GoogleMap>
      </LoadScript>
    </div>
  );
}
