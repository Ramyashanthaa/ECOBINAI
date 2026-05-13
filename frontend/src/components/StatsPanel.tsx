import React from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { StatsData, WasteEvent } from "../types";

const COLORS: Record<string, string> = {
  RECYCLABLE: "#22c55e",
  COMPOST: "#f97316",
  TRASH: "#9ca3af",
  HAZARDOUS: "#ef4444",
};

interface Props {
  stats: StatsData | null;
  recentEvents: WasteEvent[];
}

export default function StatsPanel({ stats, recentEvents }: Props) {
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

  return (
    <div className="space-y-4">
      {/* Summary tiles */}
      <div className="grid grid-cols-2 gap-3">
        <StatTile label="Total Items" value={stats.total_items} unit="" color="#a78bfa" />
        <StatTile
          label="Contamination Rate"
          value={Math.round(stats.contamination_rate * 100)}
          unit="%"
          color="#fbbf24"
        />
        <StatTile label="Recyclable" value={stats.recyclable_pct} unit="%" color="#22c55e" />
        <StatTile label="Compost" value={stats.compost_pct} unit="%" color="#f97316" />
      </div>

      {/* Pie chart */}
      {pieData.length > 0 && (
        <div className="glass-card p-4">
          <p className="text-xs text-gray-500 uppercase tracking-widest mb-3">Distribution</p>
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie
                data={pieData}
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={75}
                paddingAngle={3}
                dataKey="value"
              >
                {pieData.map((entry) => (
                  <Cell key={entry.name} fill={COLORS[entry.name] ?? "#6b7280"} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ background: "#1f2937", border: "none", borderRadius: 8 }}
                labelStyle={{ color: "#fff" }}
                itemStyle={{ color: "#d1d5db" }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex flex-wrap justify-center gap-3 mt-2">
            {pieData.map((d) => (
              <span key={d.name} className="flex items-center gap-1 text-xs text-gray-400">
                <span
                  className="w-2.5 h-2.5 rounded-full inline-block"
                  style={{ backgroundColor: COLORS[d.name] ?? "#6b7280" }}
                />
                {d.name}: {d.value}
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

function StatTile({
  label,
  value,
  unit,
  color,
}: {
  label: string;
  value: number;
  unit: string;
  color: string;
}) {
  return (
    <div className="glass-card p-3 text-center">
      <p className="text-2xl font-bold" style={{ color }}>
        {value}
        <span className="text-sm">{unit}</span>
      </p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
    </div>
  );
}
