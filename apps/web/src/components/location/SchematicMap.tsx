import type { LatLng, PlaceKind } from "@baytline/core";
import { distanceText } from "@/lib/homes-format";

export type MapPoint = { n: number; name: string; kind: PlaceKind; coordinates: LatLng };

const RING_STEPS = [250, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];
const COLOR: Record<PlaceKind, string> = { amenity: "var(--gulf)", infrastructure: "var(--saffron)", competitor: "var(--coral)" };

/**
 * A schematic map drawn from recorded coordinates: the project at the centre, places at their
 * straight-line offset, with distance rings. No tiles, no provider, nothing looked up.
 */
export function SchematicMap({ origin, points, labels, intlLocale }: {
  origin: LatLng;
  points: MapPoint[];
  labels: { title: string; project: string; north: string };
  intlLocale: string;
}) {
  const W = 640, H = 440, cx = W / 2, cy = H / 2, radius = 190;
  const offsets = points.map((p) => ({
    ...p,
    dx: (p.coordinates.lng - origin.lng) * 111_320 * Math.cos((origin.lat * Math.PI) / 180),
    dy: (p.coordinates.lat - origin.lat) * 110_540,
  }));
  const far = Math.max(0, ...offsets.map((o) => Math.hypot(o.dx, o.dy)));
  const R = RING_STEPS.find((s) => s >= far * 1.08) ?? RING_STEPS[RING_STEPS.length - 1]!;
  const rings = RING_STEPS.filter((s) => s <= R).slice(-3);
  const k = radius / R;
  return (
    <div dir="ltr">
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={labels.title} className="h-auto w-full rounded-panel border border-line bg-surface-sunk">
      <title>{labels.title}</title>
      {rings.map((r) => (
        <g key={r}>
          <circle cx={cx} cy={cy} r={r * k} fill="none" stroke="var(--line)" strokeDasharray="4 6" />
          <text x={cx + r * k * 0.71 + 4} y={cy - r * k * 0.71 - 4} fontSize="12" fill="var(--ink-muted)">{distanceText(r, intlLocale)}</text>
        </g>
      ))}
      <line x1={cx} y1={cy - radius - 14} x2={cx} y2={cy + radius + 14} stroke="var(--line)" />
      <line x1={cx - radius - 14} y1={cy} x2={cx + radius + 14} y2={cy} stroke="var(--line)" />
      <g transform={`translate(${W - 34} 30)`}>
        <path d="M0 -14 L7 8 L0 3 L-7 8 Z" fill="var(--ink-muted)" />
        <text y="24" textAnchor="middle" fontSize="12" fill="var(--ink-muted)">{labels.north}</text>
      </g>
      {offsets.map((o) => {
        const x = cx + o.dx * k, y = cy - o.dy * k, c = COLOR[o.kind];
        const shape = o.kind === "amenity" ? <circle r="11" fill={c} /> : o.kind === "infrastructure" ? <rect x="-10" y="-10" width="20" height="20" rx="3" fill={c} /> : <path d="M0 -13 L13 0 L0 13 L-13 0 Z" fill={c} />;
        return (
          <g key={o.n} transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`}>
            <title>{`${o.n}. ${o.name}`}</title>
            {shape}
            <text y="4" textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--gulf-ink)">{o.n}</text>
          </g>
        );
      })}
      <g transform={`translate(${cx} ${cy})`}>
        <circle r="9" fill="var(--ink)" stroke="var(--surface-sunk)" strokeWidth="3" />
        <text y="22" textAnchor="middle" paintOrder="stroke" stroke="var(--surface)" strokeWidth="4" fontSize="12" fontWeight="600" fill="var(--ink)">{labels.project}</text>
      </g>
    </svg>
    </div>
  );
}
