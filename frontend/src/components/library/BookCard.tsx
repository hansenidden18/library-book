import { Link, useNavigate } from "react-router-dom";
import { BookOpen, FileText } from "lucide-react";
import type { Document } from "../../api/types";
import { coverUrl } from "../../api/client";

export default function BookCard({ doc }: { doc: Document }) {
  const navigate = useNavigate();
  const cover = coverUrl(doc);
  const percent = doc.progress?.percent ?? 0;
  const status = doc.progress?.status ?? "unread";

  return (
    <div className="group flex flex-col">
      <button
        onClick={() => navigate(`/read/${doc.id}`)}
        className="relative aspect-[2/3] rounded-lg overflow-hidden bg-slate-800 border border-slate-800 hover:border-indigo-500 transition-colors"
        title={`Read "${doc.title}"`}
      >
        {cover ? (
          <img src={cover} alt={doc.title} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2 p-3 text-center">
            {doc.doc_type === "paper" ? (
              <FileText size={28} className="text-slate-600" />
            ) : (
              <BookOpen size={28} className="text-slate-600" />
            )}
            <span className="text-xs text-slate-400 line-clamp-4">{doc.title}</span>
          </div>
        )}
        {status === "finished" && (
          <span className="absolute top-2 right-2 bg-emerald-600 text-white text-[10px] px-1.5 py-0.5 rounded">
            Read
          </span>
        )}
        {percent > 0 && status !== "finished" && (
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/40">
            <div className="h-full bg-indigo-500" style={{ width: `${percent}%` }} />
          </div>
        )}
      </button>
      <Link to={`/document/${doc.id}`} className="mt-2 text-sm font-medium line-clamp-2 hover:text-indigo-300">
        {doc.title}
      </Link>
      <div className="text-xs text-slate-500 line-clamp-1">
        {doc.authors.map((a) => a.name).join(", ") || "Unknown author"}
      </div>
    </div>
  );
}
