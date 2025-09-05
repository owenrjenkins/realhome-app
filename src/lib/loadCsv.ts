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

// UK bounds
const UK_BBOX = { minLat: 49.0, maxLat: 59.5, minLng: -8.5, maxLng: 2.5 };
function withinUK(lat: number, lng: number) {
  return lat >= UK_BBOX.minLat && lat <= UK_BBOX.maxLat && lng >= UK_BBOX.minLng && lng <= UK_BBOX.maxLng;
}
function okLatLng(lat?: number, lng?: number) {
  return typeof lat === "number" && typeof lng === "number" && isFinite(lat) && isFinite(lng) &&
         Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
}

/**
 * Loads a CSV and returns clean rows with valid UK coordinates.
 * No geocoding here (keep server calls light and predictable).
 */
export function loadListingsCsv(): Promise<MinimalListing[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<MinimalListing>(DATA_URL, {
      download: true,
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const rows = (res.data || []).map((r: any) => ({
          id: r.id || undefined,
          price_gbp: Number(r.price_gbp ?? r.price ?? 0),
          bedrooms: Number(r.bedrooms ?? 0),
          property_type: String(r.property_type ?? "").trim(),
          postcode: String(r.postcode ?? "").trim(),
          city: String(r.city ?? "").trim(),
          latitude: Number(r.latitude ?? r.lat),
          longitude: Number(r.longitude ?? r.lng),
        }))
        .filter((r) => okLatLng(r.latitude, r.longitude) && withinUK(r.latitude!, r.longitude!));

        resolve(rows);
      },
      error: reject,
    });
  });
}
