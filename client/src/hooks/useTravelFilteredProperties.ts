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
  travelSeconds?: number; // set by server when it passes the travel-time filter
};

export type Meta = {
  total: number;       // total rows in CSV
  considered: number;  // candidates Distance Matrix was run on
  matched: number;     // items that passed (== items.length)
};

export function useTravelFilteredProperties(
  origin: LatLng | undefined,
  mode: "driving" | "transit" | "walking" | "bicycling",
  maxMins: number,
  filters: Filters,
  opts?: { maxCandidates?: number }
) {
  const [props, setProps] = useState<Property[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!origin) return;
    const controller = new AbortController();

    setLoading(true);
    setProps([]);
    setMeta(null);

    (async () => {
      try {
        const resp = await fetch("/api/properties/travel-filter", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            origin,
            mode,
            maxMins,
            filters,
            maxCandidates: opts?.maxCandidates ?? 4000, // ask server for breadth
          }),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json() as {
          items: Property[];
          total: number;
          considered: number;
          matched: number;
        };

        // IMPORTANT: do NOT slice – the map must render ALL verified matches
        setProps(Array.isArray(data.items) ? data.items : []);
        setMeta({
          total: data.total ?? 0,
          considered: data.considered ?? 0,
          matched: data.matched ?? (data.items?.length ?? 0),
        });
      } catch (e: any) {
        if (e?.name !== "AbortError") {
          console.error("travel-filter fetch failed:", e);
          setProps([]);
          setMeta(null);
        }
      } finally {
        setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [
    origin?.lat,
    origin?.lng,
    mode,
    maxMins,
    filters.priceMin,
    filters.priceMax,
    filters.bedroomsMin,
    filters.bedroomsMax,
    opts?.maxCandidates,
  ]);

  return { props, loading, meta };
}
