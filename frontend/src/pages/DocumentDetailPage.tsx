import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { BookOpen, Download, Lock, Trash2, Sparkles, Plus } from "lucide-react";
import {
  addToShelf,
  applyMetadata,
  citationUrl,
  coverUrl,
  deleteDocument,
  getDocument,
  importEmbeddedAnnotations,
  listShelves,
  searchMetadata,
  setDocumentTags,
  updateDocument,
} from "../api/client";
import type { Document, MetadataCandidate } from "../api/types";

export default function DocumentDetailPage() {
  const { id } = useParams();
  const docId = Number(id);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [showFetch, setShowFetch] = useState(false);
  const [tagInput, setTagInput] = useState("");

  const { data: doc } = useQuery({ queryKey: ["document", docId], queryFn: () => getDocument(docId) });
  const { data: shelves } = useQuery({ queryKey: ["shelves"], queryFn: listShelves });

  if (!doc) return <div className="text-slate-500">Loading...</div>;

  const cover = coverUrl(doc, false);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["document", docId] });
    qc.invalidateQueries({ queryKey: ["documents"] });
  };

  const addTag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tagInput.trim()) return;
    const names = [...doc.tags.map((t) => t.name), tagInput.trim()];
    await setDocumentTags(docId, names);
    setTagInput("");
    invalidate();
  };

  const removeTag = async (name: string) => {
    await setDocumentTags(docId, doc.tags.filter((t) => t.name !== name).map((t) => t.name));
    invalidate();
  };

  const remove = async () => {
    if (!confirm("Delete this document and its file?")) return;
    await deleteDocument(docId, true);
    qc.invalidateQueries({ queryKey: ["documents"] });
    qc.invalidateQueries({ queryKey: ["shelves"] });
    navigate("/");
  };

  return (
    <div className="max-w-4xl">
      <div className="flex gap-6">
        <div className="w-48 shrink-0">
          <div className="aspect-[2/3] rounded-lg overflow-hidden bg-slate-800 border border-slate-800">
            {cover ? (
              <img src={cover} alt={doc.title} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <BookOpen className="text-slate-600" />
              </div>
            )}
          </div>
          <button
            onClick={() => navigate(`/read/${doc.id}`)}
            className="mt-3 w-full py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium flex items-center justify-center gap-2"
          >
            <BookOpen size={16} /> Read
          </button>
        </div>

        <div className="flex-1">
          {editing ? (
            <MetadataEditor doc={doc} onDone={() => { setEditing(false); invalidate(); }} />
          ) : (
            <>
              <div className="flex items-start gap-2">
                <h1 className="text-2xl font-semibold flex-1">{doc.title}</h1>
                <span className="text-xs uppercase px-2 py-1 rounded bg-slate-800 text-slate-400">
                  {doc.doc_type}
                </span>
              </div>
              {doc.subtitle && <p className="text-slate-400 mt-1">{doc.subtitle}</p>}
              <p className="text-slate-300 mt-2">{doc.authors.map((a) => a.name).join(", ")}</p>

              <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-500 mt-3">
                {doc.year && <span>Year: {doc.year}</span>}
                {doc.published_date && <span>Published: {doc.published_date}</span>}
                {doc.publisher && <span>{doc.publisher}</span>}
                {doc.venue && <span>{doc.venue}</span>}
                {doc.doi && <span>DOI: {doc.doi}</span>}
                {doc.arxiv_id && <span>arXiv: {doc.arxiv_id}</span>}
                {doc.isbn13 && <span>ISBN: {doc.isbn13}</span>}
                {doc.page_count && <span>{doc.page_count} pages</span>}
                {doc.progress && <span>Progress: {Math.round(doc.progress.percent)}%</span>}
              </div>

              {doc.description && (
                <p className="text-sm text-slate-300 mt-4 leading-relaxed whitespace-pre-line">
                  {doc.description}
                </p>
              )}

              <div className="flex flex-wrap gap-2 mt-4">
                <button onClick={() => setEditing(true)} className="btn-sec">Edit metadata</button>
                <button onClick={() => setShowFetch(true)} className="btn-sec flex items-center gap-1">
                  <Sparkles size={14} /> Fetch metadata
                </button>
                <a href={citationUrl(doc.id, "bibtex")} target="_blank" className="btn-sec">BibTeX</a>
                <a href={citationUrl(doc.id, "ris")} target="_blank" className="btn-sec">RIS</a>
                <a href={`/api/documents/${doc.id}/file`} download className="btn-sec flex items-center gap-1">
                  <Download size={14} /> Download
                </a>
                {doc.file_format === "pdf" && (
                  <button
                    onClick={async () => {
                      const res = await importEmbeddedAnnotations(doc.id);
                      if (res.imported > 0) alert(`Imported ${res.imported} highlight(s)/note(s).`);
                      else if (res.skipped) alert("This document already has highlights in the app.");
                      else alert("No embedded highlights found in this PDF.");
                    }}
                    className="btn-sec"
                    title="Import highlights you made in another PDF viewer"
                  >
                    Import highlights
                  </button>
                )}
                {doc.metadata_locked && (
                  <span className="text-xs text-amber-400 flex items-center gap-1">
                    <Lock size={12} /> locked
                  </span>
                )}
                <button onClick={remove} className="btn-sec text-rose-400 ml-auto flex items-center gap-1">
                  <Trash2 size={14} /> Delete
                </button>
              </div>
            </>
          )}

          {/* tags */}
          <div className="mt-6">
            <h3 className="text-sm text-slate-400 mb-2">Tags</h3>
            <div className="flex flex-wrap items-center gap-2">
              {doc.tags.map((t) => (
                <button
                  key={t.id}
                  onClick={() => removeTag(t.name)}
                  className="text-xs bg-slate-800 hover:bg-rose-900/40 px-2 py-1 rounded-full"
                  title="Click to remove"
                >
                  {t.name} ✕
                </button>
              ))}
              <form onSubmit={addTag}>
                <input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  placeholder="add tag"
                  className="text-xs bg-slate-900 border border-slate-800 rounded-full px-2 py-1 w-24 focus:outline-none focus:border-indigo-500"
                />
              </form>
            </div>
          </div>

          {/* add to shelf */}
          <div className="mt-5">
            <h3 className="text-sm text-slate-400 mb-2">Add to shelf</h3>
            <div className="flex flex-wrap gap-2">
              {shelves?.map((s) => (
                <button
                  key={s.id}
                  onClick={async () => { await addToShelf(s.id, docId); qc.invalidateQueries({ queryKey: ["shelves"] }); }}
                  className="text-xs bg-slate-800 hover:bg-indigo-600/30 px-2.5 py-1 rounded-full flex items-center gap-1"
                >
                  <Plus size={12} /> {s.name}
                </button>
              ))}
              <Link to="/shelves" className="text-xs text-indigo-400 px-2 py-1">manage shelves</Link>
            </div>
          </div>
        </div>
      </div>

      {showFetch && (
        <MetadataFetchDialog doc={doc} onClose={() => setShowFetch(false)} onApplied={() => { setShowFetch(false); invalidate(); }} />
      )}

      <style>{`.btn-sec{font-size:.8rem;background:#1e293b;padding:.4rem .7rem;border-radius:.5rem;color:#cbd5e1}.btn-sec:hover{background:#334155}`}</style>
    </div>
  );
}

function MetadataEditor({ doc, onDone }: { doc: Document; onDone: () => void }) {
  const [form, setForm] = useState({
    title: doc.title,
    subtitle: doc.subtitle || "",
    authors: doc.authors.map((a) => a.name).join(", "),
    description: doc.description || "",
    year: doc.year?.toString() || "",
    venue: doc.venue || "",
    publisher: doc.publisher || "",
    doi: doc.doi || "",
    arxiv_id: doc.arxiv_id || "",
    isbn13: doc.isbn13 || "",
    doc_type: doc.doc_type as string,
    metadata_locked: doc.metadata_locked,
  });

  const save = async () => {
    await updateDocument(doc.id, {
      title: form.title,
      subtitle: form.subtitle || null,
      description: form.description || null,
      year: form.year ? Number(form.year) : null,
      venue: form.venue || null,
      publisher: form.publisher || null,
      doi: form.doi || null,
      arxiv_id: form.arxiv_id || null,
      isbn13: form.isbn13 || null,
      doc_type: form.doc_type as any,
      metadata_locked: form.metadata_locked,
      authors: form.authors.split(",").map((s) => s.trim()).filter(Boolean),
    });
    onDone();
  };

  const field = (key: keyof typeof form, label: string, full = false) => (
    <label className={`flex flex-col gap-1 ${full ? "col-span-2" : ""}`}>
      <span className="text-xs text-slate-500">{label}</span>
      <input
        value={form[key] as string}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        className="bg-slate-900 border border-slate-800 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-indigo-500"
      />
    </label>
  );

  return (
    <div className="grid grid-cols-2 gap-3">
      {field("title", "Title", true)}
      {field("authors", "Authors (comma separated)", true)}
      {field("year", "Year")}
      {field("venue", "Venue / Series")}
      {field("publisher", "Publisher")}
      {field("doi", "DOI")}
      {field("arxiv_id", "arXiv ID")}
      {field("isbn13", "ISBN")}
      <label className="flex flex-col gap-1 col-span-2">
        <span className="text-xs text-slate-500">Description / Abstract</span>
        <textarea
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          rows={4}
          className="bg-slate-900 border border-slate-800 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-indigo-500"
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.metadata_locked}
          onChange={(e) => setForm({ ...form, metadata_locked: e.target.checked })}
        />
        Lock metadata
      </label>
      <select
        value={form.doc_type}
        onChange={(e) => setForm({ ...form, doc_type: e.target.value })}
        className="bg-slate-900 border border-slate-800 rounded px-2 py-1.5 text-sm"
      >
        <option value="book">book</option>
        <option value="paper">paper</option>
      </select>
      <div className="col-span-2 flex gap-2">
        <button onClick={save} className="px-4 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-sm">
          Save
        </button>
        <button onClick={onDone} className="px-4 py-1.5 rounded bg-slate-800 text-sm">Cancel</button>
      </div>
    </div>
  );
}

function MetadataFetchDialog({
  doc,
  onClose,
  onApplied,
}: {
  doc: Document;
  onClose: () => void;
  onApplied: () => void;
}) {
  const [query, setQuery] = useState(doc.doi || doc.arxiv_id || doc.title);
  const [results, setResults] = useState<MetadataCandidate[]>([]);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    const q = query.trim();
    const isDoi = /^10\.\d{4,}/.test(q);
    const isArxiv = /\d{4}\.\d{4,5}/.test(q) && doc.doc_type === "paper";
    const isIsbn = /^\d{9,13}[\dxX]?$/.test(q.replace(/-/g, ""));
    try {
      const res = await searchMetadata({
        type: doc.doc_type,
        doi: isDoi ? q : "",
        arxiv: isArxiv ? q : "",
        isbn: isIsbn ? q.replace(/-/g, "") : "",
        query: !isDoi && !isArxiv && !isIsbn ? q : "",
      });
      setResults(res);
    } finally {
      setLoading(false);
    }
  };

  const apply = async (c: MetadataCandidate) => {
    await applyMetadata(doc.id, c);
    onApplied();
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-6" onClick={onClose}>
      <div
        className="bg-[#11151c] border border-slate-800 rounded-xl w-full max-w-2xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-slate-800">
          <h2 className="font-medium mb-2">Fetch metadata ({doc.doc_type})</h2>
          <div className="flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && run()}
              placeholder={doc.doc_type === "paper" ? "DOI, arXiv ID, or title" : "ISBN or title"}
              className="flex-1 bg-slate-900 border border-slate-800 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-indigo-500"
            />
            <button onClick={run} className="px-4 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-sm">
              Search
            </button>
          </div>
        </div>
        <div className="p-4 overflow-y-auto space-y-2">
          {loading && <p className="text-slate-500 text-sm">Searching...</p>}
          {!loading && results.length === 0 && <p className="text-slate-500 text-sm">No results yet.</p>}
          {results.map((c, i) => (
            <button
              key={i}
              onClick={() => apply(c)}
              className="w-full text-left bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-lg p-3"
            >
              <div className="flex items-center gap-2">
                <span className="text-xs uppercase text-indigo-400">{c.source}</span>
                {c.year && <span className="text-xs text-slate-500">{c.year}</span>}
              </div>
              <div className="font-medium text-sm">{c.title}</div>
              <div className="text-xs text-slate-400">{c.authors.join(", ")}</div>
              {c.venue && <div className="text-xs text-slate-500">{c.venue}</div>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
