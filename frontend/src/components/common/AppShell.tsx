import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  BookOpen,
  FileText,
  Library,
  Layers,
  Search,
  Settings,
  Upload,
} from "lucide-react";
import { useState } from "react";
import { listShelves } from "../../api/client";

const navItem =
  "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors";
const active = "bg-indigo-600/20 text-indigo-300";
const idle = "text-slate-400 hover:bg-slate-800 hover:text-slate-200";

export default function AppShell() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const { data: shelves } = useQuery({ queryKey: ["shelves"], queryFn: listShelves });

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (q.trim()) navigate(`/?q=${encodeURIComponent(q.trim())}`);
  };

  return (
    <div className="flex h-screen">
      <aside className="w-60 shrink-0 border-r border-slate-800 bg-[#0e1117] flex flex-col">
        <div className="px-5 py-5 flex items-center gap-2">
          <BookOpen className="text-indigo-400" size={22} />
          <span className="font-semibold text-lg">library-book</span>
        </div>
        <nav className="px-3 space-y-1">
          <NavLink to="/" end className={({ isActive }) => `${navItem} ${isActive ? active : idle}`}>
            <Library size={18} /> All
          </NavLink>
          <NavLink to="/books" className={({ isActive }) => `${navItem} ${isActive ? active : idle}`}>
            <BookOpen size={18} /> Books
          </NavLink>
          <NavLink to="/papers" className={({ isActive }) => `${navItem} ${isActive ? active : idle}`}>
            <FileText size={18} /> Papers
          </NavLink>
          <NavLink to="/stats" className={({ isActive }) => `${navItem} ${isActive ? active : idle}`}>
            <BarChart3 size={18} /> Stats
          </NavLink>
          <NavLink to="/shelves" className={({ isActive }) => `${navItem} ${isActive ? active : idle}`}>
            <Layers size={18} /> Shelves
          </NavLink>
          <NavLink to="/upload" className={({ isActive }) => `${navItem} ${isActive ? active : idle}`}>
            <Upload size={18} /> Upload
          </NavLink>
        </nav>

        {shelves && shelves.length > 0 && (
          <div className="px-3 mt-5">
            <div className="px-3 text-xs uppercase tracking-wide text-slate-600 mb-1">Shelves</div>
            <div className="space-y-0.5 max-h-64 overflow-y-auto">
              {shelves.map((s) => (
                <NavLink
                  key={s.id}
                  to={`/shelf/${s.id}`}
                  className={({ isActive }) => `${navItem} ${isActive ? active : idle}`}
                >
                  <span className="truncate">{s.name}</span>
                  <span className="ml-auto text-xs text-slate-600">{s.document_count}</span>
                </NavLink>
              ))}
            </div>
          </div>
        )}

        <div className="mt-auto px-3 pb-4">
          <NavLink to="/settings" className={({ isActive }) => `${navItem} ${isActive ? active : idle}`}>
            <Settings size={18} /> Settings
          </NavLink>
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="h-14 border-b border-slate-800 flex items-center px-6 gap-4">
          <form onSubmit={submitSearch} className="relative flex-1 max-w-xl">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search title, author, abstract, tags..."
              className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-sm focus:outline-none focus:border-indigo-500"
            />
          </form>
        </header>
        <div className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
