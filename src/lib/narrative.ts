// src/lib/narrative.ts

type Area = { outward: string; name: string; count: number };

export function buildNarrative(opts: {
  destinationName: string;
  mode: "driving" | "transit" | "walking" | "bicycling";
  maxMins: number;
  strictCount: number;
  nearMissCount: number;
  budget: { min?: number; max?: number };
  beds?: number;
  topAreas: Area[];
}) {
  const { destinationName, mode, maxMins, strictCount, nearMissCount, budget, beds, topAreas } = opts;

  const money = (n?: number) => (typeof n === "number" ? `£${n.toLocaleString()}` : undefined);

  const bits: string[] = [];
  if (beds) bits.push(`${beds} beds`);
  if (typeof budget.max === "number") bits.push(`under ${money(budget.max)}`);
  else if (typeof budget.min === "number") bits.push(`over ${money(budget.min)}`);
  bits.push(`~${maxMins} min by ${mode}`);

  const lead = `I looked for ${bits.join(", ")}${destinationName ? `, to ${destinationName}` : ""}.`;
  const found = ` I found ${strictCount} strong matches that meet all of your criteria and ${nearMissCount} near misses that are close (e.g., slightly over time or just outside budget).`;

  let cluster = "";
  if (topAreas.length > 0) {
    const names = topAreas.slice(0, 3).map((a) => a.name || a.outward);
    cluster = ` The best concentration is around ${names.join(", ")}.`;
  } else {
    cluster = ` The listings are spread across nearby areas.`;
  }

  return (lead + found + cluster).trim();
}

export function buildAreaBullets(topAreas: Area[]) {
  const bullets = topAreas.slice(0, 4).map((a) => ({
    title: a.name || a.outward,
    blurb: "Cluster of listings near your target; worth a look as you zoom in.",
    tags: ["transport", "range"],
    count: a.count,
  }));
  // Hide cards if we genuinely have no areas
  return bullets.length ? bullets : [];
}
