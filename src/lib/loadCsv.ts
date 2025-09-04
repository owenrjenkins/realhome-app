import Papa from "papaparse";

export type MinimalListing = {
  id?: string;
  price_gbp: number;
  bedrooms: number;
  property_type: string;
  postcode: string;
  city: string;
  latitude?: number;
  longitude?: number;
};

const DATA_URL = process.env.NEXT_PUBLIC_DATA_URL || "/data/realhome_listings_uk_sales_minimal.csv";

// UK postcode regex
const UK_POSTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;
const UK_BBOX = { minLat: 49.0, maxLat: 59.5, minLng: -8.5, maxLng: 2.5 };

function isWithinUK(lat: number, lng: number) {
  return lat >= UK_BBOX.minLat && lat <= UK_BBOX.maxLat && lng >= UK_BBOX.minLng && lng <= UK_BBOX.maxLng;
}

async function geocodePostcode(postcode: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const res = await fetch("/api/geocode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: postcode }),
    });
    if (!res.ok) return null;
    const j = await res.json();
    return { lat: j.lat, lng: j.lng };
  } catch {
    return null;
  }
}

export async function loadListingsCsv(): Promise<MinimalListing[]> {
  const res = await fetch(DATA_URL);
  const text = await res.text();

  return new Promise((resolve, reject) => {
    Papa.parse<MinimalListing>(text, {
      header: true,
      dynamicTyping: true,
      complete: async (results) => {
        let rows = results.data.filter((r) => {
          // must have price, bedrooms, and UK postcode
          return r.price_gbp && r.bedrooms && r.postcode && UK_POSTCODE_RE.test(r.postcode);
        });

        // fix coords
        for (let row of rows) {
          let lat = Number(row.latitude);
          let lng = Number(row.longitude);
          if (!isFinite(lat) || !isFinite(lng) || !isWithinUK(lat, lng)) {
            const g = await geocodePostcode(row.postcode + ", UK");
            if (g) {
              row.latitude = g.lat;
              row.longitude = g.lng;
            }
          }
        }

        // filter again after geocoding
        rows = rows.filter((r) => isFinite(r.latitude!) && isFinite(r.longitude!) && isWithinUK(r.latitude!, r.longitude!));

        resolve(rows);
      },
      error: reject,
    });
  });
}
