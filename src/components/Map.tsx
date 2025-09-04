'use client';
import { useEffect, useRef } from 'react';
import { Loader } from '@googlemaps/js-api-loader';

type Tile = { lat: number; lng: number; score: number };
type Listing = {
  id: string; latitude: number; longitude: number;
  price_gbp: number; bedrooms: number; property_type: string; postcode: string; city: string;
};

export default function Map({
  center,
  tiles = [],
  listings = [],
}: {
  center: { lat: number; lng: number };
  tiles?: Tile[];
  listings?: Listing[];
}) {
  const ref = useRef<HTMLDivElement>(null);

  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY as string | undefined;
  if (!key) {
    return (
      <div className="p-3 text-sm rounded-xl border bg-yellow-50 text-yellow-800">
        Missing <code>NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY</code>. Add it in Vercel → Settings → Environment Variables, then redeploy.
      </div>
    );
  }

  useEffect(() => {
    const loader = new Loader({ apiKey: key, version: 'weekly' });
    let map: google.maps.Map | null = null;
    let info: google.maps.InfoWindow | null = null;

    loader.load().then(() => {
      map = new google.maps.Map(ref.current as HTMLDivElement, {
        center,
        zoom: 12,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
      });
      info = new google.maps.InfoWindow();

      // Heat bubbles
      tiles.slice(0, 140).forEach((t) => {
        const s = Math.max(10, Math.round(t.score * 36));
        const el = document.createElement('div');
        el.style.width = `${s}px`;
        el.style.height = `${s}px`;
        el.style.borderRadius = '50%';
        el.style.background =
          t.score > 0.7
            ? 'rgba(46, 204, 113, 0.55)'
            : t.score > 0.5
            ? 'rgba(241, 196, 15, 0.55)'
            : 'rgba(230, 126, 34, 0.55)';
        el.style.border = '1px solid rgba(0,0,0,0.15)';
        // @ts-ignore AdvancedMarkerElement requires the marker library but is in core in recent versions
        new google.maps.marker.AdvancedMarkerElement({
          map,
          position: { lat: t.lat, lng: t.lng },
          content: el,
        });
      });

      // Listing pins
      listings.slice(0, 300).forEach((L) => {
        const m = new google.maps.Marker({
          map: map!,
          position: { lat: L.latitude, lng: L.longitude },
          title: `${L.bedrooms} bed ${L.property_type}`,
        });
        m.addListener('click', () => {
          info!.setContent(`
            <div style="min-width:180px">
              <div style="font-weight:600; margin-bottom:4px;">£${(L.price_gbp || 0).toLocaleString()}</div>
              <div style="font-size:12px; color:#444;">
                ${L.bedrooms} bed ${L.property_type}<br/>
                ${L.postcode}, ${L.city}
              </div>
            </div>
          `);
          info!.open({ anchor: m, map: map! });
        });
      });
    });

    // no cleanup required for simple demo
  }, [key, center.lat, center.lng, tiles.length, listings.length]);

  return <div ref={ref} className="w-full h-[520px] rounded-2xl border" />;
}

