import { useEffect, useRef, useState } from "react";
import ePub, { type Book, type Rendition } from "epubjs";
import { ChevronLeft, ChevronRight } from "lucide-react";
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
  const annsRef = useRef<Annotation[]>([]);
  const [ready, setReady] = useState(false);
  const { reportProgress } = useReadingSession(doc.id);

  useEffect(() => {
    let book: Book | null = null;
    let destroyed = false;

    // Fetch the .epub as an ArrayBuffer and open it as binary. Passing the
    // bare URL makes epub.js treat it as an unpacked directory and request
    // META-INF/container.xml, which the SPA would mis-serve.
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
        wireRendition(book, rendition);

        // Generate locations for percentage progress (async, best-effort).
        book.ready
          .then(() => book!.locations.generate(1000))
          .then(() => setReady(true))
          .catch(() => setReady(true));
      });

    function wireRendition(book: Book, rendition: Rendition) {

    rendition.on("relocated", (location: any) => {
      const cfi = location?.start?.cfi;
      let percent = 0;
      try {
        percent = Math.round((book.locations.percentageFromCfi(cfi) || 0) * 100);
      } catch {
        /* locations not ready yet */
      }
      reportProgress({ epub_cfi: cfi, percent });
    });

    // Highlight on text selection.
    rendition.on("selected", async (cfiRange: string, contents: any) => {
      const text = contents.window.getSelection()?.toString() || "";
      const ann = await createAnnotation(doc.id, {
        kind: "highlight",
        epub_cfi_range: cfiRange,
        selected_text: text,
        color: "#fbbf24",
      });
      annsRef.current.push(ann);
      applyHighlight(rendition, ann);
      contents.window.getSelection()?.removeAllRanges();
    });

    // Load + draw existing highlights.
    listAnnotations(doc.id, "highlight").then((anns) => {
      annsRef.current = anns;
      rendition.on("rendered", () => anns.forEach((a) => applyHighlight(rendition, a)));
      anns.forEach((a) => applyHighlight(rendition, a));
    });
    } // end wireRendition

    return () => {
      destroyed = true;
      book?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id]);

  const applyHighlight = (rendition: Rendition, a: Annotation) => {
    if (!a.epub_cfi_range) return;
    try {
      rendition.annotations.add(
        "highlight",
        a.epub_cfi_range,
        {},
        async () => {
          if (confirm("Delete this highlight?")) {
            await deleteAnnotation(a.id);
            rendition.annotations.remove(a.epub_cfi_range!, "highlight");
            annsRef.current = annsRef.current.filter((x) => x.id !== a.id);
          }
        },
        "lb-hl",
        { fill: a.color || "#fbbf24", "fill-opacity": "0.3" },
      );
    } catch {
      /* range may not be in the rendered view yet */
    }
  };

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

  return (
    <div className="flex flex-col h-full">
      <div className="h-12 shrink-0 border-b border-slate-800 flex items-center px-4 text-sm bg-[#0e1117]">
        <span className="text-slate-400">{ready ? "Select text to highlight" : "Preparing..."}</span>
      </div>
      <div className="flex-1 relative bg-[#f6f3ec]">
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
    </div>
  );
}
