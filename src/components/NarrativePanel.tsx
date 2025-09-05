// src/components/NarrativePanel.tsx
"use client";

type Bullet = { title: string; blurb: string; count?: number; tags?: string[] };

export default function NarrativePanel({
  text,
  bullets = [],
}: {
  text: string;
  bullets?: Bullet[];
}) {
  return (
    <div className="space-y-3">
      <div className="rounded-xl border bg-white p-4 leading-relaxed text-sm">
        {text}
      </div>

      {bullets.length > 0 &&
        bullets.map((b, i) => (
          <div key={i} className="rounded-xl border bg-white p-3">
            <div className="font-semibold">
              {b.title}
              {typeof b.count === "number" ? ` — ${b.count} listings` : ""}
            </div>
            <div className="text-sm text-gray-700">{b.blurb}</div>
            <div className="mt-2 flex gap-2 flex-wrap">
              {(b.tags || []).map((t, j) => (
                <span
                  key={j}
                  className="text-xs rounded-full border px-2 py-0.5 bg-gray-50"
                >
                  {t}
                </span>
              ))}
            </div>
          </div>
        ))}
    </div>
  );
}
