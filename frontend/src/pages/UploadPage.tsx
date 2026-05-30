import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { UploadCloud, FolderSync, CheckCircle2, XCircle } from "lucide-react";
import { getImportStatus, triggerScan, uploadDocument } from "../api/client";

export default function UploadPage() {
  const [docType, setDocType] = useState("auto");
  const [dragOver, setDragOver] = useState(false);
  const [log, setLog] = useState<{ name: string; ok: boolean; msg: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: importStatus, refetch } = useQuery({
    queryKey: ["import-status"],
    queryFn: getImportStatus,
    refetchInterval: 5000,
  });

  const handleFiles = async (files: FileList | File[]) => {
    setBusy(true);
    for (const file of Array.from(files)) {
      try {
        await uploadDocument(file, docType);
        setLog((l) => [{ name: file.name, ok: true, msg: "imported" }, ...l]);
      } catch (e: any) {
        const msg = e?.response?.data?.detail || "failed";
        setLog((l) => [{ name: file.name, ok: false, msg }, ...l]);
      }
    }
    setBusy(false);
    qc.invalidateQueries({ queryKey: ["documents"] });
  };

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold mb-5">Add documents</h1>

      <div className="flex items-center gap-2 mb-2">
        {["auto", "book", "paper"].map((t) => (
          <button
            key={t}
            onClick={() => setDocType(t)}
            className={`px-4 py-1.5 rounded-lg text-sm capitalize ${
              docType === t ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-400"
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      <p className="text-xs text-slate-500 mb-4">
        <strong>Auto</strong> detects papers from an arXiv ID or DOI in the PDF; everything else
        is filed as a book. You can change the type later on the document page.
      </p>

      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
        className={`flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-xl py-16 cursor-pointer transition-colors ${
          dragOver ? "border-indigo-500 bg-indigo-600/10" : "border-slate-700 hover:border-slate-500"
        }`}
      >
        <UploadCloud size={40} className="text-slate-500" />
        <div className="text-slate-300">
          {busy ? "Uploading..." : "Drop PDF / EPUB files here, or click to browse"}
        </div>
        <div className="text-xs text-slate-500">Adding as: {docType}</div>
        <input
          type="file"
          accept=".pdf,.epub"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />
      </label>

      {log.length > 0 && (
        <div className="mt-5 space-y-1">
          {log.map((l, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              {l.ok ? (
                <CheckCircle2 size={16} className="text-emerald-500" />
              ) : (
                <XCircle size={16} className="text-rose-500" />
              )}
              <span className="text-slate-300">{l.name}</span>
              <span className="text-slate-500">- {l.msg}</span>
            </div>
          ))}
          <button onClick={() => navigate("/")} className="mt-3 text-indigo-400 text-sm hover:underline">
            Go to library →
          </button>
        </div>
      )}

      <div className="mt-10 border-t border-slate-800 pt-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-medium flex items-center gap-2">
            <FolderSync size={18} /> Watch folder
          </h2>
          <button
            onClick={async () => {
              await triggerScan();
              refetch();
              qc.invalidateQueries({ queryKey: ["documents"] });
            }}
            className="text-sm px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700"
          >
            Scan now
          </button>
        </div>
        <p className="text-sm text-slate-500 mb-3">
          Drop files into{" "}
          <code className="bg-slate-800 px-1.5 py-0.5 rounded text-slate-300">
            {importStatus?.watch_folder}
          </code>{" "}
          and they'll be imported automatically. Put papers under a{" "}
          <code className="bg-slate-800 px-1 rounded">papers/</code> subfolder.
        </p>
        {importStatus?.recent?.length > 0 && (
          <div className="space-y-1 text-sm">
            {importStatus.recent.slice(0, 8).map((r: any, i: number) => (
              <div key={i} className="flex items-center gap-2">
                <span className={r.status === "imported" ? "text-emerald-500" : "text-slate-500"}>
                  {r.status}
                </span>
                <span className="text-slate-300">{r.file || r.title}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
