import type { Area } from "./areaCatalog";

export type NarrativeInput = {
  destinationName: string;
  mode: "driving" | "transit" | "walking" | "bicycling";
  maxMins?: number; // parsed target (fallback)
  strictCount: number;
  nearMissCount: number;
  budget?: { min?: number; max?: number };
  beds?: number;
  topAreas: Array<{ area: Area | null; count: number }>; // already aggregated & sorted
};

function fmtMoney(n?: number) {
  if (!n || n <= 0) return "";
  return "£" + Math.round(n).toLocaleString();
}

export function buildNarrative(input: NarrativeInput) {
  const {
    destinationName,
    mode,
    maxMins,
    strictCount,
    nearMissCount,
    budget,
    beds,
    topAreas,
  } = input;

  const bits: string[] = [];

  // Opening: what we tried to satisfy
  const budgetText =
    budget?.min && budget?.max
      ? `${fmtMoney(budget.min)}–${fmtMoney(budget.max)}`
      : budget?.max
      ? `under ${fmtMoney(budget.max)}`
      : budget?.min
      ? `over ${fmtMoney(budget.min)}`
      : undefined;

  const criteria = [
    beds ? `${beds} bed` + (beds > 1 ? "s" : "") : null,
    budgetText,
    maxMins ? `~${maxMins} min by ${mode}` : `by ${mode}`,
    `to ${destinationName}`,
  ]
    .filter(Boolean)
    .join(", ");

  bits.push(`I looked for **${criteria}**.`);

  // Results summary
  if (strictCount > 0) {
    bits.push(
      `I found **${strictCount} strong matches** that meet all of your criteria and **${nearMissCount} near misses** that are close (e.g., slightly over time or just outside budget).`
    );
  } else if (nearMissCount > 0) {
    bits.push(
      `I didn’t find exact matches, but there are **${nearMissCount} promising near misses**. If you can flex the commute by ~10–20% or nudge budget slightly, these could work.`
    );
  } else {
    bits.push(
      `No listings fit right now near your target. The nearest options are just outside your constraints — try widening commute by ~10–15 minutes or adjusting budget a notch.`
    );
  }

  // Area guidance
  if (topAreas.length) {
    const names = topAreas
      .slice(0, 3)
      .map((x) => (x.area ? x.area.name : "nearby areas"))
      .join(", ");
    bits.push(`The best concentration is around **${names}**.`);
  }

  return bits.join(" ");
}

export function buildAreaBullets(topAreas: Array<{ area: Area | null; count: number }>) {
  return topAreas.slice(0, 4).map(({ area, count }) => {
    if (!area) {
      return {
        title: "Nearby area",
        count,
        blurb: "Cluster of listings near your target; worth a look as you zoom in.",
      };
    }
    return {
      title: `${area.name} — ${count} listings`,
      count,
      blurb: area.summary,
      tags: area.tags || [],
    };
  });
}
