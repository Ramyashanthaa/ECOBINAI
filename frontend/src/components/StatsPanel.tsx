import { useEffect, useRef, useState } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { ImpactStats, StatsData, WasteEvent } from "../types";

const COLORS: Record<string, string> = {
  RECYCLABLE: "#22c55e",
  COMPOST: "#f97316",
  TRASH: "#9ca3af",
  HAZARDOUS: "#ef4444",
};

function useCountUp(target: number, decimals = 0, duration = 1400) {
  const [display, setDisplay] = useState(target);
  const fromRef = useRef(target);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const from = fromRef.current;
    const diff = target - from;
    if (diff === 0) return;
    const startTime = performance.now();

    function tick(now: number) {
      const p = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(parseFloat((from + diff * eased).toFixed(decimals)));
      if (p < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
      }
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, decimals, duration]);

  return display;
}

function ImpactCounter({ impact }: { impact: ImpactStats }) {
  const sorted     = useCountUp(impact.items_sorted,      0);
  const co2        = useCountUp(impact.co2_diverted_kg,   2);
  const recyclable = useCountUp(impact.recyclables_saved, 0);

  const rows: { icon: string; value: string; label: string; color: string }[] = [
    {
      icon:  "♻️",
      value: sorted.toLocaleString(),
      label: "Items correctly sorted",
      color: "#a78bfa",
    },
    {
      icon:  "🌍",
      value: `${co2.toFixed(2)} kg`,
      label: "Estimated CO₂ diverted",
      color: "#34d399",
    },
    {
      icon:  "🌱",
      value: recyclable.toLocaleString(),
      label: "Recyclables saved from landfill",
      color: "#22c55e",
    },
  ];

  return (
    <div className="rounded-2xl overflow-hidden border border-emerald-900/40"
         style={{ background: "linear-gradient(135deg, #052e16 0%, #0f172a 100%)" }}>
      <div className="px-4 pt-4 pb-2 flex items-center gap-2">
        <span className="text-base">🌿</span>
        <span className="text-xs font-bold text-emerald-400 uppercase tracking-widest">
          Environmental Impact
        </span>
      </div>
      <div className="divide-y divide-white/5">
        {rows.map(({ icon, value, label, color }) => (
          <div key={label} className="flex items-center gap-3 px-4 py-3">
            <span className="text-xl w-7 text-center flex-shrink-0">{icon}</span>
            <div className="min-w-0">
              <p className="text-2xl font-bold tabular-nums leading-none"
                 style={{ color }}>
                {value}
              </p>
              <p className="text-xs text-gray-500 mt-0.5 leading-tight">{label}</p>
            </div>
          </div>
        ))}
      </div>
      <p className="text-center text-[10px] text-gray-700 pb-3 pt-1">
        Based on EPA average item weights & recycling emissions factors
      </p>
    </div>
  );
}

const ICONS: Record<string, string> = {
  RECYCLABLE: "♻️",
  COMPOST: "🌱",
  TRASH: "🗑️",
  HAZARDOUS: "⚠️",
};

interface Props {
  stats: StatsData | null;
  impact: ImpactStats | null;
  recentEvents: WasteEvent[];
}

interface SliceLabelProps {
  cx: number; cy: number;
  midAngle: number;
  innerRadius: number; outerRadius: number;
  percent: number;
  name: string; value: number;
}
function renderIconCallout(props: unknown) {
  const { cx, cy, midAngle, outerRadius, percent, name, value } = props as SliceLabelProps;
  if (percent < 0.04) return null;
  const RAD = Math.PI / 180;
  const sin = Math.sin(-midAngle * RAD);
  const cos = Math.cos(-midAngle * RAD);
  const sx = cx + outerRadius * cos;
  const sy = cy + outerRadius * sin;
  const mx = cx + (outerRadius + 14) * cos;
  const my = cy + (outerRadius + 14) * sin;
  const ex = mx + (cos >= 0 ? 1 : -1) * 18;
  const ey = my;
  const textAnchor = cos >= 0 ? "start" : "end";
  const color = COLORS[name] ?? "#9ca3af";
  const pct = Math.round(percent * 100);
  return (
    <g>
      <path d={`M${sx},${sy}L${mx},${my}L${ex},${ey}`} stroke={color} strokeWidth={1} fill="none" />
      <circle cx={ex} cy={ey} r={2} fill={color} />
      <text
        x={ex + (cos >= 0 ? 6 : -6)}
        y={ey + 2}
        textAnchor={textAnchor}
        fontSize={16}
      >
        {ICONS[name] ?? ""}
      </text>
      <text
        x={ex + (cos >= 0 ? 26 : -26)}
        y={ey - 2}
        textAnchor={textAnchor}
        fill={color}
        fontSize={13}
        fontWeight={700}
      >
        {value}
      </text>
      <text
        x={ex + (cos >= 0 ? 26 : -26)}
        y={ey + 12}
        textAnchor={textAnchor}
        fill="#9ca3af"
        fontSize={10}
        fontWeight={600}
      >
        {pct}%
      </text>
    </g>
  );
}

export default function StatsPanel({ stats, impact, recentEvents }: Props) {
  if (!stats) {
    return (
      <div className="glass-card p-6 text-center text-gray-500 text-sm min-h-40 flex items-center justify-center">
        No data yet — classify some waste to see statistics
      </div>
    );
  }

  const pieData = Object.entries(stats.category_counts).map(([name, value]) => ({
    name,
    value,
  }));

  const total = stats.total_items || 0;
  const categoryStats: Array<{ key: keyof typeof COLORS; label: string; count: number; pct: number }> = [
    { key: "RECYCLABLE", label: "Recyclable", count: stats.category_counts.RECYCLABLE ?? 0, pct: stats.recyclable_pct },
    { key: "COMPOST",    label: "Compost",    count: stats.category_counts.COMPOST ?? 0,    pct: stats.compost_pct },
    { key: "TRASH",      label: "Trash",      count: stats.category_counts.TRASH ?? 0,      pct: stats.trash_pct },
    { key: "HAZARDOUS",  label: "Hazardous",  count: stats.category_counts.HAZARDOUS ?? 0,  pct: stats.hazardous_pct },
  ];

  return (
    <div className="space-y-4">
      {impact && <ImpactCounter impact={impact} />}

      {/* Header strip — total items + contamination rate */}
      <div className="glass-card p-3 flex items-center justify-between text-sm">
        <div>
          <p className="text-2xl font-bold text-violet-300 leading-none">{total}</p>
          <p className="text-xs text-gray-500 mt-1 uppercase tracking-wider">Total Items</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-amber-300 leading-none">
            {Math.round(stats.contamination_rate * 100)}<span className="text-base">%</span>
          </p>
          <p className="text-xs text-gray-500 mt-1 uppercase tracking-wider">Contamination</p>
        </div>
      </div>

      {/* Per-category tiles */}
      <div className="grid grid-cols-2 gap-3">
        {categoryStats.map((c) => (
          <CategoryTile
            key={c.key}
            icon={ICONS[c.key] ?? ""}
            label={c.label}
            count={c.count}
            pct={c.pct}
            color={COLORS[c.key]}
          />
        ))}
      </div>

      {/* Pie chart with icon callouts */}
      {pieData.length > 0 && (
        <div className="glass-card p-4">
          <p className="text-xs text-gray-500 uppercase tracking-widest mb-3">Distribution</p>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie
                data={pieData}
                cx="50%"
                cy="50%"
                innerRadius={45}
                outerRadius={70}
                paddingAngle={3}
                dataKey="value"
                labelLine={false}
                label={renderIconCallout}
                isAnimationActive={false}
              >
                {pieData.map((entry) => (
                  <Cell key={entry.name} fill={COLORS[entry.name] ?? "#6b7280"} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ background: "#1f2937", border: "none", borderRadius: 8 }}
                labelStyle={{ color: "#fff" }}
                itemStyle={{ color: "#d1d5db" }}
                formatter={(value: number, name: string) => [
                  `${value} item${value === 1 ? "" : "s"}`,
                  `${ICONS[name] ?? ""} ${name}`,
                ]}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex flex-wrap justify-center gap-3 mt-2">
            {pieData.map((d) => (
              <span key={d.name} className="flex items-center gap-1 text-xs text-gray-300">
                <span
                  className="w-2.5 h-2.5 rounded-full inline-block"
                  style={{ backgroundColor: COLORS[d.name] ?? "#6b7280" }}
                />
                <span>{ICONS[d.name] ?? ""}</span>
                <span className="font-semibold">{d.name}</span>
                <span className="text-gray-500">· {d.value}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Recent events */}
      {recentEvents.length > 0 && (
        <div className="glass-card p-4">
          <p className="text-xs text-gray-500 uppercase tracking-widest mb-3">Recent Activity</p>
          <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
            {recentEvents.slice(0, 10).map((ev) => (
              <div
                key={ev.id}
                className="flex items-center justify-between text-sm py-1.5 border-b border-white/5 last:border-0"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: COLORS[ev.category] ?? "#6b7280" }}
                  />
                  <span className="text-gray-300 truncate max-w-36">{ev.item_description}</span>
                  {ev.is_contaminated && (
                    <span className="text-yellow-500 text-xs">⚠️</span>
                  )}
                </div>
                <span className="text-gray-600 text-xs flex-shrink-0">
                  {new Date(ev.created_at).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CategoryTile({
  icon,
  label,
  count,
  pct,
  color,
}: {
  icon: string;
  label: string;
  count: number;
  pct: number;
  color: string;
}) {
  return (
    <div
      className="glass-card p-3 text-center"
      style={{ borderTop: `2px solid ${color}55` }}
    >
      <div className="flex items-baseline justify-center gap-1.5">
        <span className="text-lg leading-none">{icon}</span>
        <span className="text-3xl font-bold leading-none" style={{ color }}>
          {count}
        </span>
        <span className="text-xs font-semibold text-gray-400">{pct}%</span>
      </div>
      <p className="text-[11px] text-gray-500 mt-1.5 uppercase tracking-wider">{label}</p>
    </div>
  );
}
