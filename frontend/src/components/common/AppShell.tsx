import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  BookOpen,
  FileText,
  Library,
  Layers,
  Menu,
  Search,
  Settings,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { listShelves } from "../../api/client";

const navItem =
  "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors";
const active = "bg-indigo-600/20 text-indigo-300";
const idle = "text-slate-400 hover:bg-slate-800 hover:text-slate-200";

export default function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const [q, setQ] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { data: shelves } = useQuery({ queryKey: ["shelves"], queryFn: listShelves });

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname, location.search]);

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (q.trim()) navigate(`/?q=${encodeURIComponent(q.trim())}`);
  };

  const link = ({ isActive }: { isActive: boolean }) => `${navItem} ${isActive ? active : idle}`;

  return (
    <div className="flex h-screen">
      {/* Backdrop for the mobile drawer */}
      {drawerOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-30 md:hidden"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 w-60 border-r border-slate-800 bg-[#0e1117] flex flex-col
          transform transition-transform duration-200
          md:static md:translate-x-0 md:z-auto
          ${drawerOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="px-5 py-5 flex items-center gap-2">
          <BookOpen className="text-indigo-400" size={22} />
          <span className="font-semibold text-lg">library-book</span>
          <button
            className="ml-auto md:hidden text-slate-500 hover:text-slate-200"
            onClick={() => setDrawerOpen(false)}
            aria-label="Close menu"
          >
            <X size={20} />
          </button>
        </div>
        <nav className="px-3 space-y-1">
          <NavLink to="/" end className={link}>
            <Library size={18} /> All
          </NavLink>
          <NavLink to="/books" className={link}>
            <BookOpen size={18} /> Books
          </NavLink>
          <NavLink to="/papers" className={link}>
            <FileText size={18} /> Papers
          </NavLink>
          <NavLink to="/stats" className={link}>
            <BarChart3 size={18} /> Stats
          </NavLink>
          <NavLink to="/shelves" className={link}>
            <Layers size={18} /> Shelves
          </NavLink>
          <NavLink to="/upload" className={link}>
            <Upload size={18} /> Upload
          </NavLink>
        </nav>

        {shelves && shelves.length > 0 && (
          <div className="px-3 mt-5">
            <div className="px-3 text-xs uppercase tracking-wide text-slate-600 mb-1">Shelves</div>
            <div className="space-y-0.5 max-h-64 overflow-y-auto">
              {shelves.map((s) => (
                <NavLink key={s.id} to={`/shelf/${s.id}`} className={link}>
                  <span className="truncate">{s.name}</span>
                  <span className="ml-auto text-xs text-slate-600">{s.document_count}</span>
                </NavLink>
              ))}
            </div>
          </div>
        )}

        <div className="mt-auto px-3 pb-4">
          <NavLink to="/settings" className={link}>
            <Settings size={18} /> Settings
          </NavLink>
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden min-w-0">
        <header className="h-14 shrink-0 border-b border-slate-800 flex items-center px-4 md:px-6 gap-3">
          <button
            className="md:hidden text-slate-300 hover:text-white"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
          >
            <Menu size={22} />
          </button>
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
        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
