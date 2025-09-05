export type Area = {
  key: string;
  name: string;
  lat: number;
  lng: number;
  summary: string;
  tags?: string[];
};

/**
 * Seed catalog: add/edit freely. Keep to 1–2 lines each.
 * (We use nearest-hub matching to attach listings to an area.)
 */
export const AREAS: Area[] = [
  {
    key: "guildford",
    name: "Guildford",
    lat: 51.2362,
    lng: -0.5704,
    summary:
      "Historic market town on the North Downs. Fast trains into London; family-friendly pockets with parks and good schools.",
    tags: ["commuter", "green", "schools"],
  },
  {
    key: "woking",
    name: "Woking",
    lat: 51.3188,
    lng: -0.5589,
    summary:
      "Well-connected Surrey hub with frequent trains to Waterloo. Mix of new-builds and leafier suburbs.",
    tags: ["value", "commuter"],
  },
  {
    key: "sevenoaks",
    name: "Sevenoaks",
    lat: 51.2727,
    lng: 0.1867,
    summary:
      "Kent town with quick links to London Bridge/Charing Cross. Strong schools and easy access to Knole Park.",
    tags: ["schools", "green", "commuter"],
  },
  {
    key: "st-albans",
    name: "St Albans",
    lat: 51.7520,
    lng: -0.3367,
    summary:
      "Cathedral city north of London; period streets, good primaries/secondaries, fast trains via Thameslink.",
    tags: ["character", "schools", "commuter"],
  },
  {
    key: "reading",
    name: "Reading",
    lat: 51.4543,
    lng: -0.9781,
    summary:
      "Thames-side Berkshire city; Elizabeth line/fast services to Paddington. Lots of stock and relative value.",
    tags: ["value", "elizabeth-line"],
  },
  {
    key: "bromley",
    name: "Bromley",
    lat: 51.4060,
    lng: 0.0152,
    summary:
      "Outer SE London borough; good family housing, parks, and rail into London terminals.",
    tags: ["family", "parks"],
  },
  {
    key: "croydon",
    name: "Croydon",
    lat: 51.3721,
    lng: -0.1022,
    summary:
      "Large South London centre with fast services and tram network; broad range of housing and price points.",
    tags: ["transport", "range"],
  },
];

/** Haversine in km */
function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371, dLat = ((b.lat - a.lat) * Math.PI) / 180, dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s1 = Math.sin(dLat / 2), s2 = Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.sqrt(s1 * s1 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * s2 * s2));
}

/**
 * Simple nearest-hub matcher. Returns the closest catalog area within `withinKm`.
 * If none is close enough, returns null (we can fall back to city/postcode text).
 */
export function lookupNearestArea(lat: number, lng: number, withinKm = 30): Area | null {
  let best: { area: Area; d: number } | null = null;
  for (const a of AREAS) {
    const d = distanceKm({ lat, lng }, { lat: a.lat, lng: a.lng });
    if (!best || d < best.d) best = { area: a, d };
  }
  return best && best.d <= withinKm ? best.area : null;
}
