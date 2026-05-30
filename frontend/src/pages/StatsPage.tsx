import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Clock, Flame, BookCheck, Layers } from "lucide-react";
import { getHeatmap, getStatsSummary, getTimeseries } from "../api/client";
import CalendarHeatmap from "../components/stats/CalendarHeatmap";

function Card({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="bg-[#11151c] border border-slate-800 rounded-xl p-4">
      <div className="flex items-center gap-2 text-slate-400 text-sm mb-2">
        {icon} {label}
      </div>
      <div className="text-2xl font-semibold">{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </div>
  );
}

export default function StatsPage() {
  const { data: summary } = useQuery({ queryKey: ["stats-summary"], queryFn: getStatsSummary });
  const { data: series } = useQuery({
    queryKey: ["stats-ts"],
    queryFn: () => getTimeseries("minutes", "day", 30),
  });
  const year = new Date().getFullYear();
  const { data: heatmap } = useQuery({ queryKey: ["stats-heatmap", year], queryFn: () => getHeatmap(year) });

  const fmtMinutes = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-5">Reading statistics</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card
          icon={<Clock size={16} />}
          label="Total time"
          value={summary ? fmtMinutes(summary.total_minutes) : "-"}
          sub={summary ? `${summary.total_sessions} sessions` : ""}
        />
        <Card
          icon={<Flame size={16} />}
          label="Current streak"
          value={summary ? `${summary.current_streak} d` : "-"}
          sub={summary ? `longest ${summary.longest_streak} d` : ""}
        />
        <Card
          icon={<BookCheck size={16} />}
          label="Finished"
          value={summary ? String(summary.documents_finished) : "-"}
          sub={summary ? `${summary.documents_started} started` : ""}
        />
        <Card
          icon={<Layers size={16} />}
          label="This week"
          value={summary ? fmtMinutes(summary.minutes_this_week) : "-"}
          sub={summary ? `${fmtMinutes(summary.minutes_today)} today` : ""}
        />
      </div>

      <div className="bg-[#11151c] border border-slate-800 rounded-xl p-4 mb-6">
        <h2 className="text-sm text-slate-400 mb-4">Minutes read (last 30 days)</h2>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={series || []}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="bucket" tick={{ fill: "#64748b", fontSize: 11 }} tickFormatter={(d) => d.slice(5)} />
            <YAxis tick={{ fill: "#64748b", fontSize: 11 }} />
            <Tooltip
              contentStyle={{ background: "#0e1117", border: "1px solid #1e293b", borderRadius: 8 }}
              labelStyle={{ color: "#cbd5e1" }}
            />
            <Bar dataKey="value" fill="#6366f1" radius={[3, 3, 0, 0]} name="minutes" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-[#11151c] border border-slate-800 rounded-xl p-4">
        <h2 className="text-sm text-slate-400 mb-4">Activity in {year}</h2>
        <CalendarHeatmap data={heatmap || []} year={year} />
      </div>
    </div>
  );
}
