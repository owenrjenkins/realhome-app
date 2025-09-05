import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GoogleMap,
  LoadScript,
  Marker,
  InfoWindow,
  DirectionsRenderer,
} from "@react-google-maps/api";
import { useTravelFilteredProperties, type Filters } from "../hooks/useTravelFilteredProperties";

// -----------------------------
// Types
// -----------------------------
type LatLng = { lat: number; lng: number };
type TravelMode = "driving" | "transit" | "walking" | "bicycling";
type NearbyHit = { meters: number; name?: string };

// Props now accept a free-text query describing amenity requirements.
// Only amenities parsed from this text will be searched & shown in evidence.
type Props = {
  initialOrigin?: LatLng;
  mode?: TravelMode;
  maxMins?: number;
  filters?: Filters;
  amenityQueryText?: string; // e.g. "must be near a decent primary school, GP, and a tube station"
};

// -----------------------------
// Human-friendly → Google Places type mapping
// (We’ll parse user text to decide what to check.)
// -----------------------------
const AMENITY_KEYWORDS: Record<string, google.maps.places.PlaceType[]> = {
  // family / education / childcare
  "nursery": ["school"],
  "primary school": ["school"],
  "secondary school": ["school"],
  "school": ["school"],
  "university": ["university"],
  // health
  "gp": ["doctor"],
  "doctor": ["doctor"],
  "hospital": ["hospital"],
  "pharmacy": ["pharmacy"],
  "chemist": ["pharmacy"],
  "dentist": ["dentist"],
  "vet": ["veterinary_care"],
  // parks & pets
  "park": ["park"],
  "playground": ["park"],
  "dog park": ["park"],
  // transport
  "tube": ["subway_station"],
  "underground": ["subway_station"],
  "train": ["train_station"],
  "rail": ["train_station"],
  "dlr": ["light_rail_station"],
  "tram": ["light_rail_station"],
  "bus": ["bus_station"],
  "coach": ["bus_station"],
  "ferry": ["ferry_terminal"],
  "airport": ["airport"],
  // shopping & daily life
  "supermarket": ["supermarket"],
  "grocery": ["supermarket"],
  "bakery": ["bakery"],
  "butcher": ["store"],
  "greengrocer": ["store"],
  "convenience": ["convenience_store"],
  "post office": ["post_office"],
  "parcel": ["post_office"],
  "atm": ["atm"],
  "bank": ["bank"],
  // food & drink / social
  "coffee": ["cafe"],
  "cafe": ["cafe"],
  "coffee shop": ["cafe"],
  "restaurant": ["restaurant"],
  "pub": ["bar"],
  "wine bar": ["bar"],
  "bar": ["bar"],
  // fitness & sport
  "gym": ["gym"],
  "swimming": ["gym"],
  "tennis": ["stadium"],
  "climbing": ["gym"],
  // culture & leisure
  "library": ["library"],
  "cinema": ["movie_theater"],
  "theatre": ["movie_theater"],
  "bookshop": ["book_store"],
  "museum": ["museum"],
  "gallery": ["art_gallery"],
  // mobility & car
  "ev charger": ["electric_vehicle_charging_station"],
  "charging": ["electric_vehicle_charging_station"],
  "parking": ["parking"],
  "petrol": ["gas_station"],
  "fuel": ["gas_station"],
  "car park": ["parking"],
  // work & services
  "coworking": ["point_of_interest"],
  "postbox": ["post_office"],
};

function parseAmenityTypesFromText(text?: string): google.maps.places.PlaceType[] {
  if (!text) return [];
  const lc = text.toLowerCase();
  const out: google.maps.places.PlaceType[] = [];
  for (const [key, types] of Object.entries(AMENITY_KEYWORDS)) {
    if (lc.includes(key)) {
      types.forEach(t => { if (!out.includes(t)) out.push(t); });
    }
  }
  return out;
}

// default evidence thresholds (meters) – used ONLY if a category is requested
const DEFAULT_AMENITY_THRESHOLDS: Partial<Record<google.maps.places.PlaceType, number>> = {
  park: 1200,
  supermarket: 1200,
  school: 1500,
  university: 2500,
  doctor: 1500,
  hospital: 3000,
  pharmacy: 1200,
  dentist: 1500,
  veterinary_care: 2000,
  subway_station: 1200,
  train_station: 2000,
  light_rail_station: 2000,
  bus_station: 600,
  ferry_terminal: 3000,
  airport: 15000,
  bakery: 800,
  convenience_store: 600,
  post_office: 1200,
  atm: 400,
  bank: 1200,
  cafe: 600,
  restaurant: 800,
  bar: 800,
  gym: 1200,
  stadium: 2500,
  movie_theater: 2000,
  library: 1500,
  book_store: 1500,
  museum: 3000,
  art_gallery: 3000,
  electric_vehicle_charging_station: 1200,
  parking: 800,
  gas_station: 1500,
  point_of_interest: 2000,
};

export default function TravelFilteredMap({
  initialOrigin = { lat: 51.5074, lng: -0.1278 },
  mode = "transit",
  maxMins = 45,
  filters = {},
  amenityQueryText,
}: Props) {
  // -----------------------------------
  // State
  // -----------------------------------
  const [origin, setOrigin] = useState<LatLng>(initialOrigin);
  const [currentMode, setCurrentMode] = useState<TravelMode>(mode);
  const [currentMax, setCurrentMax] = useState<number>(maxMins);

  // Ask backend for more breadth so map shows *all* verified matches (no slice)
  const { props: properties, loading, meta } = useTravelFilteredProperties(
    origin,
    currentMode,
    currentMax,
    filters,
    { maxCandidates: 4000 }
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(
    () => properties.find((p) => p.id === selectedId) || null,
    [properties, selectedId]
  );

  const [route, setRoute] = useState<google.maps.DirectionsResult | null>(null);
  const [nearby, setNearby] = useState<Record<google.maps.places.PlaceType, NearbyHit | undefined>>({});

  const requestedAmenityTypes = useMemo(
    () => parseAmenityTypesFromText(amenityQueryText),
    [amenityQueryText]
  );

  const center = useMemo(() => origin, [origin]);
  const gmApiKey = import.meta.env.VITE_MAPS_JS_KEY as string;

  const mapRef = useRef<google.maps.Map | null>(null);
  const onLoad = useCallback((map: google.maps.Map) => { mapRef.current = map; }, []);
  const onUnmount = useCallback(() => { mapRef.current = null; }, []);

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
      case "walking": return google.maps.TravelMode.WALKING;
      case "bicycling": return google.maps.TravelMode.BICYCLING;
      case "transit": return google.maps.TravelMode.TRANSIT;
      default: return google.maps.TravelMode.DRIVING;
    }
  };

  // -----------------------------------
  // Directions (Show Route) – with timeout
  // -----------------------------------
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
      // keep server-verified minutes; just don't draw a polyline
      setRoute(null);
    }
  }
  function handleClearRoute() { setRoute(null); }

  // -----------------------------------
  // Nearby (Places) – only for *requested* categories, with timeout
  // -----------------------------------
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

  // Fetch Nearby for the selected property, only for requested categories
  useEffect(() => {
    setNearby({});
    if (!selected || !mapRef.current || requestedAmenityTypes.length === 0) return;

    const map = mapRef.current;
    const o = { lat: selected.lat, lng: selected.lng };

    requestedAmenityTypes.forEach(async (type) => {
      const hit = await nearbyOnceWithTimeout(map, o, type, 1500, 6000);
      if (hit) {
        setNearby((prev) => ({ ...prev, [type]: hit }));
      }
    });
  }, [selected?.id, requestedAmenityTypes.length]);

  // -----------------------------------
  // Map interactions
  // -----------------------------------
  const onMapClick = useCallback((e: google.maps.MapMouseEvent) => {
    if (!e.latLng) return;
    const lat = e.latLng.lat();
    const lng = e.latLng.lng();
    setOrigin({ lat, lng });
    setSelectedId(null);
    setRoute(null);
  }, []);

  // -----------------------------------
  // Render
  // -----------------------------------
  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      {/* Control panel */}
      <div
        style={{
          position: "absolute", top: 12, left: 12, zIndex: 10,
          background: "rgba(255,255,255,0.95)", padding: "8px 10px",
          borderRadius: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
          display: "flex", gap: 12, alignItems: "center",
        }}
      >
        <label>
          Mode{" "}
          <select
            value={currentMode}
            onChange={(e) => { setCurrentMode(e.target.value as TravelMode); setRoute(null); }}
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
            onChange={(e) => { setCurrentMax(Number(e.target.value)); setRoute(null); }}
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

      <LoadScript googleMapsApiKey={gmApiKey} libraries={["places", "geometry"]}>
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

          {/* Verified property pins – render ALL returned (no slice) */}
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

          {/* Listing details */}
          {selected && (
            <InfoWindow
              position={{ lat: selected.lat, lng: selected.lng }}
              onCloseClick={() => setSelectedId(null)}
            >
              <div style={{ minWidth: 280 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{selected.address}</div>
                <div>{selected.postcode}</div>
                <div>£{Math.round(selected.price).toLocaleString()} • {selected.bedrooms} bed</div>

                {/* Evidence – only show amenity lines if requested in free text */}
                <div style={{ marginTop: 10, fontWeight: 600 }}>Why this matches</div>
                <ul style={{ margin: 0, paddingLeft: 16 }}>
                  {typeof filters.priceMin === "number" && (
                    <li>
                      Price ≥ £{Math.round(filters.priceMin).toLocaleString()} —{" "}
                      {selected.price >= filters.priceMin ? "✓" : "✗"} (this is £{Math.round(selected.price).toLocaleString()})
                    </li>
                  )}
                  {typeof filters.priceMax === "number" && (
                    <li>
                      Price ≤ £{Math.round(filters.priceMax).toLocaleString()} —{" "}
                      {selected.price <= filters.priceMax ? "✓" : "✗"} (this is £{Math.round(selected.price).toLocaleString()})
                    </li>
                  )}
                  {typeof filters.bedroomsMin === "number" && (
                    <li>
                      Beds ≥ {filters.bedroomsMin} — {selected.bedrooms >= filters.bedroomsMin ? "✓" : "✗"} (this is {selected.bedrooms})
                    </li>
                  )}
                  {typeof filters.bedroomsMax === "number" && (
                    <li>
                      Beds ≤ {filters.bedroomsMax} — {selected.bedrooms <= filters.bedroomsMax ? "✓" : "✗"} (this is {selected.bedrooms})
                    </li>
                  )}
                  <li>
                    Commute ≤ {currentMax} min — {Math.round((selected.travelSeconds ?? 0) / 60) <= currentMax ? "✓" : "✗"} (this is{" "}
                    {Math.round((selected.travelSeconds ?? 0) / 60)} min by {currentMode})
                  </li>

                  {/* Nearby evidence – ONLY for requested categories */}
                  {requestedAmenityTypes.length > 0 && (
                    <>
                      {requestedAmenityTypes.map((type) => {
                        const hit = nearby[type];
                        const limit = DEFAULT_AMENITY_THRESHOLDS[type] ?? 1500;
                        return (
                          <li key={type}>
                            {type.replaceAll("_", " ")}{" "}
                            {hit
                              ? `≤ ${limit} m — ${hit.meters <= limit ? "✓" : "✗"} (nearest ${hit.name ?? "place"} at ${Math.round(hit.meters)} m)`
                              : "searching…"}
                          </li>
                        );
                      })}
                    </>
                  )}
                </ul>
              </div>
            </InfoWindow>
          )}

          {/* Optional route polyline */}
          {route && <DirectionsRenderer directions={route} options={{ suppressMarkers: true }} />}
        </GoogleMap>
      </LoadScript>
    </div>
  );
}
