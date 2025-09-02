'use client';
import { useEffect, useState } from "react";
import { loadListingsCsv, type MinimalListing } from "@/lib/loadCsv";

export default function Page() {
  const [listings, setListings] = useState<MinimalListing[] | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);

  useEffect(() => {
    loadListingsCsv()
      .then(data => setListings(data))
      .catch(err => setCsvError(err.message));
  }, []);

  return (
    <main className="max-w-5xl mx-auto p-6 space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">RealHome</h1>
        <p className="text-gray-600">UK Property Search with Smart Location Scoring</p>
      </header>

      <section className="space-y-4">
        <div className="bg-white border rounded-lg p-4">
          <h2 className="text-lg font-semibold mb-4">Find Your Perfect Area</h2>
          <textarea
            className="w-full p-3 border rounded-md resize-none h-24"
            placeholder="Describe your ideal location... e.g., 'In London quiet street near a big park cafes a good supermarket within 45 minutes to City of London by transit'"
          />
          <button className="mt-3 px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">
            Find Areas
          </button>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Listings Overlay</h2>
        {csvError && <div className="text-red-600 text-sm">CSV error: {csvError}</div>}
        {!listings && !csvError && <div className="text-sm">Loading listings…</div>}
        {listings && (
          <div className="space-y-2">
            <div className="text-xs text-gray-600">Loaded {listings.length} listings</div>
            <div className="bg-gray-50 border rounded-lg p-4">
              <h3 className="font-medium mb-2">Sample Listings</h3>
              <div className="grid gap-2 text-sm">
                {listings.slice(0, 5).map(listing => (
                  <div key={listing.id} className="flex justify-between items-center py-1 border-b border-gray-200 last:border-b-0">
                    <div>
                      <span className="font-medium">{listing.city}</span>
                      <span className="text-gray-500 ml-2">{listing.property_type}</span>
                      <span className="text-gray-500 ml-2">{listing.bedrooms} bed</span>
                    </div>
                    <div className="text-right">
                      <div className="font-medium">£{listing.price_gbp.toLocaleString()}</div>
                      <div className="text-xs text-gray-500">{listing.postcode}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Map View</h2>
        <div className="bg-gray-100 border rounded-lg h-96 flex items-center justify-center">
          <div className="text-gray-500">Map integration coming soon...</div>
        </div>
      </section>
    </main>
  );
}
