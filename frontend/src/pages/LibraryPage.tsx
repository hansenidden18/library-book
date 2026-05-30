import { useQuery } from "@tanstack/react-query";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { BookOpen } from "lucide-react";
import { listDocuments } from "../api/client";
import type { DocFilters } from "../api/client";
import BookCard from "../components/library/BookCard";

export default function LibraryPage({ docType }: { docType?: string }) {
  const { shelfId } = useParams();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") || undefined;
  const sort = params.get("sort") || "added_desc";
  const status = params.get("status") || undefined;

  const filters: DocFilters = {
    type: docType,
    shelf: shelfId ? Number(shelfId) : undefined,
    q,
    sort,
    status,
  };

  const { data, isLoading } = useQuery({
    queryKey: ["documents", filters],
    queryFn: () => listDocuments(filters),
  });

  const title = q
    ? `Search: "${q}"`
    : docType === "paper"
      ? "Papers"
      : docType === "book"
        ? "Books"
        : shelfId
          ? "Shelf"
          : "Library";

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <div className="flex gap-2">
          <select
            value={status || ""}
            onChange={(e) => setParam("status", e.target.value)}
            className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-sm"
          >
            <option value="">All status</option>
            <option value="unread">Unread</option>
            <option value="reading">Reading</option>
            <option value="finished">Finished</option>
          </select>
          <select
            value={sort}
            onChange={(e) => setParam("sort", e.target.value)}
            className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-sm"
          >
            <option value="added_desc">Newest</option>
            <option value="added_asc">Oldest</option>
            <option value="title_asc">Title A-Z</option>
            <option value="title_desc">Title Z-A</option>
            <option value="year_desc">Year</option>
          </select>
        </div>
      </div>

      {isLoading ? (
        <div className="text-slate-500">Loading...</div>
      ) : !data || data.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center text-slate-500">
          <BookOpen size={40} className="mb-3 opacity-40" />
          <p className="mb-2">Nothing here yet.</p>
          <Link to="/upload" className="text-indigo-400 hover:underline">
            Upload your first document
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-5">
          {data.map((doc) => (
            <BookCard key={doc.id} doc={doc} />
          ))}
        </div>
      )}
    </div>
  );
}
