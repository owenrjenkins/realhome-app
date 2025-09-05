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
  // Populated by server when the listing passes travel-time filter
  travelSeconds?: number;
};

export type Meta = {
  total: number;       // total rows in CSV
  considered: number;  // prefiltered candidates Distance Matrix was run on
  matched: number;     // items that passed (== items.length)
};

export function useTravelFilteredProperties(
  origin: LatLng | undefined,
  mode: "driving" | "transit" | "walking" | "bicycling",
  maxMins: number,
  filters: Filters,
  opts?: {
    maxCandidates?: number; // optional override; server default is 2000 (see server/index.js patch)
    abortRef?: React.MutableRefObject<AbortController | null>;
  }
) {
  const [props, setProps] = useState<Property[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!origin) return;

    // allow external abort if provided
    const controller = new AbortController();
    if (opts?.abortRef) opts.abortRef.current = controller;

    setLoading(true);
    setMeta(null);
    setProps([]);

    (async () => {
      try {
        const body = {
          origin,
          mode,
          maxMins,
          filters,
          // Ask server for more breadth so map shows *all* that pass
          maxCandidates: opts?.maxCandidates ?? 4000,
        };

        const resp = await fetch("/api/properties/travel-filter", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

        const data = await resp.json() as { items: Property[]; total: number; considered: number; matched: number };
        // CRITICAL: do NOT slice here – map must receive *all* verified matches
        setProps(Array.isArray(data.items) ? data.items : []);
        setMeta({ total: data.total ?? 0, considered: data.considered ?? 0, matched: data.matched ?? (data.items?.length ?? 0) });
      } catch (e) {
        if ((e as any)?.name !== "AbortError") {
          console.error("travel-filter fetch failed:", e);
          setProps([]);
          setMeta(null);
        }
      } finally {
        setLoading(false);
      }
    })();

    return () => {
      controller.abort();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    origin?.lat, origin?.lng,
    mode,
    maxMins,
    filters.priceMin, filters.priceMax, filters.bedroomsMin, filters.bedroomsMax,
    opts?.maxCandidates
  ]);

  return { props, loading, meta };
}
