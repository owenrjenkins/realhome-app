// client/src/hooks/useTravelFilteredProperties.ts
import { useEffect, useRef, useState } from 'react';

type LatLng = { lat: number; lng: number };
type Filters = {
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
  mode: 'driving' | 'transit' | 'walking' | 'bicycling',
  maxMins: number,
  filters: Filters,
) {
  const [props, setProps] = useState<Property[]>([]);
  const [loading, setLoading] = useState(false);
  const [chunks, setChunks] = useState<number>(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!origin) return;
    setLoading(true);
    setProps([]);
    setChunks(0);

    // Abort previous
    if (abortRef.current) abortRef.current.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    (async () => {
      try {
        const resp = await fetch('/api/properties/travel-filter', {
          method: 'POST',
          body: JSON.stringify({ origin, mode, maxMins, filters, chunkSize: 400 }),
          headers: { 'Content-Type': 'application/json' },
          signal: ac.signal,
        });

        // Stream parser for the {"chunks":[...]} structure
        const reader = resp.body?.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        if (!reader) throw new Error('no_reader');

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });

          // Extract any complete JSON arrays inside the chunks
          // We look for top-level arrays between brackets and parse them
          let start = 0;
          while (true) {
            const open = buf.indexOf('[', start);
            if (open === -1) break;
            const close = buf.indexOf(']', open);
            if (close === -1) break;
            const maybe = buf.slice(open, close + 1);
            try {
              const arr = JSON.parse(maybe);
              setProps(prev => [...prev, ...arr]);
              setChunks(c => c + 1);
              // Move window past this chunk
              buf = buf.slice(close + 1);
              start = 0;
            } catch {
              start = close + 1;
            }
          }
        }
      } catch (e) {
        if ((e as any).name !== 'AbortError') {
          console.error(e);
        }
      } finally {
        setLoading(false);
      }
    })();

    return () => {
      ac.abort();
    };
  }, [origin?.lat, origin?.lng, mode, maxMins, filters.priceMin, filters.priceMax, filters.bedroomsMin, filters.bedroomsMax]);

  return { props, loading, chunks };
}
