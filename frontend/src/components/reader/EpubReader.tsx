import { useEffect, useRef, useState } from "react";
import ePub, { type Book, type Rendition } from "epubjs";
import {
  ChevronLeft,
  ChevronRight,
  Highlighter,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import {
  createAnnotation,
  deleteAnnotation,
  fileUrl,
  listAnnotations,
} from "../../api/client";
import type { Annotation, Document } from "../../api/types";
import { useReadingSession } from "../../hooks/useReadingSession";

interface Props {
  doc: Document;
  initialCfi: string | null;
}

type ThemeName = "light" | "sepia" | "dark";

const THEME_BG: Record<ThemeName, string> = {
  light: "#faf8f4",
  sepia: "#f4ecd8",
  dark: "#15171c",
};
const THEME_FG: Record<ThemeName, string> = {
  light: "#1b1b1b",
  sepia: "#5b4636",
  dark: "#cfd3da",
};

const SERIF = '"Iowan Old Style", "Palatino Linotype", Georgia, "Times New Roman", serif';
const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

// Persisted reading preferences.
const load = <T,>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
};
const save = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
};

export default function EpubReader({ doc, initialCfi }: Props) {
  const viewerRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);

  const [ready, setReady] = useState(false);
  const [highlights, setHighlights] = useState<Annotation[]>([]);
  const [showPanel, setShowPanel] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const [theme, setTheme] = useState<ThemeName>(() => load("lb-epub-theme", "light"));
  const [fontPct, setFontPct] = useState<number>(() => load("lb-epub-fontpct", 110));
  const [lineHeight, setLineHeight] = useState<number>(() => load("lb-epub-lh", 1.7));
  const [serif, setSerif] = useState<boolean>(() => load("lb-epub-serif", true));

  const { reportProgress } = useReadingSession(doc.id);

  const removeHighlight = async (ann: Annotation) => {
    try {
      if (ann.epub_cfi_range)
        renditionRef.current?.annotations.remove(ann.epub_cfi_range, "highlight");
    } catch {
      /* not currently rendered */
    }
    await deleteAnnotation(ann.id);
    setHighlights((prev) => prev.filter((h) => h.id !== ann.id));
  };

  const drawHighlight = (rendition: Rendition, a: Annotation) => {
    if (!a.epub_cfi_range) return;
    try {
      rendition.annotations.add(
        "highlight",
        a.epub_cfi_range,
        { id: a.id },
        () => removeHighlight(a),
        "lb-hl",
        { fill: a.color || "#fbbf24", "fill-opacity": "0.3", "mix-blend-mode": "multiply" },
      );
    } catch {
      /* range not resolvable yet */
    }
  };

  // Apply typography + theme to the rendition. Safe to call repeatedly.
  const applyStyles = (rendition: Rendition) => {
    const fg = THEME_FG[theme];
    const bg = THEME_BG[theme];
    rendition.themes.override("color", fg, true);
    rendition.themes.override("background", bg, true);
    rendition.themes.default({
      // Paint the real page background (html + body) so dark/sepia cover the
      // whole page, not just the outer margins.
      html: { background: `${bg} !important` },
      body: {
        "font-family": `${serif ? SERIF : SANS} !important`,
        "line-height": `${lineHeight} !important`,
        color: `${fg} !important`,
        background: `${bg} !important`,
        padding: "0 !important",
        margin: "0 !important",
        "text-rendering": "optimizeLegibility",
      },
      p: {
        "line-height": `${lineHeight} !important`,
        color: `${fg} !important`,
        "text-align": "justify",
        "-webkit-hyphens": "auto",
        hyphens: "auto",
        "overflow-wrap": "break-word",
      },
      "div, span, li": { color: `${fg} !important` },
      a: { color: `${fg} !important` },
      "h1, h2, h3, h4, h5, h6": { color: `${fg} !important`, "line-height": "1.3 !important" },
      img: { "max-width": "100% !important", height: "auto !important" },
    });
    rendition.themes.fontSize(`${fontPct}%`);
  };

  useEffect(() => {
    let book: Book | null = null;
    let destroyed = false;

    fetch(fileUrl(doc.id))
      .then((r) => r.arrayBuffer())
      .then((buf) => {
        if (destroyed) return;
        book = ePub(buf);
        bookRef.current = book;
        const rendition = book.renderTo(viewerRef.current!, {
          width: "100%",
          height: "100%",
          flow: "paginated",
          spread: "none", // single, centered column - Google Books feel
        });
        renditionRef.current = rendition;
        applyStyles(rendition);
        rendition.display(initialCfi || undefined);

        rendition.on("relocated", (location: any) => {
          const cfi = location?.start?.cfi;
          let percent = 0;
          try {
            percent = Math.round((book!.locations.percentageFromCfi(cfi) || 0) * 100);
          } catch {
            /* not ready */
          }
          reportProgress({ epub_cfi: cfi, percent });
        });

        rendition.on("selected", async (cfiRange: string, contents: any) => {
          const text = contents.window.getSelection()?.toString() || "";
          contents.window.getSelection()?.removeAllRanges();
          const ann = await createAnnotation(doc.id, {
            kind: "highlight",
            epub_cfi_range: cfiRange,
            selected_text: text,
            color: "#fbbf24",
          });
          setHighlights((prev) => [...prev, ann]);
          drawHighlight(rendition, ann);
        });

        listAnnotations(doc.id, "highlight").then((anns) => {
          setHighlights(anns);
          anns.forEach((a) => drawHighlight(rendition, a));
        });

        book.ready
          .then(() => book!.locations.generate(1000))
          .then(() => setReady(true))
          .catch(() => setReady(true));
      });

    return () => {
      destroyed = true;
      book?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id]);

  // Re-apply styles when a reading preference changes.
  useEffect(() => {
    if (renditionRef.current) applyStyles(renditionRef.current);
    save("lb-epub-theme", theme);
    save("lb-epub-fontpct", fontPct);
    save("lb-epub-lh", lineHeight);
    save("lb-epub-serif", serif);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, fontPct, lineHeight, serif]);

  const prev = () => renditionRef.current?.prev();
  const next = () => renditionRef.current?.next();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    };
    window.addEventListener("keyup", onKey);
    return () => window.removeEventListener("keyup", onKey);
  }, []);

  const goTo = (cfi: string | null) => {
    if (cfi) renditionRef.current?.display(cfi);
  };

  const uiDark = theme === "dark";

  return (
    <div className="flex flex-col h-full">
      <div className="h-12 shrink-0 border-b border-slate-800 flex items-center px-4 gap-2 text-sm bg-[#0e1117]">
        <span className="text-slate-400 hidden sm:inline">
          {ready ? "Select text to highlight" : "Preparing..."}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => {
              setShowSettings((s) => !s);
              setShowPanel(false);
            }}
            className="flex items-center gap-1 px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200"
          >
            <Settings2 size={14} /> Aa
          </button>
          <button
            onClick={() => {
              setShowPanel((s) => !s);
              setShowSettings(false);
            }}
            className="flex items-center gap-1 px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200"
          >
            <Highlighter size={14} /> {highlights.length}
          </button>
        </div>
      </div>

      <div className="flex-1 relative overflow-hidden" style={{ background: THEME_BG[theme] }}>
        {/* Centered reading column with generous margins, like Google Books. */}
        <div className="absolute inset-0 flex justify-center">
          <button
            onClick={prev}
            className={`absolute left-0 top-0 bottom-0 z-10 px-2 sm:px-4 ${uiDark ? "text-slate-500 hover:text-slate-200" : "text-slate-400 hover:text-slate-700"} hover:bg-black/5`}
            aria-label="Previous page"
          >
            <ChevronLeft />
          </button>
          <div
            ref={viewerRef}
            className="h-full w-full"
            style={{ maxWidth: "44rem", paddingLeft: "1rem", paddingRight: "1rem" }}
          />
          <button
            onClick={next}
            className={`absolute right-0 top-0 bottom-0 z-10 px-2 sm:px-4 ${uiDark ? "text-slate-500 hover:text-slate-200" : "text-slate-400 hover:text-slate-700"} hover:bg-black/5`}
            aria-label="Next page"
          >
            <ChevronRight />
          </button>
        </div>

        {/* Reading settings popover */}
        {showSettings && (
          <div className="absolute top-3 right-3 w-72 bg-[#0e1117] border border-slate-800 rounded-xl z-30 p-4 shadow-xl text-sm">
            <div className="flex items-center mb-3">
              <span className="font-medium">Reading settings</span>
              <button onClick={() => setShowSettings(false)} className="ml-auto text-slate-500 hover:text-slate-200">
                <X size={16} />
              </button>
            </div>

            <div className="mb-4">
              <div className="text-xs text-slate-500 mb-1">Theme</div>
              <div className="flex gap-2">
                {(["light", "sepia", "dark"] as ThemeName[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTheme(t)}
                    className={`flex-1 py-2 rounded-lg border capitalize ${theme === t ? "border-indigo-500" : "border-slate-700"}`}
                    style={{ background: THEME_BG[t], color: THEME_FG[t] }}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-4">
              <div className="text-xs text-slate-500 mb-1">Font</div>
              <div className="flex gap-2">
                <button
                  onClick={() => setSerif(true)}
                  className={`flex-1 py-1.5 rounded-lg border ${serif ? "border-indigo-500 text-indigo-300" : "border-slate-700 text-slate-300"}`}
                  style={{ fontFamily: "Georgia, serif" }}
                >
                  Serif
                </button>
                <button
                  onClick={() => setSerif(false)}
                  className={`flex-1 py-1.5 rounded-lg border ${!serif ? "border-indigo-500 text-indigo-300" : "border-slate-700 text-slate-300"}`}
                >
                  Sans
                </button>
              </div>
            </div>

            <Stepper
              label="Font size"
              value={`${fontPct}%`}
              onDec={() => setFontPct((v) => Math.max(70, v - 10))}
              onInc={() => setFontPct((v) => Math.min(200, v + 10))}
            />
            <Stepper
              label="Line spacing"
              value={lineHeight.toFixed(1)}
              onDec={() => setLineHeight((v) => Math.max(1.2, +(v - 0.1).toFixed(1)))}
              onInc={() => setLineHeight((v) => Math.min(2.4, +(v + 0.1).toFixed(1)))}
            />
          </div>
        )}

        {/* Highlights panel */}
        {showPanel && (
          <div className="absolute top-0 right-0 bottom-0 w-80 bg-[#0e1117] border-l border-slate-800 z-30 flex flex-col">
            <div className="flex items-center px-4 py-3 border-b border-slate-800">
              <span className="font-medium text-sm">Highlights</span>
              <button onClick={() => setShowPanel(false)} className="ml-auto text-slate-500 hover:text-slate-200">
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {highlights.length === 0 && (
                <p className="text-slate-500 text-sm">No highlights yet. Select text to add one.</p>
              )}
              {highlights.map((h) => (
                <div key={h.id} className="bg-slate-900 border border-slate-800 rounded-lg p-2">
                  <button
                    onClick={() => goTo(h.epub_cfi_range)}
                    className="text-left text-xs text-slate-300 line-clamp-3 hover:text-indigo-300 w-full"
                    title="Go to highlight"
                  >
                    <span
                      className="inline-block w-2 h-2 rounded-full mr-1 align-middle"
                      style={{ background: h.color || "#fbbf24" }}
                    />
                    {h.selected_text || "(highlight)"}
                  </button>
                  {h.note && <p className="text-xs text-slate-500 mt-1">{h.note}</p>}
                  <button
                    onClick={() => removeHighlight(h)}
                    className="mt-1 text-xs text-rose-400 hover:text-rose-300 flex items-center gap-1"
                  >
                    <Trash2 size={12} /> Delete
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Stepper({
  label,
  value,
  onDec,
  onInc,
}: {
  label: string;
  value: string;
  onDec: () => void;
  onInc: () => void;
}) {
  return (
    <div className="flex items-center justify-between mb-3">
      <span className="text-xs text-slate-500">{label}</span>
      <div className="flex items-center gap-2">
        <button onClick={onDec} className="w-7 h-7 rounded bg-slate-800 hover:bg-slate-700">
          -
        </button>
        <span className="w-12 text-center tabular-nums text-slate-200">{value}</span>
        <button onClick={onInc} className="w-7 h-7 rounded bg-slate-800 hover:bg-slate-700">
          +
        </button>
      </div>
    </div>
  );
}
