import Papa from "papaparse";

export type MinimalListing = {
  id: string;
  latitude: number;
  longitude: number;
  price_gbp: number;
  bedrooms: number;
  property_type: string;
  city: string;
  postcode: string;
  epc_rating: string;
  date_listed: string;
};

export async function loadListingsCsv(url = (process.env.NEXT_PUBLIC_DATA_URL || "/data/realhome_listings_uk_sales_minimal.csv")): Promise<MinimalListing[]> {
  const text = await fetch(url, { cache: "no-store" }).then(r => {
    if (!r.ok) throw new Error(`Failed to fetch CSV: ${r.status}`);
    return r.text();
  });
  const parsed = Papa.parse<MinimalListing>(text, { header: true, skipEmptyLines: true, dynamicTyping: true });
  if (parsed.errors?.length) {
    // Not fatal: log first 3 errors to help debug malformed rows
    console.warn("CSV parse errors:", parsed.errors.slice(0, 3));
  }
  return (parsed.data || []).filter(d =>
    Number.isFinite(d.latitude) && Number.isFinite(d.longitude) && !!d.id
  );
}

