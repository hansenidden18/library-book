import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Layers, Plus, Trash2 } from "lucide-react";
import { createShelf, deleteShelf, listShelves } from "../api/client";

export default function ShelvesPage() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const { data: shelves } = useQuery({ queryKey: ["shelves"], queryFn: listShelves });

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    await createShelf(name.trim());
    setName("");
    qc.invalidateQueries({ queryKey: ["shelves"] });
  };

  const remove = async (id: number) => {
    if (!confirm("Delete this shelf? Documents stay in your library.")) return;
    await deleteShelf(id);
    qc.invalidateQueries({ queryKey: ["shelves"] });
  };

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold mb-5">Shelves</h1>

      <form onSubmit={add} className="flex gap-2 mb-6">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New shelf name (e.g. To Read, ML Papers)"
          className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
        />
        <button className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm flex items-center gap-1">
          <Plus size={16} /> Add
        </button>
      </form>

      <div className="space-y-2">
        {shelves?.map((s) => (
          <div
            key={s.id}
            className="flex items-center gap-3 bg-[#11151c] border border-slate-800 rounded-lg px-4 py-3"
          >
            <Layers size={18} className="text-indigo-400" />
            <Link to={`/shelf/${s.id}`} className="font-medium hover:text-indigo-300">
              {s.name}
            </Link>
            <span className="text-xs text-slate-500">{s.document_count} items</span>
            <button onClick={() => remove(s.id)} className="ml-auto text-slate-500 hover:text-rose-400">
              <Trash2 size={16} />
            </button>
          </div>
        ))}
        {shelves?.length === 0 && <p className="text-slate-500">No shelves yet.</p>}
      </div>
    </div>
  );
}
