'use client';
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import LoadingSpinner from '@/components/LoadingSpinner';
import ErrorBanner from '@/components/ErrorBanner';
import Badge from '@/components/Badge';
import { loadListingsCsv, type MinimalListing } from '@/lib/loadCsv';

const Map = dynamic(() => import('@/components/Map'), { ssr: false });

type Tile = { lat: number; lng: number; score: number; parts?: { commute:number; amenity:number; vibe:number } };

export default function Page() {
  const [text, setText] = useState<string>(
    'In London, quiet street near a big park, cafés and a good supermarket, within 45 minutes to City of London by transit.'
  );

  const [center, setCenter] = useState<{lat:number;lng:number} | null>(null);
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [listings, setListings] = useState<MinimalListing[] | null>(null);

  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg] = useState<string>('');

  // Load CSV once
  useEffect(() => {
    loadListingsCsv()
      .then(data => setListings(data))
      .catch(err => setErrMsg(`CSV load failed: ${err.message}`));
  }, []);

  async function runSearch() {
    setErrMsg('');
    setLoading(true);
    try {
      // parse then score
      const parsedRes = await fetch('/api/parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
      if (!parsedRes.ok) throw new Error(`Parse error (${parsedRes.status})`);
      const parsed = await parsedRes.json();

      const scoreRes = await fetch('/api/score', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ parsed }) });
      if (!scoreRes.ok) {
        const j = await scoreRes.json().catch(()=> ({}));
        throw new Error(j?.error || `Score error (${scoreRes.status})`);
      }
      const json = await scoreRes.json();
      setCenter(json.center);
      setTiles(json.results || []);
    } catch (e: unknown) {
      const error = e as Error;
      setErrMsg(error?.message || 'Something went wrong while scoring. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="max-w-5xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold">RealHome</h1>
        <div className="flex items-center gap-2">
          {listings && <Badge>Listings loaded: {listings.length.toLocaleString()}</Badge>}
          <Badge>Tiles cap: {process.env.REALHOME_MAX_TILES || 140}</Badge>
        </div>
      </div>

      {errMsg && <ErrorBanner message={errMsg} />}

      <div className="space-y-3">
        <label className="block text-sm font-medium">Describe your ideal location</label>
        <textarea
          className="w-full rounded-xl border p-3"
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g., In Manchester, 30 min to Piccadilly by transit, near a big park and cafés, quiet at night."
        />
        <button
          onClick={runSearch}
          disabled={loading}
          className="rounded-xl px-4 py-2 bg-black text-white disabled:opacity-60"
        >
          {loading ? 'Finding areas…' : 'Find areas'}
        </button>
        {loading && <LoadingSpinner label="Scoring candidate areas…" />}
      </div>

      {center && (
        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <Map
              center={center}
              tiles={tiles.slice(0, parseInt(process.env.REALHOME_MAX_TILES || '140'))}
              listings={(listings || []).slice(0, 300)}
            />
          </div>
          <div className="space-y-3">
            <h2 className="text-lg font-medium">Top matches</h2>
            <ol className="space-y-2">
              {tiles.slice(0, 12).map((r, i) => (
                <li key={i} className="rounded-xl border p-3">
                  <div className="font-medium">Score {(r.score * 100).toFixed(0)}%</div>
                  {r.parts && (
                    <div className="text-xs text-gray-600">
                      Commute {(r.parts.commute * 100).toFixed(0)}% · Amenities {(r.parts.amenity * 100).toFixed(0)}%
                    </div>
                  )}
                  <div className="text-xs text-gray-600">Lat {r.lat.toFixed(4)}, Lng {r.lng.toFixed(4)}</div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </main>
  );
}
