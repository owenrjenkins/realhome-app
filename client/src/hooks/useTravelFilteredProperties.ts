import { useEffect, useState } from "react";

export type LatLng = { lat: number; lng: number };
export type Filters = {
  priceMin?: number;
  priceMax?: number;
  bedroomsMin?: number;
  bedroomsMax?: number;
};
export type Property = {
  id: string;
  address: string;
  postcode: string;
  price: number;
  bedrooms: number;
  lat: number;
  lng: number;
  travelSeconds?: number;
};

export function useTravelFilteredProperties(
  origin: LatLng | null,
  mode: "driving" | "transit" | "walking" | "bicycling",
  maxMins: number,
  filters: Filters
) {
  const [props, setProps] = useState<Property[]>([]);
  const [loading, setLoading] = useState(false);
  const [meta, setMeta] = useState<{ total: number; considered: number; matched: number } | null>(null);

  useEffect(() => {
    if (!origin) return;
    let canceled = false;
    setLoading(true);
    setProps([]);
    setMeta(null);

    (async () => {
      try {
        const resp = await fetch("/api/properties/travel-filter", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ origin, mode, maxMins, filters })
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        if (!canceled) {
          setProps(data.items ?? []);
          setMeta({ total: data.total, considered: data.considered, matched: data.matched });
        }
      } catch (e) {
        if (!canceled) {
          console.error(e);
          setProps([]);
          setMeta(null);
        }
      } finally {
        if (!canceled) setLoading(false);
      }
    })();

    return () => {
      canceled = true;
    };
  }, [origin?.lat, origin?.lng, mode, maxMins, filters.priceMin, filters.priceMax, filters.bedroomsMin, filters.bedroomsMax]);

  return { props, loading, meta };
}
