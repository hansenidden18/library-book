import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

export default function SettingsPage() {
  const { data } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => (await api.get("/settings")).data,
  });

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold mb-5">Settings</h1>
      <div className="bg-[#11151c] border border-slate-800 rounded-xl p-5 space-y-3 text-sm">
        <Row label="Watch folder import" value={data?.watch_enabled ? "Enabled" : "Disabled"} />
        <Row label="Watch folder path" value={data?.watch_folder || "-"} mono />
        <Row label="Metadata auto-fetch" value={data?.metadata_fetch_enabled ? "Enabled" : "Disabled"} />
        <p className="text-slate-500 pt-2 border-t border-slate-800">
          These are configured via environment variables on the server (see{" "}
          <code className="bg-slate-800 px-1 rounded">docker-compose.yml</code>). No login is required:
          this is a single-user instance.
        </p>
      </div>
      <div className="mt-6 bg-[#11151c] border border-slate-800 rounded-xl p-5 text-sm">
        <h2 className="font-medium mb-2">External readers (OPDS)</h2>
        <p className="text-slate-400">
          Point any OPDS-capable reader (KOReader, Thorium, Marvin, etc.) at:
        </p>
        <code className="block mt-2 bg-slate-900 px-3 py-2 rounded text-indigo-300">
          {location.origin}/opds
        </code>
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-400">{label}</span>
      <span className={mono ? "font-mono text-xs text-slate-300" : "text-slate-200"}>{value}</span>
    </div>
  );
}
