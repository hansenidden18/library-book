import { useEffect, useRef, useState } from "react";
import ePub, { type Book, type Rendition } from "epubjs";
import { ChevronLeft, ChevronRight, Highlighter, Trash2, X } from "lucide-react";
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

export default function EpubReader({ doc, initialCfi }: Props) {
  const viewerRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const [ready, setReady] = useState(false);
  const [highlights, setHighlights] = useState<Annotation[]>([]);
  const [showPanel, setShowPanel] = useState(false);
  const { reportProgress } = useReadingSession(doc.id);

  // Remove a highlight: from epub.js, the backend, and local state.
  const removeHighlight = async (ann: Annotation) => {
    try {
      if (ann.epub_cfi_range) {
        renditionRef.current?.annotations.remove(ann.epub_cfi_range, "highlight");
      }
    } catch {
      /* not currently rendered */
    }
    await deleteAnnotation(ann.id);
    setHighlights((prev) => prev.filter((h) => h.id !== ann.id));
  };

  // Draw a highlight in the rendition. epub.js redraws stored annotations
  // automatically on page turns, so each is added exactly once.
  const drawHighlight = (rendition: Rendition, a: Annotation) => {
    if (!a.epub_cfi_range) return;
    try {
      rendition.annotations.add(
        "highlight",
        a.epub_cfi_range,
        { id: a.id },
        () => removeHighlight(a), // click also removes (best-effort)
        "lb-hl",
        { fill: a.color || "#fbbf24", "fill-opacity": "0.3", "mix-blend-mode": "multiply" },
      );
    } catch {
      /* range not resolvable yet */
    }
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
          spread: "auto",
        });
        renditionRef.current = rendition;
        rendition.themes.default({
          body: { background: "#f6f3ec", color: "#1a1a1a", padding: "0 8px" },
        });

        rendition.display(initialCfi || undefined);

        rendition.on("relocated", (location: any) => {
          const cfi = location?.start?.cfi;
          let percent = 0;
          try {
            percent = Math.round((book!.locations.percentageFromCfi(cfi) || 0) * 100);
          } catch {
            /* locations not ready yet */
          }
          reportProgress({ epub_cfi: cfi, percent });
        });

        // Create a highlight when the user selects text.
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

        // Load existing highlights once; epub.js re-draws them across pages.
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

  return (
    <div className="flex flex-col h-full">
      <div className="h-12 shrink-0 border-b border-slate-800 flex items-center px-4 gap-3 text-sm bg-[#0e1117]">
        <span className="text-slate-400">{ready ? "Select text to highlight" : "Preparing..."}</span>
        <button
          onClick={() => setShowPanel((s) => !s)}
          className="ml-auto flex items-center gap-1 px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200"
        >
          <Highlighter size={14} /> Highlights ({highlights.length})
        </button>
      </div>

      <div className="flex-1 relative overflow-hidden">
        <div className="absolute inset-0 bg-[#f6f3ec]">
          <button
            onClick={prev}
            className="absolute left-0 top-0 bottom-0 z-10 px-3 text-slate-500 hover:text-slate-900 hover:bg-black/5"
          >
            <ChevronLeft />
          </button>
          <div ref={viewerRef} className="h-full mx-12" />
          <button
            onClick={next}
            className="absolute right-0 top-0 bottom-0 z-10 px-3 text-slate-500 hover:text-slate-900 hover:bg-black/5"
          >
            <ChevronRight />
          </button>
        </div>

        {/* Highlights panel - reliable delete, since clicking inside the epub
            iframe is finicky. */}
        {showPanel && (
          <div className="absolute top-0 right-0 bottom-0 w-80 bg-[#0e1117] border-l border-slate-800 z-20 flex flex-col">
            <div className="flex items-center px-4 py-3 border-b border-slate-800">
              <span className="font-medium text-sm">Highlights</span>
              <button
                onClick={() => setShowPanel(false)}
                className="ml-auto text-slate-500 hover:text-slate-200"
              >
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
