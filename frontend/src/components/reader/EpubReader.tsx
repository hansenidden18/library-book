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
  updateAnnotation,
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

const HL_COLORS = ["#fbbf24", "#86efac", "#93c5fd", "#fca5a5", "#d8b4fe"];

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
  const [hlColor, setHlColor] = useState<string>(() => load("lb-epub-hlcolor", HL_COLORS[0]));
  const hlColorRef = useRef(hlColor);
  hlColorRef.current = hlColor;
  const fontPctRef = useRef(fontPct);
  fontPctRef.current = fontPct;

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
            color: hlColorRef.current,
          });
          setHighlights((prev) => [...prev, ann]);
          drawHighlight(rendition, ann);
        });

        // Touch gestures inside the epub.js iframe:
        //  - pinch with two fingers -> change font size (text reflows, like
        //    Google Books)
        //  - swipe / tap left-right thirds -> turn the page
        rendition.hooks.content.register((contents: any) => {
          const cdoc = contents.document;
          const cwin = contents.window;
          let sx = 0,
            sy = 0,
            st = 0;
          let pinching = false,
            pinchStartDist = 0,
            pinchStartPct = 110,
            lastRatio = 1;
          const dist = (t: TouchList) =>
            Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

          cdoc.addEventListener(
            "touchstart",
            (e: TouchEvent) => {
              if (e.touches.length === 2) {
                pinching = true;
                pinchStartDist = dist(e.touches);
                pinchStartPct = fontPctRef.current;
                lastRatio = 1;
              } else {
                const t = e.changedTouches[0];
                sx = t.clientX;
                sy = t.clientY;
                st = Date.now();
              }
            },
            { passive: true },
          );
          cdoc.addEventListener(
            "touchmove",
            (e: TouchEvent) => {
              if (pinching && e.touches.length === 2) {
                e.preventDefault();
                lastRatio = dist(e.touches) / pinchStartDist;
              }
            },
            { passive: false },
          );
          cdoc.addEventListener(
            "touchend",
            (e: TouchEvent) => {
              if (pinching) {
                if (e.touches.length < 2) {
                  pinching = false;
                  const next = Math.round(
                    Math.min(220, Math.max(70, pinchStartPct * lastRatio)) / 5,
                  ) * 5;
                  if (next !== fontPctRef.current) setFontPct(next);
                  lastRatio = 1;
                }
                return;
              }
              const t = e.changedTouches[0];
              const dx = t.clientX - sx;
              const dy = t.clientY - sy;
              if (cwin.getSelection()?.toString()) return;
              if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) {
                dx < 0 ? rendition.next() : rendition.prev();
              } else if (Date.now() - st < 250 && Math.abs(dx) < 10 && Math.abs(dy) < 10) {
                const w = cwin.innerWidth;
                if (t.clientX < w * 0.3) rendition.prev();
                else if (t.clientX > w * 0.7) rendition.next();
              }
            },
            { passive: true },
          );
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
    save("lb-epub-hlcolor", hlColor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, fontPct, lineHeight, serif, hlColor]);

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
        <div className="flex items-center gap-1.5 ml-2">
          {HL_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setHlColor(c)}
              className={`w-5 h-5 rounded-full border-2 ${hlColor === c ? "border-white" : "border-transparent"}`}
              style={{ background: c }}
              title="Highlight color"
            />
          ))}
        </div>
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
              onInc={() => setFontPct((v) => Math.min(220, v + 10))}
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
                  <textarea
                    defaultValue={h.note || ""}
                    placeholder="Add a note..."
                    onBlur={async (e) => {
                      const note = e.target.value.trim();
                      if (note !== (h.note || "")) {
                        await updateAnnotation(h.id, { note });
                        setHighlights((prev) =>
                          prev.map((x) => (x.id === h.id ? { ...x, note } : x)),
                        );
                      }
                    }}
                    rows={1}
                    className="mt-1.5 w-full bg-slate-950/40 border border-slate-800 rounded px-2 py-1 text-xs text-slate-300 focus:outline-none focus:border-indigo-500 resize-none"
                  />
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
