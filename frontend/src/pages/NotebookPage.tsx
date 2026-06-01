import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Download, NotebookPen } from "lucide-react";
import { getNotebook, notebookExportUrl } from "../api/client";
import type { NotebookEntry } from "../api/client";

export default function NotebookPage() {
  const { data, isLoading } = useQuery({ queryKey: ["notebook"], queryFn: () => getNotebook() });

  // Group entries by document, preserving order.
  const groups: { id: number; title: string; type: string; items: NotebookEntry[] }[] = [];
  const index = new Map<number, number>();
  for (const e of data || []) {
    if (!index.has(e.document_id)) {
      index.set(e.document_id, groups.length);
      groups.push({ id: e.document_id, title: e.document_title, type: e.doc_type, items: [] });
    }
    groups[index.get(e.document_id)!].items.push(e);
  }

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <NotebookPen size={22} /> Notebook
        </h1>
        {data && data.length > 0 && (
          <a
            href={notebookExportUrl()}
            download
            className="text-sm px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 flex items-center gap-1"
          >
            <Download size={14} /> Export Markdown
          </a>
        )}
      </div>

      {isLoading ? (
        <p className="text-slate-500">Loading...</p>
      ) : groups.length === 0 ? (
        <p className="text-slate-500">
          No highlights or notes yet. Highlight text while reading and it'll show up here.
        </p>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <div key={g.id}>
              <Link
                to={`/document/${g.id}`}
                className="font-medium hover:text-indigo-300 flex items-center gap-2"
              >
                {g.title}
                <span className="text-xs uppercase text-slate-600">{g.type}</span>
              </Link>
              <div className="mt-2 space-y-2 border-l-2 border-slate-800 pl-4">
                {g.items.map((it) => (
                  <Link
                    key={it.id}
                    to={`/read/${it.document_id}`}
                    className="block group"
                  >
                    {it.kind === "bookmark" ? (
                      <span className="text-sm text-slate-400">
                        🔖 Bookmark {it.pdf_page ? `p.${it.pdf_page}` : ""}
                      </span>
                    ) : (
                      <>
                        <div className="flex gap-2">
                          <span
                            className="w-1 shrink-0 rounded"
                            style={{ background: it.color || "#fbbf24" }}
                          />
                          <p className="text-sm text-slate-300 group-hover:text-white">
                            {it.selected_text || "(highlight)"}
                            {it.pdf_page && (
                              <span className="text-xs text-slate-600"> · p.{it.pdf_page}</span>
                            )}
                          </p>
                        </div>
                        {it.note && <p className="text-xs text-slate-500 ml-3 mt-0.5">{it.note}</p>}
                      </>
                    )}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
