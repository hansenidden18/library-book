import type { HeatmapPoint } from "../../api/types";

// A GitHub-style calendar heatmap of reading minutes per day.
export default function CalendarHeatmap({ data, year }: { data: HeatmapPoint[]; year: number }) {
  const byDate = new Map(data.map((d) => [d.date, d.minutes]));
  const start = new Date(year, 0, 1);
  const end = new Date(year, 11, 31);

  // Build weeks (columns) of 7 days (rows), starting on Sunday.
  const days: { date: string; minutes: number }[] = [];
  const cursor = new Date(start);
  // pad to start of week
  const pad = cursor.getDay();
  for (let i = 0; i < pad; i++) days.push({ date: "", minutes: -1 });
  while (cursor <= end) {
    const iso = cursor.toISOString().slice(0, 10);
    days.push({ date: iso, minutes: byDate.get(iso) ?? 0 });
    cursor.setDate(cursor.getDate() + 1);
  }

  const weeks: typeof days[] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  const color = (m: number) => {
    if (m < 0) return "transparent";
    if (m === 0) return "#1e293b";
    if (m < 15) return "#3730a3";
    if (m < 45) return "#4f46e5";
    if (m < 90) return "#6366f1";
    return "#a5b4fc";
  };

  return (
    <div className="overflow-x-auto">
      <div className="flex gap-1">
        {weeks.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-1">
            {week.map((d, di) => (
              <div
                key={di}
                title={d.date ? `${d.date}: ${d.minutes} min` : ""}
                className="w-3 h-3 rounded-sm"
                style={{ background: color(d.minutes) }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
